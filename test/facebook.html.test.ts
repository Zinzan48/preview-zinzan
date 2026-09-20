import { describe, expect, it } from 'vitest';
import {
  authorNameFromOgTitle,
  authorNameFromPageTitle,
  decodeHtmlEntities
} from '@fxembed/atmosphere/providers/facebook/html';

/*
 * Facebook 的 `<head>` 把中文、`@`、`&` 全部寫成 entity，而且同一頁混用三種寫法。
 * 解碼漏掉任何一種，出去的就是一張標題寫著 `&#x842c;` 的預覽卡 —— 不會報錯。
 */

describe('decodeHtmlEntities', () => {
  it('decodes the hex form Facebook uses for CJK', () => {
    /* 實測 og:title 的原文就是這個形狀。 */
    expect(
      decodeHtmlEntities('&#x7b97;&#x547d;&#x7684;&#x8aaa;&#x6211;&#x5f88;&#x611b;&#x5403;')
    ).toBe('算命的說我很愛吃');
  });

  it('decodes decimal entities with a leading zero', () => {
    /* Threads 在這裡踩過：`@` 實際是 `&#064;` 而不是 `&#64;`，
       只認沒有前導零的寫法會讓整條解析悄悄失效。實測 twitter:site 就是 `&#064;facebookapp`。 */
    expect(decodeHtmlEntities('&#064;facebookapp')).toBe('@facebookapp');
    expect(decodeHtmlEntities('&#64;facebookapp')).toBe('@facebookapp');
  });

  it('decodes the named entities that appear in URLs and titles', () => {
    expect(decodeHtmlEntities('a.jpg?x=1&amp;_nc_cat=101')).toBe('a.jpg?x=1&_nc_cat=101');
    expect(decodeHtmlEntities('&quot;x&quot; &lt;y&gt;')).toBe('"x" <y>');
    /* og:title 用 `&#xb7;` 當分隔點、`&#xa0;` 當不斷行空格。 */
    expect(decodeHtmlEntities('8.4&#xa0;&#x842c;&#x6b21; &#xb7; 1,345')).toBe('8.4 萬次 · 1,345');
  });

  it('leaves anything it does not recognise alone instead of mangling it', () => {
    /* 查詢字串裡的 `&_nc_cat` 不是 entity，硬解會把網址改壞。 */
    expect(decodeHtmlEntities('?x=1&_nc_cat=101&notanentity;')).toBe(
      '?x=1&_nc_cat=101&notanentity;'
    );
    expect(decodeHtmlEntities('&#xZZZZ;')).toBe('&#xZZZZ;');
  });
});

describe('authorNameFromPageTitle', () => {
  it('strips the surface suffix Facebook appends', () => {
    expect(authorNameFromPageTitle('算命的說我很愛吃 on Reels')).toBe('算命的說我很愛吃');
    expect(authorNameFromPageTitle('算命的說我很愛吃 on Reels | Facebook')).toBe(
      '算命的說我很愛吃'
    );
    expect(authorNameFromPageTitle('Some Page on Facebook Watch')).toBe('Some Page');
  });

  it('keeps a plain name untouched', () => {
    expect(authorNameFromPageTitle('Facebook')).toBe('Facebook');
  });

  it('strips the "Reel by" prefix that share pages use', () => {
    /* 實測 /share/r/<code> 的 og:title 是 `38 萬次觀看 | Reel by 算命的說我很愛吃`。 */
    expect(authorNameFromPageTitle('Reel by 算命的說我很愛吃')).toBe('算命的說我很愛吃');
    expect(authorNameFromPageTitle('Video by Some Page')).toBe('Some Page');
  });

  it('returns null when there is nothing left, so the caller can look elsewhere', () => {
    /* 半截字串比 null 糟：呼叫端會以為拿到了作者名而不再往下找。 */
    expect(authorNameFromPageTitle(' on Reels')).toBeNull();
    expect(authorNameFromPageTitle('')).toBeNull();
    expect(authorNameFromPageTitle(null)).toBeNull();
  });
});

describe('authorNameFromOgTitle', () => {
  /*
   * og:title 的形狀依 surface 而異，這四種全部是 2026-09-20 實測到的原文。
   * 這裡是整個作者名解析的核心 —— 挑錯段落會讓 og:title 變成一大段貼文內容。
   */
  it('takes the segment after the last pipe on a reel page', () => {
    expect(authorNameFromOgTitle('8.4 萬次觀看 · 1,345 個心情 | 算命的說我很愛吃 on Reels')).toBe(
      '算命的說我很愛吃'
    );
  });

  it('handles the share page shape, which says "Reel by"', () => {
    expect(authorNameFromOgTitle('38 萬次觀看 | Reel by 算命的說我很愛吃')).toBe(
      '算命的說我很愛吃'
    );
  });

  it('takes the author from the end when the video has its own title', () => {
    /* 實測 fb.watch/lqvlrYbAdh：oEmbed 的 title 屬性與 og:title 都是
       「整段貼文內文 | 作者」，作者在最後。內文自己含 `|` 也不會解錯，
       因為 Facebook 一律把作者放在最後一段。 */
    expect(
      authorNameFromOgTitle('156 萬次觀看 · 8 萬個心情 | 算命阿姨 中西合壁 | 阿翰po影片')
    ).toBe('阿翰po影片');
    expect(authorNameFromOgTitle('標題裡有 | 管線符號 | 真正的作者')).toBe('真正的作者');
  });

  it('takes a plain post title whole, because that IS the author', () => {
    /* 一般貼文的 og:title 就是粉專名稱，沒有互動數也沒有分隔線。 */
    expect(authorNameFromOgTitle('野狼祭 Beastoria')).toBe('野狼祭 Beastoria');
    expect(authorNameFromOgTitle('Facebook')).toBe('Facebook');
  });

  it('returns null on nothing usable', () => {
    expect(authorNameFromOgTitle(null)).toBeNull();
    expect(authorNameFromOgTitle('   ')).toBeNull();
  });
});
