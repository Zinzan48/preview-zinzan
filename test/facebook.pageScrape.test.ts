import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchFacebookPageMeta } from '@fxembed/atmosphere/providers/facebook/page-scrape';

/*
 * 這是 Facebook 唯一的取數路徑，沒有 fallback —— 解析壞掉不會退化成別條路，
 * 而是直接變成「貼文不存在」的錯誤卡，然後被 Telegram 快取很久。
 *
 * 片段全部取自 2026-09-20 對 facebook.com 的實際回應，包含它原本的 entity 編碼。
 */

const OEMBED_HREF =
  'https://graph.facebook.com/v26.0/oembed_video?url=https%3A%2F%2Fwww.facebook.com' +
  '%2FMASTER.FOOD.DIARY%2Fvideos%2F4484820285134652%2F';

const AUTHOR_ENTITIES = '&#x7b97;&#x547d;&#x7684;&#x8aaa;&#x6211;&#x5f88;&#x611b;&#x5403;';

const reelHead =
  `<link rel="canonical" href="https://www.facebook.com/reel/4484820285134652/" />` +
  `<link rel="alternate" href="${OEMBED_HREF}" title="${AUTHOR_ENTITIES} on Reels" />` +
  `<meta property="og:type" content="video.other" />` +
  `<meta property="og:title" content="8.4&#xa0;&#x842c;&#x6b21;&#x89c0;&#x770b; &#xb7; 1,345 &#x500b;&#x5fc3;&#x60c5; | ${AUTHOR_ENTITIES} on Reels" />` +
  `<meta property="og:description" content="" />` +
  `<meta property="og:image" content="https://scontent.xx.fbcdn.net/v/t51/n.jpg?stp=dst-jpg&amp;_nc_cat=101" />` +
  `<meta property="og:url" content="https://www.facebook.com/reel/4484820285134652/" />` +
  `<title>${AUTHOR_ENTITIES} on Reels</title>`;

/** 分享頁**沒有** rel=canonical（實測），正規網址只在 og:url 裡。 */
const shareHead =
  `<link rel="alternate" href="${OEMBED_HREF}" title="${AUTHOR_ENTITIES} on Reels" />` +
  `<meta property="og:type" content="video.other" />` +
  `<meta property="og:title" content="38&#xa0;&#x842c;&#x6b21;&#x89c0;&#x770b; | Reel by ${AUTHOR_ENTITIES}" />` +
  `<meta property="og:url" content="https://www.facebook.com/reel/4484820285134652/" />` +
  `<meta property="og:image" content="https://scontent.xx.fbcdn.net/v/t15/n.jpg" />`;

/** 粉專首頁：og:type 照樣是 video.other，但沒有 oEmbed link。 */
const pageHomeHead =
  `<link rel="canonical" href="https://www.facebook.com/facebook/" />` +
  `<meta property="og:type" content="video.other" />` +
  `<meta property="og:title" content="Facebook" />` +
  `<meta property="og:image" content="https://lookaside.fbsbx.com/lookaside/crawler/media/?media_id=100064860875397" />` +
  `<meta property="og:url" content="https://www.facebook.com/facebook/" />` +
  `<title>Facebook</title>`;

const page = (head: string) =>
  `<!DOCTYPE html><html lang="en"><head>${head}</head><body>` +
  `<div>${'app shell padding '.repeat(200)}</div></body></html>`;

/** 固定大小分塊，重現正式環境由網路決定切點的串流。 */
const streamingResponse = (html: string, chunkSize: number, status = 200) => {
  const bytes = new TextEncoder().encode(html);
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + chunkSize));
      offset += chunkSize;
    }
  });
  return new Response(body, { status, headers: { 'Content-Type': 'text/html' } });
};

describe('fetchFacebookPageMeta', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads a reel page: canonical, decoded og:*, and the video target', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => streamingResponse(page(reelHead), 4096))
    );

    const meta = await fetchFacebookPageMeta('https://www.facebook.com/reel/4484820285134652');

    expect(meta.ok).toBe(true);
    expect(meta.canonicalUrl).toBe('https://www.facebook.com/reel/4484820285134652/');
    expect(meta.ogTitle).toContain('算命的說我很愛吃');
    /* og:image 的 &amp; 必須還原成 &，否則簽章參數會少一個而拿到 403。 */
    expect(meta.ogImage).toBe('https://scontent.xx.fbcdn.net/v/t51/n.jpg?stp=dst-jpg&_nc_cat=101');
    expect(meta.pageTitle).toBe('算命的說我很愛吃 on Reels');
    expect(meta.video).toEqual({
      permalink: 'https://www.facebook.com/MASTER.FOOD.DIARY/videos/4484820285134652/',
      handle: 'MASTER.FOOD.DIARY',
      title: '算命的說我很愛吃 on Reels'
    });
  });

  it('falls back to og:url on a share page, which has no canonical', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => streamingResponse(page(shareHead), 4096))
    );

    const meta = await fetchFacebookPageMeta('https://www.facebook.com/share/r/1EGDPCQQe2/');

    /* 這是分享短連結能運作的關鍵：正規網址只在 og:url，而 plugins/video.php
       餵分享連結會回 200 但沒有 hd_src。 */
    expect(meta.canonicalUrl).toBe('https://www.facebook.com/reel/4484820285134652/');
    expect(meta.video?.permalink).toBe(
      'https://www.facebook.com/MASTER.FOOD.DIARY/videos/4484820285134652/'
    );
  });

  it('reports no video for a page home even though og:type says video.other', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => streamingResponse(page(pageHomeHead), 4096))
    );

    const meta = await fetchFacebookPageMeta('https://www.facebook.com/facebook');

    /* 這一條是整個判別邏輯的理由：og:type 對粉專首頁也是 video.other，
       拿它當條件會對每個非影片網址都白打一次 embed 端點。 */
    expect(meta.ogType).toBe('video.other');
    expect(meta.video).toBeNull();
    expect(meta.ogImage).toContain('lookaside.fbsbx.com');
  });

  it('still parses when chunks split the head markers', async () => {
    /* 7 bytes 保證 `</head>`、`<meta …>`、`<link …>` 全都會被切斷。
       正式環境是 451 KB 的串流，切在哪裡由網路決定，這種案例必然發生。 */
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => streamingResponse(page(reelHead), 7))
    );

    const meta = await fetchFacebookPageMeta('https://www.facebook.com/reel/4484820285134652');

    expect(meta.ok).toBe(true);
    expect(meta.video?.handle).toBe('MASTER.FOOD.DIARY');
  });

  it('does not treat a non-2xx page as parseable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => streamingResponse('<html></html>', 4096, 404))
    );

    const meta = await fetchFacebookPageMeta('https://www.facebook.com/reel/0');

    expect(meta.ok).toBe(false);
    expect(meta.status).toBe(404);
    expect(meta.canonicalUrl).toBeNull();
  });

  it('retries once when the fetch throws, so a blip is not cached as a broken card', async () => {
    /* 實測遇過：worker 第一個請求回 `Network connection lost.`，之後 3/3 正常。
       這條路沒有 fallback，而 Telegram 會把壞掉的預覽記很久。 */
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('Network connection lost.'))
      .mockImplementation(async () => streamingResponse(page(reelHead), 4096));
    vi.stubGlobal('fetch', fetchMock);

    const meta = await fetchFacebookPageMeta('https://www.facebook.com/reel/4484820285134652');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(meta.ok).toBe(true);
    expect(meta.video?.handle).toBe('MASTER.FOOD.DIARY');
  });

  it('gives up after the retry instead of throwing at the caller', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('Network connection lost.');
      })
    );

    const meta = await fetchFacebookPageMeta('https://www.facebook.com/reel/4484820285134652');

    expect(meta.ok).toBe(false);
    expect(meta.status).toBe(500);
  });
});

describe('fetchFacebookPageMeta redirects', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const redirect = (to: string) => new Response(null, { status: 302, headers: { Location: to } });

  it('follows fb.watch across origins to www.facebook.com', async () => {
    /* fb.watch/<code> 實測 302 到 https://www.facebook.com/watch/?v=<id>&… ——
     **跨來源**。用同源限制的 fetch 會停在 302，症狀是「fb.watch 一律沒有預覽」。 */
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        seen.push(url);
        if (url.startsWith('https://fb.watch/')) {
          return redirect('https://www.facebook.com/watch/?v=662317629075955&ref=sharing');
        }
        return streamingResponse(page(reelHead), 4096);
      })
    );

    const meta = await fetchFacebookPageMeta('https://fb.watch/lqvlrYbAdh/');

    expect(seen).toEqual([
      'https://fb.watch/lqvlrYbAdh/',
      'https://www.facebook.com/watch/?v=662317629075955&ref=sharing'
    ]);
    expect(meta.ok).toBe(true);
    expect(meta.video?.handle).toBe('MASTER.FOOD.DIARY');
  });

  it('refuses to follow a redirect off Facebook', async () => {
    /* 只放寬到 Facebook 自己的 host，而不是整個改用 redirect: 'follow'。 */
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => redirect('https://example.com/somewhere-else'))
    );

    const meta = await fetchFacebookPageMeta('https://www.facebook.com/reel/1');

    expect(meta.ok).toBe(false);
    expect(meta.status).toBe(302);
  });
});
