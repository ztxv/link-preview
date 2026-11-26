import http from "node:http";
import net from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startEgressProxy } from "../../src/lib/capture/egress-proxy.ts";
import type { EgressProxy } from "../../src/lib/capture/egress-proxy.ts";

let proxy: EgressProxy;
let target: http.Server;
let targetPort: number;
let targetHits = 0;

beforeAll(async () => {
  proxy = await startEgressProxy({ maxBytes: 1024 * 1024, maxRequests: 50 });
  target = http.createServer((_req, res) => {
    targetHits++;
    res.end("secret");
  });
  await new Promise<void>((r) => target.listen(0, "127.0.0.1", r));
  targetPort = (target.address() as net.AddressInfo).port;
});
afterAll(async () => {
  await proxy.close();
  await new Promise((r) => target.close(r));
});

function connect(authority: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(proxy.port, "127.0.0.1", () => {
      sock.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`);
    });
    let data = "";
    sock.on("data", (d) => {
      data += d.toString();
      if (data.includes("\r\n\r\n")) {
        sock.destroy();
        resolve(data.split("\r\n")[0]);
      }
    });
    sock.on("error", reject);
    sock.on("close", () => resolve(data.split("\r\n")[0]));
  });
}

function proxiedGet(url: string): Promise<{ status: number; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: proxy.port, path: url, method: "GET", headers: { host: new URL(url).host } }, (res) => {
      res.resume();
      resolve({ status: res.statusCode || 0, headers: res.headers });
    });
    req.on("error", reject);
    req.end();
  });
}

describe("capture egress proxy", () => {
  it.each(["127.0.0.1:443", "localhost:443", "10.0.0.1:443", "169.254.169.254:443", "[::1]:443", "example.com:22"])(
    "refuses CONNECT to %s",
    async (authority) => {
      expect(await connect(authority)).toMatch(/403/);
    },
  );

  it("refuses plain-http requests to private targets without contacting them", async () => {
    const before = targetHits;
    expect((await proxiedGet(`http://127.0.0.1:${targetPort}/`)).status).toBe(403);
    expect((await proxiedGet("http://169.254.169.254/latest/meta-data/")).status).toBe(403);
    expect(targetHits).toBe(before);
    expect(proxy.stats.blocked).toBeGreaterThan(0);
  });
});
