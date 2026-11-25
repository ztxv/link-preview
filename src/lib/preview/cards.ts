/**
 * Field-selection and layout rules for the three simulated cards.
 *
 * These are ESTIMATES of each platform's behaviour based on public docs and
 * observed behaviour; the real apps change over time. See README.
 */
import { displayHost } from "./normalize.ts";
import type {
  CardImage,
  Cards,
  DiscordCard,
  FieldChoice,
  GoogleCard,
  ImageCheck,
  IMessageCard,
  LinkCard,
  MastodonCard,
  PageMetadata,
  Platform,
  SlackCard,
  XCard,
} from "./types.ts";

type Candidate = { source: string; value?: string };

function choose(candidates: Candidate[]): FieldChoice {
  const tried = candidates.map((c) => c.source);
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (c.value) return { value: c.value, source: c.source, fallback: i > 0, tried };
  }
  return { fallback: true, tried };
}

export type ImageLookup = (url: string) => ImageCheck | undefined;

function cardImage(url: string | undefined, source: string, fallback: boolean, lookup: ImageLookup): CardImage | undefined {
  if (!url) return undefined;
  return { url, source, fallback, check: lookup(url) };
}

const usable = (img?: CardImage) => !!img && img.check?.ok === true;
const dims = (img?: CardImage) => (img?.check?.ok ? img.check : undefined);

export const X_LARGE_MIN = { width: 300, height: 157 };

export function buildIMessage(meta: PageMetadata, finalUrl: string, lookup: ImageLookup): IMessageCard {
  const title = choose([
    { source: "og:title", value: meta.og.title },
    { source: "<title>", value: meta.title },
  ]);
  const og = meta.og.images[0];
  const image = cardImage(og?.url, "og:image", false, lookup);
  const icon =
    cardImage(meta.appleTouchIcon, "apple-touch-icon", false, lookup) ??
    cardImage(meta.favicon, "favicon", true, lookup);
  const d = dims(image);
  const domain = displayHost(finalUrl);
  // `image` is always the og:image candidate (so the inspector can report on
  // it); `layout` says what the bubble actually shows.
  if (d && d.width >= 200 && d.height >= 100) {
    return { platform: "imessage", layout: "rich", title, domain, image, icon: usable(icon) ? icon : undefined };
  }
  if (d && image) {
    // A small og:image is shown as the compact thumbnail instead of a hero.
    return { platform: "imessage", layout: "compact", title, domain, image, icon: image };
  }
  if (usable(icon)) return { platform: "imessage", layout: "compact", title, domain, image, icon };
  return { platform: "imessage", layout: "plain", title, domain, image };
}

export function buildDiscord(meta: PageMetadata, lookup: ImageLookup): DiscordCard {
  const siteName = choose([{ source: "og:site_name", value: meta.og.siteName }]);
  const title = choose([
    { source: "og:title", value: meta.og.title },
    { source: "twitter:title", value: meta.twitter.title },
    { source: "<title>", value: meta.title },
  ]);
  const description = choose([
    { source: "og:description", value: meta.og.description },
    { source: "twitter:description", value: meta.twitter.description },
    { source: "meta description", value: meta.description },
  ]);
  const og = meta.og.images[0];
  const image = og
    ? cardImage(og.url, "og:image", false, lookup)
    : cardImage(meta.twitter.image, "twitter:image", true, lookup);
  const imageLayout: DiscordCard["imageLayout"] = !usable(image)
    ? "none"
    : meta.twitter.card === "summary_large_image"
      ? "large"
      : "thumbnail";
  const color = meta.themeColor && /^#?[0-9a-f]{3,8}$|^rgb|^hsl|^[a-z]+$/i.test(meta.themeColor) ? meta.themeColor : undefined;
  return { platform: "discord", siteName, title, description, image, imageLayout, accentColor: color };
}

export function buildX(meta: PageMetadata, finalUrl: string, lookup: ImageLookup): XCard {
  const title = choose([
    { source: "twitter:title", value: meta.twitter.title },
    { source: "og:title", value: meta.og.title },
  ]);
  const description = choose([
    { source: "twitter:description", value: meta.twitter.description },
    { source: "og:description", value: meta.og.description },
  ]);
  const image = meta.twitter.image
    ? cardImage(meta.twitter.image, "twitter:image", false, lookup)
    : cardImage(meta.og.images[0]?.url, "og:image", true, lookup);

  const declared = meta.twitter.card;
  let cardType: XCard["cardType"];
  let estimated = false;
  if (declared === "summary" || declared === "summary_large_image") {
    cardType = declared;
  } else {
    estimated = true;
    const d = dims(image);
    cardType = d && d.width >= X_LARGE_MIN.width && d.height >= X_LARGE_MIN.height ? "summary_large_image" : "summary";
  }
  return {
    platform: "x",
    declaredCard: declared,
    cardType,
    estimated,
    title,
    description,
    image,
    domain: displayHost(finalUrl),
    site: meta.twitter.site,
  };
}

// --- The other link cards ---------------------------------------------------

/** Smallest og:image each platform is estimated to show as a large card. Below it: a thumbnail. */
export const LARGE_IMAGE_MIN = {
  slack: { width: 400, height: 200 },
  linkedin: { width: 400, height: 200 },
  whatsapp: { width: 300, height: 157 },
  facebook: { width: 600, height: 315 },
  telegram: { width: 300, height: 157 },
  reddit: { width: 600, height: 315 },
  bluesky: { width: 300, height: 157 },
  mastodon: { width: 400, height: 200 },
} as const;

/** Facebook ignores images smaller than this in either dimension. */
export const FACEBOOK_IMAGE_MIN = 200;
/** WhatsApp is reported to skip images much larger than this. */
export const WHATSAPP_IMAGE_BYTES = 300 * 1024;
export const GOOGLE_TITLE_CHARS = 60;
export const GOOGLE_DESCRIPTION_CHARS = 160;

type SimplePlatform = keyof typeof LARGE_IMAGE_MIN;

function layoutFor(platform: SimplePlatform, image?: CardImage): LinkCard<Platform>["imageLayout"] {
  const d = dims(image);
  if (!d) return "none";
  if (platform === "facebook" && (d.width < FACEBOOK_IMAGE_MIN || d.height < FACEBOOK_IMAGE_MIN)) return "none";
  const min = LARGE_IMAGE_MIN[platform];
  return d.width >= min.width && d.height >= min.height ? "large" : "thumbnail";
}

/** The first og:image, optionally falling back to twitter:image (flagged as a fallback). */
function shareImage(meta: PageMetadata, lookup: ImageLookup, twitterFallback: boolean): CardImage | undefined {
  const og = meta.og.images[0];
  if (og) return cardImage(og.url, "og:image", false, lookup);
  return twitterFallback ? cardImage(meta.twitter.image, "twitter:image", true, lookup) : undefined;
}

function siteIcon(meta: PageMetadata, lookup: ImageLookup): CardImage | undefined {
  return cardImage(meta.favicon, "favicon", false, lookup) ?? cardImage(meta.appleTouchIcon, "apple-touch-icon", true, lookup);
}

const ogTitle = (m: PageMetadata): Candidate[] => [
  { source: "og:title", value: m.og.title },
  { source: "<title>", value: m.title },
];
const ogTwitterTitle = (m: PageMetadata): Candidate[] => [
  { source: "og:title", value: m.og.title },
  { source: "twitter:title", value: m.twitter.title },
  { source: "<title>", value: m.title },
];
const ogDescription = (m: PageMetadata): Candidate[] => [
  { source: "og:description", value: m.og.description },
  { source: "meta description", value: m.description },
];
const ogTwitterDescription = (m: PageMetadata): Candidate[] => [
  { source: "og:description", value: m.og.description },
  { source: "twitter:description", value: m.twitter.description },
  { source: "meta description", value: m.description },
];

function linkCard<P extends SimplePlatform>(
  platform: P,
  meta: PageMetadata,
  finalUrl: string,
  lookup: ImageLookup,
  opts: { title: Candidate[]; description?: Candidate[]; twitterImage: boolean; favicon?: boolean },
): LinkCard<P> {
  const image = shareImage(meta, lookup, opts.twitterImage);
  return {
    platform,
    domain: displayHost(finalUrl),
    siteName: choose([{ source: "og:site_name", value: meta.og.siteName }]),
    title: choose(opts.title),
    description: opts.description ? choose(opts.description) : undefined,
    image,
    imageLayout: layoutFor(platform, image),
    favicon: opts.favicon ? siteIcon(meta, lookup) : undefined,
  };
}

export function buildSlack(meta: PageMetadata, finalUrl: string, lookup: ImageLookup): SlackCard {
  const base = linkCard("slack", meta, finalUrl, lookup, {
    title: ogTwitterTitle(meta),
    description: ogTwitterDescription(meta),
    twitterImage: true,
    favicon: true,
  });
  // twitter:card is honoured when present; otherwise the image size decides.
  let imageLayout = base.imageLayout;
  if (usable(base.image)) {
    if (meta.twitter.card === "summary_large_image") imageLayout = "large";
    else if (meta.twitter.card === "summary") imageLayout = "thumbnail";
  }
  return { ...base, imageLayout, fields: meta.twitter.labels };
}

export function buildLinkedIn(meta: PageMetadata, finalUrl: string, lookup: ImageLookup) {
  // LinkedIn reads Open Graph only, and its feed cards don't show the description.
  return linkCard("linkedin", meta, finalUrl, lookup, { title: ogTitle(meta), twitterImage: false });
}

export function buildWhatsApp(meta: PageMetadata, finalUrl: string, lookup: ImageLookup) {
  return linkCard("whatsapp", meta, finalUrl, lookup, {
    title: ogTitle(meta),
    description: ogDescription(meta),
    twitterImage: false,
  });
}

export function buildFacebook(meta: PageMetadata, finalUrl: string, lookup: ImageLookup) {
  return linkCard("facebook", meta, finalUrl, lookup, {
    title: ogTitle(meta),
    description: ogDescription(meta),
    twitterImage: false,
  });
}

export function buildTelegram(meta: PageMetadata, finalUrl: string, lookup: ImageLookup) {
  return linkCard("telegram", meta, finalUrl, lookup, {
    title: ogTwitterTitle(meta),
    description: ogTwitterDescription(meta),
    twitterImage: true,
  });
}

export function buildReddit(meta: PageMetadata, finalUrl: string, lookup: ImageLookup) {
  // Reddit link posts show the (editable) post title, suggested from the page; no description.
  return linkCard("reddit", meta, finalUrl, lookup, { title: ogTwitterTitle(meta), twitterImage: true });
}

export function buildBluesky(meta: PageMetadata, finalUrl: string, lookup: ImageLookup) {
  return linkCard("bluesky", meta, finalUrl, lookup, {
    title: ogTwitterTitle(meta),
    description: ogTwitterDescription(meta),
    twitterImage: true,
  });
}

export function buildMastodon(meta: PageMetadata, finalUrl: string, lookup: ImageLookup): MastodonCard {
  const base = linkCard("mastodon", meta, finalUrl, lookup, {
    title: ogTitle(meta),
    description: ogDescription(meta),
    twitterImage: true,
  });
  return { ...base, creator: meta.fediverseCreator };
}

export function buildGoogle(meta: PageMetadata, finalUrl: string, lookup: ImageLookup): GoogleCard {
  const title = choose([
    { source: "<title>", value: meta.title },
    { source: "og:title", value: meta.og.title },
  ]);
  const description = choose([
    { source: "meta description", value: meta.description },
    { source: "og:description", value: meta.og.description },
  ]);
  let displayUrl = displayHost(finalUrl);
  try {
    const segments = new URL(finalUrl).pathname.split("/").filter(Boolean).slice(0, 3);
    if (segments.length) displayUrl += ` › ${segments.map((s) => decodeURIComponent(s)).join(" › ")}`;
  } catch {
    // keep the bare host
  }
  const tokens = (meta.robots ?? "").split(/[\s,]+/);
  return {
    platform: "google",
    domain: displayHost(finalUrl),
    displayUrl,
    siteName: choose([{ source: "og:site_name", value: meta.og.siteName }]),
    title,
    description,
    favicon: siteIcon(meta, lookup),
    titleTruncated: (title.value?.length ?? 0) > GOOGLE_TITLE_CHARS,
    descriptionTruncated: (description.value?.length ?? 0) > GOOGLE_DESCRIPTION_CHARS,
    noindex: tokens.includes("noindex") || tokens.includes("none"),
  };
}

export function buildCards(meta: PageMetadata, finalUrl: string, images: ImageCheck[]): Cards {
  const byUrl = new Map(images.map((i) => [i.url, i]));
  const lookup: ImageLookup = (url) => byUrl.get(url);
  return {
    imessage: buildIMessage(meta, finalUrl, lookup),
    discord: buildDiscord(meta, lookup),
    x: buildX(meta, finalUrl, lookup),
    slack: buildSlack(meta, finalUrl, lookup),
    linkedin: buildLinkedIn(meta, finalUrl, lookup),
    whatsapp: buildWhatsApp(meta, finalUrl, lookup),
    facebook: buildFacebook(meta, finalUrl, lookup),
    telegram: buildTelegram(meta, finalUrl, lookup),
    reddit: buildReddit(meta, finalUrl, lookup),
    bluesky: buildBluesky(meta, finalUrl, lookup),
    mastodon: buildMastodon(meta, finalUrl, lookup),
    google: buildGoogle(meta, finalUrl, lookup),
  };
}
