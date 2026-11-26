/**
 * Mobile screenshot engine, shared by the standalone capture worker and the
 * in-process capture used on serverless hosts (Vercel).
 *
 * Isolation per capture:
 *   - a fresh browser context (no cookies, storage, cache or permissions),
 *   - all traffic forced through a per-capture egress proxy that only connects
 *     to public IPs (checked at connection time), plus request routing that
 *     aborts non-http(s) and obviously private URLs before they leave,
 *   - WebSockets, service workers, downloads, popups and WebRTC disabled,
 *   - hard limits on time, requests, bytes, page height and concurrency.
 *
 * The caller supplies a "host": which browser engines it can launch and how.
 */
import { devices } from "playwright-core";
import type { Browser, BrowserContext } from "playwright-core";
import { DEMO_HOST, demoResponse } from "../demo/site.ts";
import { checkUrl } from "../net/ip-policy.ts";
import type { CaptureInfo } from "../preview/types.ts";
import { startEgressProxy } from "./egress-proxy.ts";
import { CAPTURE_PRESETS } from "./presets.ts";
import type { CapturePreset } from "./presets.ts";

type Engine = CapturePreset["engine"];

const JOB_TIMEOUT_MS = 30_000;
const NAV_TIMEOUT_MS = 15_000;
const MAX_PAGE_HEIGHT = 5_000; // CSS px
const MAX_BYTES = 30 * 1024 * 1024;
const MAX_REQUESTS = 400;

export class CaptureError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 422) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export interface CaptureHost {
  /** Engines this host can launch. */
  engines: readonly Engine[];
  /** Returns a (shared, long-lived) browser for the engine. */
  getBrowser(engine: Engine): Promise<Browser>;
  maxConcurrent: number;
  maxQueue: number;
  /** Retry a WebKit certificate failure once in Chromium (Playwright's Windows WebKit can't verify many certificates). */
  retryTlsInChromium?: boolean;
  /** Playwright's Windows WebKit build doesn't support isMobile. */
  webkitWithoutIsMobile?: boolean;
}

export interface CaptureResult {
  image: Buffer;
  info: CaptureInfo;
}

export function createCapturer(host: CaptureHost) {
  let running = 0;
  const queue: Array<() => void> = [];

  async function slot(): Promise<() => void> {
    if (running >= host.maxConcurrent) {
      if (queue.length >= host.maxQueue) throw new CaptureError("busy", "The capture worker is busy. Try again shortly.", 429);
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    running++;
    return () => {
      running--;
      queue.shift()?.();
    };
  }

  async function run(rawUrl: string, preset: CapturePreset, engine: Engine, engineNote?: string): Promise<CaptureResult> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new CaptureError("invalid_url", "That doesn't look like a valid URL.");
    }
    if (url.hostname !== DEMO_HOST) {
      const verdict = checkUrl(url);
      if (!verdict.allowed) throw new CaptureError("blocked_destination", `Blocked destination: ${verdict.reason}.`);
    }

    const release = await slot();
    const started = Date.now();
    const proxy = await startEgressProxy({ maxBytes: MAX_BYTES, maxRequests: MAX_REQUESTS });
    let context: BrowserContext | undefined;
    let timer: NodeJS.Timeout | undefined;
    try {
      const browser = await host.getBrowser(engine);
      const descriptor: Record<string, unknown> = { ...devices[preset.device] };
      delete descriptor.defaultBrowserType;
      if (engine === "webkit" && host.webkitWithoutIsMobile) delete descriptor.isMobile;
      context = await browser.newContext({
        ...descriptor,
        proxy: { server: `http://127.0.0.1:${proxy.port}`, bypass: engine === "chromium" ? "<-loopback>" : undefined },
        serviceWorkers: "block",
        acceptDownloads: false,
        javaScriptEnabled: true,
        permissions: [],
        locale: "en-US",
        timezoneId: "UTC",
      });
      const ctx = context;

      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new CaptureError("timeout", "The page took too long to capture.", 504));
          ctx.close().catch(() => {});
        }, JOB_TIMEOUT_MS);
      });

      let blockedRequests = 0;
      await ctx.route("**/*", async (route) => {
        const reqUrl = route.request().url();
        let u: URL;
        try {
          u = new URL(reqUrl);
        } catch {
          return route.abort("blockedbyclient");
        }
        if (u.hostname === DEMO_HOST) {
          const res = demoResponse(u);
          return route.fulfill({ status: res.status, headers: res.headers, body: res.body });
        }
        if (u.protocol === "data:" || u.protocol === "blob:") return route.continue();
        // Defense in depth: drop non-public targets (localhost, literal private
        // IPs, odd ports, non-http schemes) before they reach the proxy, since
        // some engines bypass proxies for loopback.
        const verdict = checkUrl(u);
        if (!verdict.allowed) {
          blockedRequests++;
          return route.abort("blockedbyclient");
        }
        return route.continue();
      });
      await ctx.routeWebSocket(/.*/, (ws) => ws.close({ code: 1008, reason: "WebSockets are disabled in captures" }));
      await ctx.addInitScript(() => {
        // Remove WebRTC so pages can't open peer connections around the proxy.
        for (const k of ["RTCPeerConnection", "webkitRTCPeerConnection", "RTCDataChannel"]) {
          try {
            Object.defineProperty(window, k, { value: undefined, configurable: false });
          } catch {}
        }
      });
      const page = await ctx.newPage();
      page.on("dialog", (d) => d.dismiss().catch(() => {}));
      page.on("popup", (p) => p.close().catch(() => {}));

      const work = (async () => {
        let navError: unknown;
        let response;
        try {
          response = await page.goto(url.href, { waitUntil: "load", timeout: NAV_TIMEOUT_MS });
        } catch (err) {
          navError = err;
        }
        const mainBlocked = () => {
          const current = page.url() === "about:blank" ? url.href : page.url();
          const hostname = new URL(current).hostname;
          return proxy.stats.blockedHosts.has(hostname) || proxy.stats.blockedHosts.has(url.hostname);
        };
        if (response?.headers()["x-lps-blocked"] || mainBlocked()) {
          throw new CaptureError("blocked_destination", "The page (or a redirect) resolves to a private or reserved address.");
        }
        if (navError) {
          // A slow subresource shouldn't sink the capture if the document rendered.
          const hasDoc = await page.evaluate(() => !!document.body && document.body.childElementCount > 0).catch(() => false);
          if (!hasDoc) {
            const msg = String((navError as Error).message || "");
            if (/ERR_BLOCKED_BY_CLIENT|blocked/i.test(msg)) {
              throw new CaptureError("blocked_destination", "The page (or a redirect) pointed at a blocked destination.");
            }
            if (/Timeout/i.test(msg)) throw new CaptureError("timeout", "The page took too long to load.", 504);
            if (/certificate|SSL|CERT_/i.test(msg)) {
              throw new CaptureError("tls_error", "The browser rejected the site's HTTPS certificate.");
            }
            throw new CaptureError("navigation_failed", "The browser couldn't load the page.");
          }
        }
        await page.waitForLoadState("networkidle", { timeout: 2_500 }).catch(() => {});
        await page.waitForTimeout(300);

        const finalUrl = page.url();
        const final = new URL(finalUrl);
        if (final.hostname !== DEMO_HOST && !checkUrl(final).allowed) {
          throw new CaptureError("blocked_destination", "The page redirected to a blocked destination.");
        }

        const fullHeight = await page.evaluate(() =>
          Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0),
        );
        const height = Math.min(Math.max(fullHeight, preset.viewport.height), MAX_PAGE_HEIGHT);
        const image = await page.screenshot({
          type: "jpeg",
          quality: 80,
          fullPage: true,
          clip: { x: 0, y: 0, width: preset.viewport.width, height },
          timeout: 10_000,
        });
        const info: CaptureInfo = {
          preset: preset.id,
          device: preset.label,
          engine: engine === "webkit" ? "WebKit" : "Chromium",
          engineNote,
          engineVersion: browser.version(),
          viewport: preset.viewport,
          deviceScaleFactor: preset.deviceScaleFactor,
          fullHeight,
          clipped: fullHeight > MAX_PAGE_HEIGHT,
          finalUrl,
          durationMs: Date.now() - started,
          blockedRequests: blockedRequests + proxy.stats.blocked,
        };
        return { image, info };
      })();

      return await Promise.race([work, timeout]);
    } finally {
      clearTimeout(timer);
      await context?.close().catch(() => {});
      await proxy.close();
      release();
    }
  }

  /** Capture with the preset's own engine when the host has it, otherwise Chromium with the same viewport, DPR and UA. */
  async function capture(rawUrl: string, presetId: CapturePreset["id"]): Promise<CaptureResult> {
    const preset = CAPTURE_PRESETS[presetId];
    if (!host.engines.includes(preset.engine)) {
      return run(rawUrl, preset, "chromium", `${preset.engineLabel} isn't available on this host, so this capture used Chromium with the ${preset.label} viewport, pixel ratio and user agent.`);
    }
    try {
      return await run(rawUrl, preset, preset.engine);
    } catch (err) {
      if (preset.engine === "webkit" && host.retryTlsInChromium && host.engines.includes("chromium") && err instanceof CaptureError && err.code === "tls_error") {
        return run(rawUrl, preset, "chromium", "WebKit on Windows couldn't verify this site's certificate, so this capture used Chromium with the iPhone viewport and user agent.");
      }
      throw err;
    }
  }

  return { capture, stats: () => ({ running, queued: queue.length }) };
}

/** Maps anything thrown by a capture to a CaptureError the API can report. */
export function toCaptureError(err: unknown): CaptureError {
  if (err instanceof CaptureError) return err;
  return new CaptureError(/Target.*closed|has been closed/i.test(String(err)) ? "timeout" : "internal", "The capture failed.", 500);
}
