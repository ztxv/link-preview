import { describe, expect, it } from "vitest";
import { checkAddress, checkHostname, checkUrl } from "../../src/lib/net/ip-policy.ts";

describe("checkAddress", () => {
  const blocked = [
    "127.0.0.1",
    "127.255.255.254",
    "10.0.0.5",
    "172.16.4.4",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", // cloud metadata
    "100.64.0.1", // CGNAT
    "0.0.0.0",
    "0.1.2.3",
    "192.0.0.8",
    "192.0.2.10",
    "198.18.0.1",
    "198.51.100.7",
    "203.0.113.9",
    "224.0.0.1",
    "239.255.255.250",
    "240.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "ff02::1",
    "::ffff:127.0.0.1", // IPv4-mapped loopback
    "::ffff:10.0.0.1",
    "::ffff:169.254.169.254",
    "64:ff9b::a00:1", // NAT64 to 10.0.0.1
    "2001:db8::1", // documentation
    "2002:7f00:1::", // 6to4 embedding 127.0.0.1
    "2001:0:4136:e378:8000:63bf:3fff:fdd2", // Teredo
    "fec0::1", // deprecated site-local
    "fe80::1%eth0",
  ];
  it.each(blocked)("blocks %s", (addr) => {
    expect(checkAddress(addr).allowed).toBe(false);
  });

  const allowed = ["93.184.215.14", "8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "2a00:1450:4001:80b::200e", "[2606:4700::1]"];
  it.each(allowed)("allows public %s", (addr) => {
    expect(checkAddress(addr).allowed).toBe(true);
  });
});

describe("checkHostname", () => {
  it.each(["localhost", "LOCALHOST.", "app.localhost", "printer.local", "db.internal", "router.home.arpa", "intranet", "foo.test", "10.0.0.1", "[::1]"])(
    "blocks %s",
    (h) => expect(checkHostname(h).allowed).toBe(false),
  );
  it.each(["example.com", "www.example.co.uk", "xn--bcher-kva.de"])("allows %s", (h) => {
    expect(checkHostname(h).allowed).toBe(true);
  });
});

describe("checkUrl", () => {
  it("allows ordinary public http(s) URLs", () => {
    expect(checkUrl("https://example.com/path?q=1").allowed).toBe(true);
    expect(checkUrl("http://example.com:8080/").allowed).toBe(true);
  });
  it.each([
    "file:///etc/passwd",
    "ftp://example.com/",
    "javascript:alert(1)",
    "gopher://example.com/",
    "https://user:pass@example.com/",
    "https://example.com:22/",
    "http://example.com:6379/",
    "http://127.0.0.1/",
    "http://0x7f.0.0.1/", // WHATWG parser normalises to 127.0.0.1
    "http://2130706433/", // decimal 127.0.0.1
    "http://[::1]/",
    "http://[::ffff:7f00:1]/",
    "http://169.254.169.254/latest/meta-data/",
    "http://metadata.google.internal/",
  ])("rejects %s", (u) => {
    expect(checkUrl(u).allowed).toBe(false);
  });
});
