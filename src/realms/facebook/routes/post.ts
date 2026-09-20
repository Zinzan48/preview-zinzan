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
      /* 解析不出東西時**不要**吐「貼文不存在」的錯誤卡，連爬蟲也一樣 ——
         那比沒有這個服務更糟：我們等於主動宣稱貼文不存在，而實際上只是 Facebook
         對這個形狀不給資料（實測 `/photo?fbid=<id>` 回 200 但零個 og:*）。
         照這個 fork 的原則退回原站，讓爬蟲去拿 Facebook 自己給的東西。

         健康探測也因此更明確：服務壞掉時探測會看到跨 host 轉址而判失敗，
         而不是收到一個 200、含 branding og:title 的假成功頁。 */
      if (statusResponse.headers.get(Constants.EMBED_ERROR_HEADER)) {
        console.log('No previewable media, falling back to the origin', facebookUrl);
        return c.redirect(facebookUrl, 302);
      }
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
