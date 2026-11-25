import { buildPreview, previewError } from "@/lib/preview/build";

// A check can follow redirects and measure several images; give serverless hosts room for that.
export const maxDuration = 60;

// POST keeps the submitted URL in the request body, out of access logs.
export async function POST(request: Request) {
  let url: unknown;
  try {
    const body = await request.json();
    url = body?.url;
  } catch {
    return json(previewError("invalid_url", "Send JSON like { \"url\": \"https://example.com/page\" }."), 400);
  }
  if (typeof url !== "string" || url.length > 4096) {
    return json(previewError("invalid_url", "Enter a page URL (up to 4096 characters)."), 400);
  }

  try {
    const result = await buildPreview(url, { signal: request.signal });
    // Routine log: outcome only — never the URL.
    if (!result.ok) console.info(`[preview] failed code=${result.code}`);
    return json(result, 200);
  } catch {
    console.error("[preview] internal error");
    return json(previewError("internal", "Something went wrong while building the preview. Try again."), 500);
  }
}

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}
