/**
 * The bundled example site, served in-process at https://demo.link-preview.test.
 *
 * `.test` is a reserved TLD that never resolves on the public internet, so this
 * host can never collide with a real site. Requests for it are answered from
 * this module instead of the network by the fetcher and the capture worker.
 */
import { DEMO_ASSETS } from "./assets.ts";
import { DEMO_ORIGIN } from "./site-info.ts";

export { DEMO_EXAMPLE_URL, DEMO_HOST, DEMO_ORIGIN, DEMO_PAGES } from "./site-info.ts";

interface DemoResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  truncated: boolean;
}

let changingCounter = 0;

function html(body: string, status = 200): DemoResponse {
  return {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    body: Buffer.from(body, "utf8"),
    truncated: false,
  };
}

function text(body: string, status: number): DemoResponse {
  return {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
    body: Buffer.from(body, "utf8"),
    truncated: false,
  };
}

const pageStyles = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, "Segoe UI", Roboto, system-ui, sans-serif; color: #1c2230; background: #f7f7fb; line-height: 1.5; }
  header { display: flex; align-items: center; justify-content: space-between; padding: 14px 20px; background: #fff; border-bottom: 1px solid #e6e8ef; position: sticky; top: 0; }
  header b { font-size: 18px; } header a { color: #2f6fdf; text-decoration: none; font-weight: 600; font-size: 15px; }
  .hero { padding: 36px 20px 28px; background: linear-gradient(135deg, var(--a), var(--b)); color: #fff; }
  .hero h1 { font-size: clamp(30px, 8vw, 54px); line-height: 1.05; margin: 0 0 12px; }
  .hero p { font-size: 18px; margin: 0 0 22px; opacity: .95; max-width: 560px; }
  .btn { display: inline-block; background: #fff; color: #1c2230; padding: 12px 20px; border-radius: 10px; font-weight: 700; text-decoration: none; }
  main { padding: 24px 20px 40px; max-width: 880px; margin: 0 auto; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; }
  .card { background: #fff; border: 1px solid #e6e8ef; border-radius: 14px; padding: 18px; }
  .card h3 { margin: 0 0 6px; font-size: 17px; }
  .card p { margin: 0; color: #555d70; font-size: 15px; }
  figure { margin: 24px 0; } figure img { width: 100%; height: auto; border-radius: 14px; display: block; }
  footer { padding: 24px 20px 48px; color: #7a8194; font-size: 13px; text-align: center; }
`;

function landing(opts: { head: string; title: string; lead: string; a: string; b: string; heroImg: string; extra?: string }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${opts.head}
<style>${pageStyles}</style>
</head>
<body style="--a:${opts.a};--b:${opts.b}">
<header><b>Fieldnote</b><a href="/spring-launch">Get the app</a></header>
<section class="hero">
  <h1>${opts.title}</h1>
  <p>${opts.lead}</p>
  <a class="btn" href="/spring-launch">Start free trial</a>
</section>
<main>
  <div class="grid">
    <div class="card"><h3>Auto-sorted notebooks</h3><p>Notes file themselves by project, person and date.</p></div>
    <div class="card"><h3>Offline first</h3><p>Everything works on the train, syncs when you're back.</p></div>
    <div class="card"><h3>Share in one tap</h3><p>Send a clean read-only link to anyone.</p></div>
  </div>
  <figure><img src="${opts.heroImg}" alt="Fieldnote 2 product artwork" width="1200" height="630"></figure>
  ${opts.extra ?? ""}
  <div class="grid">
    <div class="card"><h3>Templates</h3><p>Meeting notes, research logs and trip plans ready to go.</p></div>
    <div class="card"><h3>Search that reads handwriting</h3><p>Find the sketch you made last March in seconds.</p></div>
  </div>
</main>
<footer>Fieldnote is a fictional product used by Link Preview Studio's bundled example.</footer>
</body>
</html>`;
}

const icons = `
<link rel="icon" type="image/png" sizes="32x32" href="/favicon.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">`;

function springLaunch(url: URL): DemoResponse {
  const variantB = url.searchParams.get("variant") === "b";
  const canonical = `${DEMO_ORIGIN}/spring-launch`;
  const ogUrl = variantB ? `${DEMO_ORIGIN}/spring-launch?variant=b` : canonical;
  const ogTitle = variantB
    ? "Plan less, ship more with Fieldnote 2"
    : "Introducing Fieldnote 2: notes that organize themselves";
  const ogDesc = variantB
    ? "Variant B: the planning-focused landing page for teams that live in their notes."
    : "Fieldnote 2 files every note by project, person and date — automatically. Works offline, syncs everywhere, and shares in one tap.";
  const hero = variantB ? "hero-b.jpg" : "hero-a.jpg";
  const head = `
<title>Fieldnote 2 — Spring Launch${variantB ? " (B)" : ""}</title>
<meta name="description" content="Fieldnote 2 is the notes app that sorts itself. Try it free for 30 days.">
<link rel="canonical" href="${canonical}">
<meta name="theme-color" content="#7b4ce0">
${icons}
<meta property="og:type" content="website">
<meta property="og:site_name" content="Fieldnote">
<meta property="og:url" content="${ogUrl}">
<meta property="og:title" content="${ogTitle}">
<meta property="og:description" content="${ogDesc}">
<meta property="og:image" content="${DEMO_ORIGIN}/assets/${hero}">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Fieldnote 2 hero artwork with a tilted note card">
<meta property="og:image" content="${DEMO_ORIGIN}/assets/square.png">
<meta property="og:image:width" content="1080">
<meta property="og:image:height" content="1080">
<meta property="og:image:alt" content="Square Fieldnote 2 badge">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@fieldnote_demo">
<meta name="twitter:title" content="Spring Launch: 40% off Fieldnote 2 for early birds &amp; teams">
<meta name="twitter:description" content="Early-bird pricing ends Sunday. Grab Fieldnote 2 for 40% off.">
<meta name="twitter:image" content="${DEMO_ORIGIN}/assets/x-card.jpg">
<meta name="twitter:image:alt" content="Dark promo banner announcing 40% off">`;
  return html(
    landing({
      head,
      title: variantB ? "Plan less. Ship more." : "Notes that organize themselves.",
      lead: variantB
        ? "Variant B of the spring landing page, with a planning angle."
        : "Fieldnote 2 sorts every note by project, person and date — automatically.",
      a: variantB ? "#0f8f6f" : "#2f6fdf",
      b: variantB ? "#2b6cb0" : "#7b4ce0",
      heroImg: `/assets/${hero}`,
    }),
  );
}

function plain(): DemoResponse {
  return html(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Fieldnote changelog — plain page with no share tags</title>
<link rel="icon" href="/favicon.png">
</head>
<body style="font-family: Georgia, serif; max-width: 640px; margin: 0 auto; padding: 24px; line-height: 1.6">
<h1>Changelog</h1>
<p>This page has a document title and a favicon, but no description, no Open Graph tags, and no Twitter Card tags. It also has no viewport meta tag, so phones render it zoomed out.</p>
<h2>2.0.3</h2><ul><li>Faster sync on large notebooks.</li><li>Fixed a crash when pasting tables.</li></ul>
<h2>2.0.2</h2><ul><li>Handwriting search now supports Portuguese.</li></ul>
</body>
</html>`);
}

function brokenImage(): DemoResponse {
  const head = `
<title>Fieldnote for Teams</title>
<meta name="description" content="Shared notebooks, permissions and admin controls for teams of any size.">
${icons}
<meta property="og:title" content="Fieldnote for Teams">
<meta property="og:description" content="Shared notebooks, permissions and admin controls for teams of any size.">
<meta property="og:image" content="/assets/teams-hero.png">`;
  return html(
    landing({
      head,
      title: "Fieldnote for Teams",
      lead: "This example's og:image is a relative URL that returns HTTP 403, and there is no twitter:card tag.",
      a: "#9a3412",
      b: "#b45309",
      heroImg: "/assets/hero-a.jpg",
    }),
  );
}

function changing(): DemoResponse {
  changingCounter += 1;
  const n = changingCounter;
  const head = `
<title>Live pricing — revision ${n}</title>
<meta name="description" content="This page changes its metadata every time it is fetched.">
${icons}
<meta property="og:title" content="Fieldnote pricing (revision ${n})">
<meta property="og:description" content="Fetched ${n} time${n === 1 ? "" : "s"} since the server started. Press Refresh to see the number change.">
<meta property="og:image" content="${DEMO_ORIGIN}/assets/${n % 2 ? "hero-a.jpg" : "hero-b.jpg"}">
<meta name="twitter:card" content="${n % 2 ? "summary_large_image" : "summary"}">`;
  return html(
    landing({
      head,
      title: `Pricing, revision ${n}`,
      lead: "Each fetch bumps the revision number in the title and swaps the image.",
      a: "#334155",
      b: "#475569",
      heroImg: "/assets/hero-b.jpg",
    }),
  );
}

function diagnostics(): DemoResponse {
  const head = `
<title>Fieldnote Handbook: everything you need to know about organizing notes, projects, people and dates in one place</title>
<meta name="description" content="A long description that goes on and on about how Fieldnote files every note by project, person and date, works offline on trains and planes, syncs the moment you reconnect, and lets you share a clean read-only link with anyone in one tap.">
<meta name="robots" content="noindex, nofollow">
${icons}
<meta property="og:type" content="article">
<meta property="og:site_name" content="Fieldnote">
<meta property="og:title" content="Fieldnote Handbook">
<meta property="og:description" content="Everything you need to know about organizing notes, projects, people and dates in one place.">
<meta property="og:image" content="${DEMO_ORIGIN}/assets/touch-icon.png">
<meta name="twitter:card" content="summary">
<meta name="twitter:label1" content="Written by">
<meta name="twitter:data1" content="The Fieldnote team">
<meta name="twitter:label2" content="Reading time">
<meta name="twitter:data2" content="4 min">`;
  return html(
    landing({
      head,
      title: "The Fieldnote Handbook",
      lead: "A deliberately imperfect page: a 180×180 og:image, a noindex robots tag, very long text and Slack label tags.",
      a: "#475569",
      b: "#7b4ce0",
      heroImg: "/assets/hero-b.jpg",
    }),
  );
}

function asset(name: string): DemoResponse | null {
  const b64 = DEMO_ASSETS[name];
  if (!b64) return null;
  const type = name.endsWith(".jpg") ? "image/jpeg" : "image/png";
  return {
    status: 200,
    headers: { "content-type": type, "cache-control": "public, max-age=3600" },
    body: Buffer.from(b64, "base64"),
    truncated: false,
  };
}

/** Answer a request for the demo host. */
export function demoResponse(url: URL): DemoResponse {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  switch (path) {
    case "/":
      return { status: 302, headers: { location: "/spring-launch" }, body: Buffer.alloc(0), truncated: false };
    case "/spring-launch":
      return springLaunch(url);
    case "/plain":
      return plain();
    case "/old-launch":
      return {
        status: 301,
        headers: { location: "/spring-launch?from=old-launch" },
        body: Buffer.alloc(0),
        truncated: false,
      };
    case "/broken-image":
      return brokenImage();
    case "/changing":
      return changing();
    case "/diagnostics":
      return diagnostics();
    case "/favicon.png":
    case "/favicon.ico":
      return asset("favicon.png")!;
    case "/apple-touch-icon.png":
      return asset("touch-icon.png")!;
    case "/assets/teams-hero.png":
      return text("Forbidden", 403);
  }
  if (path.startsWith("/assets/")) {
    const found = asset(path.slice("/assets/".length));
    if (found) return found;
  }
  return html(
    `<!doctype html><html><head><title>Not found</title></head><body><h1>404</h1></body></html>`,
    404,
  );
}
