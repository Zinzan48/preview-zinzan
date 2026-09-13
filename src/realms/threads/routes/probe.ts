import { Context } from 'hono';

/*
 * 暫時的診斷端點，只為了回答一個問題：
 * 「用爬蟲 UA 讀 threads.com 的貼文頁，從 Cloudflare 的出口 IP 打得通嗎？」
 *
 * 這件事本機證明不了 —— 本機用的就是那個「一定會成功」的家用 IP。而它決定
 * 整個取數路徑要不要改寫，所以值得為它單獨部署一次。
 *
 * 驗證完就整個檔案刪掉，連同 router 裡那一行。不要留在正式版：它會對外
 * 暴露我們的上游行為，而且沒有任何正式用途。
 */

const CRAWLER_UA = {
  /* 資料最完整：頁面內嵌的 JSON 含 thread_items / video_versions / image_versions2，
     形狀與 logged-out GraphQL 相同。代價是體積最大。 */
  gb: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  /* 備援：有 og:description 但沒有內嵌媒體 JSON，體積約一半、快一倍。 */
  fb: 'facebookexternalhit/1.1',
  /* 對照組：最小的回應，只有 og:title / og:image。 */
  tg: 'TelegramBot (like TwitterBot)'
} as const;

/* 不接受任意網址 —— 網址由我們自己組，避免這個端點變成開放代理。 */
const SHORTCODE = /^[A-Za-z0-9_-]{5,30}$/;
const HANDLE = /^[A-Za-z0-9._]{1,40}$/;

export const threadsProbeRequest = async (c: Context) => {
  const code = c.req.query('code') ?? 'CuVYy5Fvrrd';
  const handle = c.req.query('handle') ?? 'zuck';
  const uaKey = (c.req.query('ua') ?? 'gb') as keyof typeof CRAWLER_UA;

  if (!SHORTCODE.test(code) || !HANDLE.test(handle) || !CRAWLER_UA[uaKey]) {
    return c.json({ error: 'bad params' }, 400);
  }

  const target = `https://www.threads.com/@${handle}/post/${code}`;
  const started = Date.now();
  const result: Record<string, unknown> = { target, ua: uaKey };

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

  /* 先記 header 階段的結果。就算下面讀 body 撞到 CPU 上限，這些也已經拿到了。 */
  result.status = res.status;
  result.msToHeaders = Date.now() - started;
  result.contentLength = res.headers.get('content-length');
  result.contentEncoding = res.headers.get('content-encoding');

  try {
    const body = await res.text();
    result.msToBody = Date.now() - started;
    result.bytes = body.length;
    result.hasOgTitle = body.includes('property="og:title"');
    result.hasOgDescription = body.includes('property="og:description"');
    result.hasThreadItems = body.includes('thread_items');
    result.hasVideoVersions = body.includes('video_versions');
    result.hasImageVersions = body.includes('image_versions2');
    /* 登入牆 / 限流的指紋，用來分辨「被擋」與「單純失敗」。 */
    result.requireLogin = body.includes('require_login');
    result.pleaseWait = body.includes('Please wait a few minutes');
  } catch (err) {
    result.phase = 'body';
    result.error = err instanceof Error ? err.message : String(err);
    result.msToBody = Date.now() - started;
  }

  return c.json(result, 200);
};
