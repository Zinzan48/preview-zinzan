import { Context } from 'hono';
import { handleStatus } from '../../../embed/status';
import { DataProvider } from '../../../enum';
import { Constants } from '../../../constants';
import { Experiment, experimentCheck } from '../../../experiments';
import { Strings } from '../../../strings';
import { InputFlags } from '../../../types/types';
import { normalizeThreadsPostId } from '@fxembed/atmosphere/providers/threads/shortcode';

/**
 * Threads 貼文的固定連結是 /@handle/post/SHORTCODE。
 * 資料取得完全沿用上游既有的 Threads provider（packages/atmosphere/src/providers/threads/），
 * 這一層只負責 UA 分流與組出原站網址 —— 跟 instagram realm 是同一個形狀。
 */
export const threadsPostRequest = async (c: Context) => {
  const { handle, id } = c.req.param();
  return handleThreadsPost(c, handle, id);
};

/**
 * 參數是用傳的而不是從 `c.req.param()` 讀 —— `/share/<code>` 那條路由會先把分享 code
 * 解析成正規的 handle / shortcode，再共用這一段，不必為它複製一份 handler。
 */
export const handleThreadsPost = async (
  c: Context,
  rawHandle: string | undefined,
  id: string | undefined
) => {
  console.log('threads post request!!!');
  /* 路由把 @ 一起收進 :handle，這裡剝掉 */
  const handle = (rawHandle ?? '').replace(/^@/, '') || undefined;
  /* 剝掉 direct-media 副檔名（/post/CODE.mp4），要在正規化之前做 */
  const rawId = (id ?? '').replace(/\.(mp4|png|jpe?g|gifv?)$/i, '');
  const shortcode = normalizeThreadsPostId(rawId);
  if (!shortcode) {
    return c.text(Strings.ERROR_UNKNOWN, 404);
  }

  const userAgent = c.req.header('User-Agent') || '';
  const url = new URL(c.req.url);
  const flags: InputFlags = {};

  const isBotUA = userAgent.match(Constants.BOT_UA_REGEX) !== null || flags?.archive;

  if (url.pathname.match(/\/post\/[\w-]+\.(mp4|png|jpe?g|gifv?)/g)) {
    console.log('Direct media request by extension');
    flags.direct = true;
  } else if (Constants.DIRECT_MEDIA_DOMAINS.includes(url.hostname)) {
    flags.direct = true;
  } else if (Constants.TEXT_ONLY_DOMAINS.includes(url.hostname)) {
    flags.textOnly = true;
  } else if (Constants.INSTANT_VIEW_DOMAINS.includes(url.hostname)) {
    flags.forceInstantView = true;
  } else if (
    experimentCheck(Experiment.IV_FORCE_THREAD_UNROLL, userAgent.includes('TelegramBot'))
  ) {
    flags.instantViewUnrollThreads = true;
  } else if (Constants.GALLERY_DOMAINS.includes(url.hostname)) {
    flags.gallery = true;
  } else if (Constants.FORCE_MOSAIC_DOMAINS.includes(url.hostname)) {
    flags.forceMosaic = true;
  } else if (Constants.OLD_EMBED_DOMAINS.includes(url.hostname)) {
    flags.noActivity = true;
  }

  /* 有 handle 就用原本的形狀，沒有（例如 /post/CODE 這種簡短連結）就退到
     不含 handle 的固定連結 —— Threads 會自己補上正確的作者。 */
  const threadsUrl = handle
    ? `${Constants.THREADS_ROOT}/@${handle}/post/${shortcode}`
    : `${Constants.THREADS_ROOT}/post/${shortcode}`;

  if (isBotUA || flags.direct || flags.api) {
    const statusResponse = await handleStatus(
      c,
      shortcode,
      handle ?? null,
      undefined,
      userAgent,
      flags,
      undefined,
      DataProvider.Threads
    );

    if (statusResponse) {
      /* 要了 direct media 但貼文根本沒有媒體時，真人就直接送回原站；
         爬蟲照樣拿到一般的嵌入資訊。 */
      if (!isBotUA && !flags.api && !flags.direct) {
        return c.redirect(threadsUrl, 302);
      }
      c.status(200);
      return statusResponse;
    }
    return c.text(Strings.ERROR_UNKNOWN, 500);
  }

  console.log('Matched human UA', userAgent);
  return c.redirect(threadsUrl, 302);
};
