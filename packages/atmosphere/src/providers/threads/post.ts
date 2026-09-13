import type { SocialThread } from '../../types/api-status.js';
import { resolveThreadsAccounts, type ThreadsRequestContext } from './account-proxy.js';
import { fetchThreadsPostPage, fetchThreadsSession, invalidateThreadsSession } from './client.js';
import { fetchThreadsPageJson } from './page-scrape.js';
import { fetchThreadsSingleThread } from './private-api.js';
import { containingThreadChain } from './private-processor.js';
import { buildThreadsTombstone, threadsPostToStatus } from './processor.js';
import { normalizeThreadsPostId, threadsShortcodeToMediaId } from './shortcode.js';

function extractPostPageEdges(json: unknown): {
  edges: { node?: Record<string, unknown>; cursor?: string }[];
} {
  const root = json as { data?: { data?: { edges?: unknown[] } } };
  const edges = root?.data?.data?.edges;
  if (!Array.isArray(edges)) return { edges: [] };
  return { edges: edges as { node?: Record<string, unknown>; cursor?: string }[] };
}

const notFound = (): SocialThread => ({ code: 404, status: null, thread: null, author: null });

/** Owner details to fall back on for posts whose `user` block is trimmed down. */
function ownerFallbackFrom(chain: Record<string, unknown>[]): {
  id: string;
  username: string;
  fullName?: string;
  pic: string | null;
} {
  const owner = chain[0]?.user as Record<string, unknown> | undefined;
  return {
    id: String(owner?.pk ?? owner?.id ?? ''),
    username: String(owner?.username ?? ''),
    fullName: typeof owner?.full_name === 'string' ? owner.full_name : undefined,
    pic: typeof owner?.profile_pic_url === 'string' ? owner.profile_pic_url : null
  };
}

/**
 * A post's own self-reply chain becomes `thread`, with the last entry as the focal `status` —
 * the same convention the logged-out path has always used.
 */
function threadFromChain(chain: Record<string, unknown>[], shortcode: string): SocialThread {
  const ownerFb = ownerFallbackFrom(chain);
  const statuses = chain
    .map(post => threadsPostToStatus(post, ownerFb))
    .filter((s): s is NonNullable<typeof s> => Boolean(s));

  if (!statuses.length) {
    return {
      code: 404,
      status: buildThreadsTombstone('unavailable', { id: shortcode }),
      thread: null,
      author: null
    };
  }

  const status = statuses[statuses.length - 1]!;
  const prefix = statuses.length > 1 ? statuses.slice(0, -1) : [];
  return {
    code: 200,
    status,
    thread: prefix.length ? prefix : [status],
    author: status.author
  };
}

/**
 * 把 post-page 查詢的結果轉成 SocialThread。
 *
 * 頁面 HTML 內嵌的那份資料與 logged-out GraphQL 的回應是**同一個形狀**
 * （兩者都是 `BarcelonaPostPageDirectQuery` 的結果），所以兩條取數路徑共用這一段。
 */
function threadFromPostPageJson(json: unknown, shortcode: string): SocialThread {
  const { edges } = extractPostPageEdges(json);
  const focalNode = edges[0]?.node;
  if (!focalNode) {
    return notFound();
  }

  const items = focalNode.thread_items;
  if (!Array.isArray(items) || items.length === 0) {
    return notFound();
  }

  const chain = items
    .map(it => (it as { post?: Record<string, unknown> })?.post)
    .filter((p): p is Record<string, unknown> => Boolean(p));
  if (!chain.length) {
    return notFound();
  }

  return threadFromChain(chain, shortcode);
}

/**
 * Resolve a single Threads post.
 *
 * With an account proxy configured this reads `text_feed/{post_id}/single_thread/`, which the
 * Threads app itself uses and which serves posts logged-out `threads.com` withholds (age-gated
 * accounts, limited-audience posts). Otherwise — and whenever that call fails — it falls back to
 * the logged-out Relay query, so a deployment without credentials behaves exactly as before.
 */
export async function constructThreadsPost(
  rawId: string,
  userAgent: string | undefined,
  ctx?: ThreadsRequestContext
): Promise<SocialThread> {
  const shortcode = normalizeThreadsPostId(rawId);
  let mediaId: string;
  try {
    mediaId = threadsShortcodeToMediaId(shortcode);
  } catch {
    return { code: 400, status: null, thread: null, author: null };
  }

  const requestCtx: ThreadsRequestContext = { ...ctx, userAgent: ctx?.userAgent ?? userAgent };
  const accounts = await resolveThreadsAccounts(requestCtx);
  if (accounts.length) {
    const proxied = await fetchThreadsSingleThread(mediaId, requestCtx, { accounts });
    if (proxied.ok) {
      const chain = containingThreadChain(proxied.json);
      if (chain.length) {
        return threadFromChain(chain, shortcode);
      }
    }
    /* 私有 API 的失敗一律往下走 logged-out 路徑，不在這裡提早回 404。

       上游原本對 `proxied.status === 404` 直接 `return notFound()`，當成「Meta 說這則
       貼文不存在」。但那個 404 不一定來自 API：session 失效時 i.instagram.com 會把
       `/api/v1/...` 302 到同源的 `/accounts/login/`，而 fetchSameOriginHttps 會跟著走，
       最後拿到的是登入頁的 HTML —— 狀態碼正好是 404。線上實測（2026-09-13，Workers
       observability）9 次 text_feed 請求全部走到這條路，使用者看到的就是「找不到貼文」，
       而同一則貼文 logged-out 查詢拿得到完整內容。

       代價是真的被刪掉的貼文會多一次上游往返才回 404，換來的是憑證出問題時服務不會
       整片假性失效。account-proxy 那側另外把登入頁還原成 401，這裡是第二道防線。 */
  }

  /* 讀頁面優先於 GraphQL。

     兩者拿到的是同一份資料（頁面內嵌的就是 `BarcelonaPostPageDirectQuery` 的結果），
     差別只在 Meta 怎麼對待這兩種請求：從 Cloudflare 出口 IP 打 GraphQL 有 75–80%
     會被回 401「Please wait a few minutes before you try again」，而讀頁面實測 20/20
     成功。Meta 擋的是 API，不擋爬蟲讀頁面。

     延遲也沒有變差 —— 串流到內嵌區塊收完就中止，線上中位數 1.95 秒，
     與 GraphQL 成功時相當。 */
  const page = await fetchThreadsPageJson(`/t/${encodeURIComponent(shortcode)}`);
  if (page.ok && page.json != null) {
    const thread = threadFromPostPageJson(page.json, shortcode);
    if (thread.code === 200) {
      return thread;
    }
  }

  /* GraphQL 留作最後手段。它現在很少會成功，但成本只有一次往返，
     而且萬一 Meta 改掉頁面的內嵌結構，這條路就是唯一還活著的。 */
  const session = await fetchThreadsSession(userAgent);
  if (!session) {
    return { code: 500, status: null, thread: null, author: null };
  }

  const res = await fetchThreadsPostPage({
    mediaId,
    sortOrder: 'TOP',
    after: null,
    /* 不要用 null（不限制）。這個查詢會連回覆一起帶回來，熱門貼文的回覆是數十萬則，
       回應大到整個請求逾時 —— 實測 Threads 上線首日那則 @zuck/post/CuVYy5Fvrrd
       會卡 16 秒後以「Request has timed out too many times」失敗，而 Threads 官方
       對同一則吐得出完整 OG。嵌入頁只需要焦點貼文本身（下面取的是
       edges[0].node.thread_items，那是作者自己的連續貼文，不是回覆），
       所以回覆抓最少量就夠。

       用 1 而不是 0：實測 first: 0 反而更慢（3.3~8.8 秒，對照 first: 1 的
       1.5~1.7 秒），Meta 對 0 似乎有特殊處理或乾脆忽略了這個限制。 */
    first: 1,
    session,
    userAgent
  });
  if (!res.ok || res.json == null) {
    /* 查詢失敗有可能是快取的 session token 過期，丟掉它讓下一次重新建，
       否則同一個 isolate 會一直拿著壞掉的 token 失敗到 TTL 到期。 */
    invalidateThreadsSession();
    return { code: res.status === 404 ? 404 : 500, status: null, thread: null, author: null };
  }

  return threadFromPostPageJson(res.json, shortcode);
}
