import type { Metadata, Viewport } from "next";
import { DEFAULT_THEME, THEME_COLORS, THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";
import "./platforms.css";

export const metadata: Metadata = {
  title: "Link Preview Studio",
  description: "See how a page's link preview might look in iMessage, Discord, X, Slack, WhatsApp, LinkedIn and more — and what to fix.",
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
