"use client";

/* eslint-disable @next/next/no-img-element -- site icons are already validated and proxied by /api/image */
import type { CardImage, GoogleCard, LinkCard, MastodonCard, SlackCard } from "@/lib/preview/types";
import { PreviewImage } from "./PreviewImage";

/** Tiny site icon that degrades to a glyph instead of a broken-image box. */
function SiteIcon({ image, className }: { image?: CardImage; className: string }) {
  const check = image?.check;
  if (!check?.ok) {
    return (
      <span className={`${className} site-icon-fallback`} aria-hidden="true">
        ⌁
      </span>
    );
  }
  return (
    <img
      className={className}
      src={`/api/image/${check.proxy}`}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
    />
  );
}

/** Image in a fixed-ratio frame, cropped like the platform does. */
function Cover({ image, ratio = 1.91 }: { image?: CardImage; ratio?: number }) {
  return (
    <div className="cover" style={{ aspectRatio: String(ratio) }}>
      <PreviewImage image={image} />
    </div>
  );
}

function Thumb({ image, size = 80 }: { image?: CardImage; size?: number }) {
  return (
    <div className="thumb" style={{ width: size, height: size }}>
      <PreviewImage image={image} />
    </div>
  );
}

const Avatar = ({ letter = "Q" }: { letter?: string }) => (
  <span className="av" aria-hidden="true">
    {letter}
  </span>
);

const NoPreview = ({ name }: { name: string }) => <div className="no-preview">No preview — {name} would show the bare link.</div>;

// --- Slack ------------------------------------------------------------------

export function SlackBody({ card }: { card: SlackCard }) {
  const hasText = card.title.value || card.description?.value;
  return (
    <div className="sl-msg">
      <Avatar />
      <div className="sl-main">
        <div className="sl-author">
          <b>qa-team</b> <span>9:41 AM</span>
        </div>
        <div className="sl-link">https://{card.domain}</div>
        {hasText || card.imageLayout !== "none" ? (
          <div className="sl-unfurl">
            <div className="sl-site">
              <SiteIcon image={card.favicon} className="sl-fav" />
              <span>{card.siteName.value ?? card.domain}</span>
            </div>
            <div className={`sl-grid ${card.imageLayout === "thumbnail" ? "with-thumb" : ""}`}>
              <div>
                {card.title.value && <div className="sl-title">{card.title.value}</div>}
                {card.description?.value && <div className="sl-desc clamp-4">{card.description.value}</div>}
                {card.fields.length > 0 && (
                  <dl className="sl-fields">
                    {card.fields.map((f) => (
                      <div key={f.label}>
                        <dt>{f.label}</dt>
                        <dd>{f.data}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
              {card.imageLayout === "thumbnail" && <Thumb image={card.image} size={72} />}
            </div>
            {card.imageLayout === "large" && (
              <div className="sl-large">
                <PreviewImage image={card.image} fit="contain" className="sl-large-img" />
              </div>
            )}
          </div>
        ) : (
          <NoPreview name="Slack" />
        )}
      </div>
    </div>
  );
}

// --- WhatsApp ---------------------------------------------------------------

export function WhatsAppBody({ card }: { card: LinkCard<"whatsapp"> }) {
  const hasText = card.title.value || card.description?.value;
  return (
    <div className="wa-thread">
      <div className="wa-bubble">
        {hasText || card.imageLayout !== "none" ? (
          <div className={`wa-card ${card.imageLayout === "thumbnail" ? "is-thumb" : ""}`}>
            {card.imageLayout === "large" && <Cover image={card.image} />}
            {card.imageLayout === "thumbnail" && <Thumb image={card.image} size={76} />}
            <div className="wa-text">
              {card.title.value && <div className="wa-title clamp-2">{card.title.value}</div>}
              {card.description?.value && <div className="wa-desc clamp-2">{card.description.value}</div>}
              <div className="wa-domain">{card.domain}</div>
            </div>
          </div>
        ) : null}
        <div className="wa-url">https://{card.domain}</div>
        <div className="wa-time">9:41 AM ✓✓</div>
      </div>
    </div>
  );
}

// --- Telegram ---------------------------------------------------------------

export function TelegramBody({ card }: { card: LinkCard<"telegram"> }) {
  const hasText = card.title.value || card.description?.value;
  return (
    <div className="tg-thread">
      <div className="tg-bubble">
        <div className="tg-url">https://{card.domain}</div>
        {hasText || card.imageLayout !== "none" ? (
          <div className="tg-preview">
            <div className={`tg-grid ${card.imageLayout === "thumbnail" ? "with-thumb" : ""}`}>
              <div>
                <div className="tg-site">{card.siteName.value ?? card.domain}</div>
                {card.title.value && <div className="tg-title">{card.title.value}</div>}
                {card.description?.value && <div className="tg-desc clamp-4">{card.description.value}</div>}
              </div>
              {card.imageLayout === "thumbnail" && <Thumb image={card.image} size={56} />}
            </div>
            {card.imageLayout === "large" && (
              <div className="tg-media">
                <PreviewImage image={card.image} className="tg-img" fit="cover" />
              </div>
            )}
          </div>
        ) : null}
        <div className="tg-time">9:41</div>
      </div>
    </div>
  );
}

// --- Facebook ---------------------------------------------------------------

export function FacebookBody({ card }: { card: LinkCard<"facebook"> }) {
  const hasText = card.title.value || card.description?.value;
  const row = card.imageLayout === "thumbnail";
  return (
    <div className="fb-post">
      <div className="fb-head">
        <Avatar />
        <div>
          <div className="fb-name">QA Team</div>
          <div className="fb-meta">Just now · Public</div>
        </div>
      </div>
      <div className="fb-link">
        {card.imageLayout === "large" && <Cover image={card.image} />}
        <div className={row ? "fb-row" : undefined}>
          {row && <Thumb image={card.image} size={96} />}
          {hasText ? (
            <div className="fb-text">
              <div className="fb-domain">{card.domain}</div>
              {card.title.value && <div className="fb-title clamp-2">{card.title.value}</div>}
              {card.description?.value && <div className="fb-desc clamp-2">{card.description.value}</div>}
            </div>
          ) : (
            <div className="fb-text">
              <div className="fb-domain">{card.domain}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- LinkedIn ---------------------------------------------------------------

export function LinkedInBody({ card }: { card: LinkCard<"linkedin"> }) {
  const row = card.imageLayout === "thumbnail";
  return (
    <div className="li-post">
      <div className="li-head">
        <Avatar />
        <div>
          <div className="li-name">QA Team</div>
          <div className="li-meta">1m · Public</div>
        </div>
      </div>
      <div className="li-link">
        {card.imageLayout === "large" && <Cover image={card.image} />}
        <div className={row ? "li-row" : undefined}>
          {row && <Thumb image={card.image} size={72} />}
          <div className="li-text">
            <div className="li-title clamp-2">{card.title.value ?? card.domain}</div>
            <div className="li-domain">{card.domain}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Reddit -----------------------------------------------------------------

export function RedditBody({ card }: { card: LinkCard<"reddit"> }) {
  const row = card.imageLayout === "thumbnail";
  return (
    <div className="rd-post">
      <div className="rd-meta">
        <span className="rd-sub">r/qa_team</span> · 1m
      </div>
      <div className={row ? "rd-row" : undefined}>
        <div>
          <div className="rd-title">{card.title.value ?? card.domain}</div>
          <div className="rd-domain">{card.domain} ↗</div>
        </div>
        {row && <Thumb image={card.image} size={72} />}
      </div>
      {card.imageLayout === "large" && <Cover image={card.image} />}
      <div className="rd-actions" aria-hidden="true">
        <span>▲ 1 ▼</span>
        <span>0 comments</span>
        <span>Share</span>
      </div>
    </div>
  );
}

// --- Bluesky ----------------------------------------------------------------

export function BlueskyBody({ card }: { card: LinkCard<"bluesky"> }) {
  const hasText = card.title.value || card.description?.value;
  const row = card.imageLayout === "thumbnail";
  return (
    <div className="bs-post">
      <Avatar />
      <div className="bs-main">
        <div className="bs-author">
          <b>QA Team</b> <span>@qa.bsky.social · 1m</span>
        </div>
        <div className="bs-card">
          {card.imageLayout === "large" && <Cover image={card.image} />}
          <div className={row ? "bs-row" : undefined}>
            {row && <Thumb image={card.image} size={84} />}
            <div className="bs-text">
              {hasText ? (
                <>
                  {card.title.value && <div className="bs-title clamp-2">{card.title.value}</div>}
                  {card.description?.value && <div className="bs-desc clamp-3">{card.description.value}</div>}
                </>
              ) : null}
              <div className="bs-domain">⛓ {card.domain}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Mastodon ---------------------------------------------------------------

export function MastodonBody({ card }: { card: MastodonCard }) {
  const row = card.imageLayout === "thumbnail";
  return (
    <div className="ms-status">
      <div className="ms-head">
        <Avatar />
        <div>
          <div className="ms-name">QA Team</div>
          <div className="ms-handle">@qa@mastodon.social</div>
        </div>
      </div>
      <div className="ms-card">
        {card.imageLayout === "large" && <Cover image={card.image} />}
        <div className={row ? "ms-row" : undefined}>
          {row && <Thumb image={card.image} size={88} />}
          <div className="ms-text">
            <div className="ms-provider">{card.siteName.value ?? card.domain}</div>
            <div className="ms-title clamp-2">{card.title.value ?? card.domain}</div>
            {card.description?.value && <div className="ms-desc clamp-2">{card.description.value}</div>}
            {card.creator && <div className="ms-by">By {card.creator}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Google -----------------------------------------------------------------

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max).trimEnd()}…` : text);

export function GoogleBody({ card, titleMax, descriptionMax }: { card: GoogleCard; titleMax: number; descriptionMax: number }) {
  return (
    <div className={`go-result ${card.noindex ? "is-noindex" : ""}`}>
      {card.noindex && (
        <div className="go-noindex" role="note">
          Google would not list this page: <code>noindex</code> is set.
        </div>
      )}
      <div className="go-site">
        <SiteIcon image={card.favicon} className="go-fav" />
        <div className="go-site-text">
          <div className="go-site-name">{card.siteName.value ?? card.domain}</div>
          <div className="go-url">{card.displayUrl}</div>
        </div>
      </div>
      <div className="go-title">{card.title.value ? cut(card.title.value, titleMax) : card.domain}</div>
      <div className="go-desc">
        {card.description.value ? cut(card.description.value, descriptionMax) : <span className="muted">No description — Google would pick text from the page.</span>}
      </div>
    </div>
  );
}
