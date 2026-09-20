import { DataProvider } from '../../types/data-provider.js';
import type { APIStatus } from '../../types/api-status.js';
import type { APIPhoto, APIUser, APIVideo, APIVideoFormat } from '../../types/api-schemas.js';
import { FACEBOOK_ORIGIN } from './constants.js';
import type { FacebookVideoSource, FacebookVideoSources } from './embed-scrape.js';
import { authorNameFromPageTitle } from './html.js';
import type { FacebookPageMeta } from './page-scrape.js';

/** Telegram 不會替超過 20 MiB 的影片產生播放器，只畫縮圖。 */
const TELEGRAM_MAX_BYTES = 20 * 1024 * 1024;

export type FacebookVideoPayload = {
  sources: FacebookVideoSources;
  /** 選中那支的實際位元組數（HEAD 問來的）；問不到是 null。 */
  bytes: number | null;
  /** 選中的那一支 —— 由 pickFacebookVideoSource 決定。 */
  chosen: FacebookVideoSource;
};

/**
 * 挑 HD 還是 SD。
 *
 * 只有在**確知** HD 超過 Telegram 門檻時才降級 —— 量不到大小就維持 HD，
 * 因為「畫質低一階」是每次都付的代價，而「超過 20 MiB」只有長影片才會發生。
 */
export const pickFacebookVideoSource = (
  sources: FacebookVideoSources,
  hdBytes: number | null
): FacebookVideoSource | null => {
  if (sources.hd && sources.sd && hdBytes !== null && hdBytes > TELEGRAM_MAX_BYTES) {
    return sources.sd;
  }
  return sources.hd ?? sources.sd;
};

/**
 * 從實際檔案大小與網址裡的 `bitrate` 反推長度（秒）。
 *
 * Facebook 的 embed 端點沒有任何時長欄位，這是唯一拿得到的來源。
 * 實測同一則影片用 hd（3087962 bps / 8980825 B）與 sd（715091 bps / 2079725 B）
 * 各自算出來都是 23.3 秒，兩條路互相印證。
 */
export const deriveDurationSeconds = (bytes: number | null, bitrate: number | null): number => {
  if (!bytes || !bitrate || bitrate <= 0) return 0;
  return Math.round(((bytes * 8) / bitrate) * 10) / 10;
};

/** 從正規網址挖作者 handle，例如 `/MASTER.FOOD.DIARY/videos/123/` → `MASTER.FOOD.DIARY`。 */
const handleFromCanonical = (canonicalUrl: string | null): string | null => {
  if (!canonicalUrl) return null;
  try {
    const segments = new URL(canonicalUrl).pathname.split('/').filter(Boolean);
    const first = segments[0];
    if (!first) return null;
    /* 這些是 Facebook 自己的功能路徑，不是誰的 handle。 */
    const reserved = ['reel', 'reels', 'watch', 'video', 'share', 'photo', 'photos', 'story.php'];
    if (reserved.includes(first.toLowerCase())) return null;
    return first;
  } catch {
    return null;
  }
};

/**
 * og:description 空的時候退到 og:title 的前半段。
 *
 * Facebook 的 og:title 形狀是 `8.4 萬次觀看 · 1,345 個心情 | 算命的說我很愛吃 on Reels` ——
 * 後半段是作者（已經另外放進 og:title 了），前半段是互動數，拿來當描述剛好。
 * 沒有分隔線時就整個放棄，不要把作者名重複一次。
 */
const descriptionFrom = (meta: FacebookPageMeta): string => {
  const description = (meta.ogDescription ?? '').trim();
  if (description) return description;

  const title = (meta.ogTitle ?? '').trim();
  const separator = title.lastIndexOf('|');
  if (separator > 0) return title.slice(0, separator).trim();
  return '';
};

const buildAuthor = (meta: FacebookPageMeta): APIUser => {
  const handle = meta.video?.handle ?? handleFromCanonical(meta.canonicalUrl) ?? '';
  /* 最後那一段要用 `||` 而不是 `??` —— handle 取不到時是空字串而不是 null，
     串成 `handle ?? 'Facebook'` 的話保底永遠不會生效，會吐出作者名為空的卡片。 */
  const name =
    authorNameFromPageTitle(meta.video?.title ?? null) ??
    authorNameFromPageTitle(meta.pageTitle) ??
    (handle || 'Facebook');

  return {
    type: 'profile',
    id: handle,
    name,
    screen_name: handle,
    avatar_url: null,
    banner_url: null,
    description: '',
    raw_description: { text: '', facets: [] },
    location: '',
    url: handle ? `${FACEBOOK_ORIGIN}/${encodeURIComponent(handle)}/` : FACEBOOK_ORIGIN,
    protected: false,
    followers: 0,
    following: 0,
    statuses: 0,
    media_count: 0,
    likes: 0,
    joined: '1970-01-01T00:00:00.000Z',
    website: null,
    profile_embed: true
  };
};

const buildVideo = (meta: FacebookPageMeta, payload: FacebookVideoPayload): APIVideo => {
  const { sources, chosen, bytes } = payload;
  const formats: APIVideoFormat[] = [sources.hd, sources.sd]
    .filter((s): s is FacebookVideoSource => s !== null)
    .map(s => ({
      container: 'mp4' as const,
      codec: 'h264' as const,
      url: s.url,
      bitrate: s.bitrate ?? undefined,
      width: sources.width || undefined,
      height: sources.height || undefined,
      size: s === chosen && bytes ? bytes : undefined
    }));

  return {
    id: sources.videoId ?? undefined,
    /* og:video:type 的來源。沒填的話 render/video.ts 會退到 mp4，但那是保險，
       provider 自己填才對 —— 實測 fbcdn 回的就是 Content-Type: video/mp4。 */
    format: 'video/mp4',
    type: 'video',
    url: chosen.url,
    width: sources.width,
    height: sources.height,
    /* og:image 缺失時**必須是 undefined 而不是字串 "null"** —— Threads 踩過，
       而 LINE 的連結預覽只讀 og:image，寫錯等於整張圖消失。 */
    thumbnail_url: meta.ogImage ?? undefined,
    duration: deriveDurationSeconds(bytes, chosen.bitrate),
    filesize: bytes ?? undefined,
    formats
  };
};

const buildPhoto = (imageUrl: string): APIPhoto => ({
  type: 'photo',
  url: imageUrl,
  /* Facebook 的 head 不給縮圖尺寸。0 會讓渲染層自己決定，比瞎猜一組數字安全。 */
  width: 0,
  height: 0
});

/**
 * 把抓到的中繼資料組成通用的 `APIStatus`。
 *
 * 刻意不做 provider 專屬的 Zod schema：這個 fork 只用 embed realm，不開
 * `/2/facebook/…` 的 JSON API，而 `APIStatus.provider` 本來就是通用的 `DataProvider`。
 *
 * 取不到的欄位（按讚數、留言數、發布時間）一律給 0 / epoch —— Facebook 的公開
 * `<head>` 沒有這些，硬湊一個看起來合理的值只會讓人以為是真的。
 */
export const facebookPageToStatus = (
  meta: FacebookPageMeta,
  video: FacebookVideoPayload | null
): APIStatus | null => {
  const url = meta.canonicalUrl;
  if (!url) return null;

  const author = buildAuthor(meta);
  const text = descriptionFrom(meta);

  const videos = video ? [buildVideo(meta, video)] : undefined;
  const photos = !video && meta.ogImage ? [buildPhoto(meta.ogImage)] : undefined;
  const all = videos ?? photos;

  if (!videos && !photos) {
    /* 沒有任何媒體就沒有預覽價值，讓呼叫端 302 回原站。 */
    return null;
  }

  return {
    type: 'status',
    id: video?.sources.videoId ?? url,
    url,
    text,
    created_at: '1970-01-01T00:00:00.000Z',
    created_timestamp: 0,
    likes: 0,
    reposts: 0,
    replies: 0,
    author,
    media: { videos, photos, all },
    raw_text: { text, facets: [] },
    lang: null,
    possibly_sensitive: false,
    replying_to: null,
    source: null,
    embed_card: videos ? 'player' : 'summary_large_image',
    provider: DataProvider.Facebook
  };
};
