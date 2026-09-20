import type { SocialThread } from '../../types/api-status.js';
import { fetchFacebookVideoSources, probeFacebookVideoBytes } from './embed-scrape.js';
import { fetchFacebookPageMeta } from './page-scrape.js';
import {
  deriveDurationSeconds,
  facebookPageToStatus,
  pickFacebookVideoSource,
  type FacebookVideoPayload
} from './processor.js';
import { facebookUpstreamUrl } from './source-url.js';

/*
 * Facebook 單篇內容的唯一入口。
 *
 * 取數分兩段，因為資料就是分在兩個地方（2026-09-20 實測）：
 *
 *   ① 貼文頁（爬蟲 UA，串流讀到 `</head>`）
 *        → og:title / og:image / 正規網址 / 作者 handle 與顯示名稱
 *        → 以及「這則到底是不是影片」的判別訊號
 *   ② 影片才打的 `plugins/video.php`
 *        → hd_src / sd_src / 原始尺寸
 *
 * 分享短連結（`/share/r/<code>`）不需要多一次往返：它自己那一頁的 `og:url`
 * 就是正規網址，而 `<head>` 的 oEmbed link 也照樣帶著永久連結。
 */

const notFound = (): SocialThread => ({ code: 404, status: null, thread: null, author: null });

/**
 * @param sourceHost 使用者原本貼的 host（`www.facebook.com` / `fb.watch` …）。
 * @param path 已剝掉來源網域前綴與 direct-media 副檔名的路徑。
 * @param search 原始查詢字串，`/watch/?v=<id>` 這種形狀需要它。
 */
export async function constructFacebookPost(
  sourceHost: string,
  path: string,
  search = ''
): Promise<SocialThread> {
  const upstreamUrl = facebookUpstreamUrl(sourceHost, path, search);
  const meta = await fetchFacebookPageMeta(upstreamUrl);
  if (!meta.ok) {
    return notFound();
  }

  let video: FacebookVideoPayload | null = null;
  if (meta.video) {
    /* href 一定要用 oEmbed 給的永久連結。餵分享短連結進去會回 200 但沒有 hd_src ——
       那是個不報錯的靜默失敗，所以這裡刻意不拿 upstreamUrl 將就。 */
    const sources = await fetchFacebookVideoSources(meta.video.permalink);
    if (sources.ok) {
      /* HEAD 問實際大小：Telegram 超過 20 MiB 就不產生播放器，而 Facebook
         沒給任何時長或大小欄位，估不出來。順帶也拿到反推長度用的分母。 */
      const hdBytes = sources.hd ? await probeFacebookVideoBytes(sources.hd.url) : null;
      const chosen = pickFacebookVideoSource(sources, hdBytes);
      if (chosen) {
        const bytes = sources.hd && chosen === sources.hd ? hdBytes : null;
        video = { sources, bytes, chosen };
        console.log('[facebook] video selected', {
          quality: chosen === sources.hd ? 'hd' : 'sd',
          bytes,
          seconds: deriveDurationSeconds(bytes, chosen.bitrate)
        });
      }
    }
  }

  const status = facebookPageToStatus(meta, video);
  if (!status) {
    return notFound();
  }

  return { code: 200, status, thread: [status], author: status.author };
}
