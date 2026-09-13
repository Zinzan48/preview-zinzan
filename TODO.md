# TODO

未來要做的事。已完成的內容看 [`CHANGELOG.md`](./CHANGELOG.md)，
操作與設定看 [`CLAUDE.md`](./CLAUDE.md)。

---

## 新增平台

### ~~Threads~~ — 已完成（2026-09-13）

預覽與影片都可用，見 `CHANGELOG.md`。這裡只留下對 Facebook 有參考價值的部分：

- **`media_type` 不只有 2 和 8。** 從 Instagram 分享進 Threads 的內容是 **19**，
  它的 `video_versions` 與 `carousel_media` 在貼文頂層都是 `null`，
  媒體實際掛在 `text_post_app_info.linked_inline_media`。
  Meta 系的平台很可能都有類似的「分享進來的內容」包裝層，
  加新平台時**不要假設媒體一定在頂層**。
- **先確認「資料有沒有回來」再懷疑「取不到」。** 這次一開始誤判成需要帳號或端點過期，
  實際上 logged-out 查詢一直都回著完整媒體（155 KB、23 筆 `video_versions`），
  只是解析沒抓。在 GraphQL 回應處印出結構特徵（bytes / hasErrors / 關鍵欄位出現次數）
  就能一分鐘分辨這兩者。
- **用瀏覽器驗證「資料是否存在」。** playwright 渲染後的 DOM 有 198 個 `mp4`、
  64 個 `video_versions`，而 curl 抓的靜態 HTML 是 0 —— 這個對比直接證明了
  「資料拿得到」，省下往逆向 token 流程鑽的時間。

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
