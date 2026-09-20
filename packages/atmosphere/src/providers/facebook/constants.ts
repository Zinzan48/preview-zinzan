/** Facebook 公開網頁（與 Instagram / Threads 同一套 Meta 基礎設施）。 */
export const FACEBOOK_ORIGIN = 'https://www.facebook.com';

/**
 * `fb.watch` 的 code 是獨立命名空間，只在該 host 上解析得出來，
 * 所以那一種來源要照原 host 抓，不能正規化成 www。
 */
export const FB_WATCH_ORIGIN = 'https://fb.watch';

/**
 * 讀 facebook.com 頁面時用的 UA。**必須是爬蟲身分**。
 *
 * 2026-09-20 家用 IP 實測（同一則 reel）：
 *
 * | UA | HTTP | 大小 | 耗時 |
 * | --- | --- | --- | --- |
 * | `facebookexternalhit/1.1` | 200 | 451 KB | 1.54s |
 * | `TelegramBot` | 200 | 442 KB | 1.53s |
 * | `Googlebot/2.1` | 200 | 878 KB | 1.71s |
 * | `bingbot/2.0` | 200 | 894 KB | 3.07s |
 * | Chrome 131（桌面瀏覽器） | **400** | 1.5 KB | — |
 * | 不帶 UA | 200 | 50 KB（**沒有 og:image**） | — |
 *
 * Threads 是「瀏覽器 UA 拿到空殼頁」，Facebook 更硬 —— 直接回 400。
 *
 * 也注意 Threads 選的是 bingbot（那邊它最快），Facebook 剛好相反：bingbot 最慢也最肥。
 * **UA 選擇不能跨平台沿用，每個平台都要自己量。**
 */
export const FACEBOOK_CRAWLER_USER_AGENT =
  'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';

/**
 * 影片直連只有這個端點給得出來 —— 貼文頁的 HTML 裡 `mp4` / `video_versions` /
 * `playable_url` / `dash_manifest` 全部是 0 次（2026-09-20 實測）。
 */
export const FACEBOOK_VIDEO_EMBED_PATH = '/plugins/video.php';

/*
 * 逾時預算。2026-09-20 從 Cloudflare 邊緣（colo SJC）各量 20 次：
 * 貼文頁 中位數 929ms / 最大 2423ms，embed 頁 中位數 154ms / 最大 234ms，兩者都 20/20。
 *
 * 不重試：呼叫端失敗時本來就會 302 回原站，重試只會讓失敗的那次更慢。
 */
export const FACEBOOK_PAGE_TIMEOUT_MS = 5000;
export const FACEBOOK_EMBED_TIMEOUT_MS = 4000;
export const FACEBOOK_RETRIES = 0;
