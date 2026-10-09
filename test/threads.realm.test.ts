import { afterEach, describe, expect, test, vi } from 'vitest';
import { app } from '../src/worker';
import { humanHeaders } from './helpers/data';
import harness from './helpers/harness';

/* 使用者實際貼進來的 Threads 連結常帶結尾斜線，或 Threads 自己加的中文 slug。
   2026-10-09 線上實測：這些形狀全部被檔尾的 catch-all 導到 branding 首頁。 */

const PREVIEW = 'https://preview.zinzan.info';
const SLUG = '%E7%9B%AE%E5%89%8D';

const request = (path: string, headers: Record<string, string>) =>
  app.request(new Request(`${PREVIEW}${path}`, { method: 'GET', headers }), undefined, harness);

describe('Threads post links reach the post handler (human UA)', () => {
  const POST = 'https://www.threads.com/@dumpling_neko/post/DZzR3K1GKmS';

  test.each([
    '/threads.com/@dumpling_neko/post/DZzR3K1GKmS',
    '/threads.com/@dumpling_neko/post/DZzR3K1GKmS/',
    '/threads.com/@dumpling_neko/post/DZzR3K1GKmS/?xmt=abc',
    `/threads.com/@dumpling_neko/post/DZzR3K1GKmS/${SLUG}`,
    `/threads.com/@dumpling_neko/post/DZzR3K1GKmS/${SLUG}/?hpir=1&http_ref=x`,
    '/www.threads.net/@dumpling_neko/post/DZzR3K1GKmS/'
  ])('%s', async path => {
    const res = await request(path, humanHeaders);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(POST);
  });

  test.each(['/threads.com/post/DZzR3K1GKmS/', '/threads.com/t/DZzR3K1GKmS/'])(
    '%s (no handle)',
    async path => {
      const res = await request(path, humanHeaders);
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('https://www.threads.com/post/DZzR3K1GKmS');
    }
  );
});

describe('Threads post links reach the post handler (crawler UA)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /* 爬蟲會真的去上游取數。讓 fetch 失敗，只看它有沒有被拿這個 shortcode 呼叫 ——
     有，就代表請求進了貼文 handler，而不是被 catch-all 導走。每條用不同 shortcode，
     避免吃到前一條的快取。 */
  test.each([
    ['/threads.com/@dumpling_neko/post/DZzR3K1GKmA/', 'DZzR3K1GKmA'],
    ['/threads.com/@dumpling_neko/post/DZzR3K1GKmB/?xmt=abc', 'DZzR3K1GKmB'],
    [`/threads.com/@dumpling_neko/post/DZzR3K1GKmC/${SLUG}/?hpir=1`, 'DZzR3K1GKmC']
  ])('%s', async (path, shortcode) => {
    const fetchSpy = vi.fn<typeof fetch>(async () => new Response('not found', { status: 404 }));
    vi.stubGlobal('fetch', fetchSpy);

    const res = await request(path, { 'User-Agent': 'facebookexternalhit/1.1' });

    expect(res.headers.get('location')).toBeNull();
    const fetchedUrls = fetchSpy.mock.calls.map(([input]) =>
      input instanceof Request ? input.url : String(input)
    );
    expect(fetchedUrls.some(url => url.includes(shortcode))).toBe(true);
  });
});
