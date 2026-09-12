import { defineConfig } from 'playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: 'list',
  outputDir: 'test-results/t3-pc',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    browserName: 'chromium',
    channel: 'msedge',
    colorScheme: 'light',
    locale: 'zh-CN',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'pc-1280x720', use: { viewport: { width: 1280, height: 720 } } },
    { name: 'pc-1440x900', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'pc-1920x1080', use: { viewport: { width: 1920, height: 1080 } } },
  ],
  webServer: {
    command: 'scripts\\project-npm.cmd --workspace @pfc/web run dev',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: false,
    timeout: 30_000,
    env: { VITE_TEST_RUN_ID: 'T4_E2E' },
  },
});
