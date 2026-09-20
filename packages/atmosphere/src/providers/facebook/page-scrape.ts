import { withTimeout } from '../../helpers/with-timeout.js';
import {
  FACEBOOK_CRAWLER_USER_AGENT,
  FACEBOOK_PAGE_TIMEOUT_MS,
  FACEBOOK_RETRIES
} from './constants.js';
import { decodeHtmlEntities } from './html.js';
import { isFacebookRedirectHost } from './source-url.js';

/*
 * 從 facebook.com 的頁面 HTML 取預覽需要的中繼資料。
 *
 * 為什麼是這條路：Facebook 對爬蟲 UA 一律回完整的 `<head>`（og:title / og:image /
 * og:url 都有真實值），對桌面瀏覽器 UA 則直接回 HTTP 400。也就是說**爬蟲那條路才是
 * 唯一走得通的**，跟 Threads（瀏覽器 UA 拿到空殼頁）的結論方向一致但更極端。
 *
 * 2026-09-20 從 Cloudflare 邊緣（colo SJC）實測 20/20 成功，沒有出現登入牆。
 *
 * 貼文頁**不含任何影片直連**（`mp4` / `video_versions` / `playable_url` 全是 0 次），
 * 影片要另外打 `plugins/video.php` —— 見 embed-scrape.ts。
 */

/** 讀到 `<head>` 收尾就夠，後面全是與預覽無關的 app shell。 */
const HEAD_END = '</head>';

/**
 * `</head>` 遲遲不出現時的保險絲。實測 reel 頁 `<head>` 是 114 KB（全文 25%），
 * 粉專首頁 109 KB（21%），512 KB 已經遠超任何正常頁面。
 */
const MAX_HEAD_BYTES = 512 * 1024;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

/**
 * Facebook 要求登入時導向的路徑。
 *
 * 2026-09-20 從 Cloudflare 邊緣實測：粉專／個人首頁（`/<handle>/`）與 `fb.watch/<code>`
 * 一律被導到 `/login/?next=…`，而同一組網址從家用 IP 完全正常 —— 跟 Threads 的
 * logged-out GraphQL 同一類，擋的是出口 IP 的信譽。
 *
 * **不能跟進去。** `www.facebook.com` 在允許清單內，所以不特別判斷的話我們會去解析
 * 登入頁。那一頁目前沒有任何 `og:*`（所以現在只是退回原站），但它**有 `canonical`**
 * （`https://zh-tw.facebook.com/login`）—— 哪天它多一個 `og:image`，我們就會吐出一張
 * 標題是 `login (@login)`、圖是 Facebook 商標的假卡片，而且完全不會報錯。
 */
const LOGIN_WALL_PATH = /^\/(login|checkpoint|recover|r\.php|login\.php)\b/i;

/**
 * 跟隨轉址，但只跟到 Facebook 自己的 host。
 *
 * **不能用 `fetchSameOriginHttps`** —— `fb.watch/<code>` 是**跨來源**轉到
 * `www.facebook.com/watch/?v=<id>`（實測 302），同源限制會讓它停在 302 直接判失敗，
 * 而症狀是「fb.watch 的連結一律沒有預覽」。理由見 source-url.ts 的
 * `isFacebookRedirectHost`。
 */
async function fetchFollowingFacebookRedirects(url: string, init: RequestInit): Promise<Response> {
  const requestInit: RequestInit = { ...init, redirect: 'manual' };
  let requestUrl = url;
  let response = await fetch(requestUrl, requestInit);
  for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
    if (!REDIRECT_STATUSES.has(response.status)) break;
    const location = response.headers.get('Location');
    if (!location) break;
    let next: URL;
    try {
      next = new URL(location, requestUrl);
    } catch {
      break;
    }
    if (next.protocol !== 'https:' || !isFacebookRedirectHost(next.hostname)) {
      console.error('[facebook] refusing redirect off Facebook', {
        from: requestUrl,
        to: next.href
      });
      break;
    }
    if (LOGIN_WALL_PATH.test(next.pathname)) {
      /* 這個名字要叫得出來 —— 「被要求登入」與「頁面結構變了」的處置完全不同，
         前者無解（出口 IP 信譽），後者要改解析。 */
      console.error('[facebook] login wall', { from: requestUrl, to: next.href });
      break;
    }
    requestUrl = next.href;
    response = await fetch(requestUrl, requestInit);
  }
  return response;
}

export type FacebookVideoTarget = {
  /** Facebook 自己認的影片永久連結，可直接餵給 `plugins/video.php?href=`。 */
  permalink: string;
  /** 作者的粉專 / 個人頁 handle，例如 `MASTER.FOOD.DIARY`。 */
  handle: string;
  /**
   * oEmbed link 的 `title` 屬性。**不一定是作者名** —— 無標題的 reel 是
   * `算命的說我很愛吃 on Reels`，有標題的影片則是「整段內文 | 阿翰po影片」。
   * 作者永遠在最後一個 `|` 之後，交給 `authorNameFromOgTitle` 取。
   */
  title: string | null;
};

export type FacebookPageMeta = {
  ok: boolean;
  status: number;
  /** 正規網址。分享頁沒有 `rel=canonical`，所以要退到 `og:url`。 */
  canonicalUrl: string | null;
  ogTitle: string | null;
  ogImage: string | null;
  ogType: string | null;
  ogDescription: string | null;
  pageTitle: string | null;
  /** 只有影片貼文才有 —— 這是判斷「要不要打 embed 端點」的依據，見下方註解。 */
  video: FacebookVideoTarget | null;
};

const emptyMeta = (status: number): FacebookPageMeta => ({
  ok: false,
  status,
  canonicalUrl: null,
  ogTitle: null,
  ogImage: null,
  ogType: null,
  ogDescription: null,
  pageTitle: null,
  video: null
});

const attr = (tag: string, name: string): string | null => {
  const match = new RegExp(`\\s${name}="([^"]*)"`, 'i').exec(tag);
  return match ? decodeHtmlEntities(match[1]) : null;
};

/**
 * 串流讀取，`</head>` 一收完就 `cancel()` 掉剩下的 body。
 *
 * 跟 Threads 一樣，這個提早中止不是微調：reel 頁 `<head>` 只佔全文 25%，
 * 其餘 337 KB 對我們毫無用處，拉完只是白白吃掉時間與 CPU 額度。
 *
 * 這裡刻意**不 catch**。逾時會 abort 掉串流讓 `read()` 拋出，吞掉它就會把
 * 「來不及讀完」誤報成「這頁沒有 head」—— 兩者的處置完全不同（前者該調預算，
 * 後者代表 Meta 改了頁面結構）。讓它往上拋，由呼叫端連同錯誤訊息一起記錄。
 */
async function readHead(res: Response): Promise<string | null> {
  const reader = res.body?.getReader();
  if (!reader) return null;

  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      /* 串流正常結束卻沒看到 `</head>`：整份文件就這麼多，照樣拿去解析。 */
      return buf || null;
    }
    buf += decoder.decode(value, { stream: true });

    const end = buf.indexOf(HEAD_END);
    if (end !== -1) {
      await reader.cancel().catch(() => undefined);
      return buf.slice(0, end);
    }
    if (buf.length > MAX_HEAD_BYTES) {
      await reader.cancel().catch(() => undefined);
      console.error('[facebook] head exceeded budget without </head>', { bytes: buf.length });
      return buf;
    }
  }
}

/**
 * `<head>` 裡的 oEmbed alternate link，形狀是
 * `<link rel="alternate" href="https://graph.facebook.com/v26.0/oembed_video?url=<encoded>" title="…">`。
 *
 * **這是判斷「這則是不是影片」的正確訊號，不要用 `og:type`** ——
 * 實測 `facebook.com/facebook`（粉專首頁，根本不是貼文）的 `og:type` 也是 `video.other`，
 * 拿它當條件會對每一個非影片頁面都白打一次 embed 端點。反之 `oembed_video`
 * 只在真的有影片時出現，而且順帶把作者 handle 與永久連結一起給了。
 */
const parseOembedVideo = (head: string): FacebookVideoTarget | null => {
  for (const match of head.matchAll(/<link\s[^>]*>/gi)) {
    const tag = match[0];
    const rel = attr(tag, 'rel');
    if (!rel || rel.toLowerCase() !== 'alternate') continue;
    const href = attr(tag, 'href');
    if (!href || !href.includes('oembed_video')) continue;
    try {
      const target = new URL(href).searchParams.get('url');
      if (!target) continue;
      const permalink = new URL(target);
      const handle = permalink.pathname.split('/').filter(Boolean)[0];
      if (!handle) continue;
      return { permalink: permalink.href, handle, title: attr(tag, 'title') };
    } catch {
      continue;
    }
  }
  return null;
};

const parseHead = (head: string, status: number): FacebookPageMeta => {
  const meta: Record<string, string> = {};
  for (const match of head.matchAll(/<meta\s[^>]*>/gi)) {
    const tag = match[0];
    const key = attr(tag, 'property') ?? attr(tag, 'name');
    const content = attr(tag, 'content');
    if (key && content !== null && !(key in meta)) {
      meta[key] = content;
    }
  }

  let canonical: string | null = null;
  for (const match of head.matchAll(/<link\s[^>]*>/gi)) {
    const tag = match[0];
    if ((attr(tag, 'rel') ?? '').toLowerCase() === 'canonical') {
      canonical = attr(tag, 'href');
      break;
    }
  }

  const titleMatch = /<title[^>]*>([^<]*)<\/title>/i.exec(head);

  return {
    ok: true,
    status,
    /* 分享頁（/share/r/<code>）沒有 rel=canonical，但 og:url 一定有，
       而且它的值就是正規的貼文網址 —— 分享短連結靠這個解析。 */
    canonicalUrl: canonical ?? meta['og:url'] ?? null,
    ogTitle: meta['og:title'] ?? null,
    ogImage: meta['og:image'] ?? null,
    ogType: meta['og:type'] ?? null,
    ogDescription: meta['og:description'] ?? null,
    pageTitle: titleMatch ? decodeHtmlEntities(titleMatch[1]).trim() || null : null,
    video: parseOembedVideo(head)
  };
};

const fetchOnce = (url: string): Promise<FacebookPageMeta> =>
  withTimeout(
    async signal => {
      const res = await fetchFollowingFacebookRedirects(url, {
        headers: {
          /* 一定要是爬蟲 UA —— 桌面瀏覽器 UA 實測回 400，不帶 UA 則沒有 og:image。
             詳細量測見 constants.ts。 */
          'User-Agent': FACEBOOK_CRAWLER_USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        },
        signal
      });
      if (!res.ok) {
        console.error('[facebook] page fetch non-ok', { url, status: res.status });
        return emptyMeta(res.status);
      }
      const head = await readHead(res);
      if (!head) {
        console.error('[facebook] page had no readable head', { url });
        return emptyMeta(res.status);
      }
      return parseHead(head, res.status);
    },
    FACEBOOK_PAGE_TIMEOUT_MS,
    FACEBOOK_RETRIES
  );

/**
 * 抓一個 Facebook 頁面並解析它的 `<head>`。`url` 必須是完整的上游網址。
 *
 * **丟例外時重試一次**，這是這個 provider 與 Threads 的重要差異：Threads 有三條
 * fallback（私有 API → GraphQL → 頁面），任何一條掛掉還有別條；Facebook 只有這一條，
 * 一次暫時性的網路錯誤就直接變成一張「貼文不存在」的卡片，**而 Telegram 會把預覽
 * 結果快取很久，壞掉的那一次會被記住**。
 *
 * 本機實測確實遇過：worker 起來後的第一個請求回 `Network connection lost.`，
 * 之後同一個網址連續 3 次都正常。
 *
 * 只對「丟例外」重試，非 2xx（例如真的 404）不重試 —— 那不是暫時性的，
 * 重試只會讓失敗的那次多花一倍時間。`withTimeout` 自己的 retries 幫不上忙，
 * 它只認 AbortError。
 */
export async function fetchFacebookPageMeta(url: string): Promise<FacebookPageMeta> {
  try {
    return await fetchOnce(url);
  } catch (err) {
    console.error('[facebook] page fetch threw, retrying once', {
      url,
      message: err instanceof Error ? err.message : String(err)
    });
  }
  try {
    return await fetchOnce(url);
  } catch (err) {
    console.error('[facebook] page fetch failed', {
      url,
      message: err instanceof Error ? err.message : String(err)
    });
    return emptyMeta(500);
  }
}
