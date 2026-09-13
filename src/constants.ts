export const Constants = {
  /* Populated from process.env (.env under Bun/Node, or each key inlined by esbuild for Workers). */
  STANDARD_DOMAIN_LIST: (process.env.STANDARD_DOMAIN_LIST ?? '')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean),
  STANDARD_BSKY_DOMAIN_LIST: (process.env.STANDARD_BSKY_DOMAIN_LIST ?? '')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean),
  STANDARD_TIKTOK_DOMAIN_LIST: (process.env.STANDARD_TIKTOK_DOMAIN_LIST ?? '')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean),
  STANDARD_INSTAGRAM_DOMAIN_LIST: (process.env.STANDARD_INSTAGRAM_DOMAIN_LIST ?? '')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean),
  DIRECT_MEDIA_DOMAINS: (process.env.DIRECT_MEDIA_DOMAINS ?? '')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean),
  TEXT_ONLY_DOMAINS: (process.env.TEXT_ONLY_DOMAINS ?? '')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean),
  INSTANT_VIEW_DOMAINS: (process.env.INSTANT_VIEW_DOMAINS ?? '')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean),
  GALLERY_DOMAINS: (process.env.GALLERY_DOMAINS ?? '')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean),
  FORCE_MOSAIC_DOMAINS: (process.env.FORCE_MOSAIC_DOMAINS ?? '')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean),
  OLD_EMBED_DOMAINS: (process.env.OLD_EMBED_DOMAINS ?? '')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean),
  MOSAIC_DOMAIN_LIST: (process.env.MOSAIC_DOMAIN_LIST ?? '')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean),
  MOSAIC_BSKY_DOMAIN_LIST: (process.env.MOSAIC_BSKY_DOMAIN_LIST ?? '')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean),
  POLYGLOT_DOMAIN_LIST: (process.env.POLYGLOT_DOMAIN_LIST ?? '')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean),
  POLYGLOT_ACCESS_TOKEN: process.env.POLYGLOT_ACCESS_TOKEN ?? '',
  /* og:video 與 Telegram Instant View 外部連結的 302 中轉 host（/2/go、/2/hit）。
     上游是直接取 API_HOST_LIST[0]，但那個變數同時決定 realm 與 flags.api：
     主網域一旦放進 API_HOST_LIST，貼文請求就會改回 JSON 而不是 OG HTML
     （src/realms/twitter/routes/status.ts）。所以中轉 host 獨立成一個變數，
     API_HOST_LIST 維持留空。設成空字串即停用中轉，og:video 直接指向上游 mp4。 */
  GO_REDIRECT_HOST: (process.env.GO_REDIRECT_HOST ?? '').trim(),
  API_HOST_LIST: (process.env.API_HOST_LIST ?? '')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean),
  API_HOST_ROOT: (() => {
    const h = (process.env.API_HOST_LIST ?? '')
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean)[0];
    return h ? `https://${h}` : '';
  })(),
  BLUESKY_API_HOST_LIST: (process.env.BLUESKY_API_HOST_LIST ?? '')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean),
  BLUESKY_API_HOST_ROOT: (() => {
    const h = (process.env.BLUESKY_API_HOST_LIST ?? '')
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean)[0];
    return h ? `https://${h}` : '';
  })(),
  ATMOSPHERE_API_HOST_LIST: (process.env.ATMOSPHERE_API_HOST_LIST ?? '')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean),
  ATMOSPHERE_API_HOST_ROOT: (() => {
    const h = (process.env.ATMOSPHERE_API_HOST_LIST ?? '')
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean)[0];
    return h ? `https://${h}` : '';
  })(),
  RELEASE_NAME: process.env.RELEASE_NAME || 'local',
  GIF_TRANSCODE_DOMAIN_LIST: (process.env.GIF_TRANSCODE_DOMAIN_LIST ?? '')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean),
  VIDEO_TRANSCODE_DOMAIN_LIST: (process.env.VIDEO_TRANSCODE_DOMAIN_LIST ?? '')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean),
  VIDEO_TRANSCODE_BSKY_DOMAIN_LIST: (process.env.VIDEO_TRANSCODE_BSKY_DOMAIN_LIST ?? '')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean),
  PBS_PROXY_DOMAIN_LIST: (process.env.PBS_PROXY_DOMAIN_LIST ?? '')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean),
  API_DOCS_URL: `https://github.com/FxEmbed/FxEmbed/wiki/API-Home`,
  TWITTER_ROOT: process.env.TWITTER_ROOT || 'https://x.com',
  HORIZON_WEB_ROOT: 'https://app.fxtwitter.com',
  TWITTER_API_ROOT: 'https://api.x.com',
  TWITTER_VIDEO_BASE: 'https://video.twimg.com',
  BLUESKY_ROOT: 'https://bsky.app',
  BLUESKY_VIDEO_BASE: 'https://video.bsky.app',
  BLUESKY_API_ROOT: 'https://public.api.bsky.app',
  TIKTOK_ROOT: 'https://www.tiktok.com',
  TIKTOK_API_HOST: 'https://api16-normal-c-useast1a.tiktokv.com',
  INSTAGRAM_ROOT: process.env.INSTAGRAM_ROOT || 'https://www.instagram.com',
  INSTAGRAM_API_ROOT: process.env.INSTAGRAM_API_ROOT || 'https://i.instagram.com',
  NATIVE_MULTI_IMAGE_UA_REGEX: /discordbot\/|matrixpreviewbot/gi,
  BOT_UA_REGEX:
    /bot|facebook|embed|got|firefox\/92|firefox\/38|chrome\/96\.0\.4664\.110|curl|wget|go-http|yahoo|generator|whatsapp|revoltchat|preview|link|proxy|vkshare|images|analyzer|index|crawl|spider|python|node|deno|mastodon|http\.rb|ruby|bun\/|fiddler|iframely|steamchaturllookup|bluesky|matrix-media-repo|cardyb|resolver|util|feedly|rss|reader|atom|thunderbird|axios/gi,
  /* 3 hours */
  GUEST_TOKEN_MAX_AGE: 3 * 60 * 60,
  GUEST_BEARER_TOKEN: `Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA`,
  GUEST_FETCH_PARAMETERS: [
    'cards_platform=Web-12',
    'include_cards=1',
    'include_ext_alt_text=true',
    'include_ext_views=true',
    'include_quote_count=true',
    'include_reply_count=1',
    'tweet_mode=extended',
    'include_entities=true',
    'include_ext_media_color=true',
    'include_ext_media_availability=true',
    'include_ext_sensitive_media_warning=true',
    'include_ext_has_birdwatch_notes=true',
    'simple_quoted_tweet=true',
    'ext=mediaStats%2ChighlightedLabel'
  ].join('&'),
  BASE_HEADERS: {
    'DNT': `1`,
    'x-twitter-client-language': `en`,
    'sec-ch-ua-mobile': `?0`,
    'content-type': `application/json`,
    'cache-control': `no-cache`,
    'x-twitter-active-user': `yes`,
    'sec-ch-ua-platform': `"Windows"`,
    'Accept': `*/*`,
    'Origin': `https://x.com`,
    'Sec-Fetch-Site': `same-site`,
    'Sec-Fetch-Mode': `cors`,
    'Sec-Fetch-Dest': `empty`,
    'Sec-Gpc': `1`,
    'Permissions-Policy': `browsing-topics=()`,
    'Pragma': `no-cache`,
    'Referer': `https://x.com/home`,
    'Accept-Encoding': `gzip, deflate, br, zstd`,
    'Accept-Language': `en`
  },
  RESPONSE_HEADERS: {
    'allow': 'OPTIONS, GET, PURGE, HEAD',
    'content-type': 'text/html;charset=UTF-8',
    'x-powered-by': `${process.env.RELEASE_NAME || 'local'}`,
    'x-trans-rights': 'true',
    'Vary': 'Accept-Encoding, User-Agent'
  },
  API_RESPONSE_HEADERS: {
    'access-control-allow-origin': '*',
    'content-type': 'application/json'
  },
  POLL_TWEET_CACHE: 'max-age=60',
  DEFAULT_COLOR: '#10A3FF',
  FRIENDLY_USER_AGENT: `Mozilla/5.0 FxEmbedBot/2.0 (like Twitterbot; +https://fxembed.com/crawler)`
};
