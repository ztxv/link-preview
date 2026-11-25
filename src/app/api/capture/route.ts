import { isPresetId } from "@/lib/capture/presets";
import { DEMO_HOST } from "@/lib/demo/site-info";
import { checkUrl } from "@/lib/net/ip-policy";
import { normalizeInput } from "@/lib/preview/normalize";

/**
 * Proxies mobile capture requests to the isolated Playwright worker.
 * CAPTURE_WORKER_URL defaults to the local worker; set it to "off" in
 * deployments without a worker and the UI shows capture as unavailable.
 * On Vercel there is no local worker, so capture is off unless a worker URL is set.
 */
function workerUrl(): string | null {
  const v = process.env.CAPTURE_WORKER_URL?.trim();
  if (v === "off" || v === "disabled") return null;
  if (!v && process.env.VERCEL) return null;
  return (v || "http://127.0.0.1:4410").replace(/\/$/, "");
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
  const base = workerUrl();
  if (!base) return json({ available: false }, 200);
  try {
    const res = await fetch(`${base}/health`, { headers: workerHeaders(), signal: AbortSignal.timeout(1500), cache: "no-store" });
    return json({ available: res.ok }, 200);
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

  const base = workerUrl();
  if (!base) return json(UNAVAILABLE, 503);

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
