/*
 * Facebook 的 `<head>` 把中文、`@`、`&` 全部寫成 HTML entity，而且**混用三種寫法**
 * （實測同一頁同時出現 `&#x842c;`、`&#064;`、`&amp;`）。取出來的字串要是給人看的
 * og:title / 作者名，所以一定得解碼。
 *
 * Threads 在這件事上踩過一次：`og:url` 裡的 `@` 實際是 `&#064;` 而不是 `&#64;`，
 * 只找 `'@'` 會讓整條路悄悄失效。所以十進位一律容許前導零。
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  middot: '·'
};

/** 解碼具名、十進位（含前導零）與十六進位 entity。其餘原樣保留。 */
export const decodeHtmlEntities = (input: string): string =>
  input.replace(/&(#[Xx][0-9A-Fa-f]+|#\d+|[A-Za-z][A-Za-z0-9]*);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const code = parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) {
        return whole;
      }
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });

/**
 * 從 `<title>` / oEmbed 的 `title` 屬性剝掉 Facebook 自己加的後綴，只留作者名。
 *
 * 實測形狀：`算命的說我很愛吃 on Reels`、`算命的說我很愛吃 on Reels | Facebook`、
 * `Facebook`。剝不出東西時回 null，讓呼叫端去找別的來源，而不是吐半截字串。
 */
export const authorNameFromPageTitle = (title: string | null): string | null => {
  if (!title) return null;
  const withoutSite = title.replace(/\s*\|\s*Facebook\s*$/i, '').trim();
  /* 前面要吃 `^` 而不只是 `\s+`：整個標題就是後綴（作者名為空）時也要剝乾淨，
     否則會回傳 `on Reels` 這種半截字串，呼叫端就不會再去找別的來源了。
     `Facebook Watch` 要排在 `Facebook` 前面才不會先配到短的那個。 */
  const withoutSurface = withoutSite
    .replace(/(^|\s+)on\s+(Facebook Watch|Reels|Facebook)\s*$/i, '')
    .trim();
  /* `Reel by <作者>` / `Video by <作者>` 是分享頁的形狀，前綴也要剝。 */
  return withoutSurface.replace(/^(Reel|Video|Post)\s+by\s+/i, '').trim() || null;
};

/**
 * 從 `og:title` 取作者名。**它的形狀依 surface 而異，全部都是實測**：
 *
 * | surface | og:title |
 * | --- | --- |
 * | reel 貼文頁 | `8.4 萬次觀看 · 1,345 個心情 \| 算命的說我很愛吃 on Reels` |
 * | reel 分享頁 | `38 萬次觀看 \| Reel by 算命的說我很愛吃` |
 * | 一般貼文 | `野狼祭 Beastoria` ← 本身就是作者名 |
 * | 粉專首頁 | `Facebook` ← 同上 |
 *
 * 所以規則是：有 `|` 就取**最後一段**（前半是互動數），沒有就整個拿，
 * 再剝掉 `on Reels` / `Reel by` 這類裝飾。
 *
 * 用 `<title>` 做不到這件事 —— 一般貼文的 `<title>` 是「作者 - 整篇內文」，
 * 直接拿會讓 og:title 變成一大段貼文內容。
 */
export const authorNameFromOgTitle = (ogTitle: string | null): string | null => {
  if (!ogTitle) return null;
  const separator = ogTitle.lastIndexOf('|');
  const tail = separator >= 0 ? ogTitle.slice(separator + 1) : ogTitle;
  return authorNameFromPageTitle(tail.trim());
};
