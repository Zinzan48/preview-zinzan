import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { WORKER_TEST_PROCESS_ENV } from './test/helpers/env';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readCompatDateFromWrangler(configPath: string): string | null {
  try {
    const text = fs.readFileSync(configPath, 'utf8');
    const m = text.match(/^\s*compatibility_date\s*=\s*"([^"]+)"/m);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function resolveWranglerConfigPath(): string | undefined {
  for (const name of ['wrangler.toml', 'wrangler.jsonc', 'wrangler.json']) {
    const p = path.join(__dirname, name);
    if (fs.existsSync(p)) {
      return p;
    }
  }
  const example = path.join(__dirname, 'wrangler.example.toml');
  if (fs.existsSync(example)) {
    return example;
  }
  return undefined;
}

const wranglerConfigPath = resolveWranglerConfigPath();
const compatibilityDate =
  (wranglerConfigPath && readCompatDateFromWrangler(wranglerConfigPath)) ?? '2026-03-21';

export default defineConfig({
  plugins: [
    cloudflareTest({
      remoteBindings: false,
      // Use Miniflare options only (not `wrangler.configPath`): loading the full Wrangler project
      // changes isolate setup and can surface empty `process.env` for app code, breaking realm routing
      // (e.g. api.fxbsky.app must match BLUESKY_API_HOST_LIST, not the embed bluesky realm).
      miniflare: {
        compatibilityDate
      }
    })
  ],
  resolve: {
    alias: [
      {
        // 測試斷言的是上游 branding.example.json 的值（FxTwitter / FxInstagram /
        // github.com/FxEmbed/FxEmbed），但實際部署讀的是自架者自己的 branding.json。
        // 讓測試固定讀 example，測試套件才不會因為換了 branding 就變紅、失去回歸檢測的作用。
        find: /^.*branding\.json$/,
        replacement: path.join(__dirname, 'branding.example.json')
      }
    ]
  },
  // Vite SSR can replace `process.env` with `{}` unless this is set; pool Workers tests then see
  // empty env and mis-route hosts (e.g. API hits the embed realm → 302). See workers-sdk#8718.
  ssr: {
    keepProcessEnv: true
  },
  test: {
    include: ['test/*.ts'],
    globals: true,
    env: { ...WORKER_TEST_PROCESS_ENV },
    coverage: {
      include: ['src/**/*.{ts,js}']
    }
  }
});
