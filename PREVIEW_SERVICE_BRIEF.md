# `preview.zinzan.info` 服務交接簡報

> 給接手實作 `preview.zinzan.info` 的人／agent。這份文件自成一體，不需要回頭讀 `ShortUrlApi` 的程式碼。
>
> 來源：`ShortUrlApi` repo，分支 `feat/domain-rewrite`。
> 所有標示「實測」的資料皆為 **2026-09-13** 實際發出請求取得；外部服務狀態變動極快，引用前請自行重驗。

---

## 1. 你要做什麼

做一個 **Open Graph metadata 代理服務**，部署在 `preview.zinzan.info`。

短網址服務（`ShortUrlApi`）會在 **302 導轉當下** 把使用者的社群連結改寫成指向你，形狀如下：

```
使用者原始連結   https://x.com/jack/status/20?s=20
短網址導轉目標   https://preview.zinzan.info/x.com/jack/status/20?s=20
                                            ^^^^^ 來源網域是路徑第一段
```

你要做的事：

1. 從路徑第一段判斷來源平台（`x.com` / `twitter.com` / `bsky.app` / `instagram.com`）。
2. 剩餘路徑 + query string 即為原站路徑，據此取得該貼文的 metadata。
3. **依 User-Agent 分流**：
   - 爬蟲（Telegram / Discord / Slack / `facebookexternalhit` 等）→ 回 `200` + 一頁只含 OG meta 的極簡 HTML。
   - 真人瀏覽器 → `302` 導回原始網址（`https://x.com/jack/status/20?s=20`）。**使用者絕不應停留在你的網域上。**
4. 上游取不到資料時 → **一律 302 回原始網址**，絕不回錯誤頁。壞掉要壞得安靜。

---

## 2. 終極目標與現實邊界

**終極目標**：使用者把短網址貼進通訊軟體時能直接看到、並直接播放影片，不必外開瀏覽器。

已查證的邊界（重要，不要把力氣花在做不到的事上）：

| 平台 | 內嵌播放影片 | 依據 |
|---|---|---|
| Telegram | ✅ 可以 | 讀 `og:video`，會產生內嵌播放器 |
| Discord | ✅ 可以 | 同上 |
| **LINE** | ❌ **做不到** | LINE 的連結預覽**只讀 `og:title` / `og:image` / `og:description`**，不吃 `og:video`。最多是正確的縮圖卡片 |

**所以**：`og:video` 還是要輸出（Telegram / Discord 靠它），但不要為了 LINE 去調 `og:video`——LINE 只會用到 `og:image`，請確保 `og:image` 一定有值（影片就放縮圖）。若 LINE 日後支援 `og:video`，本設計不需改動即可受益。

---

## 3. 必須輸出的 meta 標籤

```html
<meta property="og:title"        content="作者 (@handle)">
<meta property="og:description"  content="貼文內文">
<meta property="og:image"        content="圖片或影片縮圖的直連 URL">   <!-- LINE 只吃到這裡 -->
<meta property="og:video"        content="mp4 直連 URL">              <!-- Telegram/Discord 內嵌播放 -->
<meta property="og:video:type"   content="video/mp4">
<meta property="og:video:width"  content="...">
<meta property="og:video:height" content="...">
<meta property="og:url"          content="原始網址">
<meta name="twitter:card"        content="player">
```

`og:video` 請指向**上游的 mp4 直連**（例如 `video.twimg.com/...`），**不要自己代理影片流量**——那會讓頻寬成本失控，而且沒有必要。

---

## 4. 各平台的上游實作參考

授權與維護狀態皆於 2026-09-13 以 GitHub API 查證。

| 平台 | 參考專案 | 語言 | 授權 | 狀態 |
|---|---|---|---|---|
| X / Twitter + Bluesky | [`FxEmbed/FxEmbed`](https://github.com/FxEmbed/FxEmbed) | TypeScript | MIT | **活躍**，5,026 stars，最後推送 2026-09-13。repo 內含 `Dockerfile`、`docker-compose.yml`、`wrangler.example.toml`、`docs/`。**首選參考** |
| Instagram | [`Wikidepia/InstaFix`](https://github.com/Wikidepia/InstaFix) | Go | MIT | ⚠️ **已封存**（2025-08-04）。所有 fork 皆 0 star，最新為 `0xrushi/InstaFix`（2026-08-19）。等同接手孤兒碼 |
| Reddit（未列入第一階段） | [`MinnDevelopment/fxreddit`](https://github.com/MinnDevelopment/fxreddit) | TypeScript | Apache-2.0 | 活躍，2026-01-12 |
| TikTok（未列入第一階段） | [`okdargy/fxtiktok`](https://github.com/okdargy/fxtiktok) | TypeScript | 非標準授權 | 活躍，2026-09-06 |

> **注意**：這些專案是**拿來參考／抽取邏輯自架**，不是拿來當轉址目標。原因見第 6 節。

### 現成 JSON API（若決定不自己解析上游）

FxEmbed 提供公開 JSON API，實測可用：

```bash
curl "https://api.fxtwitter.com/jack/status/20"
# → {"code":200,"message":"OK","tweet":{"url":...,"text":...,"author":{...},"media":{...}}}
```

這是最省力的起步方式，代價是把可用性綁在第三方服務上。若採用，務必保留降級路徑（取不到就 302 回原站）。

---

## 5. 你必須提供的健康探測端點

`ShortUrlApi` 會定期探測你，失敗就自動停用替換規則、讓短網址退回原始網址。你要保證：

1. 存在一個**穩定的樣本網址**（會寫進 `TBDOMAINREWRITE.PROBEURL`），目前規劃為：
   - `https://preview.zinzan.info/x.com/jack/status/20`
   - `https://preview.zinzan.info/twitter.com/jack/status/20`
   - `https://preview.zinzan.info/bsky.app/profile/bsky.app`
2. 對探測請求（帶 `ShortUrlBot/1.0` 類 User-Agent）回 **`200`**，且 HTML 內**含 `og:title`**。
3. **不要把探測請求 302 導去別的 host**——探測端把「跨 host 轉址」判定為失敗。

判定為失敗的條件（比一般死連結檢查嚴格，因為失敗代價是使用者拿到打不開或被劫持的網址）：

- 非 2xx
- 逾時 / 連線失敗
- 回應不含指定字串（預設 `og:title`）
- 被導去非預期 host ← **防網域被搶註後掛廣告**

失敗達門檻 → `HEALTHSTATUS=0` → 該規則停止生效，導轉退回原始網址。恢復後自動重新啟用。

> 新規則的 `HEALTHSTATUS` 預設為 `0`（尚未驗證），**必須先通過一次探測才會開始生效**。所以 `preview.zinzan.info` 還沒上線前，即使規則已寫入資料庫也不會改寫任何導轉。

---

## 6. 為什麼是自架，不是用現成鏡像（實測證據）

這是整件事的起點。公開 embed fixer 鏡像的生命週期極短，且**過期網域會被搶註後拿去掛廣告或釣魚**，而使用者拿到的是我們發出的短網址，信任成本由我們承擔。

2026-09-13 逐一實測（`curl -I`，8 秒逾時）：

| 網域 | 實測結果 |
|---|---|
| `ddinstagram.com` | ❌ DNS 已消失（`Could not resolve host`） |
| `instagramez.com` | ⚠️ **307 轉址到廣告聯播網** `effectivegatecpm.com` |
| `kkinstagram.com` | ⚠️ 對非瀏覽器 client 直接拒絕 TLS（`ACCESS_DENIED`）；另有資安分析報告指其為 typosquatting 惡意站 |
| `vxinstagram.com` | ❌ 502 |
| `vxtiktok.com` | 回 200，但上游已標記 deprecated |
| `fixthreads.net` | ❌ DNS 已消失 |
| `vxthreads.net` | ❌ 連線逾時 |
| `fxtwitch.tv` / `txitch.tv` | ❌ 自 2024-11-10 起失效 |
| `fxtwitter.com` / `fixupx.com` | ✅ 正常 |
| `vxtwitter.com` / `fixvx.com` | ✅ 正常 |
| `rxddit.com` / `vxreddit.com` | ✅ 正常 |
| `tnktok.com` / `tiktxk.com` | ✅ 正常 |
| `phixiv.net` / `bskx.app` / `fxbsky.app` | ✅ 正常 |

**關鍵教訓**：`instagramez.com` 現在回的是 **307 → 200**。任何「只檢查 HTTP 狀態碼」的健康檢查都會放行它，然後把使用者送進廣告站。所以健康檢查一定要驗回應內容與轉址目標 host。

---

## 7. UA 分流的實測基準

以 `https://fxtwitter.com/jack/status/20` 實測三種 User-Agent：

| User-Agent | 回應 |
|---|---|
| `TelegramBot (like TwitterBot)` | `200` + OG meta（3,008 bytes） |
| `facebookexternalhit/1.1;line-poker/1.0`（LINE 爬蟲） | `200` + OG meta（3,081 bytes） |
| `Mozilla/5.0 (iPhone...) Line/14.0.0`（LINE 真人瀏覽器） | `302 → https://x.com/jack/status/20` |

**照這個行為做就對了**：爬蟲給 metadata、真人直接送回原站。

⚠️ 注意 LINE 的爬蟲 UA 含 `facebookexternalhit`，**不要**用「是否為 `facebookexternalhit`」去做排除邏輯。

---

## 8. `ShortUrlApi` 這一側長什麼樣（你不需要改，但要知道）

- 資料表 `ADMIN.TBDOMAINREWRITE`（Oracle）記錄：來源網域 → 替換目標、平台代號、路徑改寫方式、優先序、人工開關 `STATUS`、自動健康 `HEALTHSTATUS`、探測網址與期望字串、連續成敗次數。
- 替換發生在 **302 導轉當下**，`TBSHORTURL.ORIGINALURL` 永遠保留原始網址 → 你掛掉時所有既有短網址自動退回原站。
- 規則以行程內快照供熱路徑使用，背景服務定期探測並更新健康狀態。
- DDL 與設計理由：`EF/TBDOMAINREWRITE.sql`。

---

## 9. 參考資料

所有連結最後驗證日期 **2026-09-13**。

### 上游專案

- FxEmbed（fxtwitter / fixupx / fxbsky 的實作）— https://github.com/FxEmbed/FxEmbed — MIT、活躍
- FxEmbed 官方文件 — https://docs.fxembed.com
- FxEmbed 服務狀態頁 — https://status.fxtwitter.com （實測 200）
- InstaFix（ddinstagram 的實作）— https://github.com/Wikidepia/InstaFix — MIT、**已封存**
- fxreddit — https://github.com/MinnDevelopment/fxreddit — Apache-2.0
- fxtiktok — https://github.com/okdargy/fxtiktok
- phixiv（Pixiv）— https://github.com/thelaao/phixiv
- VixBluesky — https://github.com/Lexedia/VixBluesky

> 專案發想時提供的連結 `https://github.com/allnodes/FxTwitter` 經查是 **fork**，最後推送停在 2024-01-26、45 stars。上游是 `FxEmbed/FxEmbed`，請以上游為準。

### 社群彙整清單（狀態會過期，引用前請自行實測）

- Embed fixer 清單 — https://gist.github.com/Lexedia/bbbde4dbbf628b0bfe8476a96a977a8f
- Discord 原生播放器嵌入社群媒體 — https://gist.github.com/mohsreg/927bf8b2092515ee1a8ee88c3e4d2c14
- FixTweetBot（Discord bot，涵蓋多平台對照）— https://github.com/Kyrela/FixTweetBot

### 連結預覽與 OG 規格

- LINE Developers — LIFF app 支援 OGP 標籤 — https://developers.line.biz/zh-hant/news/2020/05/19/liff-supports-ogp-tags/
- LINE 分享 URL 預覽仍是 OG meta 標籤（LINE 只用 og:image / og:title / og:description）— https://medium.com/9ing/line%E7%9A%84%E5%88%86%E4%BA%ABurl%E9%A0%90%E8%A6%BD-%E9%82%84%E6%98%AFog%E4%B8%AD%E7%B9%BC%E6%A8%99%E7%B1%A4-31b45a82a891
- Open Graph 連結預覽設定與 LINE 快取清除 — https://hackmd.io/@A-Min-Design/BJjeU3OuY
- 黑暗執行緒 — FB/LINE 連結預覽如何產生 — https://blog.darkthread.net/blog/open-graph-tags/
- Telegram 官方 — Link Previews — https://telegram.org/blog/link-preview
- 各家通訊軟體 link preview meta tag 實測彙整 — https://dev.to/shadowfaxrodeo/i-tested-every-link-preview-meta-tag-on-every-social-media-and-messaging-app-so-you-dont-have-to-it-was-super-boring-39c0
