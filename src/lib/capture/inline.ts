/**
 * In-process mobile capture for serverless hosts such as Vercel, where no
 * separate worker process exists. It runs a Chromium build made for serverless
 * (@sparticuz/chromium) through Playwright, behind the same per-capture egress
 * proxy and limits as the local worker (see engine.ts).
 *
 * WebKit can't run here, so the iPhone preset is emulated in Chromium with the
 * same viewport, pixel ratio and user agent, and the result says so.
 */
import type { Browser } from "playwright-core";
import { createCapturer } from "./engine.ts";

// Flags from @sparticuz/chromium that loosen the browser's web security. A capture of
// a public page doesn't need them, so they are dropped; the Lambda-specific ones stay.
const DROPPED_FLAGS = new Set(["--disable-web-security", "--allow-running-insecure-content", "--disable-site-isolation-trials"]);

let browser: Promise<Browser> | undefined;

async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = (async () => {
      const [{ chromium: playwright }, { default: serverless }] = await Promise.all([import("playwright-core"), import("@sparticuz/chromium")]);
      serverless.setGraphicsMode = false; // no WebGL needed for a screenshot; faster, smaller cold start
      const b = await playwright.launch({
        executablePath: await serverless.executablePath(),
        args: [
          ...serverless.args.filter((a) => !DROPPED_FLAGS.has(a)),
          "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
          "--disable-features=WebRtcHideLocalIpsWithMdns",
        ],
        headless: true,
      });
      b.on("disconnected", () => {
        browser = undefined;
      });
      return b;
    })();
    browser.catch(() => {
      browser = undefined;
    });
  }
  return browser;
}

export const inlineCapturer = createCapturer({
  engines: ["chromium"],
  getBrowser: () => getBrowser(),
  // One browser per function instance, kept small: Chromium is memory-hungry.
  maxConcurrent: 1,
  maxQueue: 2,
});
