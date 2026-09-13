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

## 2. 與上游的差異（全部）

### 2.1 我們專屬的功能

| 檔案                                                                                               | 改了什麼                                                                                                                               |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `src/helpers/pathRouting.ts`                                                                       | **新檔**。來源網域 → realm 對照表、`matchSourcePrefix()`、`stripSourcePrefix()`、`SELF_REDIRECT_PATHS`。是這套路由規則的單一事實來源。 |
| `src/worker.ts`                                                                                    | `getPath` 改成先用路徑第一段判 realm，未命中才回落上游的 Host header 判定；另放行 `/2/go`、`/2/hit` 到 api realm。                     |
| `src/realms/twitter/routes/redirects.ts`、`src/realms/bluesky/routes/redirects.ts`                 | 凡是拿 `url.pathname` 重建原站網址的地方都改走 `stripSourcePrefix()`。                                                                 |
| `src/constants.ts`、`src/types/env.d.ts`、`esbuild.config.mjs`                                     | 新增 `GO_REDIRECT_HOST`。                                                                                                              |
| `src/render/video.ts`、`src/embed/status.ts`、`src/embed/activity.ts`、`src/render/instantview.ts` | `/2/go`、`/2/hit` 的 host 改取 `GO_REDIRECT_HOST`（原本是 `API_HOST_LIST[0]`）。                                                       |
| `src/helpers/utils.ts`                                                                             | `wrapForeignLinks` 補上「沒有中轉 host 就回原連結」的防呆。                                                                            |
| `wrangler.toml`、`branding.json`、`.gitignore`                                                     | 自架設定，見 §3。                                                                                                                      |

### 2.2 修掉的上游缺陷（**merge upstream 後要確認沒被蓋回去**）

1. **guest token 的 `cf` 選項**（`packages/atmosphere/src/providers/twitter/fetch.ts`）
   在現行 Workers runtime 會拋
   `TypeError: The 'cacheControl' and 'cacheTtl' options on cf are mutually exclusive`。
   `cacheTtl` / `cacheEverything` 依官方文件**只適用於 GET / HEAD**，而 guest token 是 POST。
   **沒有帳號憑證時這是唯一的取得路徑，所以每一則 X 貼文都會變成「Sorry, that post doesn't exist」。**
2. **被吞掉的例外**（`packages/atmosphere/src/providers/twitter/conversation.ts`）
   `fetchSingleStatus` 在無帳號代理時用 `catch (_e) { return null; }`，把所有失敗都變成
   「貼文不存在」。補了 `console.error` —— 上面那個 bug 就是因為它而完全查不到。
3. **profile 頁對真人 302 導回自己**（`src/realms/twitter/routes/profile.ts`）＝重導迴圈。
4. **空環境變數變成 `['']` 而不是 `[]`**（`src/constants.ts`）。`(x ?? '').split(',')` 對空字串
   回傳長度 1 的陣列，讓所有 `.length > 0` 檢查失效，組出 `https:///jpeg/...` 這種壞 URL。
   18 個清單都補上 `.filter(Boolean)`，6 處 `!!Constants.XXX_LIST`（對陣列取 `!!` 永遠 true）
   改成 `.length > 0`。
5. **`.gitattributes` 寫成 `* text=LF`**（無效語法，git 只認 `text` / `text=auto`，換行由 `eol` 指定）。
   在 `core.autocrlf=true` 的 Windows 上會讓 `npm run lint:eslint` 噴 13,291 個 `Delete ␍`。
6. **測試硬編上游 branding**（`vitest.config.mts`）。加了 alias 讓測試固定讀
   `branding.example.json`，換 branding 才不會讓 4 個測試變紅。

---

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

必跑：`npm run lint:eslint`（exit 0）、`npx vitest run`（62 檔 / 395 測試全綠）。

---

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

---

## 6. 跟上游同步

```bash
git fetch upstream && git merge upstream/main
```

合併後至少確認 §2.2 的六個修正還在，特別是 **1（`cf` 選項）** 與 **4（`filter(Boolean)`）**
—— 這兩個被蓋回去不會有任何錯誤訊息，只會安靜地讓 X 全部失效 / 多圖貼文吐出壞 URL。
