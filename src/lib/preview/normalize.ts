// URL normalization shared by the client form and the server. No Node imports.

export type NormalizeResult = { ok: true; url: string } | { ok: false; message: string };

const OTHER_SCHEME = /^(javascript|data|file|mailto|ftp|about|blob|chrome|view-source|ws|wss|tel|sms):/i;

/**
 * Turn what the user typed into an absolute http(s) URL.
 * Bare hostnames get https://; path and query string are preserved exactly;
 * the #fragment is dropped because it is never sent to the server.
 */
export function normalizeInput(raw: string): NormalizeResult {
  let text = raw.trim();
  if (!text) return { ok: false, message: "Enter a page URL to preview." };
  if (/\s/.test(text)) return { ok: false, message: "URLs can't contain spaces." };

  if (OTHER_SCHEME.test(text) || (/^[a-z][a-z0-9+.-]*:\/\//i.test(text) && !/^https?:\/\//i.test(text))) {
    return { ok: false, message: "Only http:// and https:// pages can be previewed." };
  }
  if (text.startsWith("//")) text = `https:${text}`;
  else if (!/^https?:\/\//i.test(text)) text = `https://${text}`;

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, message: "That doesn't look like a valid URL." };
  }
  if (!url.hostname) return { ok: false, message: "That URL is missing a hostname." };
  url.hash = "";
  return { ok: true, url: url.href };
}

export function displayHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
