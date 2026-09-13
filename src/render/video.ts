import i18next from 'i18next';
import { Constants } from '../constants';
import { Experiment, experimentCheck } from '../experiments';
import { handleQuote } from '../helpers/quote';
import { DataProvider } from '../enum';
import type { APITwitterStatus } from '../realms/api/schemas';
import { getBranding } from '../helpers/branding';
import { getGIFTranscodeDomain, shouldTranscodeGif } from '../helpers/giftranscode';
import { getVideoTranscodeDomain, getVideoTranscodeDomainBluesky } from '../helpers/transcode';

export const renderVideo = (
  properties: RenderProperties,
  video: APIVideo
): ResponseInstructions => {
  const { status, userAgent, text } = properties;
  const instructions: ResponseInstructions = { addHeaders: [] };

  const all = status.media?.all as APIMedia[];

  /* This fix is specific to Discord not wanting to render videos that are too large,
      or rendering low quality videos too small.
      
      Basically, our solution is to cut the dimensions in half if the video is too big (> 1080p),
      or double them if it's too small. (<400p)
      
      We check both height and width so we can apply this to both horizontal and vertical videos equally*/

  let sizeMultiplier = 1;

  if (video.width > 1920 || video.height > 1920) {
    sizeMultiplier = 0.5;
  }
  if (video.width < 400 && video.height < 400) {
    sizeMultiplier = 2;
  }

  /* Like photos when picking a specific one (not using mosaic),
      we'll put an indicator if there are more than one video */
  if (all && all.length > 1 && (userAgent?.indexOf('TelegramBot') ?? 0) > -1) {
    const baseString =
      all.length === status.media?.videos?.length
        ? i18next.t('videoCount')
        : i18next.t('mediaCount');
    const videoCounter = baseString.format({
      number: String(all.indexOf(video) + 1),
      total: String(all.length)
    });

    instructions.siteName = `${getBranding(properties.context).name} - ${videoCounter}`;
  }

  if (status.provider === 'twitter') {
    instructions.authorText = (status as APITwitterStatus).translation?.text || text || '';
  } else {
    instructions.authorText = text || '';
  }

  if ((instructions.authorText ?? '').length < 40 && status.quote) {
    const q = handleQuote(status.quote);
    if (q) instructions.authorText += `\n${q}`;
  }

  let url = video.url;

  if (
    status.provider !== DataProvider.Bluesky &&
    shouldTranscodeGif(properties.context) &&
    video.type === 'gif'
  ) {
    url = video.url.replace(
      Constants.TWITTER_VIDEO_BASE,
      `https://${getGIFTranscodeDomain(status.id)}`
    );
    console.log('We passed checks for transcoding GIFs, feeding embed url', url);
  }

  // console.log('status', status);
  console.log('provider', status.provider);

  /* Instagram 的 CDN 網址帶 13 個簽章參數，光是它本身就 1000 字元以上；包進
     /2/go?url=… 之後 og:video 會超過 1150 字元，而 Telegram 對這樣的貼文只畫縮圖、
     不產生播放器（實測：同一則 reel 在上游 67instagram.com 也一樣，但 X 的影片
     ——網址約 130 字元、無簽章——正常播放）。其他可能原因都已排除：meta 格式、
     302 中轉本身、影片編碼（H.264 + faststart）、檔案大小、網址時效、來源 IP 限制。

     所以改成指向我們自己的 direct-media 路徑：meta 裡只放短路徑，客戶端真的來抓時
     才即時解析並 302 到 CDN。代價是抓取時多一次上游往返（貼文資料有 Cache API 擋著）。

     只在這支影片是貼文的第一個媒體時才這樣做 —— Instagram realm 沒有
     /videos/<n> 這種指定第幾個媒體的路由，carousel 的第二支影片會被解析成第一支。 */
  const instagramDirectMediaUrl = (() => {
    if (status.provider !== DataProvider.Instagram) {
      return null;
    }
    if (all && all.length > 0 && all[0] !== video) {
      return null;
    }
    try {
      const source = new URL(status.url);
      const selfHost = new URL(properties.context.req.url).host;
      const path = source.pathname.replace(/\/+$/, '');
      if (!path) {
        return null;
      }
      return `https://${selfHost}/${source.host}${path}.mp4`;
    } catch (_e) {
      return null;
    }
  })();

  // Apply video redirect workaround for Discord/Telegram, but NOT for TikTok
  // TikTok videos need their own proxy with specific cookies/headers
  if (instagramDirectMediaUrl) {
    url = instagramDirectMediaUrl;
  } else if (
    experimentCheck(Experiment.KITCHENSINK_VIDEO, userAgent?.includes('TelegramBot')) &&
    status.provider !== DataProvider.TikTok
  ) {
    const domain =
      status.provider === DataProvider.Twitter
        ? getVideoTranscodeDomain(status.id)
        : getVideoTranscodeDomainBluesky(status.id);
    url = `https://${domain}${new URL(url).pathname}`;
  } else if (
    experimentCheck(Experiment.VIDEO_REDIRECT_WORKAROUND, Constants.GO_REDIRECT_HOST !== '') &&
    (userAgent?.includes('Discordbot') || userAgent?.includes('TelegramBot')) &&
    status.provider !== DataProvider.TikTok
  ) {
    url = `https://${Constants.GO_REDIRECT_HOST}/2/go?url=${encodeURIComponent(url)}`;
  }

  /* og:video:type 是 Telegram / Discord 用來決定要不要內嵌播放器的依據。
     provider 沒填 format 時（例如 Instagram）原本會直接把字串 "undefined" 寫進 meta，
     客戶端就當成未知格式而不播。社群平台的影片實際上都是 mp4（實測 Instagram 的
     scontent.cdninstagram.com 回 Content-Type: video/mp4），所以退一步給 mp4。 */
  const videoFormat = video.format || 'video/mp4';

  /* Push the raw video-related headers */
  instructions.addHeaders = [
    `<meta property="twitter:player:height" content="${video.height * sizeMultiplier}"/>`,
    `<meta property="twitter:player:width" content="${video.width * sizeMultiplier}"/>`,
    `<meta property="twitter:player:stream" content="${url}"/>`,
    `<meta property="twitter:player:stream:content_type" content="${videoFormat}"/>`,
    `<meta property="og:video" content="${url}"/>`,
    `<meta property="og:video:secure_url" content="${url}"/>`,
    `<meta property="og:video:height" content="${video.height * sizeMultiplier}"/>`,
    `<meta property="og:video:width" content="${video.width * sizeMultiplier}"/>`,
    `<meta property="og:video:type" content="${videoFormat}"/>`,
    `<meta property="og:image" content="${video.thumbnail_url}"/>`,
    `<meta property="twitter:image" content="0"/>`
  ];

  return instructions;
};
