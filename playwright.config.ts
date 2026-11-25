import { defineConfig } from "@playwright/test";

// End-to-end tests run against a production build (`npm run build`) plus the
// capture worker, on ports that don't clash with `npm run dev`.
const WEB_PORT = 3100;
const WORKER_PORT = 4411;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    browserName: "chromium",
    permissions: ["clipboard-read", "clipboard-write"],
    // The UI animates cards in and lifts them on hover; reduced motion turns that off
    // so bounding-box assertions don't race an animation.
    reducedMotion: "reduce",
  },
  webServer: [
    {
      command: "node worker/capture-worker.ts",
      url: `http://127.0.0.1:${WORKER_PORT}/health`,
      env: { CAPTURE_WORKER_PORT: String(WORKER_PORT) },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npx next start -p ${WEB_PORT} -H 127.0.0.1`,
      url: `http://127.0.0.1:${WEB_PORT}`,
      env: { CAPTURE_WORKER_URL: `http://127.0.0.1:${WORKER_PORT}` },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
