import { describe, expect, test } from 'vitest';
import { app } from '../src/worker';
import { originalSourceUrl } from '../src/helpers/pathRouting';
import { facebook } from '../src/realms/facebook/router';
import { botHeaders, githubUrl, humanHeaders } from './helpers/data';
import harness from './helpers/harness';

/* 各 realm 的 catch-all：路徑帶著來源網域前綴時送回原平台，而不是 branding 首頁。
   遇到沒見過的網址形狀，最差就是沒有預覽，使用者仍然到得了原本的貼文。 */

const PREVIEW = 'https://preview.zinzan.info';

describe('originalSourceUrl', () => {
  test.each([
    ['/threads.com/@h/replies?x=1', 'https://threads.com/@h/replies?x=1'],
    ['/www.instagram.com/stories/foo/123/', 'https://www.instagram.com/stories/foo/123/'],
    /* fb.watch 的 code 只在原 host 上解析得出來，不能正規化成 www.facebook.com */
    ['/fb.watch/lqvlrYbAdh/', 'https://fb.watch/lqvlrYbAdh/'],
    ['/X.com/jack', 'https://x.com/jack'],
    [
      '/threads.com/@h/post/X/%E7%9B%AE%E5%89%8D',
      'https://threads.com/@h/post/X/%E7%9B%AE%E5%89%8D'
    ],
    ['/threads.com', 'https://threads.com/']
  ])('%s → %s', (path, expected) => {
    expect(originalSourceUrl(`${PREVIEW}${path}`)).toBe(expected);
  });

  test('a path that starts with // stays on the whitelisted host', () => {
    const target = originalSourceUrl(`${PREVIEW}/x.com//evil.com/x`);
    expect(target).not.toBeNull();
    expect(new URL(target!).host).toBe('x.com');
  });

  test.each(['/', '/evil.com/x', '/2/go'])('%s has no source prefix → null', path => {
    expect(originalSourceUrl(`${PREVIEW}${path}`)).toBeNull();
  });
});

describe('realm catch-alls send source-prefixed paths back to the source', () => {
  const request = (path: string, init: RequestInit = { headers: humanHeaders }) =>
    app.request(new Request(`${PREVIEW}${path}`, { method: 'GET', ...init }), undefined, harness);

  test.each([
    [
      'threads',
      '/threads.com/@dumpling_neko/replies',
      'https://threads.com/@dumpling_neko/replies'
    ],
    ['twitter', '/x.com/jack/lists/123/members', 'https://x.com/jack/lists/123/members'],
    [
      'instagram',
      '/www.instagram.com/stories/foo/123/',
      'https://www.instagram.com/stories/foo/123/'
    ],
    ['bluesky', '/bsky.app/search?q=x', 'https://bsky.app/search?q=x'],
    ['tiktok', '/www.tiktok.com/@someone', 'https://www.tiktok.com/@someone']
  ])('%s realm: %s', async (_realm, path, expected) => {
    const res = await request(path);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(expected);
  });

  test('crawlers get the same redirect', async () => {
    const res = await request('/threads.com/@dumpling_neko/replies', { headers: botHeaders });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://threads.com/@dumpling_neko/replies');
  });

  /* Facebook 的 GET 一律交給貼文 handler，catch-all 只接得到其他 method；而其他 method
     在整個 app 上會先被快取 middleware 回 405（src/caches.ts）。所以這裡直接打子路由，
     只驗那一行有接對。 */
  test('facebook realm: catch-all is wired to the source fallback', async () => {
    const res = await facebook.request(`${PREVIEW}/www.facebook.com/reel/1`, { method: 'POST' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://www.facebook.com/reel/1');
  });

  test('no source prefix still goes to branding', async () => {
    const res = await app.request(
      new Request('https://fxtwitter.com/foo/bar/baz/qux', {
        method: 'GET',
        headers: humanHeaders
      }),
      undefined,
      harness
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(githubUrl);
  });
});
