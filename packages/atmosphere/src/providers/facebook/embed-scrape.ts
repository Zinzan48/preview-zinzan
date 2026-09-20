import { withTimeout } from '../../helpers/with-timeout.js';
import {
  FACEBOOK_CRAWLER_USER_AGENT,
  FACEBOOK_EMBED_TIMEOUT_MS,
  FACEBOOK_ORIGIN,
  FACEBOOK_RETRIES,
  FACEBOOK_VIDEO_EMBED_PATH
} from './constants.js';

/*
 * 影片直連的唯一來源。
 *
 * 貼文頁本身**一個 mp4 都沒有**（2026-09-20 實測：`mp4` / `video_versions` /
 * `playable_url` / `dash_manifest` 在 451 KB 的 HTML 裡全部是 0 次），
 * 但 `plugins/video.php?href=<永久連結>` 這個公開嵌入端點未登入就給 `hd_src` / `sd_src`。
 *
 * **`href` 必須是正規的永久連結。** 實測餵分享短連結（`/share/r/<code>`）會回 200
 * 但 `hd_src` 出現 0 次 —— 這是個不會報錯的靜默失敗，所以呼叫端一定要先解析出
 * 正規網址（`<head>` 的 oEmbed alternate link 就直接給了）。
 */

const BACKSLASH = 92;

/** 讀出 `"key":"…"` 的值並解掉 JSON 跳脫（Meta 的網址全都是 `\/` 形式）。 */
const readJsonString = (raw: string, key: string): string | null => {
  const token = `"${key}":"`;
  const start = raw.indexOf(token);
  if (start === -1) return null;
  const from = start + token.length;
  let cursor = from;
  for (;;) {
    cursor = raw.indexOf('"', cursor);
    if (cursor === -1) return null;
    if (raw.charCodeAt(cursor - 1) !== BACKSLASH) break;
    cursor += 1;
  }
  try {
    return JSON.parse(`"${raw.slice(from, cursor)}"`) as string;
  } catch {
    return null;
  }
};

const readJsonNumber = (raw: string, key: string): number | null => {
  const match = new RegExp(`"${key}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`).exec(raw);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
};

/** `bitrate` 就寫在 CDN 網址的查詢字串裡，沒有別的地方拿得到。 */
const bitrateFromUrl = (url: string): number | null => {
  try {
    const raw = new URL(url).searchParams.get('bitrate');
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
};

export type FacebookVideoSource = {
  url: string;
  /** 位元率（bps），用來從實際檔案大小反推長度。 */
  bitrate: number | null;
};

export type FacebookVideoSources = {
  ok: boolean;
  status: number;
  hd: FacebookVideoSource | null;
  sd: FacebookVideoSource | null;
  width: number;
  height: number;
  videoId: string | null;
};

const emptySources = (status: number): FacebookVideoSources => ({
  ok: false,
  status,
  hd: null,
  sd: null,
  width: 0,
  height: 0,
  videoId: null
});

const source = (url: string | null): FacebookVideoSource | null =>
  url ? { url, bitrate: bitrateFromUrl(url) } : null;

/**
 * 從 `original_width` / `original_height` 取尺寸；沒有就用 `aspect_ratio` 補。
 *
 * 尺寸只影響 `twitter:player` 的寬高，拿不到也不該讓整則貼文失敗，
 * 所以最後退到直式短影音最常見的 1080x1920。
 */
const dimensions = (raw: string): { width: number; height: number } => {
  const width = readJsonNumber(raw, 'original_width');
  const height = readJsonNumber(raw, 'original_height');
  if (width && height) return { width: Math.trunc(width), height: Math.trunc(height) };

  const ratio = readJsonNumber(raw, 'aspect_ratio');
  if (ratio && ratio > 0) {
    const fallbackHeight = 1920;
    return { width: Math.round(fallbackHeight * ratio), height: fallbackHeight };
  }
  return { width: 1080, height: 1920 };
};

/** 抓 `plugins/video.php` 並取出影片直連。`permalink` 必須是正規永久連結。 */
export async function fetchFacebookVideoSources(permalink: string): Promise<FacebookVideoSources> {
  const url = `${FACEBOOK_ORIGIN}${FACEBOOK_VIDEO_EMBED_PATH}?href=${encodeURIComponent(permalink)}`;
  try {
    return await withTimeout(
      async signal => {
        const res = await fetch(url, {
          headers: {
            'User-Agent': FACEBOOK_CRAWLER_USER_AGENT,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9'
          },
          signal
        });
        if (!res.ok) {
          console.error('[facebook] video embed non-ok', { permalink, status: res.status });
          return emptySources(res.status);
        }
        const raw = await res.text();
        const hd = source(readJsonString(raw, 'hd_src'));
        const sd = source(readJsonString(raw, 'sd_src'));
        if (!hd && !sd) {
          /* 最可能的原因是 href 不是正規永久連結（分享短連結就會這樣），
             其次才是 Meta 改了這個端點。兩者都要看得出來，所以把 bytes 記下來。 */
          console.error('[facebook] video embed had no hd_src/sd_src', {
            permalink,
            bytes: raw.length
          });
          return emptySources(res.status);
        }
        const { width, height } = dimensions(raw);
        return {
          ok: true,
          status: res.status,
          hd,
          sd,
          width,
          height,
          videoId: readJsonString(raw, 'video_id')
        };
      },
      FACEBOOK_EMBED_TIMEOUT_MS,
      FACEBOOK_RETRIES
    );
  } catch (err) {
    console.error('[facebook] video embed failed', {
      permalink,
      message: err instanceof Error ? err.message : String(err)
    });
    return emptySources(500);
  }
}

/** 短一點的預算 —— 這只是一個 HEAD，慢到這個地步就不值得再等。 */
const SIZE_PROBE_TIMEOUT_MS = 2500;

/**
 * 用 HEAD 問出影片的實際大小。
 *
 * 為什麼要多這一次往返：Telegram 拒絕超過 20 MiB 的影片（只畫縮圖、不產生播放器），
 * 而 Facebook 的 embed 端點**沒有任何長度或大小欄位**（`dash_manifest` 對 progressive
 * 串流是 null，找不到 duration），所以無從估算 —— Instagram 那套「用時長乘位元率估」
 * 在這裡沒有輸入可用。
 *
 * 換來的不只是大小：有了 bytes 就能用網址裡的 `bitrate` 反推長度
 * （實測 hd 與 sd 各自算出來都是 23.3 秒，互相印證）。
 */
export async function probeFacebookVideoBytes(url: string): Promise<number | null> {
  try {
    return await withTimeout(
      async signal => {
        const res = await fetch(url, {
          method: 'HEAD',
          headers: { 'User-Agent': FACEBOOK_CRAWLER_USER_AGENT },
          signal
        });
        if (!res.ok) return null;
        const length = Number(res.headers.get('Content-Length'));
        return Number.isFinite(length) && length > 0 ? length : null;
      },
      SIZE_PROBE_TIMEOUT_MS,
      FACEBOOK_RETRIES
    );
  } catch (err) {
    console.error('[facebook] video size probe failed', {
      message: err instanceof Error ? err.message : String(err)
    });
    return null;
  }
}
