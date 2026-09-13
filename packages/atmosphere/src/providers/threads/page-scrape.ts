import { fetchSameOriginHttps } from '../../helpers/same-origin-https-fetch.js';
import { withTimeout } from '../../helpers/with-timeout.js';
import { THREADS_CRAWLER_USER_AGENT, THREADS_ORIGIN } from './constants.js';

/*
 * 從 threads.com 的頁面 HTML 取貼文資料，取代 logged-out GraphQL。
 *
 * 為什麼要有這條路：Meta 對 Cloudflare 出口 IP 的 logged-out GraphQL 查詢會回 401
 * 「Please wait a few minutes before you try again」，實測成功率只有 20–25%，
 * 而同一支查詢從家用 IP 是 100%。擋的是**出口 IP 的信譽**。
 *
 * 但 Meta 擋的其實只有 API —— 用爬蟲 UA 讀同一則貼文的頁面，從 Cloudflare 打
 * 實測 20/20 成功，`require_login` 一次都沒出現。而且頁面裡內嵌的
 * `adp_BarcelonaPostPageDirectQueryRelayPreloader` 就是同一支 Relay 查詢的結果，
 * 形狀與 GraphQL 回應完全相同 —— 所以 processor 那一整套可以原封不動沿用。
 */

/** 含 thread_items 的那個區塊的開頭標記。 */
const SJS_SCRIPT_OPEN = '<script type="application/json"';
const SCRIPT_CLOSE = '</script>';
const DATA_MARKER = 'thread_items';

/** 搜尋時往回重疊的長度，避免標記剛好被切在兩個 chunk 中間而漏掉。 */
const OVERLAP = DATA_MARKER.length + SCRIPT_CLOSE.length;

/* 上游卡住時不要把整個請求拖垮 —— 爬蟲不會等。線上中位數 1.95 秒，5 秒已經很寬裕。
   不重試：呼叫端本來就有 fallback，重試只會讓失敗的那次更慢。 */
const PAGE_TIMEOUT_MS = 5000;
const PAGE_RETRIES = 0;

/**
 * 串流讀取，一拿到目標區塊就 `cancel()` 掉剩下的 body。
 *
 * 這個提早中止不是微調，是這條路可不可行的關鍵：線上實測讀完整個 body 要 3.7–5.2 秒，
 * 中止後只要 1.95 秒。資料區塊落在文件約 50–92% 處，後面那段對我們毫無用處。
 *
 * 掃描刻意維持 O(n)：每個 chunk 只從上次搜尋過的位置往後找，不重掃整個緩衝區 ——
 * 緩衝區會長到 700 KB 以上，每個 chunk 重掃一次就會吃掉免費方案 10 ms 的 CPU 額度。
 */
async function readDataBlock(res: Response): Promise<string | null> {
  const reader = res.body?.getReader();
  if (!reader) return null;

  const decoder = new TextDecoder();
  let buf = '';
  /* 還沒找到 thread_items 時，從這裡開始找；找到之後改成找 </script> 的起點。 */
  let searchFrom = 0;
  let markerAt = -1;

  /* 這裡刻意不 catch。逾時會 abort 掉 body 串流，讓 reader.read() 拋出 ——
     吞掉它就會把「來不及讀完」回報成「頁面沒有資料區塊」，兩者的處置完全不同
     （前者該調預算，後者代表 Meta 改了頁面結構）。讓它往上拋，由 fetchThreadsPageJson
     的 catch 連同錯誤訊息一起記錄。 */
  for (;;) {
    const { done, value } = await reader.read();
    /* 串流正常結束卻沒找到 —— 這才是真的「這一頁沒有那個區塊」。 */
    if (done) return null;
    buf += decoder.decode(value, { stream: true });

    if (markerAt === -1) {
      const hit = buf.indexOf(DATA_MARKER, searchFrom);
      if (hit === -1) {
        searchFrom = Math.max(0, buf.length - OVERLAP);
        continue;
      }
      markerAt = hit;
      searchFrom = hit;
    }

    const close = buf.indexOf(SCRIPT_CLOSE, searchFrom);
    if (close === -1) {
      searchFrom = Math.max(markerAt, buf.length - OVERLAP);
      continue;
    }

    /* 標記所在的那個 <script> 的開頭，往回找即可 —— 區塊本身就是我們要的範圍。 */
    const open = buf.lastIndexOf(SJS_SCRIPT_OPEN, markerAt);
    if (open === -1) return null;
    const contentStart = buf.indexOf('>', open);
    if (contentStart === -1 || contentStart > markerAt) return null;

    await reader.cancel().catch(() => undefined);
    return buf.slice(contentStart + 1, close);
  }
}

/**
 * 在巢狀的 ScheduledServerJS 結構裡找出形狀為 `{ data: { data: { edges } } }` 的節點。
 *
 * 刻意用搜尋而不是寫死路徑（實測是
 * `require[0][3][0].__bbox.require[0][3][1].__bbox.result`）—— 那串巢狀是 Meta 的
 * 打包細節，隨時會變，而「哪個節點長得像 GraphQL 回應」這件事穩定得多。
 */
function findEdgesHolder(node: unknown, depth = 0): unknown | null {
  if (!node || typeof node !== 'object' || depth > 14) return null;
  if (Array.isArray(node)) {
    for (const value of node) {
      const hit = findEdgesHolder(value, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  const record = node as Record<string, unknown>;
  const inner = (record.data as { data?: { edges?: unknown } } | undefined)?.data;
  if (inner && Array.isArray(inner.edges)) return record;
  for (const key of Object.keys(record)) {
    const hit = findEdgesHolder(record[key], depth + 1);
    if (hit) return hit;
  }
  return null;
}

export type ThreadsPageResult = {
  ok: boolean;
  status: number;
  /** 與 `fetchThreadsPostPage` 回傳的 json 同形狀，可直接餵給 `extractPostPageEdges`。 */
  json: unknown | null;
};

/**
 * 抓一個 threads.com 的貼文頁並取出內嵌的查詢結果。
 *
 * `path` 用不需要 handle 的形式（`/t/<code>`、`/share/<code>`）—— provider 只拿得到
 * shortcode。實測 `/t/`、`/post/`、甚至帶錯 handle 的 `/@wrong/post/<code>` 都會回同一份
 * 資料，Threads 是以 shortcode 解析的。`/share/<code>` 也一樣，所以分享短連結不需要
 * 先解析成正規網址再抓第二次。
 */
export async function fetchThreadsPageJson(path: string): Promise<ThreadsPageResult> {
  const url = `${THREADS_ORIGIN}${path}`;
  try {
    return await withTimeout(
      async signal => {
        const res = await fetchSameOriginHttps(url, {
          headers: {
            /* 一定要是爬蟲 UA。帶瀏覽器 UA 拿到的是空殼頁（實測 270 KB、0 個
               thread_items），內容全靠前端 JS 補 —— Worker 裡沒有 JS 可以跑。
               選 bingbot 而非 Googlebot 是因為它帶的回覆少（21 vs 45 edges），
               線上實測 1.95s vs 2.6s，而我們只需要焦點貼文。 */
            'User-Agent': THREADS_CRAWLER_USER_AGENT,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9'
          },
          signal
        });
        if (!res.ok) {
          console.error('[threads] page fetch non-ok', { path, status: res.status });
          return { ok: false, status: res.status, json: null };
        }
        const block = await readDataBlock(res);
        if (!block) {
          console.error('[threads] page had no embedded data block', { path });
          return { ok: false, status: res.status, json: null };
        }
        const holder = findEdgesHolder(JSON.parse(block));
        if (!holder) {
          console.error('[threads] embedded block had no edges holder', { path });
          return { ok: false, status: res.status, json: null };
        }
        return { ok: true, status: res.status, json: holder };
      },
      PAGE_TIMEOUT_MS,
      PAGE_RETRIES
    );
  } catch (err) {
    console.error('[threads] page fetch failed', {
      path,
      message: err instanceof Error ? err.message : String(err)
    });
    return { ok: false, status: 500, json: null };
  }
}
