import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests/e2e', timeout: 60000, expect: { timeout: 12000 },
  fullyParallel: false, workers: 1,
  reporter: [['list'], ['json', { outputFile: 'artifacts/e2e-results.json' }]],
  use: { baseURL: process.env.WORKFLOW_BASE_URL ?? 'http://127.0.0.1:43127', channel: 'chrome',
    viewport: { width: 1600, height: 1000 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
})
