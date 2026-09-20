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

### ~~Facebook~~ — 已完成（2026-09-20）

預覽與影片都可用，見 `CHANGELOG.md`。這裡只留下對下一個平台有參考價值的部分：

- **UA 選擇不能跨平台沿用。** Threads 與 Facebook 同屬 Meta、同樣「只有爬蟲
  拿得到資料」，但最佳 UA 完全相反：Threads 選 bingbot 因為它最快，Facebook 的
  bingbot 最慢（3.07s vs `facebookexternalhit` 的 1.54s）也最肥。而且 Facebook 對
  桌面瀏覽器 UA 是**直接回 400**，不是給空殼頁。每個平台都要自己量一次。
- **不要用 `og:type` 判斷「這則是不是影片」。** Facebook 連粉專首頁的 `og:type`
  都是 `video.other`。要找一個「只有該型態才會出現」的訊號 —— 這次是
  `<head>` 裡的 oEmbed alternate link，而且它順帶把作者 handle 與永久連結一起給了。
- **先量出口 IP 再寫 provider。** `wrangler dev --remote` 會把程式碼跑在 Cloudflare
  基礎設施上，所以出口 IP 就是正式環境的。兩個端點各 20 次、半小時內就能知道
  這件事值不值得做 —— 比寫完整個 provider 才發現線上只有 25% 便宜太多。
- **不要假設「看起來是作者名的欄位」就是作者名。** Facebook 的 oEmbed `title` 屬性
  在無標題的 reel 上是 `<作者> on Reels`，在有標題的影片上卻是「整段內文 | 作者」。
  只看一個樣本會歸納出錯的規則，而錯的規則做出來的卡片是「標題有 239 字元內文」——
  不會報錯。**一個形狀至少要兩個樣本**，而且要挑刻意不一樣的那種。
- **本機全過不代表線上全過，而且差異不是全有全無。** 同一份 bundle 用
  `wrangler dev --remote` 跑在 Cloudflare 邊緣重測，Facebook 有三種形狀過不了：
  粉專首頁與 `fb.watch` 一律被導到登入頁（**七種爬蟲 UA 全試過都一樣**），
  而分享連結是**被密集請求打到暫時限流、閒置十分鐘後自己恢復**。
  這兩者長得一樣但結論完全不同，所以**看到線上失敗要先量「會不會恢復」**，
  不要直接寫成「這個形狀不支援」。對照組也要同時做：同一時間從家用 IP 打一次，
  才分得出是出口 IP 被擋還是上游真的改了。
- **只有一條取數路徑時要重試。** Threads 有三條 fallback 所以可以不重試；
  單一路徑的 provider 一次暫時性網路錯誤就是一張壞卡片，**而 Telegram 會把它
  快取很久**。注意 `withTimeout` 的 retries 只認 `AbortError`，擋不住網路層錯誤。

---

## 維運

- **憑證會過期**，更新流程見 skill [`social-account-credentials`](./.claude/skills/social-account-credentials/SKILL.md)。
  徵兆是安靜退化（NSFW 貼文突然看不到、IG 開始不穩），公開貼文仍正常，
  所以不會有明顯的故障訊號。
- **憑證失效的判定方式**（一分鐘、不用改程式）：帶著 `credentials.json` 的 cookie 打
  `https://www.instagram.com/api/v1/web/accounts/edit/web_form_data/`。
  回 JSON＝session 還活著；回 HTML 且含 `class="... not-logged-in"`＝已失效。
  比看 `current_user`（失效與被風控都回同一句 `status: fail`）明確得多。
- **Threads 線上目前 0%，兩條路同時斷**（2026-09-13 實測 9/9 失敗）。
  診斷已經到位（`CHANGELOG.md` 有完整 log），剩下的是一個**營運動作**：

  1. 私有 API：IG session 已失效 → **重新擷取憑證**（skill `social-account-credentials`）。
  2. logged-out GraphQL：Meta 對 Cloudflare 出口 IP 限流，回 401
     `Please wait a few minutes before you try again`＋`require_login: true`。
     這條**沒有辦法從我們這側解決**，本機走家用 IP 不會碰到。

  也就是說 Threads 的可用性完全押在憑證上。憑證補好後重跑一次 9 次驗收再決定。
  **在那之前 Threads 不能寫進 `TBDOMAINREWRITE`**：探測會一直紅，或時通時斷讓規則震盪。

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
