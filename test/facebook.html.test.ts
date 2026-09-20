import { describe, expect, it } from 'vitest';
import {
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

  it('returns null when there is nothing left, so the caller can look elsewhere', () => {
    /* 半截字串比 null 糟：呼叫端會以為拿到了作者名而不再往下找。 */
    expect(authorNameFromPageTitle(' on Reels')).toBeNull();
    expect(authorNameFromPageTitle('')).toBeNull();
    expect(authorNameFromPageTitle(null)).toBeNull();
  });
});
