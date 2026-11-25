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
};

export default nextConfig;
