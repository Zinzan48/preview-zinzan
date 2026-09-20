import { Context } from 'hono';
import { handleStatus } from '../../../embed/status';
import { DataProvider } from '../../../enum';
import { Constants } from '../../../constants';
import { Strings } from '../../../strings';
import { InputFlags } from '../../../types/types';
import { sourceHostFromPath, stripSourcePrefix } from '../../../helpers/pathRouting';
import { facebookUpstreamUrl } from '@fxembed/atmosphere/providers/facebook/source-url';

/**
 * direct-media 短網址的副檔名。og:video 放的是
 * `https://preview.zinzan.info/www.facebook.com/reel/<id>.mp4`，
 * 客戶端真的來抓時才在這裡剝掉副檔名、即時解析並 302 到當下有效的 CDN 網址。
 */
const DIRECT_MEDIA_EXTENSION = /\.(mp4|png|jpe?g|gifv?)$/i;

/**
 * Facebook 的預覽入口。
 *
 * 跟其他 realm 不一樣的地方：**這是一條 catch-all**，不是幾條具名路由。
 * Facebook 的公開內容有太多形狀（`/reel/<id>`、`/watch/?v=<id>`、
 * `/<page>/videos/<id>`、`/share/r|v|p/<code>`、`/<page>/posts/<id>`、粉專首頁…），
 * 而取數方式對每一種都一樣：讀那一頁的 `<head>`。與其維護一份會漏的清單，
 * 不如全部收下來，真的解析不出媒體時再 302 回原站。
 */
export const facebookPostRequest = async (c: Context) => {
  const url = new URL(c.req.url);
  /* getPath 只影響路由比對，c.req.url 仍是使用者貼的那一個 —— 所以來源網域前綴
     還在，要在這裡自己剝，並且順便問出是哪個 host（fb.watch 要照原 host 抓）。 */
  const sourceHost = sourceHostFromPath(url.pathname) ?? 'www.facebook.com';
  const rawPath = stripSourcePrefix(url.pathname);
  const path = rawPath.replace(DIRECT_MEDIA_EXTENSION, '');

  if (!path || path === '/') {
    return c.text(Strings.ERROR_UNKNOWN, 404);
  }

  const userAgent = c.req.header('User-Agent') || '';
  const flags: InputFlags = {};

  const isBotUA = userAgent.match(Constants.BOT_UA_REGEX) !== null || flags?.archive;

  if (DIRECT_MEDIA_EXTENSION.test(rawPath)) {
    console.log('Direct media request by extension');
    flags.direct = true;
  } else if (Constants.DIRECT_MEDIA_DOMAINS.includes(url.hostname)) {
    flags.direct = true;
  } else if (Constants.TEXT_ONLY_DOMAINS.includes(url.hostname)) {
    flags.textOnly = true;
  } else if (Constants.INSTANT_VIEW_DOMAINS.includes(url.hostname)) {
    flags.forceInstantView = true;
  } else if (Constants.GALLERY_DOMAINS.includes(url.hostname)) {
    flags.gallery = true;
  } else if (Constants.FORCE_MOSAIC_DOMAINS.includes(url.hostname)) {
    flags.forceMosaic = true;
  } else if (Constants.OLD_EMBED_DOMAINS.includes(url.hostname)) {
    flags.noActivity = true;
  }

  const facebookUrl = facebookUpstreamUrl(sourceHost, path, url.search);

  if (isBotUA || flags.direct || flags.api) {
    const statusResponse = await handleStatus(
      c,
      path,
      null,
      undefined,
      userAgent,
      flags,
      undefined,
      DataProvider.Facebook
    );

    if (statusResponse) {
      /* 要了 direct media 但這一則根本沒有媒體時，真人就直接送回原站；
         爬蟲照樣拿到一般的嵌入資訊。 */
      if (!isBotUA && !flags.api && !flags.direct) {
        return c.redirect(facebookUrl, 302);
      }
      c.status(200);
      return statusResponse;
    }
    return c.text(Strings.ERROR_UNKNOWN, 500);
  }

  console.log('Matched human UA', userAgent);
  return c.redirect(facebookUrl, 302);
};
