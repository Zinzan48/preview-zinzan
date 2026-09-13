import { describe, expect, it } from 'vitest';
import { buildShortDirectMediaUrl } from '../src/helpers/directMedia';
import { DataProvider } from '../src/enum';

/*
 * 這個網址的**長度**就是功能本身。og:video 一旦回到上千字元，Telegram 會安靜地退回
 * 只畫縮圖 —— 頁面看起來完全正常，meta 也都在，只是沒有播放器。這個坑踩過三次
 * （Instagram 一次、Threads 一次、加上以為是編碼問題查錯方向一次），所以連長度都要斷言。
 */

const SELF = 'https://preview.zinzan.info/www.threads.com/@gggb745/post/DcPdyVRFFfW';

describe('buildShortDirectMediaUrl', () => {
  it('keeps the Threads URL short enough for Telegram to build a player', () => {
    const url = buildShortDirectMediaUrl(
      DataProvider.Threads,
      'https://www.threads.com/@gggb745/post/DcPdyVRFFfW',
      SELF,
      true
    );

    expect(url).toBe('https://preview.zinzan.info/www.threads.com/@gggb745/post/DcPdyVRFFfW.mp4');
    /* 實測的分界：約 130 字元會播，1154 字元不會。200 是有餘裕又能擋住迴歸的門檻。 */
    expect(url!.length).toBeLessThan(200);
  });

  it('does the same for Instagram', () => {
    const url = buildShortDirectMediaUrl(
      DataProvider.Instagram,
      'https://www.instagram.com/reel/DdIxVQ3SDWA/',
      'https://preview.zinzan.info/www.instagram.com/reel/DdIxVQ3SDWA/',
      true
    );

    /* 來源網址的結尾斜線要剝掉，否則會變成 `…/DdIxVQ3SDWA/.mp4`。 */
    expect(url).toBe('https://preview.zinzan.info/www.instagram.com/reel/DdIxVQ3SDWA.mp4');
  });

  it('leaves other providers alone', () => {
    /* X 的影片網址約 130 字元、沒有簽章，本來就播得動 —— 不需要多一次往返。
       Bluesky 與 TikTok 各自有既有的處理路徑。 */
    for (const provider of [DataProvider.Twitter, DataProvider.Bluesky, DataProvider.TikTok]) {
      expect(
        buildShortDirectMediaUrl(provider, 'https://x.com/jack/status/20', SELF, true)
      ).toBeNull();
    }
  });

  it('refuses anything but the first media', () => {
    /* 這兩個 realm 都沒有 /videos/<n> 這種路由，carousel 的第二支影片會被解析成第一支。
       放出去就是「預覽顯示了別支影片」—— 比沒有播放器更糟。 */
    expect(
      buildShortDirectMediaUrl(
        DataProvider.Threads,
        'https://www.threads.com/@gggb745/post/DcPdyVRFFfW',
        SELF,
        false
      )
    ).toBeNull();
  });

  it('returns null rather than throwing on unusable input', () => {
    expect(buildShortDirectMediaUrl(DataProvider.Threads, 'not a url', SELF, true)).toBeNull();
    expect(
      buildShortDirectMediaUrl(DataProvider.Threads, 'https://www.threads.com/', SELF, true)
    ).toBeNull();
  });
});
