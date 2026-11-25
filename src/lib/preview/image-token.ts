/**
 * Opaque, authenticated tokens for /api/image/<token>.
 *
 * The preview API hands the browser a token instead of the raw image URL, so
 * (1) the image endpoint only fetches URLs this server discovered itself and
 * is not an open proxy, and (2) raw page/asset URLs never appear in request
 * paths, access logs or analytics.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const TOKEN_TTL_MS = 60 * 60 * 1000;

let key: Buffer | undefined;
function getKey(): Buffer {
  if (!key) {
    const secret = process.env.LPS_SECRET;
    // Without LPS_SECRET a random per-process key is used; tokens then only
    // work on the instance that issued them (fine for a single local server).
    if (!secret && process.env.VERCEL) {
      console.warn("[image-token] LPS_SECRET is not set; preview images will fail across serverless instances. Set it in the project's environment variables.");
    }
    key = secret ? createHash("sha256").update(secret).digest() : randomBytes(32);
  }
  return key;
}

export function createImageToken(url: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const payload = Buffer.from(JSON.stringify({ u: url, t: Date.now() }), "utf8");
  const enc = Buffer.concat([cipher.update(payload), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64url");
}

export function readImageToken(token: string): string | null {
  try {
    const raw = Buffer.from(token, "base64url");
    if (raw.length < 29 || raw.length > 8192) return null;
    const decipher = createDecipheriv("aes-256-gcm", getKey(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const dec = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
    const { u, t } = JSON.parse(dec.toString("utf8")) as { u: string; t: number };
    if (typeof u !== "string" || typeof t !== "number") return null;
    if (Date.now() - t > TOKEN_TTL_MS) return null;
    return u;
  } catch {
    return null;
  }
}
