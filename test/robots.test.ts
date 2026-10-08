import { test, expect } from 'vitest';
import { app } from '../src/worker';
import harness from './helpers/harness';

/* zinzan fork：preview.zinzan.info 對搜尋與 AI 整站拒絕，連結預覽爬蟲另開群組放行。
   robots.txt 是公開檔案，只放指令，不放 # 註解。 */

const fetchRobots = async () => {
  const result = await app.request(
    new Request('https://fxtwitter.com/robots.txt', { method: 'GET' }),
    undefined,
    harness
  );
  return { status: result.status, body: await result.text() };
};

test('robots.txt has directives only', async () => {
  const { status, body } = await fetchRobots();

  expect(status).toEqual(200);
  expect(body).not.toContain('#');
  expect(body).toMatch(/^[\x00-\x7F]*$/);
});

test('robots.txt disallows everyone by default, with Content-Signal inside that group', async () => {
  const { body } = await fetchRobots();
  const [defaultGroup] = body.split('\n\n');

  expect(defaultGroup).toEqual(
    'User-agent: *\nContent-Signal: search=no, ai-input=no, ai-train=no\nDisallow: /'
  );
});

/* 短網址導轉到這裡不分 UA；X 與 Meta 的預覽爬蟲遵守 robots.txt，被擋就沒有預覽。 */
test('robots.txt allows link-preview crawlers', async () => {
  const { body } = await fetchRobots();
  const previewGroup = body.split('\n\n')[1] ?? '';

  for (const agent of ['Twitterbot', 'facebookexternalhit']) {
    expect(previewGroup).toContain(`User-agent: ${agent}\n`);
  }
  expect(previewGroup.trimEnd().endsWith('Allow: /')).toBe(true);
  expect(previewGroup).not.toContain('Disallow');
});
