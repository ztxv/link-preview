/**
 * Destination policy: which IP addresses and hostnames untrusted URLs may reach.
 *
 * Shared by the metadata fetcher (Next.js server) and the capture worker
 * (plain Node), so it only uses relative imports with explicit extensions.
 */
import ipaddr from "ipaddr.js";

/** Extra IPv4 blocks beyond what ipaddr.js classifies as non-unicast. */
const BLOCKED_V4_CIDRS: Array<[string, number]> = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12],
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16],
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
];

/** IPv6 blocks inside 2000::/3 that are still not ordinary public unicast. */
const BLOCKED_V6_CIDRS: Array<[string, number]> = [
  ["2001::", 23], // IETF protocol assignments (incl. Teredo 2001::/32)
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4 (embeds IPv4)
  ["3fff::", 20], // documentation (RFC 9637)
];

const parsedV4 = BLOCKED_V4_CIDRS.map(
  ([a, bits]): [ipaddr.IPv4, number] => [ipaddr.IPv4.parse(a), bits],
);
const parsedV6 = BLOCKED_V6_CIDRS.map(
  ([a, bits]): [ipaddr.IPv6, number] => [ipaddr.IPv6.parse(a), bits],
);
const globalUnicastV6: [ipaddr.IPv6, number] = [ipaddr.IPv6.parse("2000::"), 3];

export type AddressVerdict =
  | { allowed: true; family: 4 | 6; normalized: string }
  | { allowed: false; reason: string };

/** Decide whether a literal IP address is a public destination. */
export function checkAddress(raw: string): AddressVerdict {
  let text = raw.trim();
  if (text.startsWith("[") && text.endsWith("]")) text = text.slice(1, -1);
  // Strip an IPv6 zone index (fe80::1%eth0); zones only exist for local scopes.
  const zone = text.indexOf("%");
  if (zone !== -1) return { allowed: false, reason: "scoped IPv6 address" };

  if (!ipaddr.isValid(text)) return { allowed: false, reason: "not an IP address" };
  let addr: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    addr = ipaddr.parse(text);
  } catch {
    return { allowed: false, reason: "not an IP address" };
  }

  if (addr.kind() === "ipv6") {
    const v6 = addr as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) {
      // ::ffff:a.b.c.d — judge the embedded IPv4 address.
      return checkAddress(v6.toIPv4Address().toString());
    }
    if (v6.range() !== "unicast") return { allowed: false, reason: `IPv6 ${v6.range()} range` };
    if (!v6.match(globalUnicastV6)) return { allowed: false, reason: "IPv6 outside global unicast" };
    for (const cidr of parsedV6) {
      if (v6.match(cidr)) return { allowed: false, reason: "reserved IPv6 range" };
    }
    return { allowed: true, family: 6, normalized: v6.toNormalizedString() };
  }

  const v4 = addr as ipaddr.IPv4;
  // ipaddr.parse accepts legacy forms like "0x7f.1" — normalise before judging.
  if (v4.range() !== "unicast") return { allowed: false, reason: `IPv4 ${v4.range()} range` };
  for (const cidr of parsedV4) {
    if (v4.match(cidr)) return { allowed: false, reason: "private or reserved IPv4 range" };
  }
  return { allowed: true, family: 4, normalized: v4.toString() };
}

export function isPublicAddress(raw: string): boolean {
  return checkAddress(raw).allowed;
}

/** Ports an untrusted URL may use. Kept small on purpose. */
export const ALLOWED_PORTS = new Set([80, 443, 8080, 8443]);

const BLOCKED_SUFFIXES = [
  ".localhost",
  ".local",
  ".localdomain",
  ".internal",
  ".intranet",
  ".lan",
  ".home",
  ".home.arpa",
  ".corp",
  ".test",
  ".example",
  ".invalid",
  ".onion",
  ".arpa",
];

export type HostVerdict =
  | { allowed: true; literalIp: boolean }
  | { allowed: false; reason: string };

/**
 * Static checks on a hostname before any DNS lookup. DNS answers are checked
 * again at connection time — this only rejects names that are never public.
 */
export function checkHostname(hostname: string): HostVerdict {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return { allowed: false, reason: "missing hostname" };

  const bare = host.startsWith("[") ? host.slice(1, -1) : host;
  if (ipaddr.isValid(bare) || /^[0-9.]+$/.test(bare) || /^0x/i.test(bare)) {
    const verdict = checkAddress(bare);
    return verdict.allowed
      ? { allowed: true, literalIp: true }
      : { allowed: false, reason: verdict.reason };
  }

  if (host === "localhost") return { allowed: false, reason: "localhost" };
  if (!host.includes(".")) return { allowed: false, reason: "single-label hostname" };
  for (const suffix of BLOCKED_SUFFIXES) {
    if (host.endsWith(suffix)) return { allowed: false, reason: `${suffix} hostname` };
  }
  if (!/^[a-z0-9.-]+$/.test(host)) return { allowed: false, reason: "invalid hostname" };
  return { allowed: true, literalIp: false };
}

export type UrlVerdict =
  | { allowed: true; url: URL }
  | { allowed: false; reason: string };

/** Scheme, credentials, port and hostname checks for an untrusted URL. */
export function checkUrl(input: string | URL): UrlVerdict {
  let url: URL;
  try {
    url = typeof input === "string" ? new URL(input) : new URL(input.href);
  } catch {
    return { allowed: false, reason: "not a valid URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { allowed: false, reason: `${url.protocol.replace(":", "")} URLs are not allowed` };
  }
  if (url.username || url.password) {
    return { allowed: false, reason: "URLs with embedded credentials are not allowed" };
  }
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (!ALLOWED_PORTS.has(port)) return { allowed: false, reason: `port ${port} is not allowed` };
  const host = checkHostname(url.hostname);
  if (!host.allowed) return { allowed: false, reason: host.reason };
  return { allowed: true, url };
}
