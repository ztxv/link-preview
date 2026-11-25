/**
 * End-to-end tests of the fetch → parse → images → cards → issues pipeline
 * over real sockets against a local fixture server.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkAddress } from "../../src/lib/net/ip-policy.ts";
import { defaultPolicy, FetchError, guardedLookup, safeFetch } from "../../src/lib/net/safe-fetch.ts";
import type { DestinationPolicy } from "../../src/lib/net/safe-fetch.ts";
import { buildPreview } from "../../src/lib/preview/build.ts";
import { readImageToken } from "../../src/lib/preview/image-token.ts";
import type { PreviewResult } from "../../src/lib/preview/types.ts";
import { startFixtureServer } from "./fixture-server.ts";
import type { FixtureServer } from "./fixture-server.ts";

let srv: FixtureServer;
beforeAll(async () => {
  srv = await startFixtureServer();
});
afterAll(async () => {
  await srv.close();
});

async function preview(path: string): Promise<PreviewResult> {
  const res = await buildPreview(`${srv.origin}${path}`, { policy: srv.policy });
  if (!res.ok) throw new Error(`expected ok, got ${res.code}: ${res.message}`);
  return res;
}

describe("pipeline over real HTTP", () => {
  it("rich page: fields, image order, measured sizes, X differs from OG", async () => {
    const r = await preview("/rich");
    expect(r.metadata.og.images.map((i) => i.url)).toEqual([
      `${srv.origin}/static/img/hero.png`,
      `${srv.origin}/static/img/square.png`,
    ]);
    expect(r.metadata.favicon).toBe(`${srv.origin}/static/fav.png`);
    const hero = r.images.find((i) => i.url.endsWith("hero.png"));
    expect(hero).toMatchObject({ ok: true, width: 1200, height: 630, format: "png" });
    expect(hero?.ok && readImageToken(hero.proxy)).toBe(hero?.url);

    expect(r.cards.imessage.title.value).toBe("OG title & more");
    expect(r.cards.discord.title.value).toBe("OG title & more");
    expect(r.cards.discord.siteName.value).toBe("Fixture Co");
    expect(r.cards.x.title.value).toBe("X-only title");
    expect(r.cards.x.description.value).toBe("X-only description");
    expect(r.cards.x.image?.url).toBe(`${srv.origin}/static/img/x.png`);
    expect(r.cards.discord.image?.url).toBe(`${srv.origin}/static/img/hero.png`);
    expect(r.issues.find((i) => i.id === "relative-og:image")).toBeTruthy();
  });

  it("plain page: falls back to <title> and explains why", async () => {
    const r = await preview("/plain");
    expect(r.cards.imessage.title).toMatchObject({ value: "Plain page", source: "<title>" });
    expect(r.issues.map((i) => i.title)).toContain("iMessage is using the page title for the title because `og:title` is missing");
    expect(r.suggestedTags).toContain("PLACEHOLDER");
  });

  it("follows redirects and reports the chain and final URL", async () => {
    const r = await preview("/redirect-1");
    expect(r.redirected).toBe(true);
    expect(r.finalUrl).toBe(`${srv.origin}/plain?from=redirect`);
    expect(r.redirects.map((h) => h.status)).toEqual([301, 302]);
    expect(r.issues.some((i) => i.id === "redirected")).toBe(true);
  });

  it("treats query-string variants as distinct pages", async () => {
    const a = await preview("/campaign?utm_campaign=spring");
    const b = await preview("/campaign?utm_campaign=autumn");
    expect(a.requestedUrl).toBe(`${srv.origin}/campaign?utm_campaign=spring`);
    expect(a.cards.discord.title.value).toBe("Campaign spring");
    expect(b.cards.discord.title.value).toBe("Campaign autumn");
  });

  it("broken image: 403 is reported as this tool's result", async () => {
    const r = await preview("/broken");
    const img = r.images.find((i) => i.url.endsWith("forbidden.png"));
    expect(img).toMatchObject({ ok: false, code: "http_error", status: 403 });
    const issue = r.issues.find((i) => i.id === "image-failed-og:image");
    expect(issue?.title).toBe("The preview image (og:image) returned HTTP 403 to this tool");
    expect(issue?.scope).toBe("tool");
    expect(r.cards.imessage.layout).not.toBe("rich");
  });

  it("refuses to treat non-image bytes as an image, whatever Content-Type says", async () => {
    const r = await preview("/not-image");
    expect(r.images.find((i) => i.url.endsWith("fake.png"))).toMatchObject({ ok: false, code: "not_image" });
  });

  it("refresh picks up changed metadata (no caching of pages)", async () => {
    const one = await preview("/changing");
    const two = await preview("/changing");
    expect(one.metadata.og.title).not.toBe(two.metadata.og.title);
    expect(two.metadata.og.title).toMatch(/^Revision \d+$/);
  });

  it("decompresses gzip and decodes legacy charsets", async () => {
    expect((await preview("/gzip")).metadata.og.title).toBe("Compressed");
    expect((await preview("/latin1")).metadata.title).toBe("Café");
  });

  it("stops reading large pages but keeps early tags", async () => {
    const r = await preview("/huge");
    expect(r.truncated).toBe(true);
    expect(r.bytes).toBe(3 * 1024 * 1024);
    expect(r.metadata.og.title).toBe("Early tag");
  });

  it("maps HTTP errors to plain-language failures", async () => {
    const notFound = await buildPreview(`${srv.origin}/404`, { policy: srv.policy });
    expect(notFound).toMatchObject({ ok: false, code: "http_error", status: 404 });
    const denied = await buildPreview(`${srv.origin}/403`, { policy: srv.policy });
    expect(denied).toMatchObject({ ok: false, code: "blocked_page", retryable: true });
  });

  it("bounds redirects and time", async () => {
    const loop = await buildPreview(`${srv.origin}/loop`, { policy: srv.policy });
    expect(loop).toMatchObject({ ok: false, code: "too_many_redirects" });
    await expect(safeFetch(`${srv.origin}/slow`, { policy: srv.policy, timeoutMs: 500 })).rejects.toMatchObject({ code: "timeout" });
  });
});

describe("destination policy", () => {
  it("rejects private, loopback, link-local and reserved targets up front", async () => {
    for (const url of [
      "http://127.0.0.1/",
      "http://localhost:3000/",
      "http://10.0.0.1/",
      "http://192.168.0.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]/",
      "http://[fe80::1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://0.0.0.0/",
      "file:///etc/passwd",
    ]) {
      const res = await buildPreview(url);
      expect(res.ok, url).toBe(false);
      if (!res.ok) expect(["blocked_destination", "invalid_url"]).toContain(res.code);
    }
  });

  it("re-validates every redirect hop", async () => {
    const plainHitsBefore = srv.hits["/plain"] ?? 0;
    const meta = await buildPreview(`${srv.origin}/to-metadata`, { policy: srv.policy });
    expect(meta).toMatchObject({ ok: false, code: "blocked_destination" });
    const local = await buildPreview(`${srv.origin}/to-localhost`, { policy: srv.policy });
    expect(local).toMatchObject({ ok: false, code: "blocked_destination" });
    // The redirect target (same server, reached via "localhost") was never fetched.
    expect(srv.hits["/plain"] ?? 0).toBe(plainHitsBefore);
  });

  it("enforces the policy at connection time, even if a URL check is bypassed", async () => {
    // A policy whose URL check lets everything through: the guarded DNS lookup
    // must still refuse to connect to loopback.
    const permissiveUrls: DestinationPolicy = { checkUrl: (u) => ({ allowed: true, url: new URL(String(u)) }), checkAddress };
    const err = await safeFetch(`http://localhost:${srv.port}/plain`, { policy: permissiveUrls }).catch((e) => e);
    expect(err).toBeInstanceOf(FetchError);
    expect(err.code).toBe("blocked_destination");
    // Literal IPs skip DNS, so they're checked separately before connecting.
    const lit = await safeFetch(`http://127.0.0.1:${srv.port}/plain`, { policy: permissiveUrls }).catch((e) => e);
    expect(lit.code).toBe("blocked_destination");
  });

  it("the guarded lookup rejects names that resolve to non-public addresses", async () => {
    const lookup = guardedLookup(defaultPolicy);
    const err = await new Promise<Error | null>((resolve) =>
      lookup("localhost", { all: true }, (e: NodeJS.ErrnoException | null) => resolve(e)),
    );
    expect(err).toBeInstanceOf(FetchError);
  });
});

describe("bundled example (offline)", () => {
  it("serves the demo site in-process", async () => {
    const r = await buildPreview("https://demo.link-preview.test/spring-launch?utm_source=newsletter");
    if (!r.ok) throw new Error(r.message);
    expect(r.cards.x.title.value).toMatch(/40% off/);
    expect(r.cards.imessage.title.value).toMatch(/Introducing Fieldnote 2/);
    expect(r.images.filter((i) => i.ok).length).toBeGreaterThanOrEqual(4);
  });
  it("redirect, broken image and variants behave as labelled", async () => {
    const red = await buildPreview("https://demo.link-preview.test/old-launch");
    expect(red.ok && red.redirected && red.finalUrl).toBe("https://demo.link-preview.test/spring-launch?from=old-launch");
    const broken = await buildPreview("https://demo.link-preview.test/broken-image");
    expect(broken.ok && broken.issues.some((i) => i.id === "image-failed-og:image")).toBe(true);
    const b = await buildPreview("https://demo.link-preview.test/spring-launch?variant=b");
    expect(b.ok && b.cards.discord.title.value).toBe("Plan less, ship more with Fieldnote 2");
  });
});
