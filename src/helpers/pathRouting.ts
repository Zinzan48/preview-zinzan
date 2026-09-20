/* 單一網域 + 「路徑第一段＝來源網域」的路由規則。
 *
 * 上游 FxEmbed 是靠 Host header 分辨 realm 的（fxtwitter.com / fxbsky.app / …），
 * 一個平台一個網域。我們只有 preview.zinzan.info 一個網域，因為短網址服務
 * (ShortUrlApi) 是在 302 導轉當下把使用者的社群連結改寫成：
 *
 *   使用者原始連結   https://x.com/jack/status/20?s=20
 *   導轉目標         https://preview.zinzan.info/x.com/jack/status/20?s=20
 *                                               ^^^^^ 來源網域是路徑第一段
 *
 * 這個檔是那份對照表與剝除邏輯的單一事實來源。getPath（決定走哪個 realm）
 * 與各 realm 的 redirect handler（把請求路徑還原成原站網址）都必須用同一份，
 * 否則會出現「路由對了、但 Location 帶著多餘的 /x.com 前綴」這種靜默錯誤 ——
 * Hono 的 getPath 只影響路由比對，並不會改寫 c.req.url（Request.url 依 Fetch
 * 規範是唯讀的）。
 */

/** 路徑第一段（來源網域，小寫比對）→ FxEmbed realm。 */
const SOURCE_DOMAIN_REALMS: Record<string, string> = {
  'x.com': 'twitter',
  'www.x.com': 'twitter',
  'twitter.com': 'twitter',
  'www.twitter.com': 'twitter',
  'mobile.twitter.com': 'twitter',
  'bsky.app': 'bluesky',
  'www.bsky.app': 'bluesky',
  'instagram.com': 'instagram',
  'www.instagram.com': 'instagram',
  'threads.com': 'threads',
  'www.threads.com': 'threads',
  /* Meta 在 2026 年把 Threads 從 threads.net 換到 threads.com，舊連結仍在流通 */
  'threads.net': 'threads',
  'www.threads.net': 'threads',
  /* Facebook：m./web. 與 fb.com 都是同一個 id 命名空間，realm 會一律正規化成 www。
     fb.watch 是獨立的短連結命名空間，只在該 host 上解析得出來，所以 realm 會照原 host 抓。 */
  'facebook.com': 'facebook',
  'www.facebook.com': 'facebook',
  'm.facebook.com': 'facebook',
  'web.facebook.com': 'facebook',
  'fb.com': 'facebook',
  'www.fb.com': 'facebook',
  'fb.watch': 'facebook',
  'tiktok.com': 'tiktok',
  'www.tiktok.com': 'tiktok',
  'vm.tiktok.com': 'tiktok'
};

/* 服務自己的中轉端點，掛在 api realm 底下。
 *
 * FxEmbed 不會把 mp4 直接寫進 og:video，而是包一層 302（上游的
 * VIDEO_REDIRECT_WORKAROUND，用來修 Telegram / Discord 的播放問題）；
 * Telegram Instant View 也會把貼文內的外部連結包成 /2/hit。兩者都只是
 * 純轉址器（src/realms/api/hit.ts），不代理任何流量。
 *
 * 上游是用「hostname 命中 API_HOST_LIST」把整個子網域切成 api realm，
 * 但那個判定同時會讓 flags.api = true，使貼文請求改回 JSON 而不是 OG HTML
 * （src/realms/twitter/routes/status.ts）。所以我們不能把主網域放進
 * API_HOST_LIST，改成只放行這兩條路徑 —— 其餘 JSON API 路由
 * （/2/status/{id}、/2/openapi.json…）在主網域上一律不可達。
 */
export const SELF_REDIRECT_PATHS = ['/2/go', '/2/hit'];

export type SourcePrefixMatch = { realm: string; path: string };

/**
 * 比對路徑第一段是否為已知來源網域。命中回傳該用的 realm 與剝掉前綴後的路徑，
 * 否則回傳 null（呼叫端應維持原本的 host 判定）。
 *
 * 用白名單而不是「排除服務自身路徑」的黑名單：twitter realm 底下有大量固定
 * 字串開頭的路由（/i、/dir、/dl、/status、/statuses、/article、/hashtag、
 * /version、/owoembed、/robots.txt、/favicon.ico、/set_base_redirect、/api），
 * 黑名單漏一個就會靜默壞掉。
 */
export const matchSourcePrefix = (pathname: string): SourcePrefixMatch | null => {
  if (!pathname.startsWith('/')) {
    return null;
  }
  const nextSlash = pathname.indexOf('/', 1);
  const firstSegment = nextSlash === -1 ? pathname.slice(1) : pathname.slice(1, nextSlash);
  const realm = SOURCE_DOMAIN_REALMS[firstSegment.toLowerCase()];
  if (!realm) {
    return null;
  }
  /* 只有前綴、沒有後續路徑時給 '/'，讓 realm 的 catch-all 去處理 */
  return { realm, path: nextSlash === -1 ? '/' : pathname.slice(nextSlash) };
};

/**
 * 把 `/x.com/jack/status/20` 還原成 `/jack/status/20`。
 * 未命中來源網域白名單時原樣回傳，所以對上游原本的請求形狀是安全的。
 */
export const stripSourcePrefix = (pathname: string): string =>
  matchSourcePrefix(pathname)?.path ?? pathname;

/**
 * 路徑第一段本身（來源網域，小寫）。沒命中白名單就回 null。
 *
 * 多數 realm 用不到這個 —— 它們的上游只有一個 host，直接用 Constants 的 *_ROOT 即可。
 * Facebook 需要，因為 `fb.watch` 的短連結 code 是獨立命名空間，接到 www 上解析不出來。
 */
export const sourceHostFromPath = (pathname: string): string | null => {
  if (!pathname.startsWith('/')) {
    return null;
  }
  const nextSlash = pathname.indexOf('/', 1);
  const firstSegment = (
    nextSlash === -1 ? pathname.slice(1) : pathname.slice(1, nextSlash)
  ).toLowerCase();
  return SOURCE_DOMAIN_REALMS[firstSegment] ? firstSegment : null;
};
