/**
 * Fetching untrusted URLs.
 *
 * - The destination policy is enforced inside the socket `lookup` hook, so the
 *   address that gets checked is the address that gets connected to (no
 *   check-then-connect gap for DNS rebinding). The connected socket's remote
 *   address is checked again before any response bytes are read.
 * - Redirects are followed manually; every hop is re-validated.
 * - Time, redirects, decompressed bytes and concurrency are all bounded.
 * - Requests are anonymous: no cookies, no auth, no referrer.
 */
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import type { LookupFunction, Socket } from "node:net";
import { isIP } from "node:net";
import zlib from "node:zlib";
import type { Readable } from "node:stream";
import { checkAddress, checkUrl } from "./ip-policy.ts";
import type { AddressVerdict, UrlVerdict } from "./ip-policy.ts";
import { DEMO_HOST, demoResponse } from "../demo/site.ts";

export type FetchErrorCode =
  | "invalid_url"
  | "blocked_destination"
  | "dns_failed"
  | "timeout"
  | "too_large"
  | "too_many_redirects"
  | "connection_failed"
  | "tls_error"
  | "busy";

export class FetchError extends Error {
  code: FetchErrorCode;
  constructor(code: FetchErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "FetchError";
  }
}

export interface DestinationPolicy {
  checkUrl(url: string | URL): UrlVerdict;
  checkAddress(address: string): AddressVerdict;
}

export const defaultPolicy: DestinationPolicy = { checkUrl, checkAddress };

export interface FetchOptions {
  /** Total budget across all redirect hops. */
  timeoutMs?: number;
  /** Limit on decompressed body bytes. */
  maxBytes?: number;
  /** When true, stop reading at maxBytes and mark the result truncated instead of failing. */
  truncate?: boolean;
  maxRedirects?: number;
  accept?: string;
  policy?: DestinationPolicy;
  /** Extra abort signal (e.g. the incoming request). */
  signal?: AbortSignal;
}

export interface RedirectHop {
  url: string;
  status: number;
}

export interface FetchResult {
  url: string;
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  truncated: boolean;
  redirects: RedirectHop[];
}

export interface HopResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  truncated: boolean;
}

export const USER_AGENT =
  "Mozilla/5.0 (compatible; LinkPreviewStudio/1.0; link preview QA tool)";

const DEFAULTS = {
  timeoutMs: 10_000,
  maxBytes: 3 * 1024 * 1024,
  maxRedirects: 5,
  accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
};

// ---------------------------------------------------------------------------
// Concurrency limit shared by every outbound request in this process.

const MAX_CONCURRENT = Number(process.env.LPS_MAX_CONCURRENT_FETCHES || 8);
const QUEUE_WAIT_MS = 5_000;
let active = 0;
const waiters: Array<() => void> = [];

async function acquire(): Promise<() => void> {
  if (active >= MAX_CONCURRENT) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = waiters.indexOf(go);
        if (i !== -1) waiters.splice(i, 1);
        reject(new FetchError("busy", "Too many checks are running. Try again in a moment."));
      }, QUEUE_WAIT_MS);
      function go() {
        clearTimeout(timer);
        resolve();
      }
      waiters.push(go);
    });
  }
  active++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    active--;
    waiters.shift()?.();
  };
}

// ---------------------------------------------------------------------------

function blocked(reason: string): FetchError {
  return new FetchError("blocked_destination", `Blocked destination: ${reason}.`);
}

/** A `lookup` that refuses to hand the socket any non-public address. */
export function guardedLookup(policy: DestinationPolicy = defaultPolicy): LookupFunction {
  return (hostname, options, callback) => {
    dns.lookup(hostname, { all: true, order: "verbatim" }, (err, addresses) => {
      if (err) return callback(err, "", 4);
      if (!addresses.length) {
        return callback(Object.assign(new Error("no addresses"), { code: "ENOTFOUND" }), "", 4);
      }
      // Reject if *any* answer is non-public: mixed answers are a rebinding signal.
      for (const a of addresses) {
        const verdict = policy.checkAddress(a.address);
        if (!verdict.allowed) return callback(blocked(`${hostname} resolves to a ${verdict.reason}`), "", 4);
      }
      const wanted = options.family === 6 ? 6 : options.family === 4 ? 4 : 0;
      const usable = wanted ? addresses.filter((a) => a.family === wanted) : addresses;
      const list = usable.length ? usable : addresses;
      if (options.all) {
        (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
      } else {
        callback(null, list[0].address, list[0].family);
      }
    });
  };
}

function headerRecord(raw: http.IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined) continue;
    out[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : String(v);
  }
  return out;
}

function decoded(res: http.IncomingMessage): Readable {
  const enc = String(res.headers["content-encoding"] || "").trim().toLowerCase();
  if (enc === "gzip" || enc === "x-gzip") return res.pipe(zlib.createGunzip());
  if (enc === "deflate") return res.pipe(zlib.createInflate());
  if (enc === "br") return res.pipe(zlib.createBrotliDecompress());
  return res;
}

async function readCapped(
  stream: Readable,
  maxBytes: number,
  truncate: boolean,
): Promise<{ body: Buffer; truncated: boolean }> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (size + buf.length > maxBytes) {
      if (!truncate) throw new FetchError("too_large", `Response is larger than ${formatBytes(maxBytes)}.`);
      chunks.push(buf.subarray(0, maxBytes - size));
      stream.destroy();
      return { body: Buffer.concat(chunks), truncated: true };
    }
    chunks.push(buf);
    size += buf.length;
  }
  return { body: Buffer.concat(chunks), truncated: false };
}

export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(n % (1024 * 1024) ? 1 : 0)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} bytes`;
}

function networkHop(
  url: URL,
  opts: { signal: AbortSignal; accept: string; maxBytes: number; truncate: boolean; policy: DestinationPolicy },
): Promise<HopResponse> {
  return new Promise<HopResponse>((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const hostname = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;
    // Node skips `lookup` for literal IPs, so judge those directly.
    if (isIP(hostname)) {
      const verdict = opts.policy.checkAddress(hostname);
      if (!verdict.allowed) return reject(blocked(verdict.reason));
    }
    let settled = false;
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    const req = lib.request(
      url,
      {
        method: "GET",
        agent: false,
        lookup: guardedLookup(opts.policy),
        signal: opts.signal,
        headers: {
          "user-agent": USER_AGENT,
          accept: opts.accept,
          "accept-language": "en-US,en;q=0.8",
          "accept-encoding": "gzip, deflate, br",
        },
      },
      (res) => {
        const remote = res.socket?.remoteAddress;
        if (remote) {
          const verdict = opts.policy.checkAddress(remote);
          if (!verdict.allowed) {
            res.destroy();
            return fail(blocked(verdict.reason));
          }
        }
        const status = res.statusCode || 0;
        const headers = headerRecord(res.headers);
        if (status >= 300 && status < 400 && headers.location) {
          res.resume();
          settled = true;
          return resolve({ status, headers, body: Buffer.alloc(0), truncated: false });
        }
        readCapped(decoded(res), opts.maxBytes, opts.truncate).then(
          ({ body, truncated }) => {
            if (settled) return;
            settled = true;
            resolve({ status, headers, body, truncated });
          },
          (err) => {
            res.destroy();
            fail(err);
          },
        );
      },
    );
    req.on("socket", (socket: Socket) => {
      const check = () => {
        const remote = socket.remoteAddress;
        if (!remote) return;
        const verdict = opts.policy.checkAddress(remote);
        if (!verdict.allowed) req.destroy(blocked(verdict.reason));
      };
      socket.once("connect", check);
      socket.once("secureConnect", check);
    });
    req.on("error", fail);
    req.end();
  });
}

function translateError(err: unknown, signal: AbortSignal): FetchError {
  if (err instanceof FetchError) return err;
  const e = err as NodeJS.ErrnoException & { cause?: unknown };
  if (e?.cause instanceof FetchError) return e.cause;
  if (signal.aborted || e?.name === "AbortError" || e?.code === "ABORT_ERR") {
    return new FetchError("timeout", "The site took too long to respond.");
  }
  const code = String(e?.code || "");
  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "EAI_NODATA" || code === "EAI_NONAME") {
    return new FetchError("dns_failed", "The hostname could not be found. Check the spelling.");
  }
  if (/CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_SSL/i.test(code) || /certificate|ssl/i.test(String(e?.message))) {
    return new FetchError("tls_error", "The site's HTTPS certificate could not be verified.");
  }
  if (code === "Z_DATA_ERROR" || code === "Z_BUF_ERROR" || code.startsWith("ERR_BROTLI")) {
    return new FetchError("connection_failed", "The response could not be decoded.");
  }
  return new FetchError("connection_failed", "Could not connect to the site.");
}

/** Fetch an untrusted URL with redirect re-validation and hard limits. */
export async function safeFetch(input: string | URL, options: FetchOptions = {}): Promise<FetchResult> {
  const policy = options.policy ?? defaultPolicy;
  const timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
  const maxBytes = options.maxBytes ?? DEFAULTS.maxBytes;
  const maxRedirects = options.maxRedirects ?? DEFAULTS.maxRedirects;
  const accept = options.accept ?? DEFAULTS.accept;
  const truncate = options.truncate ?? false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onOuterAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onOuterAbort, { once: true });

  const release = await acquire().catch((err) => {
    clearTimeout(timer);
    throw err;
  });

  try {
    let current: URL;
    try {
      current = new URL(String(input));
    } catch {
      throw new FetchError("invalid_url", "That doesn't look like a valid URL.");
    }
    const redirects: RedirectHop[] = [];

    for (let hop = 0; ; hop++) {
      let response: HopResponse;
      if (current.hostname === DEMO_HOST) {
        response = demoResponse(current);
      } else {
        const verdict = policy.checkUrl(current);
        if (!verdict.allowed) throw blocked(verdict.reason);
        response = await networkHop(current, { signal: controller.signal, accept, maxBytes, truncate, policy });
      }

      const location = response.headers.location;
      if (response.status >= 300 && response.status < 400 && location) {
        redirects.push({ url: current.href, status: response.status });
        if (hop >= maxRedirects) {
          throw new FetchError("too_many_redirects", `The page redirected more than ${maxRedirects} times.`);
        }
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          throw new FetchError("invalid_url", "The page redirected to an invalid URL.");
        }
        if (next.hostname !== DEMO_HOST) {
          const verdict = policy.checkUrl(next);
          if (!verdict.allowed) throw blocked(`the page redirected to a ${verdict.reason}`);
        }
        next.hash = "";
        current = next;
        continue;
      }

      return {
        url: current.href,
        status: response.status,
        headers: response.headers,
        body: response.body,
        truncated: response.truncated,
        redirects,
      };
    }
  } catch (err) {
    throw translateError(err, controller.signal);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onOuterAbort);
    release();
  }
}
