import { FetchError, safeFetch } from "../net/safe-fetch.ts";
import type { DestinationPolicy } from "../net/safe-fetch.ts";
import { buildCards } from "./cards.ts";
import { checkImage } from "./images.ts";
import { buildIssues } from "./issues.ts";
import { normalizeInput } from "./normalize.ts";
import { decodeHtml, parseMetadata } from "./parse.ts";
import { suggestTags } from "./tags.ts";
import type { ImageCheck, PreviewError, PreviewErrorCode, PreviewResponse } from "./types.ts";

export const MAX_HTML_BYTES = 3 * 1024 * 1024;
const PAGE_TIMEOUT_MS = 10_000;
const MAX_IMAGES_CHECKED = 6;

const ERROR_TITLES: Record<PreviewErrorCode, string> = {
  invalid_url: "That URL can't be checked",
  blocked_destination: "That address isn't allowed",
  dns_failed: "Site not found",
  timeout: "The site took too long",
  too_large: "The page is too large",
  too_many_redirects: "Too many redirects",
  connection_failed: "Couldn't connect",
  tls_error: "HTTPS certificate problem",
  busy: "Busy right now",
  blocked_page: "The site refused this tool",
  http_error: "The page returned an error",
  not_html: "That URL isn't a web page",
  internal: "Something went wrong",
};

const RETRYABLE: PreviewErrorCode[] = ["timeout", "connection_failed", "busy", "dns_failed", "http_error", "blocked_page", "internal"];

export function previewError(code: PreviewErrorCode, message: string, extra: Partial<PreviewError> = {}): PreviewError {
  return { ok: false, code, title: ERROR_TITLES[code], message, retryable: RETRYABLE.includes(code), ...extra };
}

export async function buildPreview(
  input: string,
  opts: { policy?: DestinationPolicy; signal?: AbortSignal } = {},
): Promise<PreviewResponse> {
  const normalized = normalizeInput(input);
  if (!normalized.ok) return previewError("invalid_url", normalized.message);
  const requestedUrl = normalized.url;

  let page;
  try {
    page = await safeFetch(requestedUrl, {
      timeoutMs: PAGE_TIMEOUT_MS,
      maxBytes: MAX_HTML_BYTES,
      truncate: true,
      policy: opts.policy,
      signal: opts.signal,
    });
  } catch (err) {
    if (err instanceof FetchError) {
      const message =
        err.code === "blocked_destination"
          ? `${err.message} This tool only checks public http(s) sites — not localhost, private networks, or reserved addresses.`
          : err.message;
      return previewError(err.code, message);
    }
    return previewError("internal", "An unexpected error occurred while fetching the page.");
  }

  const { status } = page;
  if (status === 401 || status === 403 || status === 429 || status === 451) {
    return previewError(
      "blocked_page",
      status === 429
        ? "The site is rate-limiting this tool (HTTP 429). Wait a minute and retry."
        : `The site answered HTTP ${status} to this tool. It may block automated requests or require a login. Platform crawlers may get a different answer.`,
      { status, finalUrl: page.url },
    );
  }
  if (status >= 400 || status < 200) {
    return previewError(
      "http_error",
      status === 404
        ? "The page returned HTTP 404 (not found). Platforms won't build a preview for a missing page."
        : `The page returned HTTP ${status}. Platforms usually skip previews for error pages.`,
      { status, finalUrl: page.url },
    );
  }

  const contentType = page.headers["content-type"];
  const looksHtml = /<(!doctype html|html|head|meta|title)[\s>]/i.test(page.body.subarray(0, 4096).toString("latin1"));
  if (contentType && !/html|xml/i.test(contentType) && !looksHtml) {
    return previewError("not_html", `The URL returned ${contentType.split(";")[0]}, not an HTML page.`, {
      status,
      finalUrl: page.url,
    });
  }

  const html = decodeHtml(page.body, contentType);
  const metadata = parseMetadata(html, page.url);

  // Image candidates, in priority order, de-duplicated.
  const candidates: string[] = [];
  const push = (u?: string) => {
    if (u && /^https?:\/\//i.test(u) && !candidates.includes(u)) candidates.push(u);
  };
  for (const img of metadata.og.images.slice(0, 4)) push(img.url);
  push(metadata.twitter.image);
  push(metadata.appleTouchIcon);
  push(metadata.favicon);
  if (!metadata.favicon) {
    // Browsers and most platforms try /favicon.ico when no icon is declared.
    const fallback = new URL("/favicon.ico", page.url).href;
    push(fallback);
  }

  const images: ImageCheck[] = await Promise.all(
    candidates.slice(0, MAX_IMAGES_CHECKED).map((url) => checkImage(url, { policy: opts.policy, signal: opts.signal })),
  );
  if (!metadata.favicon) {
    const ico = images.find((i) => i.url.endsWith("/favicon.ico"));
    if (ico?.ok) metadata.favicon = ico.url;
  }

  const cards = buildCards(metadata, page.url, images);
  const issues = buildIssues({ meta: metadata, cards, images, requestedUrl, finalUrl: page.url, truncated: page.truncated });

  return {
    ok: true,
    requestedUrl,
    finalUrl: page.url,
    redirected: page.redirects.length > 0,
    redirects: page.redirects,
    status,
    contentType,
    fetchedAt: new Date().toISOString(),
    truncated: page.truncated,
    bytes: page.body.length,
    metadata,
    images,
    cards,
    issues,
    suggestedTags: suggestTags(metadata, page.url, images),
  };
}
