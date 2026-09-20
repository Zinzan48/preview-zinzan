# CLAUDE.md — `preview.zinzan.info`

這是 [`FxEmbed/FxEmbed`](https://github.com/FxEmbed/FxEmbed)（MIT）的 fork，部署在
`preview.zinzan.info`，給短網址服務 `ShortUrlApi` 當連結預覽的改寫目標。

**上游本身的架構、`@fxembed/atmosphere` 套件、環境變數要登記在哪幾個檔案、基本指令表，
一律以 `AGENTS.md` 為準，本檔不重述。** 這裡只寫「這個 fork 跟上游不一樣的地方」與
「不知道就會踩的雷」。

---

## 1. 這個 fork 在做什麼

使用者把社群連結貼進 Telegram / Discord / LINE 時看不到圖片與影片預覽。`ShortUrlApi`
會在 **302 導轉當下**把連結改寫成指向這個服務，形狀是「**路徑第一段＝來源網域**」：

```
使用者原始連結   https://x.com/jack/status/20?s=20
導轉目標         https://preview.zinzan.info/x.com/jack/status/20?s=20
                                            ^^^^^ 來源網域
```

`TBSHORTURL.ORIGINALURL` 永遠保留原始網址，所以這個服務掛掉時，既有短網址會自動退回原站。

不自己寫一套而選擇 fork，是因為 Instagram 這類上游的取得邏輯（含私有 API 與帳號輪替）
幾乎不可能重寫，而 FxEmbed 仍在活躍維護。**所以改動要刻意集中、可辨識**，
未來 `git fetch upstream && git merge upstream/main` 才不會變成災難。

---

## 2. 與上游的差異

**完整清單在 [`CHANGELOG.md`](./CHANGELOG.md)**（改了哪些檔案、為什麼、不改會怎樣）。
這裡只留操作上必須記得的部分。

我們專屬的功能：單一網域 + 路徑第一段即來源網域（`src/helpers/pathRouting.ts`、
`getPath`、兩個 realm 的 redirect handler），以及把 `/2/go`、`/2/hit` 的中轉 host
從 `API_HOST_LIST[0]` 拆成獨立的 `GO_REDIRECT_HOST`。

### merge upstream 後必須複查的六個修正

`git merge upstream/main` 之後逐項確認還在。**前兩項被蓋回去不會有任何錯誤訊息**，
只會安靜地讓 X 全部失效 / 多圖貼文吐出壞 URL：

1. `packages/atmosphere/src/providers/twitter/fetch.ts` — guest token 的 `cf` 選項
   （`cacheTtl` / `cacheEverything` 只適用 GET/HEAD，而它是 POST）必須維持移除。
2. `src/constants.ts` — 18 個清單的 `.filter(Boolean)`，以及 6 處
   `!!Constants.XXX_LIST` → `.length > 0`。
3. `packages/atmosphere/src/providers/twitter/conversation.ts` — `fetchSingleStatus`
   吞例外處的 `console.error`。
4. `src/realms/twitter/routes/profile.ts` — 真人分支不可 redirect 回 `url` 自己。
5. `.gitattributes` — 必須是 `* text=auto eol=lf`，不是上游的 `* text=LF`。
6. `vitest.config.mts` — branding alias。

## 3. 設定

### 3.1 三個雷

- **`API_HOST_LIST` 必須留空。** 它不只決定 realm，還同時決定 `flags.api`
  （`src/realms/twitter/routes/status.ts`、`routes/profile.ts`）。主網域一旦放進去，
  每則貼文都會回 **JSON 而不是 OG HTML**，整個預覽服務等於失效。
  `og:video` 的中轉 host 請用獨立的 `GO_REDIRECT_HOST`。
- **`STANDARD_DOMAIN_LIST` 填 `zinzan.info`，不是 `preview.zinzan.info`。**
  `getPath` 與 `getBranding` 都取 base domain（`hostname.split('.').slice(-2)`）。
  `branding.json` 的 `domains` 同理。
- **`.env` 是 build-time inline**（esbuild `define`），不是 runtime 讀取。
  改了必須重新 build 才生效；正式部署則是改 Cloudflare 的 **Build variables** 後重新部署。

### 3.2 Cloudflare Workers Builds

Repo `Zinzan48/preview-zinzan`、production branch `main`。

- Build command：`npm run build`
- Deploy command：`npx wrangler deploy --no-bundle`
- Build variables（只設這 5 個，其餘未設定＝空字串＝停用，那正是我們要的）：

  ```
  STANDARD_DOMAIN_LIST=zinzan.info
  GO_REDIRECT_HOST=preview.zinzan.info
  TWITTER_ROOT=https://x.com
  INSTAGRAM_ROOT=https://www.instagram.com
  INSTAGRAM_API_ROOT=https://i.instagram.com
  ```

`MOSAIC_*` / `GIF_TRANSCODE_*` / `VIDEO_TRANSCODE_*` / `POLYGLOT_*` 的上游預設值
**全部指向 FxEmbed 官方的線上服務**，留空＝不使用（否則等於把我們的流量打到別人的正式站）。

Custom domain 不用手動加，`wrangler.toml` 已宣告 `[[routes]] custom_domain = true`。

---

### 3.3 社群帳號憑證

沒有憑證服務照常運作（程式內建公開 guest token），憑證換來的是 X 的 NSFW 貼文、
更高的 rate limit、Instagram 明顯更穩的成功率。

設定、更新與診斷的完整流程在 skill
[`social-account-credentials`](./.claude/skills/social-account-credentials/SKILL.md)。
這裡只留最容易出錯的那一點：

**三個值分屬兩個不同的地方。** `ENCRYPTED_CREDENTIALS` 與 `CREDENTIALS_IV` 是
**Build** secrets（密文要在 build 期編進 bundle）；`CREDENTIAL_KEY` 是 **Worker runtime**
secret（執行時才用來解密）。**金鑰放進 Build secrets 等於白加密** —— 它會跟密文一起
被 inline 進 bundle。放錯的症狀跟「完全沒設憑證」一模一樣，不會有任何錯誤訊息。

## 4. 驗收

本機：`npx wrangler dev --local`，一律帶 `-H "Host: preview.zinzan.info"`
（不帶的話 `127.0.0.1` 會落到 twitter realm 的 fallback，行為跟正式站不同）。

```bash
BOT='TelegramBot (like TwitterBot)'
HUMAN='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1'

# 爬蟲 → 200 + 真實作者名
curl -s -H "Host: preview.zinzan.info" -A "$BOT" http://localhost:8787/x.com/jack/status/20 | grep og:title
# 真人 → 302 回原站，Location 不可殘留 /x.com 前綴
curl -sI -H "Host: preview.zinzan.info" -A "$HUMAN" http://localhost:8787/x.com/jack/status/20 | grep -i location
# og:video 必須是 https://preview.zinzan.info/2/go?url=… ，且該端點 302 到 video.twimg.com
# 頁面內不可出現 https:/// 、https://undefined 、api.fxtwitter.com
```

必跑：`npm run lint:eslint`（exit 0）、`npx vitest run`（69 檔 / 461 測試全綠）。

### 4.1 本機重測前一定要做的兩件事

改完程式在本機重測時，**沒做這兩件事會拿到上一版的結果，而且看起來完全正常**
（2026-09-20 實際踩到，一度誤判成「修正沒生效」）：

```bash
# ① 殺掉殘留的 workerd —— 停掉 wrangler 只會殺外層的 node，
#    子行程 workerd 會繼續佔著 8787，服務的是舊 bundle
powershell -c "Get-Process workerd -ErrorAction SilentlyContinue | Stop-Process -Force"

# ② 清掉 Miniflare 持久化的回應快取 —— 它存在磁碟上，重啟 wrangler 不會清
rm -rf .wrangler/state/v3/cache .wrangler/tmp
```

`wrangler.toml` 有 `[build] command = "npm run build"`，所以 wrangler 自己會在啟動與
偵測到 `src` 變動時重跑 build。手動 build 與它同時寫 `dist/worker.js` 會撞在一起，
產出半截檔案，症狀是 `Error: Handler does not export a fetch() function.`。
用 `--no-bundle` 跑（與 `npm run deploy` 一致）可以少一層重複打包。

---

> 遇到「meta 看起來都對，但 Telegram 就是不播影片／預覽不更新」這類問題，
> 用 skill [`link-preview-platform-behavior`](./.claude/skills/link-preview-platform-behavior/SKILL.md)
> —— 裡面有各平台的能力邊界、Telegram 產生播放器的四個條件，
> 以及一套照順序排除的診斷步驟（快取 → meta 比對 → 平台限縮 → 中轉 → 影片檔 →
> 第三方可達性 → 網址長度）。

## 5. 交給 `ShortUrlApi` 的探測設定

`ADMIN.TBDOMAINREWRITE` 的探測 UA 是 `ShortUrlBot/1.0`，它命中 `BOT_UA_REGEX` 的 `bot`
token，所以會拿到 200 + OG meta。**UA 不可為空**（空 UA 會被判成真人而 302）。

| 來源網域      | `PROBEURL`                                                                 | 期望字串              |
| ------------- | -------------------------------------------------------------------------- | --------------------- |
| `x.com`       | `https://preview.zinzan.info/x.com/jack/status/20`                         | `jack (@jack)`        |
| `twitter.com` | `https://preview.zinzan.info/twitter.com/jack/status/20`                   | `jack (@jack)`        |
| `bsky.app`    | `https://preview.zinzan.info/bsky.app/profile/bsky.app/post/3l6oveex3ii2l` | `Bluesky (@bsky.app)` |

三個關鍵修正，寫錯會讓規則永遠 `HEALTHSTATUS=0` 或永遠假綠燈：

1. **期望字串不可以用 `og:title`。** 服務故障時仍會回 200 且含 `og:title`，值是
   `branding.json` 的 `name`（`zinzan preview`）。要用只有真的取到資料才會出現的作者字串。
2. **不要用 profile 當樣本。** Twitter profile 頁回 200 但**不含 `og:title`**；
   Bluesky 的 profile-only 路徑（`/bsky.app/profile/bsky.app`）一律 302 跨 host，
   會直接觸發「被導去非預期 host」的失敗判定。樣本一律用貼文。
3. Instagram 是 best-effort（Meta 持續封鎖），建議規則先不啟用。
4. **Facebook 尚未列入表中。** provider 已完成且本機驗收全過，出口 IP 也在
   `wrangler dev --remote` 實測 20/20，但**還沒有線上驗收**。照 Threads 的教訓，
   在正式網域連續量到穩定成功率之前不要寫進 `TBDOMAINREWRITE` —— 探測會一直紅、
   或時通時斷讓規則震盪。屆時的樣本用貼文、期望字串用作者字串（規則 1、2 照舊），
   並換成一則可控、不會被刪的公開貼文。

### 5.1 Facebook：已實測的連結形狀與來源網域

`ShortUrlApi` 要改寫哪些 Facebook 連結，以這張表為準。全部是 2026-09-20 在本機
（`wrangler dev --local`，家用 IP）用 `TelegramBot` UA 實際跑過的結果。

| 形狀 | 樣本 | 結果 |
| --- | --- | --- |
| `/reel/<id>` | `www.facebook.com/reel/4484820285134652` | ✅ 播放器 + 縮圖 + `算命的說我很愛吃 (@MASTER.FOOD.DIARY)` |
| `/share/r/<code>`（影片分享） | `www.facebook.com/share/r/1EGDPCQQe2/` | ✅ 同上，解析回同一則 reel |
| `/share/<code>`（一般貼文分享） | `www.facebook.com/share/19h74gRbKu/` | ✅ 縮圖卡 + `野狼祭 Beastoria (@beastoriatw)`（該貼文無影片） |
| `fb.watch/<code>` | `fb.watch/lqvlrYbAdh/` | ✅ 播放器 + `阿翰po影片 (@hanhanpovideo)` |
| 粉專首頁 | `www.facebook.com/facebook` | ✅ 縮圖卡 + `Facebook (@facebook)` |
| `/photo?fbid=<id>` | `www.facebook.com/photo?fbid=986636164121078` | ❌ **Facebook 對這個形狀不給任何 `og:*`** → 302 回原站 |

`/photo?fbid=` 不是我們解析失敗：`/photo/`、`/photo.php`、`m.facebook.com` 三種寫法
實測都是 200 但 `og:*` 出現 **0 次**（同一支測法對 reel 是 7 次）。同一張圖用**貼文**
永久連結（`/<page>/posts/<id>`）就正常，所以**探測與改寫規則都不要用 `/photo` 樣本**。

來源網域白名單在 `src/helpers/pathRouting.ts`：

| 來源網域 | 處理方式 | 是否實測 |
| --- | --- | --- |
| `www.facebook.com`、`facebook.com` | 直接抓 | ✅ |
| `fb.watch` | **照原 host 抓**（code 是獨立命名空間，接到 www 上解析不出來），再由頁面的 `og:url` 換回正規網址 | ✅ |
| `m.facebook.com`、`web.facebook.com`、`fb.com`、`www.fb.com` | 正規化成 `www.facebook.com`（同一個 id 命名空間） | ⚠ 未實測 |

---

## 6. 跟上游同步

```bash
git fetch upstream && git merge upstream/main
```

合併後至少確認 §2.2 的六個修正還在，特別是 **1（`cf` 選項）** 與 **4（`filter(Boolean)`）**
—— 這兩個被蓋回去不會有任何錯誤訊息，只會安靜地讓 X 全部失效 / 多圖貼文吐出壞 URL。
