# TODO

未來要做的事。已完成的內容看 [`CHANGELOG.md`](./CHANGELOG.md)，
操作與設定看 [`CLAUDE.md`](./CLAUDE.md)。

---

## 新增平台

### Threads

**上游已經有完整的 provider，缺的只是預覽頁路由。**

`packages/atmosphere/src/providers/threads/` 有 18 個檔案（`post.ts`、`profile.ts`、
`conversation.ts`、`account-proxy.ts`、`private-api.ts`…），但它只註冊在 **atmosphere
的 JSON API**（`src/providers/threads/atmosphere-handlers.ts`），**沒有 `src/realms/threads/`**
—— 也就是沒有像 twitter / instagram 那樣會吐 OG meta 的 embed realm。

要做的事：

1. 比照 `src/realms/instagram/`（`router.ts` + `routes/post.ts`）建 `src/realms/threads/`
2. `src/worker.ts` 掛 `app.route('/threads', threads)`
3. `src/helpers/pathRouting.ts` 的白名單加 `threads.com`、`www.threads.com`
   （以及舊網域 `threads.net`，Meta 2026 年前後改過網域）
4. `branding.json` 不用動（`og:site_name` 已改成依 provider 顯示，
   `PROVIDER_SITE_NAMES` 要補一筆 Threads）
5. `TBDOMAINREWRITE` 新增一列（`SOURCEHOST='threads.com'`、`PLATFORM='THREADS'`、
   `PATHMODE=1`），探測樣本比照現有規則挑一則穩定貼文

**注意**：Threads 的帳號代理**重用 Instagram 的憑證池**
（`resolveThreadsAccounts` 就是 `resolveInstagramAccounts`，只換 app 指紋），
所以我們現有的 IG 憑證可以直接用。proxy-only 路由（搜尋、typeahead、trends、
按讚/追蹤名單、Replies/Reposts/Media 分頁）沒憑證會回 `501`，但貼文與個人頁
會退回 logged-out 路徑，不影響預覽。

### Facebook

**上游完全沒有**，`packages/atmosphere/src/providers/` 底下沒有 facebook 目錄。

要做的事比 Threads 大得多：整個 provider（資料取得、解析、型別）都要自己寫。
動工前先評估可行性 —— Facebook 的公開貼文對未登入者的限制比 Instagram 更嚴，
而且 Meta 對這類取用的封鎖很積極（`ddinstagram.com` 與 `fixthreads.net` 的下場
見 `PREVIEW_SERVICE_BRIEF.md` 第 6 節）。

建議先做一次實測再決定：拿幾則公開的 Facebook 貼文，確認未登入狀態下
拿不拿得到 og:image / 影片直連。拿不到就不值得投入。

---

## 維運

- **憑證會過期**，更新流程見 skill [`social-account-credentials`](./.claude/skills/social-account-credentials/SKILL.md)。
  徵兆是安靜退化（NSFW 貼文突然看不到、IG 開始不穩），公開貼文仍正常，
  所以不會有明顯的故障訊號。
- **Worker observability 目前沒開。** `wrangler.toml` 沒有 `[observability]` 區塊，
  所以線上的 `console.log` 查不到。要診斷線上問題（例如憑證有沒有被載入、
  上游回了什麼）需要先開啟它。
- **跟上游同步**：`git fetch upstream && git merge upstream/main` 之後，
  務必複查 `CHANGELOG.md` 列的六個上游缺陷修正還在不在。
  其中 guest token 的 `cf` 選項與 `constants.ts` 的 `filter(Boolean)`
  被蓋回去不會有任何錯誤訊息。

---

## 已知限制（不打算修）

- **LINE 不會內嵌播放影片。** 它的連結預覽只讀 `og:title` / `og:image` /
  `og:description`，不吃 `og:video`。對 LINE 的效益僅止於正確的縮圖卡片。
- **Instagram 的多圖貼文（carousel）只會預覽第一個媒體。**
  Instagram realm 沒有 `/videos/<n>` 這種指定第幾個媒體的路由，
  所以 `og:video` 的 direct-media 短網址只在該影片是第一個媒體時才套用。
