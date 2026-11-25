"use client";

import { PLATFORMS } from "@/lib/platforms";
import type { CardImage, FieldChoice, ImageCheck, Issue, LinkCard, Platform, PreviewResult } from "@/lib/preview/types";
import { CopyButton } from "./CopyButton";

const SCOPE_LABEL = {
  tool: "Tool check",
  metadata: "All platforms",
  ...Object.fromEntries(PLATFORMS.map((p) => [p.id, p.short])),
} as Record<Issue["scope"], string>;

const SEVERITY_LABEL = { error: "Fix", warning: "Check", info: "Note" } as const;

/** Render `backtick` spans as code, everything else as plain text. */
function Ticks({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("`") && p.endsWith("`") && p.length > 1 ? <code key={i}>{p.slice(1, -1)}</code> : <span key={i}>{p}</span>,
      )}
    </>
  );
}

export function MetadataPanel({ result, hidden = [] }: { result: PreviewResult; hidden?: Platform[] }) {
  const show = (id: Platform) => !hidden.includes(id);
  const { issues, cards, metadata, images } = result;
  const counts = {
    error: issues.filter((i) => i.severity === "error").length,
    warning: issues.filter((i) => i.severity === "warning").length,
  };

  return (
    <details className="inspector" open>
      <summary>
        <span className="inspector-title">Metadata &amp; fixes</span>
        <span className="inspector-counts">
          {counts.error > 0 && <span className="badge badge-error">{counts.error} to fix</span>}
          {counts.warning > 0 && <span className="badge badge-warn">{counts.warning} to check</span>}
          {counts.error + counts.warning === 0 && <span className="badge badge-ok">No blocking issues</span>}
        </span>
      </summary>

      <div className="inspector-body">
        <section aria-labelledby="fixes-h">
          <h3 id="fixes-h">What to fix</h3>
          <p className="legend">
            <span className="scope scope-tool">Tool check</span> means this tool couldn&apos;t complete the check — a platform&apos;s
            crawler may get a different answer. Other labels are results about your tags.
          </p>
          {issues.length === 0 ? (
            <p className="muted">No issues found.</p>
          ) : (
            <ol className="issues">
              {issues.map((issue) => (
                <li key={issue.id} className={`issue sev-${issue.severity}`}>
                  <span className={`sev sev-${issue.severity}`}>{SEVERITY_LABEL[issue.severity]}</span>
                  <div className="issue-main">
                    <div className="issue-title">
                      <Ticks text={issue.title} />
                    </div>
                    {issue.detail && (
                      <div className="issue-detail">
                        <Ticks text={issue.detail} />
                      </div>
                    )}
                    {issue.fix && (
                      <div className="issue-fix">
                        <Ticks text={issue.fix} />
                      </div>
                    )}
                  </div>
                  <span className={`scope scope-${issue.scope}`}>{SCOPE_LABEL[issue.scope]}</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section aria-labelledby="fields-h">
          <h3 id="fields-h">Fields each card used</h3>
          {hidden.length > 0 && <p className="legend">Showing the platforms selected above.</p>}
          <div className="table-wrap">
            <table className="fields">
              <thead>
                <tr>
                  <th scope="col">Card</th>
                  <th scope="col">Field</th>
                  <th scope="col">Value (full text)</th>
                  <th scope="col">Source</th>
                </tr>
              </thead>
              <tbody>
                {show("imessage") && (
                  <>
                    <FieldRow card="iMessage" field="Title" choice={cards.imessage.title} />
                    <ImageRow card="iMessage" field="Image" image={cards.imessage.image} note={`Layout: ${cards.imessage.layout}`} />
                    <ImageRow card="iMessage" field="Icon" image={cards.imessage.icon} />
                  </>
                )}
                {show("discord") && (
                  <>
                    <FieldRow card="Discord" field="Site name" choice={cards.discord.siteName} />
                    <FieldRow card="Discord" field="Title" choice={cards.discord.title} />
                    <FieldRow card="Discord" field="Description" choice={cards.discord.description} />
                    <ImageRow card="Discord" field="Image" image={cards.discord.image} note={`Layout: ${cards.discord.imageLayout}`} />
                  </>
                )}
                {show("x") && (
                  <>
                    <tr>
                      <th scope="row">X</th>
                      <td>Card type</td>
                      <td>{cards.x.cardType}</td>
                      <td>
                        {cards.x.estimated ? (
                          <span className="src-fallback">estimated — twitter:card {cards.x.declaredCard ? `"${cards.x.declaredCard}" unsupported` : "missing"}</span>
                        ) : (
                          <code>twitter:card</code>
                        )}
                      </td>
                    </tr>
                    <FieldRow card="X" field="Title" choice={cards.x.title} />
                    <FieldRow card="X" field="Description" choice={cards.x.description} />
                    <ImageRow card="X" field="Image" image={cards.x.image} />
                  </>
                )}
                {show("slack") && <LinkRows card="Slack" data={cards.slack} siteName />}
                {show("whatsapp") && <LinkRows card="WhatsApp" data={cards.whatsapp} />}
                {show("telegram") && <LinkRows card="Telegram" data={cards.telegram} siteName />}
                {show("facebook") && <LinkRows card="Facebook" data={cards.facebook} />}
                {show("linkedin") && <LinkRows card="LinkedIn" data={cards.linkedin} />}
                {show("reddit") && <LinkRows card="Reddit" data={cards.reddit} />}
                {show("bluesky") && <LinkRows card="Bluesky" data={cards.bluesky} />}
                {show("mastodon") && <LinkRows card="Mastodon" data={cards.mastodon} siteName />}
                {show("google") && (
                  <>
                    <FieldRow card="Google" field="Title" choice={cards.google.title} />
                    <FieldRow card="Google" field="Description" choice={cards.google.description} />
                    <FieldRow card="Google" field="Site name" choice={cards.google.siteName} />
                    <tr>
                      <th scope="row">Google</th>
                      <td>Indexing</td>
                      <td>{cards.google.noindex ? "Blocked (noindex)" : "Allowed"}</td>
                      <td>{metadata.robots ? <code>robots</code> : <span className="muted">— (default)</span>}</td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="images-h">
          <h3 id="images-h">Images found</h3>
          {metadata.og.images.length > 0 && (
            <ol className="og-images">
              {metadata.og.images.map((img) => {
                const check = images.find((c) => c.url === img.url);
                return (
                  <li key={img.position}>
                    <div className="mono-url">
                      og:image #{img.position + 1}: {img.url}
                    </div>
                    <div className="small muted">
                      Declared: {img.width && img.height ? `${img.width}×${img.height}` : "no size"}
                      {img.type ? ` · ${img.type}` : ""}
                      {img.alt ? ` · alt “${img.alt}”` : " · no alt"}
                      {img.secureUrl ? ` · secure_url ${img.secureUrl}` : ""}
                    </div>
                    <CheckLine check={check} />
                  </li>
                );
              })}
            </ol>
          )}
          <ul className="other-images">
            {images
              .filter((c) => !metadata.og.images.some((o) => o.url === c.url))
              .map((c) => (
                <li key={c.url}>
                  <span className="mono-url">
                    {roleOf(c.url, result)}: {c.url}
                  </span>
                  <CheckLine check={c} />
                </li>
              ))}
          </ul>
        </section>

        <section aria-labelledby="page-h">
          <h3 id="page-h">Page</h3>
          <dl className="facts">
            <Fact label="Submitted URL (inspected)" value={result.requestedUrl} mono />
            {result.redirects.map((r, i) => (
              <Fact key={i} label={`Redirect ${i + 1} (HTTP ${r.status})`} value={r.url} mono />
            ))}
            <Fact label="Final URL" value={`${result.finalUrl} · HTTP ${result.status}`} mono />
            <Fact label="Canonical (reported)" value={metadata.canonical} mono />
            <Fact label="og:url (reported)" value={metadata.og.url} mono />
            <Fact label="<title>" value={metadata.title} />
            <Fact label="meta description" value={metadata.description} />
            <Fact label="og:site_name" value={metadata.og.siteName} />
            <Fact label="og:type" value={metadata.og.type} />
            <Fact label="twitter:card" value={metadata.twitter.card} />
            <Fact label="twitter:site" value={metadata.twitter.site} />
            {metadata.twitter.labels.map((l, i) => (
              <Fact key={i} label={`twitter:label${i + 1} / data${i + 1}`} value={`${l.label}: ${l.data}`} />
            ))}
            <Fact label="robots" value={metadata.robots} />
            <Fact label="fb:app_id" value={metadata.fbAppId} />
            <Fact label="fediverse:creator" value={metadata.fediverseCreator} />
            <Fact label="theme-color" value={metadata.themeColor} />
            <Fact label="Favicon" value={metadata.favicon} mono />
            <Fact label="Apple touch icon" value={metadata.appleTouchIcon} mono />
          </dl>
          <details className="raw-tags">
            <summary>All {metadata.tags.length} meta tags, in document order</summary>
            <ol>
              {metadata.tags.map((t) => (
                <li key={t.index}>
                  <code>
                    {t.attr}=&quot;{t.key}&quot;
                  </code>{" "}
                  <span className="tag-value">{t.value}</span>
                </li>
              ))}
            </ol>
          </details>
        </section>

        <section aria-labelledby="tags-h">
          <div className="row spread">
            <h3 id="tags-h">Suggested tags</h3>
            <CopyButton text={result.suggestedTags} label="Copy suggested tags" className="btn btn-primary" />
          </div>
          <p className="small">
            Generated from the values this tool found, with HTML escaping applied. Lines marked <code>PLACEHOLDER</code> are
            guesses you must replace. <strong>Merge this into your page&apos;s existing &lt;head&gt;</strong> — replace tags you
            already have rather than adding duplicates.
          </p>
          <pre className="code-block" tabIndex={0}>
            <code>{result.suggestedTags}</code>
          </pre>
        </section>
      </div>
    </details>
  );
}

function roleOf(url: string, result: PreviewResult): string {
  const m = result.metadata;
  if (url === m.twitter.image) return "twitter:image";
  if (url === m.appleTouchIcon) return "apple-touch-icon";
  if (url === m.favicon) return "favicon";
  if (url.endsWith("/favicon.ico")) return "/favicon.ico (default location)";
  return "image";
}

function CheckLine({ check }: { check?: ImageCheck }) {
  if (!check) return <div className="small muted">Not checked (only the first few images are fetched).</div>;
  if (check.ok) {
    return (
      <div className="small ok-text">
        Measured {check.width}×{check.height} · {check.format.toUpperCase()} · {Math.max(1, Math.round(check.bytes / 1024))} KB
      </div>
    );
  }
  return <div className="small err-text">{check.message}</div>;
}

function FieldRow({ card, field, choice }: { card: string; field: string; choice: FieldChoice }) {
  return (
    <tr>
      <th scope="row">{card}</th>
      <td>{field}</td>
      <td className="value-cell">{choice.value ?? <span className="muted">— (none)</span>}</td>
      <td>
        {choice.source ? (
          <>
            <code>{choice.source}</code>
            {choice.fallback && <span className="src-fallback"> fallback</span>}
          </>
        ) : (
          <span className="src-fallback">missing: {choice.tried.join(", ")}</span>
        )}
      </td>
    </tr>
  );
}

/** Table rows for the simpler link cards: optional site name, title, optional description, image. */
function LinkRows({ card, data, siteName }: { card: string; data: LinkCard<Platform>; siteName?: boolean }) {
  return (
    <>
      {siteName && <FieldRow card={card} field="Site name" choice={data.siteName} />}
      <FieldRow card={card} field="Title" choice={data.title} />
      {data.description && <FieldRow card={card} field="Description" choice={data.description} />}
      <ImageRow card={card} field="Image" image={data.image} note={`Layout: ${data.imageLayout}`} />
    </>
  );
}

function ImageRow({ card, field, image, note }: { card: string; field: string; image?: CardImage; note?: string }) {
  const check = image?.check;
  return (
    <tr>
      <th scope="row">{card}</th>
      <td>{field}</td>
      <td className="value-cell">
        {image ? <span className="mono-url">{image.url}</span> : <span className="muted">— (none)</span>}
        {check?.ok && (
          <div className="small muted">
            {check.width}×{check.height} measured
          </div>
        )}
        {check && !check.ok && <div className="small err-text">{check.message}</div>}
        {note && <div className="small muted">{note}</div>}
      </td>
      <td>
        {image ? (
          <>
            <code>{image.source}</code>
            {image.fallback && <span className="src-fallback"> fallback</span>}
          </>
        ) : (
          <span className="muted">—</span>
        )}
      </td>
    </tr>
  );
}

function Fact({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={mono ? "mono-url" : undefined}>{value ?? <span className="muted">— (not set)</span>}</dd>
    </div>
  );
}
