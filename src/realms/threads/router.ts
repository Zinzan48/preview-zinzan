import { Hono } from 'hono';
import { trimTrailingSlash } from 'hono/trailing-slash';
import { sourceFallbackRedirect } from '../common/fallback';
import { versionRoute } from '../common/version';
import { threadsPostRequest } from './routes/post';
import { threadsShareRequest } from './routes/share';

export const threads = new Hono();
threads.use(trimTrailingSlash());

/* Threads 的固定連結是 /@handle/post/SHORTCODE。把 @ 留在 :handle 裡由 handler 剝掉，
   而不是寫成 /@:handle/… —— 後者實測匹配不到（會落到 catch-all 直接 302）。
   這樣也順帶容許沒有 @ 的形狀。

   每條都要配一條 `/*`：使用者貼的連結常帶結尾斜線（/post/CODE/）或 Threads 加的中文 slug
   （/post/CODE/<slug>/?hpir=1）。上面的 trimTrailingSlash() 救不到 —— 它只在回應是 404 時
   才去斜線重導，而檔尾的 catch-all 會先回 302，404 永遠不會出現。handler 只讀 handle 與 id，
   後面多出來的段落一律忽略。 */
threads.get('/:handle/post/:id', threadsPostRequest);
threads.get('/:handle/post/:id/*', threadsPostRequest);
/* 不帶 handle 的簡短形式 */
threads.get('/post/:id', threadsPostRequest);
threads.get('/post/:id/*', threadsPostRequest);
/* 分享用的短連結 /t/<code>。code 就是貼文 shortcode，所以直接沿用同一個 handler；
   真人會被 302 回不含 handle 的固定連結，Threads 自己會補上正確的作者。 */
threads.get('/t/:id', threadsPostRequest);
threads.get('/t/:id/*', threadsPostRequest);

/* 分享鈕產生的短連結 /share/<code>。code 與貼文 shortcode 不同命名空間，
   要先問過上游才知道指向哪一則。 */
threads.get('/share/:code', threadsShareRequest);
threads.get('/share/:code/*', threadsShareRequest);

threads.get('/version', c => versionRoute(c));

threads.all('*', sourceFallbackRedirect);
