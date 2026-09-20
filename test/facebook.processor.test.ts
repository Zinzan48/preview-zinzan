import { describe, expect, it } from 'vitest';
import {
  deriveDurationSeconds,
  facebookPageToStatus,
  pickFacebookVideoSource
} from '@fxembed/atmosphere/providers/facebook/processor';
import type { FacebookVideoSources } from '@fxembed/atmosphere/providers/facebook/embed-scrape';
import type { FacebookPageMeta } from '@fxembed/atmosphere/providers/facebook/page-scrape';
import type { APIVideo } from '@fxembed/atmosphere/types/api-schemas';

const HD = 'https://video-tpe5-1.xx.fbcdn.net/hd.mp4?bitrate=3087962';
const SD = 'https://video-tpe1-1.xx.fbcdn.net/sd.mp4?bitrate=715091';

const sources = (over: Partial<FacebookVideoSources> = {}): FacebookVideoSources => ({
  ok: true,
  status: 200,
  hd: { url: HD, bitrate: 3087962 },
  sd: { url: SD, bitrate: 715091 },
  width: 1080,
  height: 1920,
  videoId: '4484820285134652',
  ...over
});

const meta = (over: Partial<FacebookPageMeta> = {}): FacebookPageMeta => ({
  ok: true,
  status: 200,
  canonicalUrl: 'https://www.facebook.com/reel/4484820285134652/',
  ogTitle: '8.4 萬次觀看 · 1,345 個心情 | 算命的說我很愛吃 on Reels',
  ogImage: 'https://scontent.xx.fbcdn.net/v/t51/n.jpg',
  ogType: 'video.other',
  ogDescription: '',
  pageTitle: '算命的說我很愛吃 on Reels',
  video: {
    permalink: 'https://www.facebook.com/MASTER.FOOD.DIARY/videos/4484820285134652/',
    handle: 'MASTER.FOOD.DIARY',
    title: '算命的說我很愛吃 on Reels'
  },
  ...over
});

describe('pickFacebookVideoSource', () => {
  it('keeps HD when the size is unknown', () => {
    /* 量不到就維持 HD：「畫質低一階」是每次都付的代價，
       「超過 20 MiB」只有長影片才會發生。 */
    expect(pickFacebookVideoSource(sources(), null)?.url).toBe(HD);
  });

  it('keeps HD when it fits under Telegram 的 20 MiB', () => {
    expect(pickFacebookVideoSource(sources(), 8980825)?.url).toBe(HD);
  });

  it('drops to SD only when HD is provably too big', () => {
    expect(pickFacebookVideoSource(sources(), 25 * 1024 * 1024)?.url).toBe(SD);
  });

  it('uses whichever single source exists', () => {
    expect(pickFacebookVideoSource(sources({ hd: null }), null)?.url).toBe(SD);
    /* 只有 HD 又超標時沒有更小的可選，維持 HD 好過沒有影片。 */
    expect(pickFacebookVideoSource(sources({ sd: null }), 25 * 1024 * 1024)?.url).toBe(HD);
    expect(pickFacebookVideoSource(sources({ hd: null, sd: null }), null)).toBeNull();
  });
});

describe('deriveDurationSeconds', () => {
  it('derives the same length from either quality', () => {
    /* Facebook 不給時長，只能用 bytes 與 bitrate 反推。
       兩種畫質各自算出同一個數字，就是這個推導可信的證據。 */
    expect(deriveDurationSeconds(8980825, 3087962)).toBe(23.3);
    expect(deriveDurationSeconds(2079725, 715091)).toBe(23.3);
  });

  it('returns 0 instead of Infinity or NaN when an input is missing', () => {
    expect(deriveDurationSeconds(null, 3087962)).toBe(0);
    expect(deriveDurationSeconds(8980825, null)).toBe(0);
    expect(deriveDurationSeconds(8980825, 0)).toBe(0);
  });
});

describe('facebookPageToStatus', () => {
  it('builds a video status with the fields the embed pipeline needs', () => {
    const status = facebookPageToStatus(meta(), {
      sources: sources(),
      bytes: 8980825,
      chosen: sources().hd!
    });

    expect(status).not.toBeNull();
    expect(status!.url).toBe('https://www.facebook.com/reel/4484820285134652/');
    expect(status!.provider).toBe('facebook');
    expect(status!.embed_card).toBe('player');
    /* og:title 由 render 端組成 `${name} (@${screen_name})`，探測就是靠這個字串。 */
    expect(status!.author.name).toBe('算命的說我很愛吃');
    expect(status!.author.screen_name).toBe('MASTER.FOOD.DIARY');

    const video = status!.media.videos![0] as APIVideo;
    /* 沒填 format 的 provider 會讓 og:video:type 變成字串 "undefined"，客戶端就不播。 */
    expect(video.format).toBe('video/mp4');
    expect(video.url).toBe(HD);
    expect(video.width).toBe(1080);
    expect(video.duration).toBe(23.3);
    expect(video.filesize).toBe(8980825);
    /* 兩種畫質都要留在 formats 裡，方便之後診斷挑錯的情況。 */
    expect(video.formats.map(f => f.url)).toEqual([HD, SD]);
  });

  it('never writes the string "null" into the thumbnail', () => {
    /* Threads 踩過這個：og:image 被寫成字串 "null"。
       LINE 的連結預覽只讀 og:image，寫錯等於整張圖消失。 */
    const status = facebookPageToStatus(meta({ ogImage: null }), {
      sources: sources(),
      bytes: null,
      chosen: sources().hd!
    });

    const video = status!.media.videos![0] as APIVideo;
    expect(video.thumbnail_url).toBeUndefined();
    expect(String(video.thumbnail_url)).not.toBe('null');
  });

  it('builds a photo card for a non-video page', () => {
    const status = facebookPageToStatus(
      meta({
        video: null,
        canonicalUrl: 'https://www.facebook.com/facebook/',
        ogTitle: 'Facebook',
        pageTitle: 'Facebook',
        ogImage: 'https://lookaside.fbsbx.com/lookaside/crawler/media/?media_id=1'
      }),
      null
    );

    expect(status!.embed_card).toBe('summary_large_image');
    expect(status!.media.videos).toBeUndefined();
    expect(status!.media.photos).toHaveLength(1);
    /* 沒有 oEmbed link 時 handle 從正規網址的第一段來。 */
    expect(status!.author.screen_name).toBe('facebook');
    expect(status!.author.name).toBe('Facebook');
  });

  it('does not mistake a Facebook surface path for a handle', () => {
    const status = facebookPageToStatus(
      meta({ video: null, pageTitle: null, ogTitle: 'x | y' }),
      null
    );

    /* canonical 是 /reel/<id>/ —— `reel` 不是誰的 handle。 */
    expect(status!.author.screen_name).toBe('');
    expect(status!.author.name).toBe('Facebook');
  });

  it('falls back to the engagement half of og:title when there is no description', () => {
    const status = facebookPageToStatus(meta(), {
      sources: sources(),
      bytes: null,
      chosen: sources().hd!
    });

    /* 後半段是作者（已經在 og:title 裡了），前半段才是有資訊量的部分。 */
    expect(status!.text).toBe('8.4 萬次觀看 · 1,345 個心情');
  });

  it('prefers a real og:description over the title split', () => {
    const status = facebookPageToStatus(meta({ ogDescription: '今天這家真的好吃' }), {
      sources: sources(),
      bytes: null,
      chosen: sources().hd!
    });

    expect(status!.text).toBe('今天這家真的好吃');
  });

  it('returns null when there is nothing worth previewing', () => {
    /* 呼叫端會把人 302 回原站，而不是吐一張空卡片。 */
    expect(facebookPageToStatus(meta({ video: null, ogImage: null }), null)).toBeNull();
    expect(facebookPageToStatus(meta({ canonicalUrl: null }), null)).toBeNull();
  });
});
