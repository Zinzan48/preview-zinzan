import { Context } from 'hono';
import { Constants } from '../../../constants';
import { stripSourcePrefix } from '../../../helpers/pathRouting';

export const genericBlueskyRedirect = async (c: Context) => {
  const url = new URL(c.req.url);
  /* 請求路徑帶著來源網域前綴（/bsky.app/...），要剝掉才會是原站路徑。
     getPath 只影響路由比對，不會改寫 c.req.url。 */
  return c.redirect(`${Constants.BLUESKY_ROOT}${stripSourcePrefix(url.pathname)}`, 302);
};
