---
name: link-preview-platform-behavior
description: 診斷「Open Graph meta 看起來都對，但聊天軟體就是不顯示預覽／不播影片」的問題，以及各平台（Telegram / Discord / LINE）對 og:video、og:image 的實際能力邊界。當使用者回報「Telegram 上沒有播放器只有縮圖」「LINE 看不到影片」「og:video 沒作用」「影片預覽壞掉」「換了網址還是舊的預覽」「預覽卡片顯示錯誤的名稱」，或在新增／修改任何會輸出 OG meta 的服務（預覽代理、embed fixer、分享頁）時，務必使用此技能。也涵蓋健康探測樣本與期望字串的設計陷阱。不適用於 SEO/搜尋引擎的 metadata、Google Search Console 的檢索問題，或與聊天軟體預覽無關的一般 HTML head 調整。
---

# 連結預覽的平台行為與診斷

這份技能記錄的是**實測得來、規格文件上查不到**的行為。所有數字與結論都來自
2026-09-13 對 `preview.zinzan.info`（FxEmbed fork）的實際請求，
對照組是上游的 `fxtwitter.com` / `67instagram.com`。

外部服務變動很快，引用前若成本允許請自行重驗一次；本檔的價值在於
**告訴你該驗什麼、以及哪些路已經走過**。

## 先確認能力邊界，不要在做不到的事情上耗時間

| 平台     | 內嵌播放影片 | 依據                                                                                    |
| -------- | ------------ | --------------------------------------------------------------------------------------- |
| Telegram | 可以         | 讀 `og:video`，會產生播放器                                                             |
| Discord  | 可以         | 同上                                                                                    |
| **LINE** | **做不到**   | LINE 的連結預覽**只讀 `og:title` / `og:image` / `og:description`**，完全不吃 `og:video` |

**所以 `og:image` 一定要有值**——影片就放縮圖。LINE 那一側的天花板就是「正確的縮圖卡片」，
不管怎麼調 `og:video` 都不會有播放器。使用者回報「LINE 看不到影片」時，
這不是 bug，講清楚比繼續查有價值。

## Telegram 產生播放器的條件

四個都要滿足，缺一個就退回只顯示 `og:image`：

1. **`og:video:type` 必須是有效的 MIME type。** 輸出字串 `undefined`（provider 沒填
   format 時最容易發生）會被當成未知格式而不播。
2. **影片要是 H.264 的 MP4，且 faststart**（`moov` 在 `mdat` 之前）。
   檢查方式見下方診斷步驟。
3. **`og:video` 的網址不能太長。** 實測：約 130 字元的 `video.twimg.com` 網址正常播放；
   約 1162 字元的 Instagram CDN 簽章網址**只顯示縮圖**——同一則貼文在上游
   `67instagram.com` 也一樣，所以不是單一實作的問題。
   確切門檻未知，但這是排除其他所有因素後唯一剩下的變因。
4. 影片本身要能被 Telegram 的伺服器抓到（見診斷步驟 6）。

**長網址的解法是換中轉方式，不是縮短查詢字串。** 把「預先算好的完整媒體網址塞進 meta」
改成「meta 只放自己網域的短路徑，客戶端真的來抓時才即時解析並 302」。
例如 `https://你的網域/instagram.com/reel/<code>.mp4`（66 字元）。
代價是抓取時多一次上游往返，值得。

## 診斷步驟

症狀是「meta 看起來都對，但就是不顯示／不播」時，照順序排除。
每一步都有明確的判斷依據，不要跳著猜。

### 1. 先排除快取

Telegram 會把每個網址的預覽結果**快取很久**，而且**訊息送出後就不會再更新**。
之前壞掉的版本會一直被記住。

- 換一個**沒貼過**的網址測，或
- 對 **@WebpageBot** 發送該網址讓它重抓

沒排除這一步之前，後面所有的測試結果都不可信。

### 2. 跟上游／對照組比對 meta

如果是 fork 或改寫既有服務，直接抓同一則內容在對照組的輸出逐欄位比對：

```bash
BOT='TelegramBot (like TwitterBot)'
curl -s -A "$BOT" "https://對照組/<同一則貼文>" -o up.html
curl -s -A "$BOT" "https://你的服務/<同一則貼文>" -o ours.html
# 逐欄位 diff og:* 與 twitter:*
```

**如果你的輸出比對照組還完整，問題就不在 meta**，可以直接跳到步驟 4。
這一步常常能一次排除掉大半的猜測。

### 3. 確認是「這個平台」還是「整個服務」

用另一個平台的內容做對照——例如 X 的影片能播、Instagram 的不能，
那就證明服務本身、中轉機制、UA 分流都是好的，問題限縮在該平台的媒體網址特性。

這一步能把搜尋範圍縮小一個數量級，值得優先做。

### 4. 驗證中轉端點本身

如果 `og:video` 指向自己的轉址端點，單獨打它：

```bash
curl -s -A "$BOT" -o /dev/null -D - "<og:video 的值>" | grep -iE '^(HTTP|location)'
```

必須是 `302` 且 `Location` 指向真正的媒體。出現 `https:///`、`https://undefined`
這種壞網址，通常是環境變數留空時字串拼接的結果。

### 5. 驗證影片檔本身

```bash
curl -s -r 0-1 -o /dev/null -D - "<最終媒體網址>" | grep -iE '^(HTTP|content-type|content-range)'
```

要看到 `206` + `video/mp4`，`Content-Range` 的分母就是檔案大小。

容器與編碼（需要把檔案抓下來）：

```python
import struct, io
data = io.open(path,'rb').read(4096)
pos, boxes = 0, []
while pos < len(data)-8:
    size = struct.unpack('>I', data[pos:pos+4])[0]
    typ  = data[pos+4:pos+8].decode('latin-1')
    if not typ.isprintable() or size == 0: break
    boxes.append(typ); pos += size
print(boxes)                      # moov 要排在 mdat 之前（faststart）
print(b'avc1' in data)            # H.264
```

### 6. 確認第三方抓得到那個網址

媒體網址常帶簽章（Instagram 的 `oh` / `oe` / `_nc_gid`）。要排除
「只有你抓得到、別人抓不到」：

- 解析 `oe` 參數（十六進位的 Unix 時間）確認還沒過期
- **從另一個 IP 抓一次**。你自己的機器跟聊天軟體的伺服器在不同網路，
  簽章若綁來源就會在這裡現形。手邊沒有第二個出口時，任何能代你發請求的
  工具（WebFetch、線上 HTTP 測試服務）都算數。

⚠️ 複製長網址時**務必完整**。少一個查詢參數就會得到 403，
那個 403 是你自己造成的，會把診斷帶往完全錯誤的方向。

### 7. 剩下的就是長度

前面全部通過卻還是不播，回頭看 `og:video` 的字元數。
對照組能播的那個是幾字元、你的是幾字元。

## 健康探測的設計陷阱

如果有外部系統定期探測這個預覽服務（判斷要不要啟用改寫規則），
以下三點都是實測踩過的：

**期望字串不能用 `og:title`。** 服務故障或內容不存在時，多數 embed 服務仍會回
`200` 並附上一個「找不到」的頁面，那個頁面**照樣有 `og:title`**（值通常是服務名稱）。
拿 `og:title` 當期望字串等於永遠綠燈。改用**只有真的取到資料才會出現的內容**，
例如貼文作者的 handle。

**用 `(@handle)` 而不是顯示名稱。** 作者改暱稱不會讓探測失效，改 handle 才會，
而後者罕見得多。

**探測樣本不能用會轉址的路徑。** 例如純個人頁路徑常常直接 302 回原站，
而嚴謹的探測會把「跨網域轉址」判定為失敗。樣本一律用**貼文**，
並實際驗證它回 `200` 且沒有 `Location`：

```bash
curl -s -A "探測用的 UA" -D - "<PROBEURL>" -o body.html | grep -iE '^(HTTP|location)'
grep -c "<期望字串>" body.html
```

**挑不會消失的樣本。** Instagram 史上第一則貼文（`instagram.com/p/C`，
創辦人 2010 年那張狗的照片）比任何官方帳號的行銷貼文都穩定——
官方帳號會刪舊貼文，歷史文物不會。X 則用 `jack/status/20`。

## UA 分流

爬蟲給 metadata、真人直接 302 回原站，使用者不該停留在代理網域上。

判定邏輯通常是「**比對已知的 bot 關鍵字，不命中就當成真人**」，
而不是白名單真人瀏覽器。實務含意：

- 自訂的探測 UA（例如 `XxxBot/1.0`）通常**開箱即用**，因為含 `bot`
- **UA 不可為空**，空字串會被判成真人而收到 302
- LINE 的爬蟲 UA 含 `facebookexternalhit`，**不要**用「是否為 facebookexternalhit」
  做排除邏輯
