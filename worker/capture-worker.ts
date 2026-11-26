/**
 * Link Preview Studio — mobile capture worker.
 *
 * A separate Node process that takes real screenshots with Playwright.
 *   npm run worker            (listens on 127.0.0.1:4410)
 *
 * The capture logic and its isolation rules live in src/lib/capture/engine.ts
 * (shared with the in-process capture used on Vercel); this file is the local
 * HTTP wrapper plus the WebKit/Chromium launchers.
 */
import http from "node:http";
import { chromium, webkit } from "playwright";
import type { Browser } from "playwright";
import { CaptureError, createCapturer, toCaptureError } from "../src/lib/capture/engine.ts";
import { CAPTURE_PRESETS, isPresetId } from "../src/lib/capture/presets.ts";

const PORT = Number(process.env.CAPTURE_WORKER_PORT || 4410);
const HOST = process.env.CAPTURE_WORKER_HOST || "127.0.0.1";
const TOKEN = process.env.CAPTURE_WORKER_TOKEN || "";
const MAX_CONCURRENT = Number(process.env.CAPTURE_MAX_CONCURRENT || 2);

// --- browsers --------------------------------------------------------------

const browsers = new Map<string, Promise<Browser>>();

function getBrowser(engine: "webkit" | "chromium"): Promise<Browser> {
  let p = browsers.get(engine);
  if (!p) {
    const launch =
      engine === "chromium"
        ? chromium.launch({
            headless: true,
            args: ["--force-webrtc-ip-handling-policy=disable_non_proxied_udp", "--disable-features=WebRtcHideLocalIpsWithMdns"],
          })
        : webkit.launch({ headless: true });
    p = launch.then((b) => {
      b.on("disconnected", () => browsers.delete(engine));
      return b;
    });
    p.catch(() => browsers.delete(engine));
    browsers.set(engine, p);
  }
  return p;
}

const capturer = createCapturer({
  engines: ["chromium", "webkit"],
  getBrowser: (engine) => getBrowser(engine),
  maxConcurrent: MAX_CONCURRENT,
  maxQueue: 4,
  retryTlsInChromium: process.platform === "win32",
  webkitWithoutIsMobile: process.platform === "win32",
});

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
    const { running, queued } = capturer.stats();
    return sendJson(res, 200, { ok: true, presets: Object.keys(CAPTURE_PRESETS), engines: ["webkit", "chromium"], running, queued });
  }
  if (req.method !== "POST" || req.url !== "/capture") return sendJson(res, 404, { code: "not_found" });

  try {
    const body = (await readJson(req)) as { url?: unknown; preset?: unknown };
    if (typeof body.url !== "string" || !isPresetId(body.preset)) {
      throw new CaptureError("invalid_request", "Expected { url, preset }.", 400);
    }
    const { image, info } = await capturer.capture(body.url, body.preset);
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
    const e = toCaptureError(err);
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
