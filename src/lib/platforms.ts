import type { Platform } from "./preview/types";

/** Display order. The first three keep their original positions at the top of the grid. */
export const PLATFORMS: ReadonlyArray<{ id: Platform; name: string; short: string }> = [
  { id: "imessage", name: "iMessage", short: "iMessage" },
  { id: "discord", name: "Discord", short: "Discord" },
  { id: "x", name: "X (Twitter)", short: "X" },
  { id: "slack", name: "Slack", short: "Slack" },
  { id: "whatsapp", name: "WhatsApp", short: "WhatsApp" },
  { id: "telegram", name: "Telegram", short: "Telegram" },
  { id: "facebook", name: "Facebook", short: "Facebook" },
  { id: "linkedin", name: "LinkedIn", short: "LinkedIn" },
  { id: "reddit", name: "Reddit", short: "Reddit" },
  { id: "bluesky", name: "Bluesky", short: "Bluesky" },
  { id: "mastodon", name: "Mastodon", short: "Mastodon" },
  { id: "google", name: "Google Search", short: "Google" },
];
