import { Hono } from 'hono';
import { trimTrailingSlash } from 'hono/trailing-slash';
import { getBranding } from '../../helpers/branding';
import { versionRoute } from '../common/version';
import { facebookPostRequest } from './routes/post';

export const facebook = new Hono();
facebook.use(trimTrailingSlash());

facebook.get('/version', c => versionRoute(c));

/* 刻意是 catch-all。Facebook 的公開內容形狀太多（/reel/、/watch/?v=、
   /<page>/videos/、/share/r|v|p/、/<page>/posts/…），但取數方式對每一種都一樣 ——
   讀那一頁的 <head>。維護一份具名路由清單只會漏，漏掉的那一種會安靜地 302 掉。
   真的解析不出媒體時，handler 自己會把人送回原站。 */
facebook.get('/*', facebookPostRequest);

facebook.all('*', async c => c.redirect(getBranding(c).redirect, 302));
