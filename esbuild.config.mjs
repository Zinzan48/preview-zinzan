import { sentryEsbuildPlugin } from '@sentry/esbuild-plugin';
import { config } from 'dotenv';
import { execSync } from 'child_process';
import * as esbuild from 'esbuild';

import fs from 'fs';

config();

// check if no-sentry-upload command line argument is set
const noSentryUpload = process.argv.includes('--no-sentry-upload');

// check if we're in wrangler dev mode (wrangler sets WRANGLER_COMMAND=dev)
const isWranglerDev = process.env.WRANGLER_COMMAND === 'dev';

const gitCommit = execSync('git rev-parse --short HEAD').toString().trim();
const gitUrl = execSync('git remote get-url origin').toString().trim();
const gitBranch = execSync('git rev-parse --abbrev-ref HEAD')
  .toString()
  .trim()
  .replace(/[\\\/]/g, '-');

let workerName = 'fixtweet';

// Get worker name from wrangler.toml

try {
  workerName = fs
    .readFileSync('wrangler.toml')
    .toString()
    .match(/name ?= ?"(.+?)"/)[1];
} catch (e) {
  console.error(`Error reading wrangler.toml to find worker name, using 'fixtweet' instead.`);
}

const releaseName = `${workerName}-${gitBranch}-${gitCommit}-${new Date()
  .toISOString()
  .substring(0, 19)}`;

let envVariables = [
  'STANDARD_DOMAIN_LIST',
  'STANDARD_BSKY_DOMAIN_LIST',
  'STANDARD_TIKTOK_DOMAIN_LIST',
  'STANDARD_INSTAGRAM_DOMAIN_LIST',
  'DIRECT_MEDIA_DOMAINS',
  'TEXT_ONLY_DOMAINS',
  'INSTANT_VIEW_DOMAINS',
  'GALLERY_DOMAINS',
  'FORCE_MOSAIC_DOMAINS',
  'MOSAIC_DOMAIN_LIST',
  'MOSAIC_BSKY_DOMAIN_LIST',
  'POLYGLOT_DOMAIN_LIST',
  'POLYGLOT_ACCESS_TOKEN',
  'API_HOST_LIST',
  'GO_REDIRECT_HOST',
  'BLUESKY_API_HOST_LIST',
  'ATMOSPHERE_API_HOST_LIST',
  'SENTRY_DSN',
  'GIF_TRANSCODE_DOMAIN_LIST',
  'VIDEO_TRANSCODE_DOMAIN_LIST',
  'VIDEO_TRANSCODE_BSKY_DOMAIN_LIST',
  'PBS_PROXY_DOMAIN_LIST',
  'OLD_EMBED_DOMAINS',
  'TWITTER_ROOT',
  'THREADS_ROOT',
  'FACEBOOK_ROOT',
  'INSTAGRAM_ROOT',
  'INSTAGRAM_API_ROOT'
];

// Inline process.env.* so Workers bundles stay static; Bun/Node read real process.env at runtime.
let defines = {};
for (let envVar of envVariables) {
  defines[`process.env.${envVar}`] = JSON.stringify(process.env[envVar] ?? '');
}

defines['process.env.RELEASE_NAME'] = JSON.stringify(releaseName);

try {
  const raw = fs.readFileSync('credentials.enc.json', 'utf-8');
  let enc;
  try {
    enc = JSON.parse(raw);
  } catch (parseErr) {
    const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
    throw new Error(`credentials.enc.json: invalid JSON (${msg})`);
  }
  if (
    enc == null ||
    typeof enc !== 'object' ||
    Array.isArray(enc) ||
    typeof enc.ciphertext !== 'string' ||
    typeof enc.iv !== 'string' ||
    enc.ciphertext.length === 0 ||
    enc.iv.length === 0
  ) {
    throw new Error(
      'credentials.enc.json: expected object with non-empty string ciphertext and iv'
    );
  }
  defines['process.env.ENCRYPTED_CREDENTIALS'] = JSON.stringify(enc.ciphertext);
  defines['process.env.CREDENTIALS_IV'] = JSON.stringify(enc.iv);
} catch (err) {
  if (err && typeof err === 'object' && err.code === 'ENOENT') {
    /* 沒有 credentials.enc.json 時改讀環境變數。
       上游的 CI 是在 build 前從 R2 把這個檔拉下來；我們用 Cloudflare Workers Builds，
       它從 git clone 原始碼來 build，而這個檔在 .gitignore 裡（而且這是 public repo，
       就算是密文也不該進版控），所以改用 build secret 傳。
       這裡收的是**已加密**的 ciphertext / iv，解密金鑰 CREDENTIAL_KEY 是 Worker 的
       runtime secret，刻意不放進 build 環境 —— 兩者同時進 bundle 等於白加密。 */
    const envCiphertext = (process.env.ENCRYPTED_CREDENTIALS ?? '').trim();
    const envIv = (process.env.CREDENTIALS_IV ?? '').trim();

    if (envCiphertext && envIv) {
      console.log(
        'No credentials.enc.json; using ENCRYPTED_CREDENTIALS / CREDENTIALS_IV from the environment.'
      );
      defines['process.env.ENCRYPTED_CREDENTIALS'] = JSON.stringify(envCiphertext);
      defines['process.env.CREDENTIALS_IV'] = JSON.stringify(envIv);
    } else {
      if (envCiphertext || envIv) {
        /* 只設一半是最容易犯又最難查的錯：bundle 會帶著半套憑證，
           runtime 解密必定失敗，但外觀跟「完全沒設憑證」一模一樣。 */
        console.warn(
          'Only one of ENCRYPTED_CREDENTIALS / CREDENTIALS_IV is set; both are required. Ignoring both.'
        );
      }
      console.warn(
        'No credentials.enc.json found; encrypted credential bundle will be empty (local: npm run credentials:encrypt, CI: set ENCRYPTED_CREDENTIALS + CREDENTIALS_IV, or fetch from R2 before build).'
      );
      defines['process.env.ENCRYPTED_CREDENTIALS'] = JSON.stringify('');
      defines['process.env.CREDENTIALS_IV'] = JSON.stringify('');
    }
  } else {
    throw err;
  }
}

const plugins = [];

if (process.env.SENTRY_DSN && !noSentryUpload && !isWranglerDev && !workerName.includes('canary')) {
  plugins.push(
    sentryEsbuildPlugin({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,

      telemetry: false,

      release: {
        name: releaseName,
        create: true,
        vcsRemote: gitUrl,
        setCommits: {
          auto: true,
          ignoreMissing: true
        }
      },

      // Auth tokens can be obtained from
      // https://sentry.io/orgredirect/organizations/:orgslug/settings/auth-tokens/
      authToken: process.env.SENTRY_AUTH_TOKEN
    })
  );
}

// if branding.json doesn't exist, copy branding.example.json to branding.json, we need this for CI tests
if (!fs.existsSync('branding.json')) {
  fs.copyFileSync('branding.example.json', 'branding.json');
}

await esbuild.build({
  entryPoints: ['src/worker.ts'],
  sourcemap: 'external',
  outdir: 'dist',
  minify: true,
  bundle: true,
  format: 'esm',
  plugins: plugins,
  define: defines
});
