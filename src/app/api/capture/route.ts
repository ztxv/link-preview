import { isPresetId } from "@/lib/capture/presets";
import { DEMO_HOST } from "@/lib/demo/site-info";
import { checkUrl } from "@/lib/net/ip-policy";
import { normalizeInput } from "@/lib/preview/normalize";

// Chromium start-up plus a page load can take a while on a cold serverless instance.
export const maxDuration = 60;

/**
 * Mobile capture has three modes:
 *   - worker: proxy to the Playwright worker (CAPTURE_WORKER_URL, default http://127.0.0.1:4410)
 *   - inline: on Vercel with no worker URL, run a serverless Chromium inside this function
 *   - off:    CAPTURE_WORKER_URL=off; the UI shows capture as unavailable
 */
type Mode = { kind: "worker"; base: string } | { kind: "inline" } | { kind: "off" };

function captureMode(): Mode {
  const v = process.env.CAPTURE_WORKER_URL?.trim();
  if (v === "off" || v === "disabled") return { kind: "off" };
  if (!v && process.env.VERCEL) return { kind: "inline" };
  return { kind: "worker", base: (v || "http://127.0.0.1:4410").replace(/\/$/, "") };
}

function workerHeaders(): Record<string, string> {
  const token = process.env.CAPTURE_WORKER_TOKEN;
  return token ? { "x-capture-token": token } : {};
}

const UNAVAILABLE = {
  ok: false,
  code: "capture_unavailable",
  message: "Mobile capture isn't available in this deployment. The share cards still work; use “Open original” to check the page on a real phone.",
};

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function GET() {
  const mode = captureMode();
  if (mode.kind === "off") return json({ available: false }, 200);
  if (mode.kind === "inline") return json({ available: true, engines: ["chromium"] }, 200);
  try {
    const res = await fetch(`${mode.base}/health`, { headers: workerHeaders(), signal: AbortSignal.timeout(1500), cache: "no-store" });
    const health = res.ok ? await res.json().catch(() => ({})) : {};
    return json({ available: res.ok, engines: health.engines ?? ["webkit", "chromium"] }, 200);
  } catch {
    return json({ available: false }, 200);
  }
}

export async function POST(request: Request) {
  let body: { url?: unknown; preset?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, code: "invalid_request", message: "Expected { url, preset }." }, 400);
  }
  if (typeof body.url !== "string" || !isPresetId(body.preset)) {
    return json({ ok: false, code: "invalid_request", message: "Expected { url, preset }." }, 400);
  }
  const normalized = normalizeInput(body.url);
  if (!normalized.ok) return json({ ok: false, code: "invalid_url", message: normalized.message }, 400);
  const target = new URL(normalized.url);
  if (target.hostname !== DEMO_HOST) {
    const verdict = checkUrl(target);
    if (!verdict.allowed) {
      return json({ ok: false, code: "blocked_destination", message: `Blocked destination: ${verdict.reason}.` }, 422);
    }
  }

  const mode = captureMode();
  if (mode.kind === "off") return json(UNAVAILABLE, 503);
  if (mode.kind === "inline") return captureInline(normalized.url, body.preset);
  const base = mode.base;

  let res: Response;
  try {
    res = await fetch(`${base}/capture`, {
      method: "POST",
      headers: { "content-type": "application/json", ...workerHeaders() },
      body: JSON.stringify({ url: normalized.url, preset: body.preset }),
      signal: AbortSignal.any([AbortSignal.timeout(70_000), request.signal]),
      cache: "no-store",
    });
  } catch (err) {
    const timedOut = (err as Error)?.name === "TimeoutError";
    return json(
      timedOut
        ? { ok: false, code: "timeout", message: "The capture took too long." }
        : UNAVAILABLE,
      timedOut ? 504 : 503,
    );
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return json({ ok: false, code: err.code ?? "capture_failed", message: err.message ?? "The capture failed." }, res.status);
  }

  return new Response(res.body, {
    status: 200,
    headers: {
      "content-type": "image/jpeg",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-capture-info": res.headers.get("x-capture-info") ?? "",
    },
  });
}

async function captureInline(url: string, preset: "iphone" | "android") {
  try {
    const { inlineCapturer } = await import("@/lib/capture/inline");
    const { image, info } = await inlineCapturer.capture(url, preset);
    console.log(`[capture] ok preset=${info.preset} ${info.durationMs}ms ${Math.round(image.length / 1024)}KB`);
    return new Response(new Uint8Array(image), {
      status: 200,
      headers: {
        "content-type": "image/jpeg",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "x-capture-info": encodeURIComponent(JSON.stringify(info)),
      },
    });
  } catch (err) {
    const { toCaptureError } = await import("@/lib/capture/engine");
    const e = toCaptureError(err);
    console.log(`[capture] failed code=${e.code}`);
    return json({ ok: false, code: e.code, message: e.message }, e.status);
  }
}
