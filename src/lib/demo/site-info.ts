// Client-safe constants for the bundled example site (no Node APIs, no assets).

export const DEMO_HOST = "demo.link-preview.test";
export const DEMO_ORIGIN = `https://${DEMO_HOST}`;
export const DEMO_EXAMPLE_URL = `${DEMO_ORIGIN}/spring-launch?utm_source=newsletter&utm_campaign=spring`;

export const DEMO_PAGES: Array<{ path: string; label: string }> = [
  { path: "/spring-launch?utm_source=newsletter&utm_campaign=spring", label: "Rich (X differs)" },
  { path: "/spring-launch?variant=b", label: "Query variant B" },
  { path: "/plain", label: "Plain HTML" },
  { path: "/old-launch", label: "Redirect" },
  { path: "/broken-image", label: "Broken image" },
  { path: "/changing", label: "Changes on refresh" },
  { path: "/diagnostics", label: "Small image & noindex" },
];
