import { FACEBOOK_ORIGIN, FB_WATCH_ORIGIN } from './constants.js';

/*
 * 這個 fork 的路由形狀是「路徑第一段＝來源網域」，所以 provider 拿到的是
 * 「使用者原本貼的是哪個 host」＋「剩下的路徑」。Facebook 沒有 Threads 那種
 * shortcode 可以正規化，真正需要決定的是**要對哪個 origin 發請求**。
 */

/**
 * 這些 host 共用同一個 id 命名空間，一律正規化成 www —— `m.` 會回行動版的精簡頁面，
 * `fb.com` 只是轉址殼，兩者都沒有比 www 更好的內容。
 */
const WWW_EQUIVALENT_HOSTS = new Set([
  'facebook.com',
  'www.facebook.com',
  'm.facebook.com',
  'web.facebook.com',
  'fb.com',
  'www.fb.com'
]);

/**
 * `fb.watch` 的 code 是**獨立命名空間**，把它接到 www 上解析不出東西，
 * 所以那一種要照原 host 抓，再由頁面的 og:url / canonical 換回正規網址。
 */
export const facebookOriginFor = (sourceHost: string): string =>
  sourceHost.toLowerCase() === 'fb.watch' ? FB_WATCH_ORIGIN : FACEBOOK_ORIGIN;

/** 我們認得的來源 host（與 src/helpers/pathRouting.ts 的白名單對應）。 */
export const isFacebookSourceHost = (sourceHost: string): boolean => {
  const host = sourceHost.toLowerCase();
  return WWW_EQUIVALENT_HOSTS.has(host) || host === 'fb.watch';
};

/**
 * 轉址可以跟到哪些 host。
 *
 * **`fb.watch` 的短連結是跨來源轉址**（實測 302 到
 * `https://www.facebook.com/watch/?v=<id>&…`），所以不能用 `fetchSameOriginHttps`
 * —— 那支只跟同源，遇到 fb.watch 會停在 302 直接判失敗。
 *
 * 同源限制的用意是「不要把 session cookie 帶到別的 host」，而我們對 Facebook
 * 一個 cookie 都不帶，所以改成用 host 白名單擋住「被導去無關站台」就夠了。
 */
export const isFacebookRedirectHost = (host: string): boolean => {
  const h = host.toLowerCase();
  return h === 'fb.watch' || h === 'facebook.com' || h.endsWith('.facebook.com');
};

/**
 * 組出要抓的上游網址。`path` 是已經剝掉來源網域前綴（也剝掉 direct-media 副檔名）
 * 的那一段，`search` 是原始查詢字串 —— `/watch/?v=<id>` 這種形狀的 id 在查詢字串裡，
 * 丟掉就會變成抓 Watch 首頁。
 */
export const facebookUpstreamUrl = (sourceHost: string, path: string, search = ''): string => {
  const origin = facebookOriginFor(sourceHost);
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${origin}${normalizedPath}${search}`;
};
