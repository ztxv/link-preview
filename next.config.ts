import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Pin the workspace root to this project so a stray lockfile in a parent
  // directory isn't mistaken for the monorepo root.
  turbopack: { root: path.resolve(".") },
  // Don't advertise the framework in response headers.
  poweredByHeader: false,
  // Hide the floating Next.js route indicator. Compile and runtime errors still surface.
  devIndicators: false,
  // In-process mobile capture on Vercel: keep the browser packages out of the bundle and
  // ship the compressed Chromium binaries that @sparticuz/chromium reads at runtime.
  serverExternalPackages: ["playwright-core", "@sparticuz/chromium"],
  outputFileTracingIncludes: {
    // playwright-core reads files such as browsers.json at runtime, which static tracing can't see.
    "/api/capture": ["./node_modules/@sparticuz/chromium/bin/**", "./node_modules/playwright-core/**"],
  },
};

export default nextConfig;
