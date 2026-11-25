import {
  FACEBOOK_IMAGE_MIN,
  GOOGLE_DESCRIPTION_CHARS,
  GOOGLE_TITLE_CHARS,
  LARGE_IMAGE_MIN,
  WHATSAPP_IMAGE_BYTES,
  X_LARGE_MIN,
} from "./cards.ts";
import type { Cards, FieldChoice, ImageCheck, Issue, PageMetadata, Platform } from "./types.ts";

export const PLATFORM_NAME: Record<Platform, string> = {
  imessage: "iMessage",
  discord: "Discord",
  x: "X",
  slack: "Slack",
  linkedin: "LinkedIn",
  whatsapp: "WhatsApp",
  facebook: "Facebook",
  telegram: "Telegram",
  reddit: "Reddit",
  bluesky: "Bluesky",
  mastodon: "Mastodon",
  google: "Google",
};

/** Cards that share the generic title / description / image rules; their issues are reported together. */
const LINK_PLATFORMS = ["slack", "linkedin", "whatsapp", "facebook", "telegram", "reddit", "bluesky", "mastodon"] as const;

const list = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

const SOURCE_LABEL: Record<string, string> = {
  "<title>": "the page title",
  "meta description": "the meta description",
};

const sourceLabel = (s: string) => SOURCE_LABEL[s] ?? `\`${s}\``;

function fieldIssue(platform: Platform, field: string, choice: FieldChoice, critical: boolean): Issue | null {
  const name = PLATFORM_NAME[platform];
  const preferred = choice.tried[0];
  if (!choice.value) {
    const list = choice.tried.map((t) => sourceLabel(t)).join(", ");
    return {
      id: `${platform}-${field}-missing`,
      severity: critical ? "error" : "warning",
      scope: platform,
      title: `${name} has no ${field} to show`,
      detail: `Looked for ${list}; none were found.`,
      fix: `Add \`${preferred}\` to the page's <head>.`,
    };
  }
  if (!choice.fallback || !choice.source) return null;
  // Falling back from a twitter: tag to the matching og: tag is documented,
  // intended behaviour — note it, don't nag.
  const intended = platform === "x" && choice.source.startsWith("og:");
  return {
    id: `${platform}-${field}-fallback`,
    severity: intended ? "info" : "warning",
    scope: platform,
    title: `${name} is using ${sourceLabel(choice.source)} for the ${field} because \`${preferred}\` is missing`,
    fix: intended ? undefined : `Add \`${preferred}\` so ${name} doesn't have to guess.`,
  };
}

function imageFailureIssue(check: Extract<ImageCheck, { ok: false }>, role: string): Issue {
  const id = `image-failed-${role}`;
  switch (check.code) {
    case "http_error":
      return {
        id,
        severity: "error",
        scope: "tool",
        title: `The preview image (${role}) returned HTTP ${check.status} to this tool`,
        detail:
          check.status === 403 || check.status === 401
            ? "This is the result of this tool's request. Platform crawlers may be refused too — check that your CDN or bot protection allows link-preview crawlers."
            : "This is the result of this tool's request; a platform crawler would most likely get the same error.",
        fix: "Make sure the image URL is publicly reachable without cookies or a login.",
      };
    case "blocked_destination":
      return {
        id,
        severity: "error",
        scope: "metadata",
        title: `The preview image (${role}) points to a private or disallowed address`,
        detail: check.message,
        fix: "Host the image on a public URL.",
      };
    case "not_image":
    case "unsupported_format":
      return {
        id,
        severity: "error",
        scope: "metadata",
        title: `The preview image (${role}) isn't a usable image`,
        detail: check.message,
        fix: "Point the tag at a PNG or JPEG file.",
      };
    case "too_large":
      return { id, severity: "error", scope: "metadata", title: `The preview image (${role}) is too large`, detail: check.message, fix: "Keep share images under 5 MB (X's limit); ~300 KB is typical." };
    default:
      return {
        id,
        severity: "warning",
        scope: "tool",
        title: `This tool couldn't load the preview image (${role})`,
        detail: check.message,
        fix: "Retry. If it keeps failing, check the image URL in a private browser window.",
      };
  }
}

const TRACKING_PARAM = /^(utm_[a-z_]+|gclid|fbclid|msclkid|mc_cid|mc_eid|ref_src)$/i;

/** Compare URLs, ignoring trailing slashes and campaign-tracking parameters. */
function sameUrl(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  try {
    const x = new URL(a);
    const y = new URL(b);
    const norm = (u: URL) => {
      const params = [...u.searchParams].filter(([k]) => !TRACKING_PARAM.test(k));
      const search = params.length ? `?${new URLSearchParams(params).toString()}` : "";
      return `${u.protocol}//${u.host}${u.pathname.replace(/\/$/, "")}${search}`;
    };
    return norm(x) === norm(y);
  } catch {
    return a === b;
  }
}

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 } as const;

export function buildIssues(input: {
  meta: PageMetadata;
  cards: Cards;
  images: ImageCheck[];
  requestedUrl: string;
  finalUrl: string;
  truncated: boolean;
}): Issue[] {
  const { meta, cards, images, finalUrl, requestedUrl } = input;
  const out: Issue[] = [];
  const add = (i: Issue | null) => i && !out.some((o) => o.id === i.id) && out.push(i);
  const check = (url?: string) => (url ? images.find((i) => i.url === url) : undefined);

  // --- Share image -------------------------------------------------------
  const ogImg = meta.og.images[0];
  if (!ogImg && !meta.twitter.image) {
    add({
      id: "no-image",
      severity: "error",
      scope: "metadata",
      title: "No share image: `og:image` is missing",
      detail: "Every card falls back to a text-only or icon layout.",
      fix: "Add an absolute `og:image` URL to a 1200×630 PNG or JPEG.",
    });
  } else if (!ogImg) {
    add({
      id: "og-image-missing",
      severity: "warning",
      scope: "metadata",
      title: "`og:image` is missing; only platforms that read `twitter:image` have an image",
      detail:
        "X, Slack, Telegram, Reddit, Bluesky and Mastodon fall back to it. iMessage, Discord, LinkedIn, WhatsApp and Facebook show no image.",
      fix: "Add `og:image` so every platform can show an image.",
    });
  }

  const roles: Array<[string, string | undefined, string | undefined]> = [
    ["og:image", ogImg?.url, ogImg?.rawUrl],
    ["twitter:image", meta.twitter.image, meta.twitter.imageRaw],
  ];
  for (const [role, url, raw] of roles) {
    if (!url) continue;
    if (role === "twitter:image" && url === ogImg?.url) continue;
    if (raw && !/^https?:\/\//i.test(raw)) {
      add({
        id: `relative-${role}`,
        severity: "warning",
        scope: "metadata",
        title: `\`${role}\` uses a relative URL (${raw})`,
        detail: `This tool resolved it to ${url}, but the Open Graph spec requires absolute URLs and some crawlers won't resolve it.`,
        fix: `Use the full URL: ${url}`,
      });
    }
    if (url.startsWith("http://")) {
      add({ id: `insecure-${role}`, severity: "warning", scope: "metadata", title: `\`${role}\` is served over plain http`, fix: "Use an https:// image URL; some apps refuse insecure images." });
    }
    const c = check(url);
    if (c && !c.ok) add(imageFailureIssue(c, role));
  }

  const ogCheck = check(ogImg?.url);
  if (ogImg && ogCheck?.ok) {
    if (ogImg.width && ogImg.height && (ogImg.width !== ogCheck.width || ogImg.height !== ogCheck.height)) {
      add({
        id: "og-image-dimension-mismatch",
        severity: "warning",
        scope: "metadata",
        title: `\`og:image:width/height\` say ${ogImg.width}×${ogImg.height}, but the image is ${ogCheck.width}×${ogCheck.height}`,
        fix: "Update the declared dimensions (or remove them).",
      });
    }
    if (ogCheck.width < 600 || ogCheck.height < 315) {
      add({
        id: "og-image-small",
        severity: ogCheck.width < 200 ? "warning" : "info",
        scope: "metadata",
        title: `The og:image is only ${ogCheck.width}×${ogCheck.height}`,
        detail: "Small images look blurry or get shown as a thumbnail instead of a large preview.",
        fix: "Use at least 1200×630 for large previews.",
      });
    }
    const ratio = ogCheck.width / ogCheck.height;
    if (ratio < 1.5 || ratio > 2.3) {
      add({
        id: "og-image-ratio",
        severity: "info",
        scope: "metadata",
        title: `The og:image aspect ratio is ${ratio.toFixed(2)}:1, so wide cards will crop it`,
        detail: "Large link cards are roughly 1.91:1. Compare the crops in each card above.",
      });
    }
    if (!ogImg.alt) {
      add({ id: "og-image-alt", severity: "info", scope: "metadata", title: "`og:image:alt` is missing", fix: "Describe the image for screen-reader users." });
    }
  }
  for (const key of meta.orphanImageFields) {
    add({
      id: `orphan-${key}`,
      severity: "warning",
      scope: "metadata",
      title: `\`${key}\` appears before any \`og:image\` tag and is ignored`,
      fix: "Put structured image fields right after the `og:image` they describe.",
    });
  }

  // --- Card fields -------------------------------------------------------
  add(fieldIssue("imessage", "title", cards.imessage.title, true));
  add(fieldIssue("discord", "title", cards.discord.title, true));
  add(fieldIssue("discord", "description", cards.discord.description, false));
  add(fieldIssue("x", "title", cards.x.title, true));
  add(fieldIssue("x", "description", cards.x.description, false));
  if (!cards.discord.siteName.value) {
    add({ id: "discord-site-name", severity: "info", scope: "discord", title: "Discord shows no site name because `og:site_name` is missing", fix: "Add `og:site_name` with your brand name." });
  }
  if (cards.x.image?.fallback && cards.x.image.check?.ok) {
    add({ id: "x-image-fallback", severity: "info", scope: "x", title: "X is using `og:image` because `twitter:image` is missing" });
  }

  // --- The other link cards ----------------------------------------------
  for (const field of ["title", "description"] as const) {
    const bySource = new Map<string, { preferred: string; names: string[] }>();
    for (const key of LINK_PLATFORMS) {
      const choice = cards[key][field];
      if (!choice?.value || !choice.fallback || !choice.source) continue;
      const entry = bySource.get(choice.source) ?? { preferred: choice.tried[0], names: [] };
      entry.names.push(PLATFORM_NAME[key]);
      bySource.set(choice.source, entry);
    }
    for (const [source, { preferred, names }] of bySource) {
      add({
        id: `others-${field}-fallback-${source}`,
        severity: source.startsWith("twitter:") ? "info" : "warning",
        scope: "metadata",
        title: `${list(names)} use ${sourceLabel(source)} for the ${field} because \`${preferred}\` is missing`,
        fix: `Add \`${preferred}\` so they don't have to guess.`,
      });
    }
  }

  const small = LINK_PLATFORMS.filter((k) => cards[k].imageLayout === "thumbnail");
  if (small.length) {
    add({
      id: "others-thumbnail-layout",
      severity: small.includes("linkedin") || small.includes("facebook") ? "warning" : "info",
      scope: "metadata",
      title: `${list(small.map((k) => PLATFORM_NAME[k]))} will show a small thumbnail instead of a large image`,
      detail: `Estimated minimum for a large image: ${small.map((k) => `${PLATFORM_NAME[k]} ${LARGE_IMAGE_MIN[k].width}×${LARGE_IMAGE_MIN[k].height}`).join(", ")}.`,
      fix: "Use a 1200×630 og:image.",
    });
  }
  const fbCheck = cards.facebook.image?.check;
  if (fbCheck?.ok && cards.facebook.imageLayout === "none") {
    add({
      id: "facebook-image-too-small",
      severity: "warning",
      scope: "facebook",
      title: `Facebook ignores images under ${FACEBOOK_IMAGE_MIN}×${FACEBOOK_IMAGE_MIN}; this one is ${fbCheck.width}×${fbCheck.height}`,
      fix: "Use a 1200×630 og:image.",
    });
  }
  if (!meta.fbAppId) {
    add({
      id: "facebook-app-id",
      severity: "info",
      scope: "facebook",
      title: "No `fb:app_id` — Facebook's Sharing Debugger may note it",
      detail: "Previews still work without it; the tag only links shares to your Facebook app for Insights.",
      fix: 'Optional: <meta property="fb:app_id" content="YOUR_APP_ID">',
    });
  }
  const waCheck = cards.whatsapp.image?.check;
  if (waCheck?.ok && waCheck.bytes > WHATSAPP_IMAGE_BYTES) {
    add({
      id: "whatsapp-image-bytes",
      severity: "warning",
      scope: "whatsapp",
      title: `The og:image is ${Math.round(waCheck.bytes / 1024)} KB; WhatsApp often skips images over ~${WHATSAPP_IMAGE_BYTES / 1024} KB`,
      fix: "Compress the image (a 1200×630 JPEG under 300 KB is safe).",
    });
  }
  if (!meta.fediverseCreator) {
    add({
      id: "mastodon-creator",
      severity: "info",
      scope: "mastodon",
      title: "No `fediverse:creator` — Mastodon can't credit the author on the card",
      fix: 'Optional: <meta name="fediverse:creator" content="@you@your.instance">',
    });
  }

  // --- Google ------------------------------------------------------------
  const g = cards.google;
  add(fieldIssue("google", "title", g.title, true));
  add(fieldIssue("google", "description", g.description, false));
  if (g.noindex) {
    add({
      id: "google-noindex",
      severity: "error",
      scope: "google",
      title: `The page tells search engines not to index it (robots: ${meta.robots})`,
      detail: "Google won't show this page in results at all.",
      fix: 'Remove `noindex` from <meta name="robots"> if the page should be searchable.',
    });
  }
  if (g.titleTruncated) {
    add({
      id: "google-title-long",
      severity: "info",
      scope: "google",
      title: `The title is ${g.title.value!.length} characters; Google will likely cut it near ${GOOGLE_TITLE_CHARS}`,
      fix: "Put the important words first, or shorten it.",
    });
  }
  if (g.descriptionTruncated) {
    add({
      id: "google-description-long",
      severity: "info",
      scope: "google",
      title: `The description is ${g.description.value!.length} characters; Google will likely cut it near ${GOOGLE_DESCRIPTION_CHARS}`,
    });
  }
  if (!g.favicon) {
    add({
      id: "google-favicon",
      severity: "info",
      scope: "google",
      title: "No favicon found, so Google shows a generic globe next to the result",
      fix: 'Add <link rel="icon" href="/favicon.ico"> (a multiple of 48 px is best).',
    });
  }

  // --- X card type -------------------------------------------------------
  const declared = meta.twitter.card;
  if (!declared) {
    add({
      id: "x-card-missing",
      severity: "warning",
      scope: "x",
      title: `\`twitter:card\` is missing — the X preview is an estimate (${cards.x.cardType})`,
      fix: 'Add <meta name="twitter:card" content="summary_large_image"> (or "summary").',
    });
  } else if (declared !== "summary" && declared !== "summary_large_image") {
    const known = declared === "app" || declared === "player";
    add({
      id: "x-card-unsupported",
      severity: "warning",
      scope: "x",
      title: known
        ? `\`twitter:card\` is "${declared}", which this tool doesn't simulate — showing an estimated ${cards.x.cardType} card`
        : `\`twitter:card\` has an unsupported value "${declared}" — showing an estimated ${cards.x.cardType} card`,
      fix: 'Use "summary_large_image" or "summary".',
    });
  }
  const xCheck = cards.x.image?.check;
  if (cards.x.cardType === "summary_large_image" && xCheck?.ok) {
    if (xCheck.width < X_LARGE_MIN.width || xCheck.height < X_LARGE_MIN.height) {
      add({
        id: "x-large-too-small",
        severity: "warning",
        scope: "x",
        title: `X's large image card needs at least ${X_LARGE_MIN.width}×${X_LARGE_MIN.height}; this image is ${xCheck.width}×${xCheck.height}`,
      });
    }
  }
  if (xCheck?.ok && xCheck.bytes > 5 * 1024 * 1024) {
    add({ id: "x-image-bytes", severity: "warning", scope: "x", title: "The X image is over 5 MB, which X rejects" });
  }

  // --- iMessage ----------------------------------------------------------
  if (cards.imessage.layout === "plain") {
    add({
      id: "imessage-plain",
      severity: "info",
      scope: "imessage",
      title: "iMessage will show a plain bubble with no image or icon",
      fix: "Add an og:image, or at least an apple-touch-icon.",
    });
  } else if (cards.imessage.layout === "compact" && !meta.appleTouchIcon) {
    add({ id: "imessage-touch-icon", severity: "info", scope: "imessage", title: "No apple-touch-icon; iMessage's compact bubble uses the favicon", fix: 'Add <link rel="apple-touch-icon" href="/apple-touch-icon.png"> (180×180).' });
  }

  // --- Page-level --------------------------------------------------------
  if (requestedUrl !== finalUrl) {
    add({
      id: "redirected",
      severity: "info",
      scope: "metadata",
      title: "The URL you entered redirects",
      detail: `This tool followed it to ${finalUrl}. Platforms follow redirects too, but they cache the preview under the URL that was shared.`,
    });
  }
  if (meta.canonical && !sameUrl(meta.canonical, finalUrl)) {
    add({
      id: "canonical-differs",
      severity: "info",
      scope: "metadata",
      title: "The page reports a different canonical URL",
      detail: `Canonical: ${meta.canonical}. This tool inspected the URL you submitted, not the canonical one; previews are built from the shared URL.`,
    });
  }
  if (meta.og.url && !sameUrl(meta.og.url, finalUrl)) {
    add({
      id: "og-url-differs",
      severity: "info",
      scope: "metadata",
      title: "`og:url` points somewhere else",
      detail: `og:url: ${meta.og.url}. Some crawlers treat og:url as the page's identity and may show that page's preview instead.`,
    });
  }
  if (!meta.hasViewport) {
    add({ id: "no-viewport", severity: "info", scope: "metadata", title: "No viewport meta tag — phones will render this page zoomed out", fix: '<meta name="viewport" content="width=device-width, initial-scale=1">' });
  }
  if (input.truncated) {
    add({ id: "truncated", severity: "info", scope: "tool", title: "This tool stopped reading the page after 3 MB", detail: "Tags after that point were not checked. Share tags belong early in <head>." });
  }

  return out
    .map((issue, i) => ({ issue, i }))
    .sort((a, b) => SEVERITY_ORDER[a.issue.severity] - SEVERITY_ORDER[b.issue.severity] || a.i - b.i)
    .map(({ issue }) => issue);
}
