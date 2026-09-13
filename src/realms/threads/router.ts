import { Hono } from 'hono';
import { trimTrailingSlash } from 'hono/trailing-slash';
import { getBranding } from '../../helpers/branding';
import { versionRoute } from '../common/version';
import { threadsPostRequest } from './routes/post';

export const threads = new Hono();
threads.use(trimTrailingSlash());

/* Threads 的固定連結是 /@handle/post/SHORTCODE。把 @ 留在 :handle 裡由 handler 剝掉，
   而不是寫成 /@:handle/… —— 後者實測匹配不到（會落到 catch-all 直接 302）。
   這樣也順帶容許沒有 @ 的形狀。 */
threads.get('/:handle/post/:id', threadsPostRequest);
threads.get('/:handle/post/:id/:language', threadsPostRequest);
/* 不帶 handle 的簡短形式 */
threads.get('/post/:id', threadsPostRequest);

threads.get('/version', c => versionRoute(c));

threads.all('*', async c => c.redirect(getBranding(c).redirect, 302));
