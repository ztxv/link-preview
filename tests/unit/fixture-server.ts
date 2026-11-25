/**
 * A real local HTTP server with fixture pages, used to exercise the actual
 * network code path (sockets, redirects, compression, limits).
 *
 * The production policy blocks loopback, so tests that talk to this server
 * pass a policy that allows exactly this server's origin and nothing else.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import zlib from "node:zlib";
import { checkAddress, checkUrl } from "../../src/lib/net/ip-policy.ts";
import type { DestinationPolicy } from "../../src/lib/net/safe-fetch.ts";

// 1×1 PNG and a 1200×630 PNG header (image-size only needs the header).
export const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
export function pngOfSize(width: number, height: number): Buffer {
  const buf = Buffer.from(PNG_1x1);
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

export interface FixtureServer {
  origin: string;
  port: number;
  policy: DestinationPolicy;
  hits: Record<string, number>;
  close(): Promise<void>;
}

export async function startFixtureServer(): Promise<FixtureServer> {
  const hits: Record<string, number> = {};
  let changing = 0;
  let origin = "";

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", origin);
    hits[url.pathname] = (hits[url.pathname] ?? 0) + 1;
    const html = (body: string, status = 200) => {
      res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
      res.end(body);
    };
    switch (url.pathname) {
      case "/rich":
        return html(`<!doctype html><html lang="en"><head>
<base href="/static/">
<title>Rich page title</title>
<meta name="description" content="Meta description">
<link rel="canonical" href="${origin}/rich">
<link rel="icon" href="fav.png" sizes="32x32">
<link rel="apple-touch-icon" href="/touch.png">
<meta property="og:title" content="OG title &amp; more">
<meta property="og:description" content="OG description">
<meta property="og:site_name" content="Fixture Co">
<meta property="og:image" content="img/hero.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Hero alt">
<meta property="og:image" content="${origin}/static/img/square.png">
<meta property="og:image:width" content="600">
<meta property="og:image:height" content="600">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="X-only title">
<meta name="twitter:description" content="X-only description">
<meta name="twitter:image" content="${origin}/static/img/x.png">
</head><body><p>hi</p></body></html>`);
      case "/plain":
        return html(`<!doctype html><html><head><title>Plain page</title></head><body>Hello</body></html>`);
      case "/campaign": {
        const v = url.searchParams.get("utm_campaign") ?? "none";
        return html(`<html><head><title>Campaign</title><meta property="og:title" content="Campaign ${v}"></head></html>`);
      }
      case "/redirect-1":
        res.writeHead(301, { location: "/redirect-2" });
        return res.end();
      case "/redirect-2":
        res.writeHead(302, { location: `${origin}/plain?from=redirect` });
        return res.end();
      case "/loop":
        res.writeHead(302, { location: "/loop" });
        return res.end();
      case "/to-metadata":
        res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
        return res.end();
      case "/to-localhost":
        res.writeHead(302, { location: `http://localhost:${(server.address() as AddressInfo).port}/plain` });
        return res.end();
      case "/broken":
        return html(`<html><head><title>Broken</title>
<meta property="og:title" content="Broken image page">
<meta property="og:image" content="/static/forbidden.png">
</head></html>`);
      case "/not-image":
        return html(`<html><head><meta property="og:title" content="t"><meta property="og:image" content="/static/fake.png"></head></html>`);
      case "/changing":
        changing++;
        return html(`<html><head><meta property="og:title" content="Revision ${changing}"></head></html>`);
      case "/gzip": {
        const body = zlib.gzipSync(`<html><head><meta property="og:title" content="Compressed"></head></html>`);
        res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
        return res.end(body);
      }
      case "/huge": {
        res.writeHead(200, { "content-type": "text/html" });
        res.write(`<html><head><meta property="og:title" content="Early tag"></head><body>`);
        res.end("x".repeat(4 * 1024 * 1024));
        return;
      }
      case "/slow":
        setTimeout(() => html("<title>slow</title>"), 15_000);
        return;
      case "/latin1":
        res.writeHead(200, { "content-type": "text/html; charset=iso-8859-1" });
        return res.end(Buffer.from(`<html><head><title>Caf\xe9</title></head></html>`, "latin1"));
      case "/404":
        return html("<title>Not found</title>", 404);
      case "/403":
        return html("<title>Denied</title>", 403);
      case "/static/img/hero.png":
        res.writeHead(200, { "content-type": "image/png" });
        return res.end(pngOfSize(1200, 630));
      case "/static/img/square.png":
        res.writeHead(200, { "content-type": "image/png" });
        return res.end(pngOfSize(600, 600));
      case "/static/img/x.png":
        res.writeHead(200, { "content-type": "image/png" });
        return res.end(pngOfSize(1200, 600));
      case "/static/fav.png":
      case "/touch.png":
        res.writeHead(200, { "content-type": "image/png" });
        return res.end(pngOfSize(180, 180));
      case "/static/forbidden.png":
        res.writeHead(403, { "content-type": "text/plain" });
        return res.end("Forbidden");
      case "/static/fake.png":
        // Claims to be PNG, is actually HTML.
        res.writeHead(200, { "content-type": "image/png" });
        return res.end("<html><script>alert(1)</script></html>");
      default:
        res.writeHead(404);
        return res.end();
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  origin = `http://127.0.0.1:${port}`;

  // Allow exactly this server; everything else goes through the real policy.
  const policy: DestinationPolicy = {
    checkUrl(input) {
      const url = new URL(String(input));
      if (url.hostname === "127.0.0.1" && url.port === String(port)) return { allowed: true, url };
      return checkUrl(url);
    },
    checkAddress(address) {
      if (address === "127.0.0.1" || address === "::ffff:127.0.0.1") {
        return { allowed: true, family: 4, normalized: "127.0.0.1" };
      }
      return checkAddress(address);
    },
  };

  return {
    origin,
    port,
    policy,
    hits,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
