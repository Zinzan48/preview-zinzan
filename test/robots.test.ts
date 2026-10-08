import { test, expect } from 'vitest';
import { app } from '../src/worker';
import harness from './helpers/harness';

/* zinzan fork：preview.zinzan.info 整站拒絕爬蟲。
   robots.txt 是公開檔案，只放指令，不放 # 註解。 */

test('robots.txt disallows everything with directives only', async () => {
  const result = await app.request(
    new Request('https://fxtwitter.com/robots.txt', { method: 'GET' }),
    undefined,
    harness
  );
  const body = await result.text();

  expect(result.status).toEqual(200);
  expect(body).toMatch(/^User-agent: \*\nDisallow: \/\n?$/);
  expect(body).not.toContain('#');
});
