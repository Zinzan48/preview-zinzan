---
name: social-account-credentials
description: 在 preview.zinzan.info（FxEmbed fork）設定、更新或診斷 X / Instagram / Bluesky 的帳號憑證。當使用者提到憑證、credentials.json、cookie、auth_token、ct0、sessionid、CREDENTIAL_KEY、ENCRYPTED_CREDENTIALS、帳號代理（account proxy），或回報「NSFW 貼文看不到」「IG 最近很不穩」「rate limit 被擋」「憑證過期了」「要換一組帳號」時，務必使用此技能。也適用於「密文要放哪」「為什麼金鑰不能放 Build secrets」這類設定位置的疑問。不適用於 Cloudflare 的一般部署設定、網域改寫規則（TBDOMAINREWRITE），或與帳號憑證無關的 build variable。
---

# 社群帳號憑證

FxEmbed 沒有憑證也能運作（程式內建公開的 guest bearer token），所以**憑證是強化而非必要**。
它換來的是：X 的 NSFW 貼文、更高的 rate limit、Instagram 明顯更穩定的取得成功率。

這件事最容易出錯的不是取 cookie，而是**三個值放錯地方**——而且放錯的症狀跟「完全沒設」
一模一樣，不會有任何錯誤訊息。所以先講位置。

## 三個值，兩個不同的地方

| 值                      | 放哪                                                                          | 為什麼                                      |
| ----------------------- | ----------------------------------------------------------------------------- | ------------------------------------------- |
| `ENCRYPTED_CREDENTIALS` | Cloudflare → Settings → **Build** → Build variables and secrets（按 Encrypt） | 密文要在 **build 期**被 esbuild 編進 bundle |
| `CREDENTIALS_IV`        | 同上                                                                          | 同上                                        |
| `CREDENTIAL_KEY`        | Cloudflare → Settings → **Variables and Secrets**（Worker runtime）           | 解密金鑰，Worker **執行時**才用             |

**金鑰放進 Build secrets 等於白加密**——它會跟密文一起被 inline 進 bundle，
任何拿到 bundle 的人都能解開。兩者刻意分開，正是為了讓 bundle 外流也不等於憑證外流。

`.env` 是第三個地方，但它**只存在於本機**，不會上傳到 Cloudflare。

## 設定流程

### 1. 先開專用小號

X 的 `auth_token` **等同該帳號的完整登入權限**：沒有範圍限制、不能像 app password
那樣單獨撤銷，拿到的人可以直接操作帳號。Instagram 的 `sessionid` 同理，而且 Meta
對自動化行為的停權很積極。**不要用主帳號。**

帳號被停權時服務不會壞——會自動退回 guest token 模式繼續運作，只是失去強化效果。

### 2. 取 cookie

登入後開 F12 → Application → Cookies：

| 平台                             | 欄位                                        | cookie 名稱                                   |
| -------------------------------- | ------------------------------------------- | --------------------------------------------- |
| X（`x.com`）                     | `authToken`                                 | `auth_token`（約 40 字元）                    |
|                                  | `csrfToken`                                 | `ct0`（約 160 字元）                          |
| Instagram（`www.instagram.com`） | `sessionId`                                 | `sessionid`                                   |
|                                  | `userId` / `csrfToken` / `mid` / `deviceId` | `ds_user_id` / `csrftoken` / `mid` / `ig_did` |

Instagram 的 `platform` 填 `web`，**必須跟 cookie 來源一致**——從瀏覽器拿的就是 `web`，
混用 android 指紋是最常觸發 IG checkpoint 的原因。

`username` 欄位純粹給 log 用（型別註解明寫 `for logging only`），多組帳號輪替時
才看得出是哪一組出問題。

### 3. 寫進 `credentials.json` 並加密

```bash
cp credentials.example.json credentials.json   # 首次
# 填入實際值後：
npm run credentials:encrypt
```

兩個容易卡住的地方：

- **`encrypt` 會拒絕「只有 instagram」的檔案**，必須至少有一組 `twitter` 或
  `bluesky` 帳號。
- **用不到的平台要整個區塊刪掉**，不能只把值清空。驗證邏輯是「只要 `accounts`
  陣列非空，每個欄位就必須是非空字串」，留著空字串會直接 exit。

Bluesky 通常不需要憑證——公開 AppView API 不用登入就能用，帳號只是 PDS 故障時的備援。

`encrypt` 第一次執行會產生金鑰寫進 `.credential-key` 並印在畫面上，那個值就是
`CREDENTIAL_KEY`。輸出是 `credentials.enc.json`（`{ciphertext, iv}`）。

### 4. 複製到 Cloudflare

這些指令把值送進剪貼簿而不顯示在畫面上——憑證不該出現在終端機紀錄或對話裡：

```powershell
Set-Clipboard -Value (node -p "require('./credentials.enc.json').ciphertext")   # ENCRYPTED_CREDENTIALS
Set-Clipboard -Value (node -p "require('./credentials.enc.json').iv")           # CREDENTIALS_IV
Set-Clipboard -Value ((Get-Content .credential-key -Raw).Trim())                # CREDENTIAL_KEY
```

貼完**必須重新觸發一次建置**。Build secrets 只在建置當下生效，改了不重建等於沒改。

## 驗證

**build log** 是最直接的判斷，搜尋 `credentials`：

| 訊息                                                                    | 意義                                                           |
| ----------------------------------------------------------------------- | -------------------------------------------------------------- |
| `using ENCRYPTED_CREDENTIALS / CREDENTIALS_IV from the environment.`    | 兩個都讀到了，密文已進 bundle                                  |
| `Only one of ENCRYPTED_CREDENTIALS / CREDENTIALS_IV is set`             | 有一個名稱拼錯（`ENCRYPTED_CREDENTIALS` 結尾有 S，共 21 字元） |
| `No credentials.enc.json found ... CI: set ENCRYPTED_CREDENTIALS + ...` | 兩個都沒讀到                                                   |

**行為驗證**：貼一則 X 的 NSFW（sensitive media）貼文。無憑證時 X 回
`TweetUnavailable / reason: NsfwLoggedOut`，畫面是失敗頁；有憑證時程式會
自動用帳號代理重試並正常顯示。

如果 build log 正常但 NSFW 還是看不到，八成是 `CREDENTIAL_KEY` 放進了 Build 那一區。

## 過期與輪替

cookie 會過期（X 的 `auth_token` 撐得久，IG 的 `sessionid` 大約幾個月）。

**徵兆是安靜退化，不是故障**：NSFW 貼文突然又看不到、IG 開始不穩定，
但一般公開貼文完全正常——因為那條路徑本來就不需要憑證。所以不會有告警，
只能靠上述的行為驗證發現。

輪替流程跟首次設定一樣，但 **`CREDENTIAL_KEY` 不用動**：`.credential-key`
已存在時 `encrypt` 會沿用同一把金鑰，只有密文和 iv 會變。

## 安全檢查

`credentials.json`、`credentials.enc.json`、`.credential-key` 三個檔都在 `.gitignore`
裡。**這是 public repo**，動到 `.gitignore` 或新增憑證相關檔案時，
用 `git check-ignore -v <檔名>` 確認一次再 commit。
