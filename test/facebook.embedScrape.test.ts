import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchFacebookVideoSources,
  probeFacebookVideoBytes
} from '@fxembed/atmosphere/providers/facebook/embed-scrape';

/*
 * `plugins/video.php` 是影片直連的唯一來源，而它最危險的失敗模式**不會報錯**：
 * 餵它分享短連結會回 200、回一整頁 HTML、就是沒有 hd_src。
 */

const HD =
  'https://video-tpe5-1.xx.fbcdn.net/o1/v/t2/f2/m367/AQO2vezZ.mp4' +
  '?_nc_cat=111&bitrate=3087962&tag=progressive_h264-basic-gen2_720p&oe=6AB56ECF';
const SD =
  'https://video-tpe1-1.xx.fbcdn.net/o1/v/t2/f2/m367/AQN6jLq1.mp4' +
  '?_nc_cat=109&bitrate=715091&tag=progressive_h264-basic-gen2_360p&oe=6AB56ECF';

/** JSON 內嵌在 HTML 裡，網址是 `\/` 跳脫過的 —— 與實際回應相同。 */
const embedPage = (fields: Record<string, unknown>) =>
  `<!DOCTYPE html><html><body><script>requireLazy(["VideoConfig"],function(){` +
  JSON.stringify(fields).replace(/\//g, '\\/') +
  `})</script></body></html>`;

const fullPayload = {
  video_id: '4484820285134652',
  aspect_ratio: 0.5625,
  original_width: 1080,
  original_height: 1920,
  dash_manifest: null,
  hd_src: HD,
  sd_src: SD
};

describe('fetchFacebookVideoSources', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('pulls both sources, their bitrates and the original dimensions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(embedPage(fullPayload), { status: 200 }))
    );

    const sources = await fetchFacebookVideoSources(
      'https://www.facebook.com/MASTER.FOOD.DIARY/videos/4484820285134652/'
    );

    expect(sources.ok).toBe(true);
    /* `\/` 必須被解掉，否則 og:video 會指向一個壞網址。 */
    expect(sources.hd?.url).toBe(HD);
    expect(sources.sd?.url).toBe(SD);
    /* bitrate 只寫在查詢字串裡，沒有別的地方拿得到 —— 它是反推長度的分母。 */
    expect(sources.hd?.bitrate).toBe(3087962);
    expect(sources.sd?.bitrate).toBe(715091);
    expect(sources.width).toBe(1080);
    expect(sources.height).toBe(1920);
    expect(sources.videoId).toBe('4484820285134652');
  });

  it('requests the canonical permalink, not whatever the user pasted', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(embedPage(fullPayload), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    await fetchFacebookVideoSources(
      'https://www.facebook.com/MASTER.FOOD.DIARY/videos/4484820285134652/'
    );

    const requested = String(fetchMock.mock.calls[0][0]);
    expect(requested).toContain('/plugins/video.php?href=');
    expect(decodeURIComponent(requested)).toContain(
      'https://www.facebook.com/MASTER.FOOD.DIARY/videos/4484820285134652/'
    );
  });

  it('treats a 200 with no hd_src/sd_src as a failure', async () => {
    /* 這就是餵分享短連結的實際結果：200、52 KB 的 HTML、零個 hd_src。
       當成成功會讓上層組出一則沒有影片的「影片貼文」。 */
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html><body>no player here</body></html>', { status: 200 }))
    );

    const sources = await fetchFacebookVideoSources('https://www.facebook.com/share/r/1EGDPCQQe2/');

    expect(sources.ok).toBe(false);
    expect(sources.hd).toBeNull();
    expect(sources.sd).toBeNull();
  });

  it('falls back to aspect_ratio when the original dimensions are missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(embedPage({ hd_src: HD, aspect_ratio: 0.5625 }), {
            status: 200
          })
      )
    );

    const sources = await fetchFacebookVideoSources('https://www.facebook.com/x/videos/1/');

    expect(sources.ok).toBe(true);
    expect(sources.height).toBe(1920);
    expect(sources.width).toBe(1080);
  });

  it('survives an SD-only response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(embedPage({ sd_src: SD, original_width: 640, original_height: 360 }), {
            status: 200
          })
      )
    );

    const sources = await fetchFacebookVideoSources('https://www.facebook.com/x/videos/1/');

    expect(sources.ok).toBe(true);
    expect(sources.hd).toBeNull();
    expect(sources.sd?.url).toBe(SD);
  });

  it('does not throw when the endpoint errors out', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('Network connection lost.');
      })
    );

    const sources = await fetchFacebookVideoSources('https://www.facebook.com/x/videos/1/');

    expect(sources.ok).toBe(false);
    expect(sources.status).toBe(500);
  });
});

describe('probeFacebookVideoBytes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads Content-Length from a HEAD', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(null, { status: 200, headers: { 'Content-Length': '8980825' } })
    );
    vi.stubGlobal('fetch', fetchMock);

    expect(await probeFacebookVideoBytes(HD)).toBe(8980825);
    expect(fetchMock.mock.calls[0][1]?.method).toBe('HEAD');
  });

  it('returns null rather than a wrong number when the probe fails', async () => {
    /* 量不到就維持 HD。回 0 會被誤讀成「這支影片是空的」。 */
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 403 }))
    );
    expect(await probeFacebookVideoBytes(HD)).toBeNull();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 200 }))
    );
    expect(await probeFacebookVideoBytes(HD)).toBeNull();
  });
});
