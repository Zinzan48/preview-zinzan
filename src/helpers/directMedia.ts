import { DataProvider } from '../enum';

/**
 * Meta 系（Instagram / Threads）的 CDN 網址帶 13 個簽章參數，光是它本身就 1000 字元以上。
 * 包進 `/2/go?url=…` 之後 `og:video` 會超過 1150 字元，而 **Telegram 對這樣的貼文只畫縮圖、
 * 不產生播放器**。
 *
 * 實測（三次踩到同一個坑才歸納出來）：
 *
 * | 來源 | og:video 長度 | Telegram |
 * | --- | --- | --- |
 * | X | 約 130 字元、無簽章 | 正常播放 |
 * | Instagram reel | 1162 | 只有縮圖 |
 * | Threads 影片 | 1154 | 只有縮圖 |
 * | Facebook reel | 約 1150（直連本身 702 字元、13 個簽章參數） | 只有縮圖 |
 *
 * 其他可能原因都已排除：meta 格式、302 中轉本身、影片編碼（H.264 + faststart）、
 * 檔案大小、網址時效、來源 IP 限制。同一則 reel 在上游 `67instagram.com` 也一樣不播。
 */
const SHORT_DIRECT_MEDIA_PROVIDERS: DataProvider[] = [
  DataProvider.Instagram,
  DataProvider.Threads,
  DataProvider.Facebook
];

/**
 * 組出指向我們自己 direct-media 路徑的短網址（實測 66–73 字元）。
 * meta 裡只放這個短路徑，客戶端真的來抓時才即時解析並 302 到 CDN。
 *
 * 回 `null` 代表這支影片不適用，呼叫端應維持原本的網址。
 *
 * @param isFirstMedia 這支影片是不是貼文的第一個媒體。**只有第一個才適用** ——
 *   這兩個 realm 都沒有 `/videos/<n>` 這種指定第幾個媒體的路由，carousel 的第二支影片
 *   會被解析成第一支，放出去就是錯的影片。
 */
export const buildShortDirectMediaUrl = (
  provider: DataProvider | string,
  statusUrl: string,
  selfUrl: string,
  isFirstMedia: boolean
): string | null => {
  if (!SHORT_DIRECT_MEDIA_PROVIDERS.includes(provider as DataProvider)) {
    return null;
  }
  if (!isFirstMedia) {
    return null;
  }
  try {
    const source = new URL(statusUrl);
    const selfHost = new URL(selfUrl).host;
    /* 帶查詢字串就不適用：短網址只保留 pathname，`/watch/?v=<id>` 這種形狀的 id
       會整個被丟掉，客戶端回來抓時解析到的是另一則（或整個 Watch 首頁）。
       那是「預覽顯示了別支影片」那一類的錯 —— 比沒有播放器更糟。
       實測目前三個 provider 的 canonical 都是純路徑，這是防止日後變動的保險。 */
    if (source.search) {
      return null;
    }
    const path = source.pathname.replace(/\/+$/, '');
    if (!path) {
      return null;
    }
    return `https://${selfHost}/${source.host}${path}.mp4`;
  } catch (_e) {
    return null;
  }
};
