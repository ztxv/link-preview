"use client";

/* eslint-disable @next/next/no-img-element -- capture is a blob URL produced by the worker */
import { useEffect, useRef, useState } from "react";
import { CAPTURE_PRESETS } from "@/lib/capture/presets";
import type { CapturePreset } from "@/lib/capture/presets";
import type { CaptureInfo } from "@/lib/preview/types";

type Capture =
  | { status: "loading" }
  | { status: "done"; src: string; info: CaptureInfo }
  | { status: "error"; code: string; message: string };

type PresetId = CapturePreset["id"];

const CAPTURE_ERRORS: Record<string, string> = {
  capture_unavailable: "Mobile capture isn't available in this deployment.",
  blocked_destination: "The capture browser refused this page because it points at a private or reserved address.",
  timeout: "The page took too long to load in the capture browser.",
  busy: "The capture worker is busy with other pages. Try again in a few seconds.",
  navigation_failed: "The capture browser couldn't load the page.",
  tls_error: "The capture browser rejected the site's HTTPS certificate.",
};

export function MobilePanel({ url, active }: { url: string; active: boolean }) {
  const [preset, setPreset] = useState<PresetId>("iphone");
  const [captures, setCaptures] = useState<Partial<Record<PresetId, Capture>>>({});
  const [available, setAvailable] = useState<boolean | null>(null);
  const urls = useRef<string[]>([]);

  useEffect(() => {
    if (!active || available !== null) return;
    let cancelled = false;
    fetch("/api/capture", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => !cancelled && setAvailable(!!d.available))
      .catch(() => !cancelled && setAvailable(false));
    return () => {
      cancelled = true;
    };
  }, [active, available]);

  useEffect(() => {
    const list = urls.current;
    return () => list.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  const capture = async (id: PresetId) => {
    setCaptures((c) => ({ ...c, [id]: { status: "loading" } }));
    try {
      const res = await fetch("/api/capture", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, preset: id }),
        cache: "no-store",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const code = err.code ?? "capture_failed";
        if (code === "capture_unavailable") setAvailable(false);
        setCaptures((c) => ({ ...c, [id]: { status: "error", code, message: CAPTURE_ERRORS[code] ?? err.message ?? "The capture failed." } }));
        return;
      }
      const info = JSON.parse(decodeURIComponent(res.headers.get("x-capture-info") || "%7B%7D")) as CaptureInfo;
      const blob = await res.blob();
      const src = URL.createObjectURL(blob);
      urls.current.push(src);
      setCaptures((c) => ({ ...c, [id]: { status: "done", src, info } }));
    } catch {
      setCaptures((c) => ({ ...c, [id]: { status: "error", code: "network", message: "Couldn't reach the app server." } }));
    }
  };

  const current = captures[preset];
  const p = CAPTURE_PRESETS[preset];

  return (
    <section className="mobile" aria-labelledby="mobile-h">
      <div className="mobile-controls">
        <h2 id="mobile-h" className="sim-label">
          Browser emulation
        </h2>
        <div className="seg-group" role="group" aria-label="Device preset">
          {Object.values(CAPTURE_PRESETS).map((pr) => (
            <button key={pr.id} type="button" className={`seg ${preset === pr.id ? "on" : ""}`} aria-pressed={preset === pr.id} onClick={() => setPreset(pr.id)}>
              {pr.id === "iphone" ? "iPhone" : "Android"} · {pr.label}
            </button>
          ))}
        </div>
        <div className="row gap">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => capture(preset)}
            disabled={current?.status === "loading" || available === false}
          >
            {current?.status === "loading" && <span className="spinner" aria-hidden="true" />}
            {current?.status === "loading" ? "Capturing…" : current?.status === "done" ? "Capture again" : "Capture screenshot"}
          </button>
          <a className="btn" href={url} target="_blank" rel="noopener noreferrer">
            Open original
          </a>
        </div>
        <p className="small muted">
          A real screenshot from a headless {p.engineLabel} browser at {p.viewport.width}×{p.viewport.height} CSS px, DPR{" "}
          {p.deviceScaleFactor}. It emulates the device; it isn&apos;t the device&apos;s own browser.
        </p>
        {available === false && (
          <div className="notice" role="status">
            <strong>Capture unavailable.</strong> This deployment has no capture worker running. The share cards still work —
            use <em>Open original</em> to check the page on a phone. Locally, start it with <code>npm run worker</code>.
          </div>
        )}
      </div>

      <div className="phone-wrap">
        <div className={`phone phone-${preset}`} style={{ width: p.viewport.width * 0.82 + 24 }}>
          <div className="phone-notch" aria-hidden="true" />
          <div className="phone-screen" style={{ height: p.viewport.height * 0.82 }} tabIndex={current?.status === "done" ? 0 : -1} aria-label="Scrollable page screenshot">
            {!current && <div className="phone-empty">Press “Capture screenshot” to render this page at {p.label} size.</div>}
            {current?.status === "loading" && (
              <div className="phone-empty" aria-busy="true">
                Rendering in {p.engineLabel}… this usually takes a few seconds.
              </div>
            )}
            {current?.status === "error" && (
              <div className="phone-empty error-text" role="alert">
                <p>{current.message}</p>
                {current.code !== "capture_unavailable" && current.code !== "blocked_destination" && (
                  <button type="button" className="btn" onClick={() => capture(preset)}>
                    Retry
                  </button>
                )}
              </div>
            )}
            {current?.status === "done" && (
              <img src={current.src} alt={`Screenshot of the page at ${p.label} size`} className="phone-shot" />
            )}
          </div>
        </div>
        {current?.status === "done" && (
          <dl className="capture-facts">
            <div>
              <dt>Viewport</dt>
              <dd>
                {current.info.viewport.width}×{current.info.viewport.height} CSS px · DPR {current.info.deviceScaleFactor}
              </dd>
            </div>
            <div>
              <dt>Engine</dt>
              <dd>
                {current.info.engine} {current.info.engineVersion}
              </dd>
            </div>
            <div>
              <dt>Page height</dt>
              <dd>
                {current.info.fullHeight} px{current.info.clipped ? " (screenshot clipped at 5000 px)" : ""}
              </dd>
            </div>
            <div>
              <dt>Captured in</dt>
              <dd>{(current.info.durationMs / 1000).toFixed(1)} s</dd>
            </div>
            {current.info.engineNote && <p className="notice small">{current.info.engineNote}</p>}
            {!!current.info.blockedRequests && (
              <p className="small muted">{current.info.blockedRequests} request(s) to non-public destinations were blocked.</p>
            )}
          </dl>
        )}
      </div>
    </section>
  );
}
