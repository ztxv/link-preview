import type { Metadata, Viewport } from "next";
import { DEFAULT_THEME, THEME_COLORS, THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";
import "./platforms.css";

const TITLE = "Link Preview Studio";
const DESCRIPTION = "See how a page's link preview might look in iMessage, Discord, X, Slack, WhatsApp, LinkedIn and more — and what to fix.";

/** Absolute origin for share tags: SITE_URL if set, else the Vercel production domain, else localhost. */
function siteOrigin(): string {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  const explicit = process.env.SITE_URL || (host ? `https://${host}` : "");
  return (explicit || "http://localhost:3000").replace(/\/$/, "");
}

// The share image comes from src/app/opengraph-image.png and twitter-image.png (with their .alt.txt files).
export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin()),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: TITLE,
  openGraph: {
    type: "website",
    url: "/",
    siteName: TITLE,
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: THEME_COLORS[DEFAULT_THEME],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // Dark is the default; the inline script swaps in a saved "light" choice before first paint.
    <html lang="en" data-theme={DEFAULT_THEME} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
