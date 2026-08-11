import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./acceptance/browser",
  timeout: 45_000,
  workers: 1,
  use: {
    headless: true,
    viewport: { width: 1280, height: 760 },
  },
  webServer: {
    command: "npm run build:acceptance-host && npx vite preview --outDir dist/acceptance-host --host 127.0.0.1 --port 4173",
    port: 4173,
    reuseExistingServer: false,
  },
});
