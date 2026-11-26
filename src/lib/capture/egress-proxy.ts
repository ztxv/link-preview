/**
 * A per-capture forward proxy that only lets the browser reach public
 * addresses. Every page request, subresource, redirect target and CONNECT
 * tunnel goes through it; the destination is resolved and checked here, at
 * connection time, and the socket is connected to exactly the checked IP.
 */
import dns from "node:dns";
import http from "node:http";
import net from "node:net";
import { ALLOWED_PORTS, checkAddress, checkHostname, checkUrl } from "../net/ip-policy.ts";
import { guardedLookup } from "../net/safe-fetch.ts";

export interface EgressStats {
  requests: number;
  blocked: number;
  bytes: number;
  blockedHosts: Set<string>;
}

export interface EgressProxy {
  port: number;
  stats: EgressStats;
  close(): Promise<void>;
}

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function resolvePublic(host: string): Promise<{ address: string; family: number }> {
  return new Promise((resolve, reject) => {
    const bare = host.startsWith("[") ? host.slice(1, -1) : host;
    if (net.isIP(bare)) {
      const v = checkAddress(bare);
      return v.allowed ? resolve({ address: bare, family: v.family }) : reject(new Error(v.reason));
    }
    dns.lookup(bare, { all: true, order: "verbatim" }, (err, addrs) => {
      if (err || !addrs.length) return reject(err ?? new Error("no addresses"));
      for (const a of addrs) {
        const v = checkAddress(a.address);
        if (!v.allowed) return reject(new Error(`resolves to ${v.reason}`));
      }
      resolve(addrs[0]);
    });
  });
}

export async function startEgressProxy(opts: { maxBytes: number; maxRequests: number }): Promise<EgressProxy> {
  const stats: EgressStats = { requests: 0, blocked: 0, bytes: 0, blockedHosts: new Set() };
  const sockets = new Set<net.Socket>();
  const over = () => stats.bytes > opts.maxBytes || stats.requests > opts.maxRequests;
  const deny = (host: string) => {
    stats.blocked++;
    stats.blockedHosts.add(host);
  };

  const server = http.createServer((req, res) => {
    stats.requests++;
    let target: URL;
    try {
      target = new URL(req.url || "");
    } catch {
      res.writeHead(400).end();
      return;
    }
    const verdict = checkUrl(target);
    if (!verdict.allowed || target.protocol !== "http:" || over()) {
      deny(target.hostname);
      res.writeHead(403, { "content-type": "text/plain" }).end("Blocked by Link Preview Studio capture policy");
      return;
    }
    const headers: http.OutgoingHttpHeaders = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (!HOP_BY_HOP.has(k.toLowerCase()) && v !== undefined) headers[k] = v;
    }
    const upstream = http.request(
      {
        protocol: "http:",
        hostname: target.hostname,
        port: target.port || 80,
        path: `${target.pathname}${target.search}`,
        method: req.method,
        headers,
        agent: false,
        lookup: guardedLookup(),
        timeout: 15_000,
      },
      (up) => {
        const outHeaders: http.OutgoingHttpHeaders = {};
        for (const [k, v] of Object.entries(up.headers)) {
          if (!HOP_BY_HOP.has(k.toLowerCase()) && v !== undefined) outHeaders[k] = v;
        }
        res.writeHead(up.statusCode || 502, outHeaders);
        up.on("data", (chunk: Buffer) => {
          stats.bytes += chunk.length;
          if (over()) {
            up.destroy();
            res.destroy();
          }
        });
        up.pipe(res);
      },
    );
    upstream.on("timeout", () => upstream.destroy());
    upstream.on("error", (err: Error & { code?: string }) => {
      const wasBlocked = err.name === "FetchError" && err.code === "blocked_destination";
      if (wasBlocked) deny(target.hostname);
      if (!res.headersSent) {
        res.writeHead(wasBlocked ? 403 : 502, wasBlocked ? { "x-lps-blocked": "1" } : {}).end();
      } else res.destroy();
    });
    req.pipe(upstream);
  });

  // HTTPS (and wss) tunnels.
  server.on("connect", async (req: http.IncomingMessage, client: net.Socket, head: Buffer) => {
    stats.requests++;
    sockets.add(client);
    client.on("close", () => sockets.delete(client));
    client.on("error", () => client.destroy());
    const match = /^(\[[^\]]+\]|[^:]+):(\d+)$/.exec(req.url || "");
    const host = match?.[1] ?? "";
    const port = Number(match?.[2]);
    const reject = () => {
      deny(host);
      client.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
    };
    if (!match || !ALLOWED_PORTS.has(port) || over()) return reject();
    const hostVerdict = checkHostname(host);
    if (!hostVerdict.allowed) return reject();

    let resolved;
    try {
      resolved = await resolvePublic(host);
    } catch {
      return reject();
    }
    const upstream = net.connect({ host: resolved.address, port, family: resolved.family });
    sockets.add(upstream);
    upstream.setTimeout(20_000, () => upstream.destroy());
    upstream.on("close", () => {
      sockets.delete(upstream);
      client.destroy();
    });
    upstream.on("error", () => {
      if (!client.destroyed) client.end("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n");
    });
    upstream.on("connect", () => {
      // Belt and braces: confirm the connected peer is the checked public IP.
      if (!upstream.remoteAddress || !checkAddress(upstream.remoteAddress).allowed) {
        upstream.destroy();
        return reject();
      }
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      const count = (chunk: Buffer) => {
        stats.bytes += chunk.length;
        if (over()) {
          upstream.destroy();
          client.destroy();
        }
      };
      upstream.on("data", count);
      upstream.pipe(client);
      client.pipe(upstream);
    });
  });

  // Plain-http WebSocket upgrades are refused outright.
  server.on("upgrade", (_req, socket: net.Socket) => {
    stats.blocked++;
    socket.destroy();
  });
  server.on("connection", (socket: net.Socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    stats,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}
