import { imageSize } from "image-size";
import { FetchError, formatBytes, safeFetch } from "../net/safe-fetch.ts";
import type { DestinationPolicy } from "../net/safe-fetch.ts";
import { createImageToken } from "./image-token.ts";
import type { ImageCheck } from "./types.ts";

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TIMEOUT_MS = 8_000;

/** Formats the image endpoint will serve, with their canonical MIME types. */
export const SERVABLE_FORMATS: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  cur: "image/x-icon",
};

export interface ValidatedImage {
  url: string;
  body: Buffer;
  format: string;
  mime: string;
  width: number;
  height: number;
}

// Short-lived cache so the image endpoint can usually reuse the bytes the
// preview check just validated instead of fetching them a second time.
const CACHE_TTL_MS = 2 * 60 * 1000;
const CACHE_MAX_BYTES = 48 * 1024 * 1024;
const cache = new Map<string, { at: number; image: ValidatedImage }>();
let cacheBytes = 0;

function cachePut(image: ValidatedImage) {
  const old = cache.get(image.url);
  if (old) {
    cacheBytes -= old.image.body.length;
    cache.delete(image.url);
  }
  cache.set(image.url, { at: Date.now(), image });
  cacheBytes += image.body.length;
  for (const [k, v] of cache) {
    if (cacheBytes <= CACHE_MAX_BYTES && Date.now() - v.at < CACHE_TTL_MS) break;
    cache.delete(k);
    cacheBytes -= v.image.body.length;
  }
}

export function cacheGet(url: string): ValidatedImage | undefined {
  const hit = cache.get(url);
  if (!hit) return undefined;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(url);
    cacheBytes -= hit.image.body.length;
    return undefined;
  }
  return hit.image;
}

export type ImageFailure = Extract<ImageCheck, { ok: false }>;

/** Fetch an image URL and confirm the bytes are a real, servable image. */
export async function fetchValidatedImage(
  url: string,
  opts: { policy?: DestinationPolicy; signal?: AbortSignal } = {},
): Promise<ValidatedImage | ImageFailure> {
  let res;
  try {
    res = await safeFetch(url, {
      accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8",
      maxBytes: MAX_IMAGE_BYTES,
      timeoutMs: IMAGE_TIMEOUT_MS,
      policy: opts.policy,
      signal: opts.signal,
    });
  } catch (err) {
    const e = err instanceof FetchError ? err : new FetchError("connection_failed", "Could not load the image.");
    const code =
      e.code === "blocked_destination"
        ? "blocked_destination"
        : e.code === "too_large"
          ? "too_large"
          : e.code === "timeout"
            ? "timeout"
            : e.code === "invalid_url"
              ? "invalid_url"
              : "network";
    const message =
      code === "too_large"
        ? `The image is larger than ${formatBytes(MAX_IMAGE_BYTES)}, so this tool stopped downloading it.`
        : code === "blocked_destination"
          ? `This tool refused to load the image: ${e.message.replace(/^Blocked destination: /, "")}`
          : code === "timeout"
            ? "The image took too long to load in this tool."
            : e.message;
    return { ok: false, url, code, message };
  }

  if (res.status < 200 || res.status >= 300) {
    return {
      ok: false,
      url,
      code: "http_error",
      status: res.status,
      message: `The image returned HTTP ${res.status} to this tool.`,
    };
  }

  let size;
  try {
    size = imageSize(new Uint8Array(res.body));
  } catch {
    const ct = res.headers["content-type"] || "unknown type";
    return { ok: false, url, code: "not_image", message: `The image URL returned ${ct}, not a recognizable image.` };
  }
  const format = String(size.type || "");
  const mime = SERVABLE_FORMATS[format];
  if (!mime || !size.width || !size.height) {
    return {
      ok: false,
      url,
      code: "unsupported_format",
      message:
        format === "svg"
          ? "The image is an SVG. Most link-preview crawlers ignore SVG share images; use PNG or JPEG."
          : `The image format (${format || "unknown"}) is not supported for previews.`,
    };
  }
  // ICO files can contain several sizes; report the largest.
  let { width, height } = size;
  if (size.images?.length) {
    for (const img of size.images) {
      if (img.width * img.height > width * height) {
        width = img.width;
        height = img.height;
      }
    }
  }
  const image: ValidatedImage = { url: res.url, body: res.body, format, mime, width, height };
  cachePut(image);
  if (res.url !== url) cachePut({ ...image, url });
  return image;
}

export async function checkImage(
  url: string,
  opts: { policy?: DestinationPolicy; signal?: AbortSignal } = {},
): Promise<ImageCheck> {
  const result = await fetchValidatedImage(url, opts);
  if ("ok" in result) return result;
  return {
    ok: true,
    url,
    proxy: createImageToken(url),
    width: result.width,
    height: result.height,
    format: result.format,
    bytes: result.body.length,
    contentType: result.mime,
  };
}
