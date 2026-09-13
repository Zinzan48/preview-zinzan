import { Context } from 'hono';
import { Constants } from '../../../constants';
import { Strings } from '../../../strings';
import { resolveThreadsShareCode } from '@fxembed/atmosphere/providers/threads/page-scrape';
import { handleThreadsPost } from './post';

/** 分享 code 與貼文 shortcode 同樣是不分大小寫的英數串，但命名空間不同。 */
const SHARE_CODE = /^[A-Za-z0-9_-]{4,40}$/;

/**
 * Threads 分享鈕產生的短連結：`https://www.threads.com/share/<code>`。
 *
 * 這是使用者實際會貼進 Telegram 的形狀，但 `<code>` **不是**貼文 shortcode
 * （實測 `/post/BAWnHgstpr` 找不到），所以必須先問上游它指向哪一則。
 *
 * 成本比看起來低：正規網址就放在 `og:url`，位於文件 0.2% 處，串流讀到就中止，
 * 實測約 0.4 秒。解析完直接交給既有的貼文 handler，不重複任何邏輯。
 */
export const threadsShareRequest = async (c: Context) => {
  const { code } = c.req.param();
  if (!code || !SHARE_CODE.test(code)) {
    return c.text(Strings.ERROR_UNKNOWN, 404);
  }

  const target = await resolveThreadsShareCode(code);
  if (!target) {
    /* 解析不出來就把人送回 Threads 自己處理 —— 總比停在錯誤頁好。 */
    return c.redirect(`${Constants.THREADS_ROOT}/share/${encodeURIComponent(code)}`, 302);
  }

  /* 換上正規的 handle / shortcode，其餘完全走既有流程。 */
  return handleThreadsPost(c, target.handle, target.shortcode);
};
