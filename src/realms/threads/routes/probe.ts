import { Context } from 'hono';

/*
 * 暫時的診斷端點。第一版回答了「爬蟲 UA 讀 threads.com 從 Cloudflare 打得通嗎」——
 * 答案是通（12/12，requireLogin 全為 false）。但同時量到 msToBody 中位數 4.3–5.4 秒，
 * 遠超預算，所以第二版改問下一個問題：
 *
 *   「哪一種 UA / 端點，能在預算內拿到我們真正需要的東西？」
 *
 * 關鍵在於資料的位置：og: meta 在文件 0.2% 處，但帶媒體的 JSON 區塊落在 50–94%。
 * 所以「讀完整個 body」不是必要的 —— 只要串流到那個區塊收完就能中止。
 * msToData 量的就是這件事，也就是正式實作實際會付出的延遲。
 *
 * 驗證完整個檔案刪掉，連同 router 裡那一行。
 */

const CRAWLER_UA = {
  /* 資料最完整，但也最慢（本機 3.6s / 線上 5.4s 中位數）。 */
  gb: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  /* 本機實測 2.15s，帶的回覆較少（21 vs 45 edges）—— 對我們反而是優點，
     因為只需要焦點貼文。目前最看好的候選。 */
  bb: 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
  fb: 'facebookexternalhit/1.1'
} as const;

/* 不接受任意網址 —— 網址由我們自己組，避免這個端點變成開放代理。 */
const SHORTCODE = /^[A-Za-z0-9_-]{5,30}$/;
const HANDLE = /^[A-Za-z0-9._]{1,40}$/;

/** 目標是含 thread_items 的那個 `<script type="application/json" data-sjs>` 區塊。 */
const SJS_OPEN = /<script type="application\/json"[^>]*data-sjs[^>]*>/g;

/**
 * 串流讀取，一拿到目標區塊就中止剩下的 body。
 *
 * 回傳 `bytesRead` 是為了看清楚「省了多少」—— 區塊結束在文件 92% 處時省不了多少，
 * 但那個數字本身就是要不要走這條路的依據。
 */
async function readUntilDataBlock(res: Response): Promise<{
  found: boolean;
  block: string | null;
  bytesRead: number;
}> {
  const reader = res.body?.getReader();
  if (!reader) return { found: false, block: null, bytesRead: 0 };

  const decoder = new TextDecoder();
  let buf = '';
  let bytesRead = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      buf += decoder.decode(value, { stream: true });

      /* 只在看到收尾標籤時才掃描，避免每個 chunk 都重掃整個緩衝區。 */
      if (!buf.includes('thread_items') || !buf.includes('</script>')) continue;

      SJS_OPEN.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = SJS_OPEN.exec(buf)) !== null) {
        const start = m.index + m[0].length;
        const end = buf.indexOf('</script>', start);
        if (end === -1) continue;
        const block = buf.slice(start, end);
        if (block.includes('thread_items')) {
          await reader.cancel().catch(() => undefined);
          return { found: true, block, bytesRead };
        }
      }
    }
  } catch {
    /* 讀到一半失敗就當作沒找到，交給呼叫端 fallback。 */
  }
  return { found: false, block: null, bytesRead };
}

/** 在巢狀的 ScheduledServerJS 結構裡找出形狀為 `{data:{data:{edges}}}` 的節點。 */
function findEdgesHolder(node: unknown, depth = 0): Record<string, unknown> | null {
  if (!node || typeof node !== 'object' || depth > 14) return null;
  if (Array.isArray(node)) {
    for (const v of node) {
      const hit = findEdgesHolder(v, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  const o = node as Record<string, unknown>;
  const inner = (o.data as { data?: { edges?: unknown } } | undefined)?.data;
  if (inner && Array.isArray(inner.edges)) return o;
  for (const k of Object.keys(o)) {
    const hit = findEdgesHolder(o[k], depth + 1);
    if (hit) return hit;
  }
  return null;
}

export const threadsProbeRequest = async (c: Context) => {
  const code = c.req.query('code') ?? 'DdNwfAwiZcO';
  const handle = c.req.query('handle') ?? '150_one_fifty';
  const uaKey = (c.req.query('ua') ?? 'bb') as keyof typeof CRAWLER_UA;
  const embed = c.req.query('embed') === '1';

  if (!SHORTCODE.test(code) || !HANDLE.test(handle) || !CRAWLER_UA[uaKey]) {
    return c.json({ error: 'bad params' }, 400);
  }

  const target = `https://www.threads.com/@${handle}/post/${code}${embed ? '/embed' : ''}`;
  const started = Date.now();
  const result: Record<string, unknown> = { target, ua: uaKey, embed };

  let res: Response;
  try {
    res = await fetch(target, {
      headers: {
        'User-Agent': CRAWLER_UA[uaKey],
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      redirect: 'follow'
    });
  } catch (err) {
    result.phase = 'fetch';
    result.error = err instanceof Error ? err.message : String(err);
    result.ms = Date.now() - started;
    return c.json(result, 200);
  }

  result.status = res.status;
  result.msToHeaders = Date.now() - started;

  if (embed) {
    /* /embed 很小（約 48 KB），直接整份讀完即可。它沒有 JSON，要的是
       「作者 / 內文 / 貼文圖片」是否都在。 */
    const body = await res.text();
    result.msToBody = Date.now() - started;
    result.bytes = body.length;
    result.hasHandle = body.includes(handle);
    /* t51.71878-15 是貼文媒體路徑，t51.2885-19 是頭像 —— 完整頁面的 og:image
       指向後者，所以這裡要確認 /embed 真的給的是前者。 */
    result.hasPostMedia = body.includes('t51.71878-15');
    result.hasAvatar = body.includes('t51.2885-19');
    return c.json(result, 200);
  }

  const { found, block, bytesRead } = await readUntilDataBlock(res);
  result.msToData = Date.now() - started;
  result.bytesRead = bytesRead;
  result.foundBlock = found;
  result.blockLength = block?.length ?? 0;

  if (block) {
    const parseStart = Date.now();
    try {
      const holder = findEdgesHolder(JSON.parse(block));
      result.msToParse = Date.now() - parseStart;
      const edges = (
        holder as { data?: { data?: { edges?: { node?: Record<string, unknown> }[] } } } | null
      )?.data?.data?.edges;
      result.edges = edges?.length ?? 0;
      const items = edges?.[0]?.node?.thread_items;
      result.threadItems = Array.isArray(items) ? items.length : 0;
      const post = Array.isArray(items)
        ? ((items[0] as { post?: Record<string, unknown> })?.post ?? null)
        : null;
      result.postCode = post?.code ?? null;
      result.mediaType = post?.media_type ?? null;
    } catch (err) {
      result.parseError = err instanceof Error ? err.message : String(err);
    }
  }

  result.msTotal = Date.now() - started;
  return c.json(result, 200);
};
