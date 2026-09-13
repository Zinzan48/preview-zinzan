import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchThreadsPageJson } from '@fxembed/atmosphere/providers/threads/page-scrape';

/*
 * 這條路徑壞掉時會**安靜地**退回 GraphQL —— 沒有錯誤訊息，只會讓 Threads 的成功率
 * 悄悄掉回 20–25%。所以串流解析的每個分支都要釘住。
 *
 * 特別是分塊邊界那個案例：正式環境一次拿到的是 700 KB 以上、由網路決定切點的串流，
 * 標記被切成兩半是必然會發生的，但在「一次給完整份 HTML」的測試裡永遠看不到。
 */

/** 最小但形狀正確的內嵌資料：巢狀深度與正式頁面相同（`__bbox` 包兩層）。 */
const postPayload = {
  require: [
    [
      'ScheduledServerJS',
      'handle',
      null,
      [
        {
          __bbox: {
            require: [
              [
                'RelayPrefetchedStreamCache',
                'next',
                [],
                [
                  'adp_BarcelonaPostPageDirectQueryRelayPreloader_0',
                  {
                    __bbox: {
                      complete: true,
                      result: {
                        data: {
                          data: {
                            edges: [
                              {
                                node: {
                                  thread_items: [
                                    {
                                      post: {
                                        code: 'DdNwfAwiZcO',
                                        pk: '1234567890',
                                        media_type: 19,
                                        user: { username: '150_one_fifty', pk: '42' }
                                      }
                                    }
                                  ]
                                }
                              }
                            ]
                          }
                        }
                      }
                    }
                  }
                ]
              ]
            ]
          }
        }
      ]
    ]
  ]
};

const pageHtml = (payload: unknown, extra = '') =>
  `<!DOCTYPE html><html><head><meta property="og:title" content="x"/></head><body>` +
  `<script type="application/json" data-content-len="80" data-sjs>{"require":[["Noise"]]}</script>` +
  extra +
  `<script type="application/json" data-content-len="99999" data-sjs>${JSON.stringify(payload)}</script>` +
  `<div>${'tail padding '.repeat(50)}</div></body></html>`;

/** 把 HTML 切成固定大小的 chunk 串流出去，重現正式環境的分塊行為。 */
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

describe('fetchThreadsPageJson', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('pulls the post-page query result out of the embedded block', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => streamingResponse(pageHtml(postPayload), 4096))
    );

    const res = await fetchThreadsPageJson('/t/DdNwfAwiZcO');

    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    /* 回傳的形狀必須讓 extractPostPageEdges 能直接吃 —— 那是與 GraphQL 路徑共用的入口。 */
    const edges = (res.json as { data: { data: { edges: { node: Record<string, unknown> }[] } } })
      .data.data.edges;
    expect(edges).toHaveLength(1);
    const post = (edges[0].node.thread_items as { post: Record<string, unknown> }[])[0].post;
    expect(post.code).toBe('DdNwfAwiZcO');
    expect(post.media_type).toBe(19);
  });

  it('still finds the block when chunks split it mid-marker', async () => {
    /* 7 bytes 保證 `thread_items` 與 `</script>` 都會被切斷 —— 掃描為了維持 O(n)
       會往前跳，重疊長度不夠就會漏掉整個區塊。 */
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => streamingResponse(pageHtml(postPayload), 7))
    );

    const res = await fetchThreadsPageJson('/t/DdNwfAwiZcO');

    expect(res.ok).toBe(true);
    expect(
      (res.json as { data: { data: { edges: unknown[] } } }).data.data.edges
    ).toHaveLength(1);
  });

  it('sends a crawler User-Agent, not a browser one', async () => {
    const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) =>
      streamingResponse(pageHtml(postPayload), 4096)
    );
    vi.stubGlobal('fetch', fetchSpy);

    await fetchThreadsPageJson('/t/DdNwfAwiZcO');

    /* 帶瀏覽器 UA 拿到的是空殼頁（實測 0 個 thread_items），內容全靠前端 JS 補。
       這個標頭是整條路徑成立的前提。 */
    const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers['User-Agent']).toMatch(/bingbot/);
  });

  it('reports failure instead of throwing when the page has no data block', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => streamingResponse('<html><body>nothing here</body></html>', 4096))
    );

    const res = await fetchThreadsPageJson('/t/DdNwfAwiZcO');

    expect(res.ok).toBe(false);
    expect(res.json).toBeNull();
  });

  it('surfaces a mid-stream failure instead of calling it a missing block', async () => {
    /* 逾時會 abort body 串流，讓 read() 拋出。早期版本把它吞掉並回報成
       「頁面沒有資料區塊」—— 那會把「來不及讀完」誤診成「Meta 改了頁面結構」，
       兩者的處置完全不同。這裡確認它是以失敗收場而不是靜默地變成「沒有區塊」。 */
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('<html><script type='));
                controller.error(new Error('network reset'));
              }
            }),
            { status: 200 }
          )
      )
    );

    const res = await fetchThreadsPageJson('/t/DdNwfAwiZcO');

    expect(res.ok).toBe(false);
    expect(res.json).toBeNull();
  });

  it('reports failure on a non-2xx page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => streamingResponse('<html></html>', 4096, 404))
    );

    const res = await fetchThreadsPageJson('/t/nope');

    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
  });
});
