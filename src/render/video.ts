import i18next from 'i18next';
import { Constants } from '../constants';
import { Experiment, experimentCheck } from '../experiments';
import { handleQuote } from '../helpers/quote';
import { DataProvider } from '../enum';
import type { APITwitterStatus } from '../realms/api/schemas';
import { getBranding } from '../helpers/branding';
import { getGIFTranscodeDomain, shouldTranscodeGif } from '../helpers/giftranscode';
import { getVideoTranscodeDomain, getVideoTranscodeDomainBluesky } from '../helpers/transcode';
import { buildShortDirectMediaUrl } from '../helpers/directMedia';

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

  /* og:video 太長時 Telegram 只畫縮圖、不產生播放器 —— 細節與實測數據見
     helpers/directMedia.ts。 */
  const shortDirectMediaUrl = buildShortDirectMediaUrl(
    status.provider,
    status.url,
    properties.context.req.url,
    !all || all.length === 0 || all[0] === video
  );

  // Apply video redirect workaround for Discord/Telegram, but NOT for TikTok
  // TikTok videos need their own proxy with specific cookies/headers
  if (shortDirectMediaUrl) {
    url = shortDirectMediaUrl;
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
    ...(video.thumbnail_url
      ? [`<meta property="og:image" content="${video.thumbnail_url}"/>`]
      : []),
    `<meta property="twitter:image" content="0"/>`
  ];

  return instructions;
};
