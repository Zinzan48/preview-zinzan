# CHANGELOG

這個 fork 與上游 [`FxEmbed/FxEmbed`](https://github.com/FxEmbed/FxEmbed) 的**全部**差異。

- **Fork 基準**：upstream `main` @ `5b5b6207`（2026-09-13）
- **範圍**：60 個檔案、+4952 / −112 行
- 操作面的說明（設定雷、驗收指令、部署參數）在 [`CLAUDE.md`](./CLAUDE.md)；
  這裡只記錄「改了什麼、為什麼、不改會怎樣」。

---

## [2026-09-20] Facebook 支援

### Added

**Facebook embed realm + provider**（`src/realms/facebook/`、
`packages/atmosphere/src/providers/facebook/`）。上游完全沒有 Facebook provider，
整套是自己寫的；但取數方式比 `TODO.md` 原本預期的簡單得多。

`TODO.md` 要求動工前先做可行性實測，理由是「Facebook 的公開貼文對未登入者的限制
比 Instagram 更嚴」。就預覽需要的東西而言**並沒有**：帶爬蟲 UA、未登入，
`<head>` 裡就有真實的 `og:title`、`og:image` 與正規網址。

#### UA 決定一切，而且結論與 Threads 相反

同一則 reel、家用 IP：

| UA                        | HTTP    | 回應大小                   | 耗時  |
| ------------------------- | ------- | -------------------------- | ----- |
| `facebookexternalhit/1.1` | 200     | 451 KB                     | 1.54s |
| `TelegramBot`             | 200     | 442 KB                     | 1.53s |
| `Googlebot/2.1`           | 200     | 878 KB                     | 1.71s |
| `bingbot/2.0`             | 200     | 894 KB                     | 3.07s |
| Chrome 131（桌面瀏覽器）  | **400** | —                          | —     |
| 不帶 UA                   | 200     | 50 KB（**沒有 og:image**） | —     |

Threads 選 bingbot 是因為在那邊它最快；Facebook 剛好相反，它最慢也最肥。
而且 Threads 的瀏覽器 UA 只是拿到空殼頁，Facebook 是**直接回 400** ——
爬蟲那條路不是最佳化，是唯一走得通的路。

> **UA 選擇不能跨平台沿用。** 兩個平台同屬 Meta、同樣「只有爬蟲拿得到資料」，
> 但最佳 UA 完全不同。加新平台時要自己量。

#### 出口 IP 先驗過才動工

Threads 的教訓是 logged-out GraphQL 從 Cloudflare 出口只有 20–25% 成功。
所以寫任何 provider 之前，先用 `wrangler dev --remote`（程式碼實際跑在 Cloudflare
基礎設施上）對兩個端點各打 20 次：

| 端點                | 成功率    | 耗時中位數 | 最大   | 平均大小 |
| ------------------- | --------- | ---------- | ------ | -------- |
| 貼文頁              | **20/20** | 929ms      | 2423ms | 863 KB   |
| `plugins/video.php` | **20/20** | 154ms      | 234ms  | 191 KB   |

colo 是 SJC，沒有出現任何登入牆。

#### 取數要兩段，因為資料就分在兩個地方

**貼文頁裡一個影片直連都沒有** —— `mp4`、`video_versions`、`playable_url`、
`dash_manifest` 在 451 KB 的 HTML 裡全部是 **0 次**。影片在公開的
`plugins/video.php` 嵌入端點，未登入就給 `hd_src`（8.98 MB）與 `sd_src`（2.08 MB），
實測 `206 Partial Content` + `video/mp4` + `Accept-Ranges: bytes`。

**它的 `href` 必須是正規永久連結。** 餵分享短連結（`/share/r/<code>`）會回 **200
但 `hd_src` 出現 0 次** —— 又一個不報錯的靜默失敗。永久連結從貼文頁 `<head>` 的
oEmbed alternate link 拿：

```html
<link
  rel="alternate"
  href="https://graph.facebook.com/v26.0/oembed_video?url=…%2FMASTER.FOOD.DIARY%2Fvideos%2F4484820285134652%2F"
  title="算命的說我很愛吃 on Reels"
/>
```

它落在文件 2% 處，一次就同時給了**永久連結、作者 handle、作者顯示名稱**。

#### `og:type` 不能拿來判斷「是不是影片」

`facebook.com/facebook`（粉專首頁，根本不是貼文）的 `og:type` 也是 `video.other`。
拿它當條件會對每個非影片網址都白打一次 embed 端點。**正確的訊號是上面那個
oEmbed link** —— 它只在真的有影片時出現。

#### realm 是 catch-all，不是具名路由

`/reel/<id>`、`/watch/?v=<id>`、`/<page>/videos/<id>`、`/share/r|v|p/<code>`、
`/<page>/posts/<id>`、粉專首頁 —— 取數方式全都一樣（讀那一頁的 `<head>`）。
維護一份具名路由清單只會漏，而漏掉的那一種會安靜地 302 掉。解析不出媒體時
才退回原站。

#### 同一個坑的第三次：`og:video` 長度

Facebook 的 CDN 網址與 Instagram / Threads 同形狀（**702 字元、13 個簽章參數**），
所以 `DataProvider.Facebook` 在**同一個 commit** 就加進
`src/helpers/directMedia.ts` 的 `SHORT_DIRECT_MEDIA_PROVIDERS`，不留到之後。
結果是 **70 字元**。

### Changed

**與 Threads provider 的兩個刻意差異：**

1. **貼文頁在丟例外時重試一次。** Threads 有三條 fallback（私有 API → GraphQL →
   頁面），Facebook 只有一條，一次暫時性網路錯誤就直接變成「貼文不存在」的卡片，
   **而 Telegram 會把預覽結果快取很久**。本機實測確實遇過：worker 起來後第一個
   請求回 `Network connection lost.`，之後同一個網址 3/3 正常。
   注意 `withTimeout` 自己的 retries 幫不上忙，它只認 `AbortError`。
2. **影片大小用 HEAD 問，不用估的。** Facebook 沒有任何時長或大小欄位
   （progressive 串流的 `dash_manifest` 是 `null`），Instagram 那套「用時長乘位元率估」
   沒有輸入可用。HEAD 回來的 `Content-Length` 同時也讓我們能用網址查詢字串裡的
   `bitrate` 反推長度 —— hd 與 sd 各自算出來都是 23.3 秒，互相印證。

**不做 atmosphere JSON API、不做 provider 專屬 Zod schema。** 這個 fork 只用
embed realm，而 `APIStatus.provider` 本來就是通用的 `DataProvider`。Facebook 能
取得的欄位也遠少於 Threads（沒有按讚數、留言數、內文），JSON API 的價值不成比例。
取不到的欄位一律留 0 / epoch，不硬湊看起來合理的值。

### Fixed — 第二輪範本揭穿的三個錯誤假設

第一輪只有 reel 與影片分享連結兩種樣本，補上 `fb.watch`、一般貼文分享、相片永久
連結之後，三個假設各自被打破，而且**三個都是安靜失敗**。

**① `fb.watch` 從一開始就不可能會動。** 它的短連結是**跨來源**轉到
`www.facebook.com/watch/?v=<id>`，而頁面抓取原本用 `fetchSameOriginHttps` ——
那支依設計只跟同源，會停在 302。結果是每一個 fb.watch 連結都回「貼文不存在」，
而且沒有任何線索指向轉址。那個同源限制的用意是不要把 session cookie 帶到別的 host，
這個 provider 一個 cookie 都不帶，所以改成跟隨轉址但**只跟到 Facebook 自己的 host**
（比直接用 `redirect: 'follow'` 窄）。

> ⚠ 這個修正讓 `fb.watch` 在**本機**可用，但線上仍然不行 —— Meta 對 Cloudflare 出口
> 一律把 `fb.watch` 導到登入頁。詳見下面的「線上驗收」。

**② oEmbed 的 `title` 屬性不是作者名。** 第一個樣本看起來像
（`算命的說我很愛吃 on Reels`），但有自己標題的影片會把整段內文放進去、作者擺最後：
`<整段內文> | 阿翰po影片`。整個拿來用會做出一張標題有 239 字元貼文內文的卡片。

Facebook 一律把作者放在**最後一段 `|` 之後**，oEmbed title 與 og:title 都一樣，
所以兩者現在走同一套擷取 —— 內文自己含 `|` 也不會解錯。一般貼文的 og:title
（`野狼祭 Beastoria`）本身就是作者名，而它的 `<title>` 是「作者 - 整篇內文」，
所以 `<title>` 已經完全不再是作者名的來源。

**③ 有些形狀根本沒有 Open Graph。** `/photo?fbid=<id>` 回 200 但 `og:*` 出現 0 次
（`/photo/`、`/photo.php`、`m.facebook.com` 三種寫法都一樣，同一支測法對 reel 是 7 次）。
provider 正確地判斷「沒東西可預覽」，但 realm 接著吐了「貼文不存在」的錯誤卡 ——
**那比不跑這個服務更糟**：它主動宣稱一件不成立的事，而原本使用者只會看到一個純連結。
現在爬蟲也一起退回原站。

這順帶讓健康探測更明確：服務壞掉時探測看到的是跨 host 轉址而判失敗，
而不是收到一個 200、含 branding `og:title` 的假成功頁。

**另外兩個順手補的保險：**

- canonical 可能把整個標題塞進路徑 —— fb.watch 那則是 **211 字元**，
  direct-media 短網址會變 234。不含 slug 的 `/<handle>/videos/<id>/` 實測同樣回 200、
  同樣帶 oEmbed，所以影片改用兩者中較短的那個（**85 字元**）。234 離 Telegram 的
  失效點（1150）還很遠，但這條路沒有任何訊號可以偵測，能短就短。
- `buildShortDirectMediaUrl` 現在拒絕帶查詢字串的來源網址。它只保留 pathname，
  `/watch/?v=<id>` 這種 canonical 會安靜地解析成 Watch 首頁 —— 顯示錯的影片，
  正是那個檔案開頭說「比沒有播放器更糟」的那一類。目前沒有 provider 會產生這種
  canonical，這是保險不是修正。

### 線上驗收：本機全過，線上有三種形狀過不了

把同一份 bundle 用 `wrangler dev --remote` 跑在 Cloudflare 邊緣（colo SJC）重測，
結果**與本機不同**。完整表格在 [`CLAUDE.md`](./CLAUDE.md) §5.1，這裡記為什麼。

| 形狀                                | 本機 | 線上              |
| ----------------------------------- | ---- | ----------------- |
| `/reel/<id>`、`/<page>/videos/<id>` | ✅   | ✅ 穩定           |
| `/share/<code>`、`/share/r/<code>`  | ✅   | ✅ 但會被暫時限流 |
| 粉專首頁 `/<handle>/`               | ✅   | ❌ 一律登入牆     |
| `fb.watch/<code>`                   | ✅   | ❌ 一律登入牆     |

**擋的是出口 IP 的信譽，不是請求本身。** 同一批網址在同一時間從家用 IP 全部正常
（粉專首頁 200、`fb.watch` 302 到影片），從 Cloudflare 出口則被導到
`/login/?next=…`。這與 Threads 的 logged-out GraphQL 是同一類問題，
**沒有辦法從我們這側解決**。

`fb.watch` 另外把七種 UA 都從邊緣試過 —— `facebookexternalhit`、Googlebot、bingbot、
Twitterbot、Discordbot、TelegramBot、不帶 UA。**全部被擋。** 前面那條「UA 選擇要每個
平台自己量」在這裡救不了，因為沒有 UA 可換。

**限流是會恢復的，這點差別很重要。** 分享連結一開始 5/5，被連打幾十次之後變成
0/3 登入牆，**閒置 10 分鐘後回到 2/2**；同一段時間 reel 完全沒受影響。也就是說
「分享連結線上不能用」是錯的結論 —— 正確的是「密集請求會被暫時擋」。
含意：健康探測不要打太密，而且看到偶發轉紅時要先排除是自己打出來的。

> 數字來自 `wrangler dev --remote`，它固定落在 colo SJC。正式部署的 colo 取決於
> 爬蟲從哪裡來，所以是代表性參考值而不是保證值。

### Fixed — 不要跟著 Facebook 進它自己的登入頁

`www.facebook.com` 在轉址允許清單裡，所以上面那些登入牆原本會被**跟進去解析**。
那一頁目前沒有任何 `og:*`（所以現在只是乾淨地退回原站），但它**有 `canonical`**
（`https://zh-tw.facebook.com/login`）—— 哪天它多一個 `og:image`，我們就會吐出一張
標題 `login (@login)`、圖是 Facebook 商標的卡片，而且完全不會報錯。

所以登入牆現在是一個**有名字的失敗**（log 寫 `[facebook] login wall`），不是一個
要去解析的頁面。命名有意義：「被要求登入」在我們這側無解，「頁面結構變了」要改解析，
在這之前兩者的 log 長得一模一樣。順帶把 `login` / `checkpoint` / `videos` /
`unsupportedbrowser` 加進保留路徑，作者 handle 不可能被解析成這些字。

### 已知限制

- **粉專首頁與 `fb.watch` 線上不可用**（見上）。兩者都留在來源網域白名單裡 ——
  拿掉 `fb.watch` 反而更糟：會落到 twitter realm 的 fallback 而導去 `zinzan.info` 首頁，
  留著至少是乾淨地 302 回原連結。
- **`/photo?fbid=<id>` 兩邊都拿不到**，但原因不同：家用 IP 是 200 卻零個 `og:*`，
  線上是登入牆。同一張圖用貼文永久連結就正常。
- **`m.facebook.com` / `web.facebook.com` / `fb.com` 未實測。** 程式上正規化成
  `www.facebook.com`（同一個 id 命名空間），但沒有樣本驗過。
- **私人／受限貼文**未登入拿不到，退回 302 原站。
- **沒有按讚數、留言數、發布時間。** Facebook 的公開 `<head>` 不給，
  這些欄位一律留 0 / epoch，不硬湊。

---

## [2026-09-14] Threads 影片在 Telegram 不播

### Fixed

**`og:video` 長 1154 字元，Telegram 只畫縮圖、不產生播放器。**

這是 Instagram 那個坑的第二次發作：Meta 系的 CDN 網址帶 13 個簽章參數，光是本身就
1000 字元以上，包進 `/2/go?url=…` 之後就爆掉。修法早就存在（`src/render/video.ts`
的 direct-media 短網址），只是當初只套用在 Instagram 上，Threads 一接上就落回
`/2/go` 那條路。

Threads realm 的 direct-media 路徑**本來就已經可用**（`routes/post.ts` 會剝掉 `.mp4`
副檔名並設 `flags.direct`），所以這次只需要讓 `renderVideo` 也對 Threads 產生短網址：
**1154 → 73 字元**。

實測對照：

| 來源           | og:video 長度  | Telegram   |
| -------------- | -------------- | ---------- |
| X              | 約 130、無簽章 | 正常播放   |
| Instagram reel | 1162 → 66      | 修正後正常 |
| Threads 影片   | 1154 → 73      | 修正後正常 |

### Changed

**網址組裝抽成 `src/helpers/directMedia.ts` 並補上測試。**
同一個問題踩過三次，而它的症狀是**安靜失敗** —— meta 全都在、頁面看起來正常，
只是沒有播放器。所以連「網址長度」本身都要斷言，不能只驗格式。

測試同時釘住兩個容易被改掉的前提：結尾斜線要剝掉（否則變成 `…/CODE/.mp4`），
以及**只有第一個媒體才適用** —— 這兩個 realm 都沒有 `/videos/<n>` 路由，
carousel 的第二支影片會被解析成第一支，放出去是「預覽顯示了別支影片」，比沒有播放器更糟。

---

## [2026-09-13] Threads 改走「爬蟲 UA 讀頁面」

### Added

**`providers/threads/page-scrape.ts`** —— 不再用 logged-out GraphQL 取 Threads 貼文，
改成用爬蟲 UA 讀貼文頁、取出頁面內嵌的查詢結果。

起因是量到的事實：同一支 GraphQL 查詢，從 Cloudflare 出口 IP 打 **20–25% 成功**，
從家用 IP **100% 成功**。瓶頸是出口 IP 的信譽。但 **Meta 擋的只有 API** ——
用爬蟲 UA 讀同一則貼文的頁面，從 Cloudflare 實測 **20/20 成功**，
`require_login` 一次都沒出現。

關鍵在於頁面裡內嵌的 `adp_BarcelonaPostPageDirectQueryRelayPreloader`
**就是同一支 Relay 查詢的結果**，形狀與 GraphQL 回應完全相同 ——
所以 processor 那一整套（含 `linked_inline_media` fallback）原封不動沿用，
只換掉傳輸層。`post.ts` 把 edges → SocialThread 那段抽成 `threadFromPostPageJson`，
兩條路徑共用。

三個實測決定的設計：

| 決定                                | 依據                                                                                                 |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **串流到資料區塊收完就 `cancel()`** | 資料落在文件 50–92% 處。讀完整份 body 線上要 3.7–5.2 秒，中止後 **1.83 秒**（中位數，最大 2.49）     |
| **用 bingbot，不用 Googlebot**      | 資料同樣完整但回覆少得多（21 vs 45 edges），線上 1.83s vs 2.57s。只需要焦點貼文，回覆是純成本        |
| **一定要爬蟲 UA**                   | 帶瀏覽器 UA 拿到的是空殼頁（270 KB、0 個 `thread_items`），內容全靠前端 JS 補，Worker 裡沒有 JS 可跑 |

掃描維持 O(n)（每個 chunk 只從上次位置往後找）—— 緩衝區會長到 700 KB 以上，
每個 chunk 重掃一次就會吃掉免費方案 10 ms 的 CPU 額度。實際的 `JSON.parse` 只花 **0–1 ms**。

GraphQL 保留為最後手段：它現在很少成功，但萬一 Meta 改掉頁面的內嵌結構，那是唯一還活著的路。

### Fixed

**逾時被誤報成「頁面沒有資料區塊」。** 串流讀取原本把所有例外都吞掉當作「沒找到」，
但逾時會 abort body 串流讓 `read()` 拋出 —— 於是「來不及讀完」會被記成
「Meta 改了頁面結構」。兩者的處置完全不同（前者調預算，後者要重寫解析），
所以改成只有串流**正常結束**卻沒找到才算「沒有區塊」，其餘往上拋並記錄原因。

> 本機開發時必然會踩到這個：家用連線讀完 @zuck 那一頁要 4–4.7 秒，
> 逼近 5 秒的預算，而線上只要 1.8 秒。

### Added — `/share/<code>` 分享短連結

Threads 分享鈕產生的就是這個形狀，也是使用者實際會貼進 Telegram 的連結，
但 `<code>` **不是**貼文 shortcode（實測 `/post/BAWnHgstpr` 找不到），
原本會落到 catch-all 直接 302 回首頁。

解析成本比預期低得多：正規網址就放在 `og:url`，位於文件 **0.2%** 處，
串流讀到就中止，實測約 0.4 秒 —— 不需要為它把整頁近 800 KB 拉下來。
拿到 handle 與 shortcode 後直接走既有流程（`threadsPostRequest` 拆出
`handleThreadsPost`，參數改用傳的，不必為這條路由複製一份 handler）。

真人會被 302 到**正規網址**而不是原本的 share 網址。

> `og:url` 裡的 `@` 是 HTML entity，而且實際用的是 `&#064;` 而不是 `&#64;`。
> 直接找 `'@'` 會讓整條路悄悄失效，所以兩種寫法都要吃 —— 有測試釘住。

---

## [2026-09-13] 失敗頁不再進快取

### Fixed

**上游對成功與失敗一視同仁地 `cache.put`。** `src/caches.ts` 在 `next()` 之後
無條件把回應寫進 Cache API，所以上游的一次抖動（Meta 對 Cloudflare 出口 IP 的限流、
rate limit、逾時）會被**凍在快取裡持續服務**，即使下一秒上游就恢復了。

分不出成功與失敗，是因為兩者都回 **HTTP 200** —— 那是刻意的，爬蟲要 200 才會渲染
`og:description` 裡的錯誤訊息。所以改成由 `returnError`（`src/embed/status.ts`，
17 個失敗路徑的唯一進入點）打上 `x-embed-error` 標頭，快取層據此跳過寫入。

對**機率性失敗**的上游特別有價值：成功的那次留在快取服務所有爬蟲，失敗的那次下次重試。
Threads 的 logged-out 查詢實測只有 20–25% 會通（見上一節），這個修正等於
「把運氣好的那次留住、運氣壞的那次丟掉」。X / Bluesky / Instagram 的偶發失敗同樣受益。

> 實測數據（2026-09-13）：Threads 匿名路徑連打 9 次 **0/9**；改成每 2 分鐘 1 次
> **1/5**。間隔拉長沒有明顯改善 —— 限流是機率性的，不是「等幾分鐘就放行」。

---

## [2026-09-13] Threads 線上時好時壞的真正原因

### Fixed

**私有 API 的 404 會把「憑證失效」誤報成「貼文不存在」。**
`i.instagram.com` 對未認證的 `/api/v1/…` 不回 401，而是 302 到**同源**的
`/accounts/login/?next=…`；`fetchSameOriginHttps` 依設計會跟著同源 HTTPS 跳轉走，
最後拿到的是登入頁的 HTML，而那頁的狀態碼正好是 **404**。
`providers/threads/post.ts` 原本對 `proxied.status === 404` 直接 `return notFound()`，
於是 session 一失效，每一則 Threads 貼文都變成「找不到貼文」——
儘管同一則貼文的 logged-out 查詢完全正常。

> 這個短路連上游自己的 doc comment 都對不上，那段明寫
> 「_and whenever that call fails — it falls back to the logged-out Relay query_」。

改法兩層：

- `threads/account-proxy.ts` 認出登入頁，還原成 `401` 並輪替帳號，
  不讓它偽裝成任何內容層的狀態碼。
- `threads/post.ts` 移除 404 短路，私有 API 的失敗一律往下走 logged-out 路徑。
  代價是真的被刪掉的貼文多一次上游往返才回 404。

**非 2xx 回應的 body 被丟掉，失敗完全不可診斷。**
`account-proxy.ts` 在 `!response.ok` 時回傳 `text: ''`，所以那行
`body: text.slice(0, 400)` 的 log 永遠是空字串。改成照樣讀出來。

> 線上 log（Workers observability，2026-09-13 13:15–13:40Z）：
> 9 次 `text_feed/{id}/single_thread/` 請求 **9 次全部** 404，
> 本機用同一組憑證直接打也是 302 → 登入頁。

### 修正後的線上驗收：Threads 仍然不通，但原因終於看得見了

部署後同一則貼文跑 9 次（三種前綴各 3 次）**全部失敗**，但 log 從「貼文不存在」
變成兩條互相獨立的真實原因，各 9/9：

| 路徑               | log                                                           | 意義              |
| ------------------ | ------------------------------------------------------------- | ----------------- |
| 私有 API（憑證）   | `[threads] private API redirected to login (session invalid)` | IG session 已過期 |
| logged-out GraphQL | `[threads] graphql non-ok` status **401**                     | 見下              |

logged-out 那條，Meta 回的是：

```json
{
  "message": "Please wait a few minutes before you try again.",
  "require_login": true,
  "igweb_rollout": true,
  "status": "fail"
}
```

**所以「Meta 限流 Cloudflare 出口 IP」這個推論對了一半**：它不適用於私有 API 那條
（那純粹是憑證死了），但確實適用於 logged-out GraphQL —— 這才是先前 25% 成功率的來源，
限流偶爾放行。本機走家用 IP 不會碰到，所以本機一直是 100%。

兩條路同時斷，Threads 才會 0%。**要恢復就得讓私有 API 那條活過來**，也就是重新擷取
IG 憑證；帶著有效 session 的請求不受 logged-out 限流管轄。
判定 session 死活的方法見 skill `social-account-credentials`。

---

## [2026-09-13] Threads 支援

### Added

**Threads embed realm**（`src/realms/threads/`）。上游的 Threads provider 本來就完整，
但只註冊在 atmosphere 的 JSON API 下，沒有會吐 OG meta 的預覽路由。
比照 `src/realms/instagram/` 建 realm，`DataProvider` 加 `Threads`，
`pathRouting` 白名單加 `threads.com` / `www.threads.com` / `threads.net`（Meta 換過網域），
新增 `THREADS_ROOT` 常數。

路由寫成 `/:handle/post/:id` 由 handler 剝掉 `@` —— `/@:handle/post/:id` 實測匹配不到，
會落到 catch-all 回 302。

### Fixed

**從 Instagram 分享進 Threads 的貼文抓不到媒體。**
那種貼文的 `media_type` 是 **19**，頂層的 `video_versions` 與 `carousel_media` 都是 `null`，
所以 `mediaContainerFromThreadsPost` 依 media_type / carousel 判斷的分支一個都不會命中。
媒體實際掛在 `text_post_app_info.linked_inline_media`，其內部結構與一般貼文相同，
所以頂層抓不到時對它重跑同一套邏輯即可。順序是貼文自己的媒體優先。

> 追查過程值得記住：logged-out GraphQL **一直都回著完整媒體**
> （155 KB、`video_versions` 23 筆、6 個 `.mp4`），問題自始至終是解析。
> 中途曾誤判為「需要 Threads 帳號」與「端點過期」，兩者都不是。

**影片縮圖缺失時 `og:image` 被寫成字串 `"null"`。**
縮圖原本只看 `display_url`，而 `linked_inline_media` 沒有那個欄位。
改成退到 `image_versions2`，並在 `src/render/video.ts` 補上防呆 ——
thumbnail 缺失時不輸出 `og:image`。**LINE 的連結預覽只讀 `og:image`，寫錯等於整張圖消失。**

**Instagram 憑證在預覽路徑上完全沒被使用。**
`handleStatus` 呼叫 `constructInstagramPost` / `constructThreadsPost` 時沒有傳
`credentialKey`，而那是帳號代理的唯一入口 —— `hasInstagramAccountProxy()` 在 ctx
沒帶它時直接回 `false`，`resolveInstagramAccounts()` 就回空陣列。
Twitter 沒這問題，它是靠 `twitterBuildHostFromContext(c)` 帶進去的。

**`threadsGraphql` 失敗時印出回應 body。** 原本只印 status，查不出失敗原因。

---

## [2026-09-13] 初版自架

### Added — 這個 fork 專屬（不打算回饋上游）

#### 單一網域 + 路徑第一段即來源網域

上游是「一個平台一個網域」，靠 Host header 分辨 realm。我們只有
`preview.zinzan.info` 一個網域，因為短網址服務是在 302 導轉當下把連結改寫成
`https://preview.zinzan.info/<來源網域>/<原路徑>`。

| 檔案                                                                                 | 內容                                                                                                                 |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `src/helpers/pathRouting.ts`（新）                                                   | 來源網域→realm 對照表、`matchSourcePrefix()`、`stripSourcePrefix()`、`SELF_REDIRECT_PATHS`。這套規則的單一事實來源。 |
| `src/worker.ts`                                                                      | `getPath` 先用路徑第一段判 realm，未命中才回落上游的 Host 判定；另放行 `/2/go`、`/2/hit` 到 api realm。              |
| `src/realms/twitter/routes/redirects.ts`<br>`src/realms/bluesky/routes/redirects.ts` | 所有拿 `url.pathname` 重建原站網址的地方改走 `stripSourcePrefix()`。                                                 |

用**白名單**（只認 `x.com`、`twitter.com`、`bsky.app`、`instagram.com`、`tiktok.com` 及其
`www.` 變體）而非黑名單：twitter realm 底下有十多個固定字串開頭的路由
（`/i`、`/dir`、`/dl`、`/status`、`/statuses`、`/article`、`/hashtag`、`/version`、
`/owoembed`、`/robots.txt`、`/favicon.ico`、`/set_base_redirect`、`/api`），
黑名單漏一個就靜默壞掉。

> **為什麼 redirect handler 也要改**：Hono 的 `getPath` 只影響路由比對，**不會改寫
> `c.req.url`**（`Request.url` 依 Fetch 規範唯讀）。不處理的話
> `/bsky.app/profile/bsky.app` 會得到 `Location: https://bsky.app/bsky.app/profile/bsky.app`。

#### `GO_REDIRECT_HOST` 環境變數

`og:video` 與 Telegram Instant View 外部連結的 302 中轉 host（`/2/go`、`/2/hit`）
從 `API_HOST_LIST[0]` 拆出來成為獨立變數。

**為什麼必須拆**：`API_HOST_LIST` 不只決定 realm，還同時決定 `flags.api`
（`src/realms/twitter/routes/status.ts`、`routes/profile.ts`）。主網域一旦放進
`API_HOST_LIST`，每則貼文都會回 **JSON 而不是 OG HTML**，整個預覽服務等於失效。
拆開後 `API_HOST_LIST` 維持留空，服務只需要一個網域。

影響檔案：`src/constants.ts`、`src/types/env.d.ts`、`esbuild.config.mjs`、
`src/render/video.ts`、`src/embed/status.ts`、`src/embed/activity.ts`、
`src/render/instantview.ts`。

`src/helpers/utils.ts` 的 `wrapForeignLinks` 另補上「沒有中轉 host 就回原連結」的防呆，
避免組出 `https://undefined/2/hit?url=…`。

### Fixed — 上游缺陷（**merge upstream 後必須確認還在**）

#### 1. guest token 的 `cf` 選項讓無憑證自架完全取不到 X 資料

`packages/atmosphere/src/providers/twitter/fetch.ts`

現行 Workers runtime 會拋：

```
TypeError: The 'cacheControl' and 'cacheTtl' options on cf are mutually exclusive.
```

`cacheTtl` / `cacheEverything` 依 Cloudflare 官方文件**只適用於 GET / HEAD**，
而 guest token 請求是 **POST** —— 那組設定本來就不會生效，現在還會直接拋例外。
另一個只當 `caches.default` cache key 用的 Request 從來不會被 fetch，`cf` 對它同樣
沒有意義，卻會讓 `cache.match` / `put` 拋同一個錯。兩處都移除；token 的保存期限
本來就是由 put 進去的 Response 上的 `cache-control` 決定的。

**沒有帳號憑證時這是唯一的取得路徑**，所以症狀是每一則 X 貼文都變成
「Sorry, that post doesn't exist」。

#### 2. 被吞掉的例外讓上面那個 bug 完全查不到

`packages/atmosphere/src/providers/twitter/conversation.ts`

`fetchSingleStatus` 在沒有帳號代理時用 `catch (_e) { return null; }`，
把所有失敗都變成「貼文不存在」，沒有任何 log。補上 `console.error`。

#### 3. profile 頁對真人 302 導回自己

`src/realms/twitter/routes/profile.ts`

實測 `https://fxtwitter.com/jack` 帶真人 UA 會回 `302 → https://fxtwitter.com/jack`，
瀏覽器判定為重導迴圈。原因是 human 分支直接 redirect 到 `url`（`new URL(c.req.url)`），
而算好的原站網址只是 bot 分支裡的區域變數。把目標提到分岔之前，兩個分支共用。

#### 4. 空環境變數變成 `['']` 而不是 `[]`

`src/constants.ts`

`(process.env.X ?? '').split(',')` 對空字串回傳**長度 1** 的陣列，
所有 `.length > 0` / `.length === 0` 的 graceful 檢查因此全部失效，程式拿空字串當
hostname。實測（對編譯後的 `handleMosaic`）：

```
[]    -> null（正確停用）
['']  -> {"formats":{"jpeg":"https:///jpeg/123/AAA/BBB", …}}   ← 壞 URL
```

18 個清單補上 `.map(s => s.trim()).filter(Boolean)`（比照同檔已經寫對的
`BLUESKY_API_HOST_LIST`），`API_HOST_ROOT` 改成同樣的 IIFE 形式。
另外 6 處 `!!Constants.XXX_LIST`（對陣列取 `!!` **永遠是 true**）改成 `.length > 0`，
否則 filter 了也沒用 —— `src/render/video.ts`、`src/embed/status.ts`、
`src/embed/activity.ts`、`src/helpers/giftranscode.ts`、`src/render/instantview.ts`。

自架時 `MOSAIC_*` / `GIF_TRANSCODE_*` / `POLYGLOT_*` 必須留空（上游預設值全部指向
FxEmbed 官方的線上服務），所以這個陷阱一定要先修掉。

#### 5. `.gitattributes` 是無效語法

上游寫 `* text=LF`，但 git 只認 `text` / `text=auto`，換行由獨立的 `eol` 屬性指定，
整條屬性等同沒設定。在 `core.autocrlf=true` 的 Windows 上 checkout 會把工作目錄轉成
CRLF，`npm run lint:eslint` 噴出 **13,291 個** `prettier/prettier "Delete ␍"`，
lint 完全沒辦法當驗證用。改成 `* text=auto eol=lf` 後降到 0。
index 內容一直都是 LF（`git ls-files --eol` 可證），所以這個修正不動任何檔案內容。

#### 6. 測試硬編上游 branding

`vitest.config.mts`

4 個測試直接斷言 `branding.example.json` 的值（`FxTwitter`、`FxInstagram`、
`github.com/FxEmbed/FxEmbed`），但 `src/helpers/branding.ts` 是 import
`branding.json` —— 自架者自己的那份。只要換了 branding 測試就變紅。
加 alias 讓測試固定讀 example。

### Changed — 自架設定

| 檔案                      | 內容                                                                                                                                                                                                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wrangler.toml`（進版控） | 移除 `analytics_engine_datasets`；不寫 `account_id`（public repo，由 Workers Builds 的 API token 決定）；宣告 Custom Domain `preview.zinzan.info`。                                                                                                                    |
| `branding.json`（進版控） | 單一 zone，`domains: ["zinzan.info"]`（`getBranding` 取 base domain）、`redirect` 指向 `https://www.zinzan.info`、favicon 改用自有資產。`name` 會成為失敗頁的 `og:title`，所以刻意取一個不會跟貼文作者名相撞的值 —— 健康探測靠這點區分「真的取到資料」與「服務壞掉」。 |
| `.gitignore`              | 用否定規則放行上面兩個檔（不刪上游原本的行，避免 upstream 改動時衝突）；忽略 `.codegraph/`。                                                                                                                                                                           |

### Style

`packages/atmosphere/src/providers/twitter/processor.ts` 的一處 prettier 違規
（上游既有，會讓 `npm run lint:eslint` 直接失敗）。純格式，無行為變更。

---

## 驗證紀錄（2026-09-13）

- `npm run lint:eslint` → exit 0
- `npx vitest run` → 62 檔 / 395 測試全綠
- `npx tsc --noEmit` → 155 error（基準 159；差額是順手修掉的同類問題，非新增）
- 線上（`https://preview.zinzan.info`，build `c1e1140`）：
  - 探測 UA `ShortUrlBot/1.0` → 200 + `jack (@jack)` / `Bluesky (@bsky.app)`，無 `Location`
  - Telegram / Discord / LINE 爬蟲 → 200 + 正確 OG；Instagram 亦可取得資料
  - 真人 UA → 302 回原站，`Location` 無前綴殘留（x.com、profile、bsky、instagram）
  - `/2/go`、`/2/hit` → 302；根路徑 → 302 到 `https://www.zinzan.info`
  - 頁面內無 `https:///`、`https://undefined`、`api.fxtwitter.com`
