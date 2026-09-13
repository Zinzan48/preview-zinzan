import { test, expect } from 'vitest';
import { app } from '../src/worker';
import harness from './helpers/harness';
import { botHeaders } from './helpers/data';
import { Constants } from '../src/constants';

/* 失敗頁與成功頁都回 HTTP 200（爬蟲要 200 才會渲染 og:description 裡的錯誤訊息），
   所以 cacheMiddleware 只能靠 returnError 打的這個標頭分辨兩者。
   標頭一旦消失，快取層就會把上游的暫時性失敗凍在快取裡持續服務。 */

test('error embeds are marked so they are not cached', async () => {
  const result = await app.request(
    new Request('https://fxtwitter.com/jack/status/not-a-real-id', {
      method: 'GET',
      headers: botHeaders
    }),
    undefined,
    harness
  );

  expect(result.status).toEqual(200);
  expect(result.headers.get(Constants.EMBED_ERROR_HEADER)).toEqual('1');
});

test('successful embeds are not marked', async () => {
  const result = await app.request(
    new Request('https://fxtwitter.com/jack/status/20', {
      method: 'GET',
      headers: botHeaders
    }),
    undefined,
    harness
  );

  expect(result.status).toEqual(200);
  expect(result.headers.get(Constants.EMBED_ERROR_HEADER)).toBeNull();
});
