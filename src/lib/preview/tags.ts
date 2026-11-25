import { X_LARGE_MIN } from "./cards.ts";
import type { ImageCheck, PageMetadata } from "./types.ts";

/** Escape a value for a double-quoted HTML attribute. */
export function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const PLACEHOLDER = "PLACEHOLDER";

/**
 * Generate Open Graph + Twitter Card markup from the values that are known.
 * Unknown required values become clearly marked placeholders.
 */
export function suggestTags(meta: PageMetadata, finalUrl: string, images: ImageCheck[]): string {
  const lines: string[] = [];
  const tag = (attr: "property" | "name", key: string, value: string, placeholder = false) => {
    if (placeholder) lines.push(`<!-- ${PLACEHOLDER}: replace the value below before publishing -->`);
    lines.push(`<meta ${attr}="${key}" content="${escapeAttr(value)}">`);
  };

  const title = meta.og.title ?? meta.twitter.title ?? meta.title;
  const description = meta.og.description ?? meta.twitter.description ?? meta.description;
  const url = meta.og.url ?? meta.canonical ?? finalUrl;
  const ogImage = meta.og.images[0];
  const imageUrl = ogImage?.url ?? meta.twitter.image;
  const imageCheck = imageUrl ? images.find((i) => i.url === imageUrl) : undefined;
  const measured = imageCheck?.ok ? imageCheck : undefined;

  lines.push(
    "<!-- Suggested share tags from Link Preview Studio.",
    "     Merge these into your page's existing <head>: replace tags you already",
    "     have instead of duplicating them, and fill in every PLACEHOLDER. -->",
  );

  // Google's snippet and WhatsApp/Mastodon fall back to the plain meta description.
  const metaDescription = meta.description ?? description;
  tag("name", "description", metaDescription ?? `${PLACEHOLDER} — a 1–2 sentence summary, under ~160 characters`, !metaDescription);
  tag("property", "og:type", meta.og.type ?? "website");
  tag("property", "og:url", url);
  tag("property", "og:title", title ?? `${PLACEHOLDER} — page title (under ~60 characters)`, !title);
  tag("property", "og:description", description ?? `${PLACEHOLDER} — one or two sentences describing this page`, !description);
  if (meta.og.siteName) tag("property", "og:site_name", meta.og.siteName);
  else tag("property", "og:site_name", `${PLACEHOLDER} — your site or brand name`, true);

  if (imageUrl) {
    if (imageCheck && !imageCheck.ok) {
      lines.push(`<!-- Check this image: ${imageCheck.message.replace(/--/g, "–")} -->`);
    }
    tag("property", "og:image", imageUrl);
    const type = measured?.contentType ?? ogImage?.type;
    if (type) tag("property", "og:image:type", type);
    const w = measured?.width ?? ogImage?.width;
    const h = measured?.height ?? ogImage?.height;
    if (w && h) {
      tag("property", "og:image:width", String(w));
      tag("property", "og:image:height", String(h));
    }
  } else {
    tag("property", "og:image", "https://PLACEHOLDER.example/share-image-1200x630.png", true);
    tag("property", "og:image:width", "1200");
    tag("property", "og:image:height", "630");
  }
  const alt = ogImage?.alt ?? meta.twitter.imageAlt;
  tag("property", "og:image:alt", alt ?? `${PLACEHOLDER} — describe the image`, !alt);

  const declared = meta.twitter.card;
  const supported = declared === "summary" || declared === "summary_large_image";
  const xImage = meta.twitter.image ?? imageUrl;
  const xCheck = xImage ? images.find((i) => i.url === xImage) : undefined;
  const large =
    !xCheck || !xCheck.ok || (xCheck.width >= X_LARGE_MIN.width && xCheck.height >= X_LARGE_MIN.height);
  tag("name", "twitter:card", supported ? declared! : large && xImage ? "summary_large_image" : "summary");
  // X falls back to og:title/og:description/og:image, so only repeat values
  // that are meant to differ on X.
  if (meta.twitter.title && meta.twitter.title !== title) tag("name", "twitter:title", meta.twitter.title);
  if (meta.twitter.description && meta.twitter.description !== description) {
    tag("name", "twitter:description", meta.twitter.description);
  }
  if (meta.twitter.image && meta.twitter.image !== imageUrl) tag("name", "twitter:image", meta.twitter.image);
  if (meta.twitter.imageAlt && meta.twitter.imageAlt !== alt) tag("name", "twitter:image:alt", meta.twitter.imageAlt);
  if (meta.twitter.site) tag("name", "twitter:site", meta.twitter.site);

  return lines.join("\n");
}
