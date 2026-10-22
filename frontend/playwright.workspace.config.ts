import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  testMatch: 'workspace.spec.ts',
  outputDir: './test-results/workspace',
  fullyParallel: true,
  use: {
    baseURL: 'http://127.0.0.1:3129',
    viewport: { width: 1280, height: 800 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command:
      'pnpm exec tailwindcss -i src/app/globals.css -o tests/browser/.workspace.css --minify && bun tests/browser/workspace-server.ts',
    url: 'http://127.0.0.1:3129',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
