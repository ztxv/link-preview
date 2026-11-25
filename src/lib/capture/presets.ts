// Mobile capture presets, shared by the UI and the capture worker.

export interface CapturePreset {
  id: "iphone" | "android";
  label: string;
  /** Playwright device descriptor name. */
  device: string;
  engine: "webkit" | "chromium";
  engineLabel: string;
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
}

export const CAPTURE_PRESETS: Record<CapturePreset["id"], CapturePreset> = {
  iphone: {
    id: "iphone",
    label: "iPhone 15",
    device: "iPhone 15",
    engine: "webkit",
    engineLabel: "WebKit",
    viewport: { width: 393, height: 659 },
    deviceScaleFactor: 3,
  },
  android: {
    id: "android",
    label: "Pixel 7",
    device: "Pixel 7",
    engine: "chromium",
    engineLabel: "Chromium",
    viewport: { width: 412, height: 839 },
    deviceScaleFactor: 2.625,
  },
};

export function isPresetId(value: unknown): value is CapturePreset["id"] {
  return value === "iphone" || value === "android";
}
