import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test',
  testMatch: 'smoke.spec.mjs',
  use: { headless: true },
});
