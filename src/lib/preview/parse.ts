import * as cheerio from "cheerio";
import type { IconLink, MetaTag, OgImage, PageMetadata } from "./types.ts";

/** Pick a text decoder from the Content-Type header or an early <meta charset>. */
export function decodeHtml(body: Buffer, contentType?: string): string {
  let charset = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType || "")?.[1];
  if (!charset) {
    const head = body.subarray(0, 2048).toString("latin1");
    charset =
      /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1] ??
      undefined;
  }
  // UTF-8 BOM wins over everything.
  if (body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) charset = "utf-8";
  try {
    return new TextDecoder(charset || "utf-8", { fatal: false }).decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

function clean(value: string | undefined | null): string | undefined {
  if (value == null) return undefined;
  const v = value.replace(/\s+/g, " ").trim();
  return v.length ? v : undefined;
}

function resolve(href: string | undefined, base: string): string | undefined {
  if (!href) return undefined;
  try {
    const url = new URL(href.trim(), base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

function toInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function largestSize(sizes?: string): number {
  if (!sizes) return 0;
  if (/any/i.test(sizes)) return 10_000;
  return Math.max(0, ...sizes.split(/\s+/).map((s) => Number.parseInt(s, 10) || 0));
}

/**
 * Parse share metadata from server-rendered HTML.
 * @param pageUrl the final URL the HTML was fetched from.
 */
export function parseMetadata(html: string, pageUrl: string): PageMetadata {
  const $ = cheerio.load(html);

  // <base href> changes how relative URLs resolve; only the first one counts.
  const rawBase = $("base[href]").first().attr("href");
  const base = resolve(rawBase, pageUrl) ?? pageUrl;

  const tags: MetaTag[] = [];
  $("meta").each((_, el) => {
    const $el = $(el);
    const property = $el.attr("property");
    const name = $el.attr("name");
    const key = (property || name || "").trim().toLowerCase();
    const content = $el.attr("content");
    if (!key || content == null) return;
    tags.push({
      key,
      value: content.trim(),
      attr: property ? "property" : "name",
      index: tags.length,
    });
  });

  const first = (key: string) => clean(tags.find((t) => t.key === key)?.value);

  // og:image entries in document order; structured fields attach to the
  // most recent og:image (per the Open Graph spec's array rules).
  const images: OgImage[] = [];
  const orphanImageFields: string[] = [];
  for (const tag of tags) {
    if (!tag.key.startsWith("og:image")) continue;
    const field = tag.key === "og:image" ? "url" : tag.key.slice("og:image:".length);
    if (tag.key !== "og:image" && !tag.key.startsWith("og:image:")) continue;
    if (field === "url") {
      const url = resolve(tag.value, base);
      if (!tag.value) continue;
      // `og:image:url` right after `og:image` with the same value is a duplicate, not a new image.
      const last = images[images.length - 1];
      if (tag.key === "og:image:url" && last && last.rawUrl === tag.value) continue;
      images.push({ url: url ?? tag.value, rawUrl: tag.value, position: images.length });
      continue;
    }
    const current = images[images.length - 1];
    if (!current) {
      orphanImageFields.push(tag.key);
      continue;
    }
    switch (field) {
      case "secure_url":
        current.secureUrl = resolve(tag.value, base);
        break;
      case "type":
        current.type = clean(tag.value);
        break;
      case "width":
        current.width = toInt(tag.value);
        break;
      case "height":
        current.height = toInt(tag.value);
        break;
      case "alt":
        current.alt = clean(tag.value);
        break;
    }
  }

  const icons: IconLink[] = [];
  $("link[rel][href]").each((_, el) => {
    const $el = $(el);
    const rel = ($el.attr("rel") || "").toLowerCase().trim();
    if (!/\bicon\b|apple-touch-icon/.test(rel)) return;
    const href = resolve($el.attr("href"), base);
    if (!href) return;
    icons.push({ rel, href, sizes: clean($el.attr("sizes")), type: clean($el.attr("type")) });
  });

  const touch = icons
    .filter((i) => i.rel.includes("apple-touch-icon"))
    .sort((a, b) => largestSize(b.sizes) - largestSize(a.sizes))[0];
  const favicon = icons
    .filter((i) => /(^|\s)icon(\s|$)|shortcut icon/.test(i.rel) && !i.rel.includes("apple"))
    .sort((a, b) => largestSize(b.sizes) - largestSize(a.sizes))[0];

  const twitterImageRaw = first("twitter:image") ?? first("twitter:image:src");

  return {
    title: clean($("head title").first().text()) ?? clean($("title").first().text()),
    description: first("description"),
    canonical: resolve($('link[rel~="canonical"]').first().attr("href"), base),
    lang: clean($("html").attr("lang")),
    themeColor: first("theme-color"),
    hasViewport: tags.some((t) => t.key === "viewport"),
    robots: first("robots")?.toLowerCase(),
    fbAppId: first("fb:app_id"),
    fediverseCreator: first("fediverse:creator"),
    favicon: favicon?.href,
    appleTouchIcon: touch?.href,
    icons,
    og: {
      title: first("og:title"),
      description: first("og:description"),
      siteName: first("og:site_name"),
      url: resolve(first("og:url"), base) ?? first("og:url"),
      type: first("og:type"),
      locale: first("og:locale"),
      images,
    },
    twitter: {
      card: first("twitter:card")?.toLowerCase(),
      title: first("twitter:title"),
      description: first("twitter:description"),
      image: resolve(twitterImageRaw, base) ?? twitterImageRaw,
      imageRaw: twitterImageRaw,
      imageAlt: first("twitter:image:alt"),
      site: first("twitter:site"),
      creator: first("twitter:creator"),
      labels: [1, 2].flatMap((n) => {
        const label = first(`twitter:label${n}`);
        const data = first(`twitter:data${n}`);
        return label && data ? [{ label, data }] : [];
      }),
    },
    tags,
    orphanImageFields,
    baseHref: rawBase ? base : undefined,
  };
}
