"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { DEMO_EXAMPLE_URL, DEMO_ORIGIN, DEMO_PAGES } from "@/lib/demo/site-info";
import { normalizeInput } from "@/lib/preview/normalize";
import type { Platform, PreviewError, PreviewResponse, PreviewResult } from "@/lib/preview/types";
import { BrandMark } from "./BrandMark";
import { CardsView } from "./CardsView";
import { CopyButton } from "./CopyButton";
import { MetadataPanel } from "./MetadataPanel";
import { MobilePanel } from "./MobilePanel";
import { ThemeToggle } from "./ThemeToggle";

type State =
  | { phase: "idle" }
  | { phase: "loading"; url: string; previous?: PreviewResult }
  | { phase: "done"; result: PreviewResult }
  | { phase: "error"; url: string; error: PreviewError };

type Tab = "cards" | "mobile";

export function Workbench() {
  const [input, setInput] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [state, setState] = useState<State>({ phase: "idle" });
  const [tab, setTab] = useState<Tab>("cards");
  // Platforms the user switched off; kept here so it survives re-checks.
  const [hidden, setHidden] = useState<Platform[]>([]);
  const togglePlatform = (id: Platform) => setHidden((h) => (h.includes(id) ? h.filter((x) => x !== id) : [...h, id]));
  const requestId = useRef(0);
  const errorRef = useRef<HTMLDivElement>(null);
  const inputId = useId();

  const run = useCallback(async (raw: string) => {
    const normalized = normalizeInput(raw);
    if (!normalized.ok) {
      setInputError(normalized.message);
      return;
    }
    setInputError(null);
    const id = ++requestId.current;
    setState((s) => ({
      phase: "loading",
      url: normalized.url,
      previous: s.phase === "done" && s.result.requestedUrl === normalized.url ? s.result : undefined,
    }));
    let data: PreviewResponse;
    try {
      const res = await fetch("/api/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: normalized.url }),
        cache: "no-store",
      });
      data = (await res.json()) as PreviewResponse;
    } catch {
      data = {
        ok: false,
        code: "internal",
        title: "Couldn't reach Link Preview Studio",
        message: "The app's server didn't respond. Check that it's still running, then retry.",
        retryable: true,
      };
    }
    if (id !== requestId.current) return; // a newer request superseded this one
    setState(data.ok ? { phase: "done", result: data } : { phase: "error", url: normalized.url, error: data });
  }, []);

  useEffect(() => {
    if (state.phase === "error") errorRef.current?.focus();
  }, [state]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    run(input);
  };

  const tryExample = (url = DEMO_EXAMPLE_URL) => {
    setInput(url);
    setTab("cards");
    run(url);
  };

  const result = state.phase === "done" ? state.result : state.phase === "loading" ? state.previous : undefined;
  const loading = state.phase === "loading";
  const activeUrl = state.phase === "done" ? state.result.requestedUrl : state.phase === "idle" ? undefined : state.url;

  return (
    <div className="shell">
      <div className="progress" data-active={loading} aria-hidden="true">
        <span />
      </div>
      <header className="topbar">
        <div className="brand">
          <BrandMark />
          <span>Link Preview Studio</span>
        </div>
        <div className="topbar-end">
          <span className="topbar-note">Local QA workbench · no accounts, no tracking</span>
          <ThemeToggle />
        </div>
      </header>

      <main className="main">
        <section className="url-panel" aria-label="Check a link">
          <form className="url-form" onSubmit={onSubmit} noValidate>
            <label id={`${inputId}-label`} htmlFor={inputId} className="url-label">
              Page URL
            </label>
            <div className="url-row">
              <input
                id={inputId}
                className="url-input"
                type="text"
                inputMode="url"
                autoComplete="url"
                spellCheck={false}
                placeholder="yoursite.com/landing-page?utm_campaign=spring"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                aria-invalid={!!inputError}
                aria-describedby={inputError ? `${inputId}-err` : `${inputId}-hint`}
              />
              <button className="btn btn-primary" type="submit" disabled={loading}>
                {loading && <span className="spinner" aria-hidden="true" />}
                {loading ? "Checking…" : "Preview link"}
              </button>
              <button className="btn" type="button" onClick={() => tryExample()} disabled={loading}>
                Try example
              </button>
            </div>
            {inputError ? (
              <p id={`${inputId}-err`} className="field-error" role="alert">
                {inputError}
              </p>
            ) : (
              <p id={`${inputId}-hint`} className="field-hint">
                Bare hostnames get <code>https://</code>. Path and query string are kept, so each landing page or campaign
                URL is checked on its own.
              </p>
            )}
          </form>
          <nav className="examples" aria-label="Bundled example pages">
            <span>Example pages:</span>
            {DEMO_PAGES.map((p) => (
              <button key={p.path} type="button" className="link-btn" onClick={() => tryExample(`${DEMO_ORIGIN}${p.path}`)} disabled={loading}>
                {p.label}
              </button>
            ))}
          </nav>
        </section>

        <div className="sr-only" aria-live="polite">
          {loading ? "Fetching page metadata…" : state.phase === "done" ? "Preview ready." : ""}
        </div>

        {state.phase === "idle" && <EmptyState onExample={() => tryExample()} />}

        {state.phase === "error" && (
          <div className="error-card" role="alert" tabIndex={-1} ref={errorRef}>
            <h2>{state.error.title}</h2>
            <p>{state.error.message}</p>
            {state.error.code === "blocked_page" && (
              <p className="muted small">This is what this tool received; it doesn&apos;t prove how each platform&apos;s crawler is treated.</p>
            )}
            <div className="row gap">
              {state.error.retryable && (
                <button className="btn btn-primary" type="button" onClick={() => run(state.url)}>
                  Retry
                </button>
              )}
              {state.error.code !== "blocked_destination" && state.error.code !== "invalid_url" && (
                <a className="btn" href={state.url} target="_blank" rel="noopener noreferrer">
                  Open original
                </a>
              )}
            </div>
          </div>
        )}

        {(result || loading) && (
          <>
            {result ? (
              <ResultBar result={result} loading={loading} onRefresh={() => run(result.requestedUrl)} />
            ) : (
              <div className="result-bar" aria-busy="true">
                <span className="muted">Fetching {activeUrl}…</span>
              </div>
            )}

            <div className="tabs" role="tablist" aria-label="Preview views">
              {(["cards", "mobile"] as const).map((t) => (
                <button
                  key={t}
                  role="tab"
                  id={`tab-${t}`}
                  aria-controls={`panel-${t}`}
                  aria-selected={tab === t}
                  tabIndex={tab === t ? 0 : -1}
                  className="tab"
                  onClick={() => setTab(t)}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                      const next = t === "cards" ? "mobile" : "cards";
                      setTab(next);
                      document.getElementById(`tab-${next}`)?.focus();
                    }
                  }}
                >
                  {t === "cards" ? "Share cards" : "Mobile page"}
                </button>
              ))}
            </div>

            <div role="tabpanel" id="panel-cards" aria-labelledby="tab-cards" hidden={tab !== "cards"}>
              {result ? (
                <div className={loading ? "stale" : undefined} aria-busy={loading}>
                  <CardsView key={result.fetchedAt} result={result} hidden={hidden} onToggle={togglePlatform} onShowAll={() => setHidden([])} />
                  <MetadataPanel result={result} hidden={hidden} />
                </div>
              ) : (
                <CardsSkeleton />
              )}
            </div>
            <div role="tabpanel" id="panel-mobile" aria-labelledby="tab-mobile" hidden={tab !== "mobile"}>
              {activeUrl && <MobilePanel key={`${activeUrl}|${result?.fetchedAt ?? ""}`} url={activeUrl} active={tab === "mobile"} />}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function ResultBar({ result, loading, onRefresh }: { result: PreviewResult; loading: boolean; onRefresh: () => void }) {
  const checked = new Date(result.fetchedAt);
  return (
    <div className="result-bar">
      <dl className="result-facts">
        <div>
          <dt>Checked</dt>
          <dd className="mono-url">{result.requestedUrl}</dd>
        </div>
        {result.redirected && (
          <div>
            <dt>Redirected to</dt>
            <dd className="mono-url">{result.finalUrl}</dd>
          </div>
        )}
        <div>
          <dt>Last checked</dt>
          <dd>
            <time dateTime={result.fetchedAt} suppressHydrationWarning>
              {checked.toLocaleTimeString()}
            </time>
          </dd>
        </div>
      </dl>
      <div className="row gap">
        <button className="btn" type="button" onClick={onRefresh} disabled={loading}>
          {loading && <span className="spinner" aria-hidden="true" />}
          {loading ? "Refreshing…" : "Refresh"}
        </button>
        <CopyButton text={result.requestedUrl} label="Copy link" />
      </div>
    </div>
  );
}

function EmptyState({ onExample }: { onExample: () => void }) {
  return (
    <section className="empty">
      <h1>How will your link look when it&apos;s shared?</h1>
      <p>
        Paste a page from your site to see simulated previews for iMessage, Discord, X, Slack, WhatsApp, Telegram, Facebook,
        LinkedIn, Reddit, Bluesky, Mastodon and Google, a real phone screenshot, and a prioritized list of tags to fix.
      </p>
      <button className="btn" type="button" onClick={onExample}>
        Explore the bundled example
      </button>
    </section>
  );
}

function CardsSkeleton() {
  return (
    <div className="cards-grid" aria-hidden="true">
      {["iMessage", "Discord", "X (Twitter)"].map((n) => (
        <div key={n} className="card-frame skeleton">
          <div className="card-frame-head">{n}</div>
          <div className="skel-block" />
          <div className="skel-line" />
          <div className="skel-line short" />
        </div>
      ))}
    </div>
  );
}
