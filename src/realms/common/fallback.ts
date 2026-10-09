import { Context } from 'hono';
import { getBranding } from '../../helpers/branding';
import { originalSourceUrl } from '../../helpers/pathRouting';

/**
 * 各 realm 檔尾 catch-all 的共用 handler。
 *
 * 上游是一律導到 branding 首頁 —— 對 fxtwitter.com 這種「換網域」的用法沒差，但我們的請求
 * 帶著使用者原本要去的網址（`/threads.com/@h/post/X/`），導到首頁等於把目的地丟掉。
 * 2026-10-09 Threads 的結尾斜線就是這樣讓使用者全部落到 www.zinzan.info。
 *
 * 有來源網域前綴 → 送回原平台；沒有（直接打 preview.zinzan.info/）→ 照舊導到 branding。
 */
export const sourceFallbackRedirect = async (c: Context) =>
  c.redirect(originalSourceUrl(c.req.url) ?? getBranding(c).redirect, 302);
