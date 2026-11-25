"use client";

import { useState } from "react";
import { GOOGLE_DESCRIPTION_CHARS, GOOGLE_TITLE_CHARS } from "@/lib/preview/cards";
import { PLATFORMS } from "@/lib/platforms";
import type { CardImage, Platform, PreviewResult, XCard as XCardData } from "@/lib/preview/types";
import {
  BlueskyBody,
  FacebookBody,
  GoogleBody,
  LinkedInBody,
  MastodonBody,
  RedditBody,
  SlackBody,
  TelegramBody,
  WhatsAppBody,
} from "./PlatformCards";
import { PreviewImage } from "./PreviewImage";

/** One-line caveats shown under a card, where the platform behaves unlike the others. */
const NOTES: Partial<Record<Platform, string>> = {
  slack: "Slack caches unfurls for a while; re-share the link to see changes.",
  whatsapp: "WhatsApp is reported to skip images over ~300 KB.",
  telegram: "Telegram's Instant View and custom templates aren't simulated.",
  facebook: "Also what Messenger shows. Refresh a stale preview in Facebook's Sharing Debugger.",
  linkedin: "LinkedIn doesn't show the description and ignores twitter: tags. Refresh via Post Inspector.",
  reddit: "Reddit shows your own post title; this is the one it suggests from the page.",
  bluesky: "Bluesky builds the card when the post is composed.",
  mastodon: "Each server builds its own card; layouts vary slightly by version.",
  google: "Google often rewrites titles and snippets, and is not an Open Graph consumer.",
};

export function CardsView({
  result,
  hidden,
  onToggle,
  onShowAll,
}: {
  result: PreviewResult;
  hidden: Platform[];
  onToggle: (id: Platform) => void;
  onShowAll: () => void;
}) {
  const { cards } = result;
  const visible = PLATFORMS.filter((p) => !hidden.includes(p.id));

  const render = (id: Platform, i: number): React.ReactNode => {
    const name = PLATFORMS.find((p) => p.id === id)!.name;
    const frame = (children: React.ReactNode, footer?: React.ReactNode) => (
      <CardFrame key={id} name={name} platform={id} index={i} footer={footer} note={NOTES[id]}>
        {children}
      </CardFrame>
    );
    const missing = (c: { imageLayout: string; image?: CardImage }) =>
      imageNote(c.imageLayout === "none" ? c.image : undefined, c.image?.source);
    switch (id) {
      case "imessage":
        return frame(<IMessageCard card={cards.imessage} />, imageNote(cards.imessage.layout === "rich" ? undefined : cards.imessage.image, "og:image"));
      case "discord":
        return frame(<DiscordCard card={cards.discord} />, imageNote(cards.discord.imageLayout === "none" ? cards.discord.image : undefined, cards.discord.image?.source));
      case "x":
        return <XFrame key={`${id}-${result.fetchedAt}`} card={cards.x} index={i} />;
      case "slack":
        return frame(<SlackBody card={cards.slack} />, missing(cards.slack));
      case "whatsapp":
        return frame(<WhatsAppBody card={cards.whatsapp} />, missing(cards.whatsapp));
      case "telegram":
        return frame(<TelegramBody card={cards.telegram} />, missing(cards.telegram));
      case "facebook":
        return frame(<FacebookBody card={cards.facebook} />, missing(cards.facebook));
      case "linkedin":
        return frame(<LinkedInBody card={cards.linkedin} />, missing(cards.linkedin));
      case "reddit":
        return frame(<RedditBody card={cards.reddit} />, missing(cards.reddit));
      case "bluesky":
        return frame(<BlueskyBody card={cards.bluesky} />, missing(cards.bluesky));
      case "mastodon":
        return frame(<MastodonBody card={cards.mastodon} />, missing(cards.mastodon));
      case "google":
        return frame(<GoogleBody card={cards.google} titleMax={GOOGLE_TITLE_CHARS} descriptionMax={GOOGLE_DESCRIPTION_CHARS} />);
    }
  };

  return (
    <section aria-labelledby="sim-label" className="cards-section">
      <div className="sim-head">
        <span id="sim-label" className="sim-label">
          Simulated preview
        </span>
        <span className="sim-note">
          Real apps can render differently depending on app version, settings, or a cached copy of your page.
        </span>
      </div>
      <div className="platform-filter" role="group" aria-label="Platforms to show">
        {PLATFORMS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`seg ${hidden.includes(p.id) ? "" : "on"}`}
            aria-pressed={!hidden.includes(p.id)}
            onClick={() => onToggle(p.id)}
          >
            {p.short}
          </button>
        ))}
        {hidden.length > 0 && (
          <button type="button" className="link-btn" onClick={onShowAll}>
            Show all
          </button>
        )}
      </div>
      {visible.length === 0 ? (
        <p className="muted">All platforms are hidden. Pick one above.</p>
      ) : (
        <div className="cards-grid">{visible.map((p, i) => render(p.id, i))}</div>
      )}
    </section>
  );
}

function imageNote(image: CardImage | undefined, source?: string) {
  if (!image?.check || image.check.ok) return null;
  return (
    <p className="card-warn">
      <strong>{source ?? "Image"} not shown:</strong> {image.check.message}
    </p>
  );
}

function CardFrame({
  name,
  platform,
  children,
  footer,
  badge,
  note,
  index = 0,
}: {
  name: string;
  platform: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  badge?: React.ReactNode;
  note?: string;
  index?: number;
}) {
  return (
    <article className={`card-frame frame-${platform}`} aria-label={`${name} simulated preview`} style={{ "--i": index } as React.CSSProperties}>
      <header className="card-frame-head">
        <span className={`plat-dot dot-${platform}`} aria-hidden="true" />
        <h2>{name}</h2>
        {badge}
      </header>
      <div className={`stage stage-${platform}`}>{children}</div>
      {footer}
      {note && <p className="card-note">{note}</p>}
    </article>
  );
}

// --- iMessage ---------------------------------------------------------------

function IMessageCard({ card }: { card: PreviewResult["cards"]["imessage"] }) {
  const title = card.title.value ?? card.domain;
  const d = card.image?.check?.ok ? card.image.check : undefined;
  // Keep the image's own proportions within a band, like a chat bubble does.
  const ratio = d ? Math.min(Math.max(d.width / d.height, 1), 2) : 1.91;
  return (
    <div className="im-thread">
      <div className={`im-bubble im-${card.layout}`}>
        {card.layout === "rich" && (
          <div className="im-media" style={{ aspectRatio: String(ratio) }}>
            <PreviewImage image={card.image} className="im-img" />
          </div>
        )}
        <div className="im-body">
          {card.layout === "compact" && (
            <PreviewImage image={card.icon} className="im-icon" />
          )}
          {card.layout === "plain" && (
            <span className="im-globe" aria-hidden="true">
              ⌁
            </span>
          )}
          <div className="im-text">
            <div className="im-title clamp-2">{title}</div>
            <div className="im-domain">{card.domain}</div>
          </div>
        </div>
      </div>
      <div className="im-meta">Delivered</div>
    </div>
  );
}

// --- Discord ----------------------------------------------------------------

function DiscordCard({ card }: { card: PreviewResult["cards"]["discord"] }) {
  const accent = card.accentColor ?? "#1e1f22";
  const hasText = card.title.value || card.description.value || card.siteName.value;
  return (
    <div className="dc-message">
      <div className="dc-avatar" aria-hidden="true">
        Q
      </div>
      <div className="dc-content">
        <div className="dc-author">
          qa-team <span className="dc-time">Today at 9:41</span>
        </div>
        <div className="dc-link">link in chat ↓</div>
        {hasText || card.imageLayout !== "none" ? (
          <div className="dc-embed" style={{ borderLeftColor: accent }}>
            <div className={`dc-grid ${card.imageLayout === "thumbnail" ? "with-thumb" : ""}`}>
              <div className="dc-text">
                {card.siteName.value && <div className="dc-site">{card.siteName.value}</div>}
                {card.title.value && <div className="dc-title">{card.title.value}</div>}
                {card.description.value && <div className="dc-desc clamp-4">{card.description.value}</div>}
              </div>
              {card.imageLayout === "thumbnail" && <PreviewImage image={card.image} className="dc-thumb" />}
            </div>
            {card.imageLayout === "large" && (
              <div className="dc-large">
                <PreviewImage image={card.image} className="dc-large-img" fit="contain" />
              </div>
            )}
          </div>
        ) : (
          <div className="dc-none">No embed — Discord would show the bare link.</div>
        )}
      </div>
    </div>
  );
}

// --- X ----------------------------------------------------------------------

function XFrame({ card, index }: { card: XCardData; index: number }) {
  const [view, setView] = useState<XCardData["cardType"]>(card.cardType);
  const badge = card.estimated ? (
    <span className="badge badge-warn" title="twitter:card is missing or unsupported">
      Estimated
    </span>
  ) : null;
  const footer = (
    <div className="x-toggle" role="group" aria-label="X card type">
      {(["summary_large_image", "summary"] as const).map((t) => (
        <button
          key={t}
          type="button"
          className={`seg ${view === t ? "on" : ""}`}
          aria-pressed={view === t}
          onClick={() => setView(t)}
        >
          {t}
          {t === card.cardType && (
            <span className="seg-tag">{card.estimated ? " · fallback" : " · declared"}</span>
          )}
        </button>
      ))}
      {card.estimated && (
        <p className="card-warn">
          <strong>
            {card.declaredCard ? `twitter:card="${card.declaredCard}" isn't supported.` : "twitter:card is missing."}
          </strong>{" "}
          This card is an estimated fallback.
        </p>
      )}
      {imageNote(card.image, card.image?.source)}
    </div>
  );
  return (
    <CardFrame name="X (Twitter)" platform="x" badge={badge} footer={footer} index={index}>
      <XCard card={card} view={view} />
    </CardFrame>
  );
}

function XCard({ card, view }: { card: XCardData; view: XCardData["cardType"] }) {
  const title = card.title.value;
  const imageOk = card.image?.check?.ok;
  return (
    <div className="x-post">
      <div className="x-author">
        <span className="x-avatar" aria-hidden="true" />
        <span className="x-name">QA Team</span>
        <span className="x-handle">@qa_team · 1m</span>
      </div>
      {view === "summary_large_image" ? (
        <div className="x-large">
          <div className="x-large-media">
            <PreviewImage image={card.image} className="x-large-img" />
            {title && imageOk && <span className="x-overlay clamp-1">{title}</span>}
          </div>
          {!imageOk && title && <div className="x-large-title clamp-2">{title}</div>}
          <div className="x-from">From {card.domain}</div>
        </div>
      ) : (
        <div className="x-summary">
          <PreviewImage image={card.image} className="x-sum-img" />
          <div className="x-sum-text">
            <div className="x-sum-domain">{card.domain}</div>
            {title && <div className="x-sum-title clamp-1">{title}</div>}
            {card.description.value && <div className="x-sum-desc clamp-2">{card.description.value}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
