import { defineConfig } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export default defineConfig({
  testDir: '.',
  testMatch: 'browser.spec.ts',
  outputDir: resolve(root, 'artifacts/reasoning-slider-browser'),
  workers: 1,
  reporter: [['list'], ['json', { outputFile: resolve(root, 'artifacts/reasoning-slider-browser-results.json') }]],
  use: {
    baseURL: `http://127.0.0.1:${process.env.REASONING_PREVIEW_PORT ?? 43133}`,
    channel: 'chrome', viewport: { width: 920, height: 720 },
    screenshot: 'only-on-failure',
  },
});
