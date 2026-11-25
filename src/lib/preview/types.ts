// Types shared by the server pipeline and the client UI. No runtime imports.

export interface MetaTag {
  /** Lower-cased property/name, e.g. "og:title" or "twitter:card". */
  key: string;
  value: string;
  /** Which attribute carried the key. */
  attr: "property" | "name";
  /** Position among all meta tags in the document. */
  index: number;
}

export interface OgImage {
  url: string;
  /** The raw attribute value before resolution, to detect relative URLs. */
  rawUrl: string;
  secureUrl?: string;
  type?: string;
  width?: number;
  height?: number;
  alt?: string;
  /** Position among og:image entries, in document order. */
  position: number;
}

export interface IconLink {
  rel: string;
  href: string;
  sizes?: string;
  type?: string;
}

export interface PageMetadata {
  title?: string;
  description?: string;
  canonical?: string;
  lang?: string;
  themeColor?: string;
  hasViewport: boolean;
  /** Content of <meta name="robots">, lower-cased. */
  robots?: string;
  /** fb:app_id, used by Facebook's sharing tools. */
  fbAppId?: string;
  /** fediverse:creator, used by Mastodon for author attribution. */
  fediverseCreator?: string;
  favicon?: string;
  appleTouchIcon?: string;
  icons: IconLink[];
  og: {
    title?: string;
    description?: string;
    siteName?: string;
    url?: string;
    type?: string;
    locale?: string;
    images: OgImage[];
  };
  twitter: {
    card?: string;
    title?: string;
    description?: string;
    image?: string;
    imageRaw?: string;
    imageAlt?: string;
    site?: string;
    creator?: string;
    /** twitter:label1/data1 and label2/data2, shown by Slack as extra fields. */
    labels: Array<{ label: string; data: string }>;
  };
  /** All meta tags with a property or name, in document order. */
  tags: MetaTag[];
  /** og:image:* fields that appeared before any og:image. */
  orphanImageFields: string[];
  baseHref?: string;
}

export type ImageCheck =
  | {
      ok: true;
      url: string;
      /** Opaque token for /api/image/<token>. */
      proxy: string;
      width: number;
      height: number;
      format: string;
      bytes: number;
      contentType?: string;
    }
  | {
      ok: false;
      url: string;
      code:
        | "http_error"
        | "blocked_destination"
        | "not_image"
        | "unsupported_format"
        | "too_large"
        | "timeout"
        | "network"
        | "invalid_url";
      status?: number;
      message: string;
    };

export type Platform =
  | "imessage"
  | "discord"
  | "x"
  | "slack"
  | "linkedin"
  | "whatsapp"
  | "facebook"
  | "telegram"
  | "reddit"
  | "bluesky"
  | "mastodon"
  | "google";

export interface FieldChoice {
  value?: string;
  /** e.g. "og:title", "twitter:title", "<title>", "meta description", "hostname". */
  source?: string;
  /** True when a fallback (not the platform's preferred tag) was used. */
  fallback: boolean;
  /** Tags that were looked for, in priority order. */
  tried: string[];
}

export interface CardImage {
  url: string;
  source: string;
  fallback: boolean;
  check?: ImageCheck;
}

export interface IMessageCard {
  platform: "imessage";
  layout: "rich" | "compact" | "plain";
  title: FieldChoice;
  domain: string;
  image?: CardImage;
  icon?: CardImage;
}

export interface DiscordCard {
  platform: "discord";
  siteName: FieldChoice;
  title: FieldChoice;
  description: FieldChoice;
  image?: CardImage;
  imageLayout: "large" | "thumbnail" | "none";
  accentColor?: string;
}

export interface XCard {
  platform: "x";
  declaredCard?: string;
  /** The card actually simulated. */
  cardType: "summary" | "summary_large_image";
  /** True when the card type had to be estimated (missing or unsupported tag). */
  estimated: boolean;
  title: FieldChoice;
  description: FieldChoice;
  image?: CardImage;
  domain: string;
  site?: string;
}

/** Shared shape of the simpler link cards (title, optional text, optional image). */
export interface LinkCard<P extends Platform> {
  platform: P;
  domain: string;
  siteName: FieldChoice;
  title: FieldChoice;
  /** Absent when the platform doesn't show a description. */
  description?: FieldChoice;
  image?: CardImage;
  /** "none" means no image is shown (missing, failed, or below the platform's minimum). */
  imageLayout: "large" | "thumbnail" | "none";
  favicon?: CardImage;
}

export interface SlackCard extends LinkCard<"slack"> {
  /** twitter:label/data pairs, rendered as small fields under the description. */
  fields: Array<{ label: string; data: string }>;
}
export type LinkedInCard = LinkCard<"linkedin">;
export type WhatsAppCard = LinkCard<"whatsapp">;
export type FacebookCard = LinkCard<"facebook">;
export type TelegramCard = LinkCard<"telegram">;
export type RedditCard = LinkCard<"reddit">;
export type BlueskyCard = LinkCard<"bluesky">;
export interface MastodonCard extends LinkCard<"mastodon"> {
  /** fediverse:creator, e.g. "@name@example.social". */
  creator?: string;
}

export interface GoogleCard {
  platform: "google";
  domain: string;
  /** Breadcrumb-style URL line, e.g. "example.com › blog › post". */
  displayUrl: string;
  siteName: FieldChoice;
  title: FieldChoice;
  description: FieldChoice;
  favicon?: CardImage;
  /** Estimated cut-offs: ~60 characters for titles, ~160 for descriptions. */
  titleTruncated: boolean;
  descriptionTruncated: boolean;
  /** True when <meta name="robots"> contains noindex. */
  noindex: boolean;
}

export interface Cards {
  imessage: IMessageCard;
  discord: DiscordCard;
  x: XCard;
  slack: SlackCard;
  linkedin: LinkedInCard;
  whatsapp: WhatsAppCard;
  facebook: FacebookCard;
  telegram: TelegramCard;
  reddit: RedditCard;
  bluesky: BlueskyCard;
  mastodon: MastodonCard;
  google: GoogleCard;
}

export type IssueSeverity = "error" | "warning" | "info";

export interface Issue {
  id: string;
  severity: IssueSeverity;
  /**
   * "tool": a check this tool could not complete — the platform's crawler may
   * get a different answer. "metadata": a problem in the page's tags that
   * affects every platform. Otherwise a platform-specific result.
   */
  scope: "tool" | "metadata" | Platform;
  title: string;
  detail?: string;
  fix?: string;
}

export interface PreviewResult {
  ok: true;
  requestedUrl: string;
  finalUrl: string;
  redirected: boolean;
  redirects: Array<{ url: string; status: number }>;
  status: number;
  contentType?: string;
  fetchedAt: string;
  truncated: boolean;
  bytes: number;
  metadata: PageMetadata;
  images: ImageCheck[];
  cards: Cards;
  issues: Issue[];
  suggestedTags: string;
}

export type PreviewErrorCode =
  | "invalid_url"
  | "blocked_destination"
  | "dns_failed"
  | "timeout"
  | "too_large"
  | "too_many_redirects"
  | "connection_failed"
  | "tls_error"
  | "busy"
  | "blocked_page"
  | "http_error"
  | "not_html"
  | "internal";

export interface PreviewError {
  ok: false;
  code: PreviewErrorCode;
  title: string;
  message: string;
  retryable: boolean;
  status?: number;
  finalUrl?: string;
}

export type PreviewResponse = PreviewResult | PreviewError;

export interface CaptureInfo {
  preset: string;
  device: string;
  engine: string;
  engineVersion: string;
  /** Set when the capture used a different engine than the preset asks for. */
  engineNote?: string;
  blockedRequests?: number;
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  fullHeight: number;
  clipped: boolean;
  finalUrl: string;
  durationMs: number;
}
