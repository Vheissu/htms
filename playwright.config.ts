import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  webServer: {
    command:
      'npm run demo:build && npx ts-node scripts/serve-demos.ts --port 5174',
    url: 'http://127.0.0.1:5174/demos/',
    timeout: 60_000,
  },
  use: {
    headless: true,
    baseURL: 'http://127.0.0.1:5174',
  },
});
