/**
 * Link Preview Studio — mobile capture worker.
 *
 * A separate Node process that takes real screenshots with Playwright.
 *   npm run worker            (listens on 127.0.0.1:4410)
 *
 * Isolation per capture:
 *   - a fresh browser context (no cookies, storage, cache or permissions),
 *   - all traffic forced through a per-capture egress proxy that only connects
 *     to public IPs (checked at connection time), plus request routing that
 *     aborts non-http(s) and obviously private URLs before they leave,
 *   - WebSockets, service workers, downloads, popups and WebRTC disabled,
 *   - hard limits on time, requests, bytes, page height and concurrency.
 */
import http from "node:http";
import { chromium, devices, webkit } from "playwright";
import type { Browser, BrowserContext, BrowserType } from "playwright";
import { CAPTURE_PRESETS, isPresetId } from "../src/lib/capture/presets.ts";
import type { CapturePreset } from "../src/lib/capture/presets.ts";
import { DEMO_HOST, demoResponse } from "../src/lib/demo/site.ts";
import { checkUrl } from "../src/lib/net/ip-policy.ts";
import { startEgressProxy } from "./egress-proxy.ts";

const PORT = Number(process.env.CAPTURE_WORKER_PORT || 4410);
const HOST = process.env.CAPTURE_WORKER_HOST || "127.0.0.1";
const TOKEN = process.env.CAPTURE_WORKER_TOKEN || "";
const MAX_CONCURRENT = Number(process.env.CAPTURE_MAX_CONCURRENT || 2);
const MAX_QUEUE = 4;
const JOB_TIMEOUT_MS = 30_000;
const NAV_TIMEOUT_MS = 15_000;
const MAX_PAGE_HEIGHT = 5_000; // CSS px
const MAX_BYTES = 30 * 1024 * 1024;
const MAX_REQUESTS = 400;

class CaptureError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 422) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// --- browsers --------------------------------------------------------------

const engines: Record<CapturePreset["engine"], BrowserType> = { chromium, webkit };
const browsers = new Map<string, Promise<Browser>>();

function getBrowser(engine: CapturePreset["engine"]): Promise<Browser> {
  let p = browsers.get(engine);
  if (!p) {
    const args =
      engine === "chromium"
        ? ["--force-webrtc-ip-handling-policy=disable_non_proxied_udp", "--disable-features=WebRtcHideLocalIpsWithMdns"]
        : [];
    p = engines[engine].launch({ headless: true, args }).then((b) => {
      b.on("disconnected", () => browsers.delete(engine));
      return b;
    });
    p.catch(() => browsers.delete(engine));
    browsers.set(engine, p);
  }
  return p;
}

// --- concurrency -----------------------------------------------------------

let running = 0;
const queue: Array<() => void> = [];
async function slot(): Promise<() => void> {
  if (running >= MAX_CONCURRENT) {
    if (queue.length >= MAX_QUEUE) throw new CaptureError("busy", "The capture worker is busy. Try again shortly.", 429);
    await new Promise<void>((resolve) => queue.push(resolve));
  }
  running++;
  return () => {
    running--;
    queue.shift()?.();
  };
}

// --- capture ---------------------------------------------------------------

async function capture(rawUrl: string, preset: CapturePreset, engine: CapturePreset["engine"] = preset.engine, engineNote?: string) {
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
    const browser = await getBrowser(engine);
    const descriptor = { ...devices[preset.device] };
    if (engine === "webkit" && process.platform === "win32") {
      // Playwright's WebKit build for Windows doesn't support isMobile;
      // the viewport, DPR, touch and UA are still emulated.
      delete (descriptor as { isMobile?: boolean }).isMobile;
    }
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
        const host = new URL(page.url() === "about:blank" ? url.href : page.url()).hostname;
        return proxy.stats.blockedHosts.has(host) || proxy.stats.blockedHosts.has(url.hostname);
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
      return {
        image,
        info: {
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
        },
      };
    })();

    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
    await context?.close().catch(() => {});
    await proxy.close();
    release();
  }
}

// --- HTTP API --------------------------------------------------------------

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16 * 1024) throw new CaptureError("invalid_request", "Request too large.", 413);
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

const server = http.createServer(async (req, res) => {
  if (TOKEN && req.headers["x-capture-token"] !== TOKEN) return sendJson(res, 401, { code: "unauthorized" });
  if (req.method === "GET" && req.url === "/health") {
    return sendJson(res, 200, { ok: true, presets: Object.keys(CAPTURE_PRESETS), running, queued: queue.length });
  }
  if (req.method !== "POST" || req.url !== "/capture") return sendJson(res, 404, { code: "not_found" });

  try {
    const body = (await readJson(req)) as { url?: unknown; preset?: unknown };
    if (typeof body.url !== "string" || !isPresetId(body.preset)) {
      throw new CaptureError("invalid_request", "Expected { url, preset }.", 400);
    }
    const preset = CAPTURE_PRESETS[body.preset];
    let result;
    try {
      result = await capture(body.url, preset);
    } catch (err) {
      // Playwright's WebKit build for Windows can't verify many public HTTPS
      // certificates. Retry once in Chromium with the same iPhone viewport,
      // DPR and user agent, and say so in the result instead of hiding it.
      if (preset.engine === "webkit" && process.platform === "win32" && err instanceof CaptureError && err.code === "tls_error") {
        result = await capture(body.url, preset, "chromium", "WebKit on Windows couldn't verify this site's certificate, so this capture used Chromium with the iPhone viewport and user agent.");
      } else throw err;
    }
    const { image, info } = result;
    res.writeHead(200, {
      "content-type": "image/jpeg",
      "content-length": image.length,
      "cache-control": "no-store",
      "x-capture-info": encodeURIComponent(JSON.stringify(info)),
    });
    res.end(image);
    // Routine log line: outcome and timing only, never the URL.
    console.log(`[capture] ok preset=${info.preset} ${info.durationMs}ms ${Math.round(image.length / 1024)}KB`);
  } catch (err) {
    const e =
      err instanceof CaptureError
        ? err
        : new CaptureError(/Target.*closed|has been closed/i.test(String(err)) ? "timeout" : "internal", "The capture failed.", 500);
    console.log(`[capture] failed code=${e.code}`);
    sendJson(res, e.status, { code: e.code, message: e.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[capture] worker listening on http://${HOST}:${PORT} (max ${MAX_CONCURRENT} concurrent)`);
});

const shutdown = async () => {
  server.close();
  for (const p of browsers.values()) await p.then((b) => b.close()).catch(() => {});
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
