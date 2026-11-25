import { cacheGet, fetchValidatedImage } from "@/lib/preview/images";
import { readImageToken } from "@/lib/preview/image-token";

export const maxDuration = 30;

/**
 * Serves images discovered by a preview check. Only URLs inside a valid,
 * server-issued token are fetched, and only bytes that decode as a known
 * raster format are returned — with a MIME type derived from the bytes, not
 * from the remote server's Content-Type.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/image/[token]">) {
  const { token } = await ctx.params;
  const url = readImageToken(token);
  if (!url) return new Response("Invalid or expired image token", { status: 404, headers: { "cache-control": "no-store" } });

  const image = cacheGet(url) ?? (await fetchValidatedImage(url));
  if ("ok" in image) {
    return new Response(image.message, {
      status: image.code === "http_error" ? 502 : 422,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }

  return new Response(new Uint8Array(image.body), {
    status: 200,
    headers: {
      "content-type": image.mime,
      "content-length": String(image.body.length),
      "cache-control": "private, max-age=600",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      "content-disposition": "inline",
      "cross-origin-resource-policy": "same-origin",
    },
  });
}
