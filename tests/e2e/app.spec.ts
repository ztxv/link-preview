import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const DEMO = "https://demo.link-preview.test";

async function previewUrl(page: Page, url: string) {
  await page.getByLabel("Page URL").fill(url);
  await page.getByRole("button", { name: "Preview link" }).click();
}

const card = (page: Page, name: string) => page.getByRole("article", { name: `${name} simulated preview` });

test.describe("share cards", () => {
  test("example: three cards side by side, X differs from Open Graph", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    await page.goto("/");
    await page.getByRole("button", { name: "Try example" }).click();

    await expect(page.getByText("Simulated preview", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Page URL")).toHaveValue(`${DEMO}/spring-launch?utm_source=newsletter&utm_campaign=spring`);

    const im = card(page, "iMessage");
    const dc = card(page, "Discord");
    const x = card(page, "X (Twitter)");
    await expect(im).toContainText("Introducing Fieldnote 2: notes that organize themselves");
    await expect(dc).toContainText("Introducing Fieldnote 2: notes that organize themselves");
    await expect(dc).toContainText("Fieldnote"); // og:site_name
    await expect(x).toContainText("Spring Launch: 40% off Fieldnote 2 for early birds & teams");
    await expect(x).not.toContainText("Introducing Fieldnote 2");

    // Images are served through the validated proxy and actually decode.
    const imgs = page.locator(".frame-imessage img, .frame-discord img, .frame-x img");
    await expect(imgs.first()).toBeVisible();
    const sizes = await imgs.evaluateAll((els) => (els as HTMLImageElement[]).map((i) => [i.complete, i.naturalWidth]));
    expect(sizes.length).toBeGreaterThanOrEqual(3);
    for (const [, w] of sizes) expect(w).toBeGreaterThan(0);
    const xImg = await x.locator("img").getAttribute("src");
    const dcImg = await dc.locator("img").getAttribute("src");
    expect(xImg).not.toBe(dcImg);
    expect(xImg).toMatch(/^\/api\/image\//);

    // Side by side on desktop.
    const [a, b, c] = await Promise.all([im, dc, x].map((l) => l.boundingBox()));
    expect(Math.abs(a!.y - b!.y)).toBeLessThan(2);
    expect(Math.abs(b!.y - c!.y)).toBeLessThan(2);
    expect(a!.x).toBeLessThan(b!.x);
    expect(b!.x).toBeLessThan(c!.x);

    // X can be simulated as both card types.
    await x.getByRole("button", { name: /^summary(?!_)/ }).click();
    await expect(x.locator(".x-summary")).toBeVisible();
    await x.getByRole("button", { name: /summary_large_image/ }).click();
    await expect(x.locator(".x-large")).toBeVisible();

    // Inspector shows sources and measured sizes.
    const panel = page.locator("details.inspector");
    await expect(panel).toContainText("twitter:title");
    await expect(panel).toContainText("1200×630 measured");
  });

  test("phone width stacks the cards without horizontal scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await page.getByRole("button", { name: "Try example" }).click();
    const boxes = await Promise.all(["iMessage", "Discord", "X (Twitter)"].map((n) => card(page, n).boundingBox()));
    expect(boxes[0]!.y).toBeLessThan(boxes[1]!.y);
    expect(boxes[1]!.y).toBeLessThan(boxes[2]!.y);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("plain page, redirect and query-string variants", async ({ page }) => {
    await page.goto("/");
    await previewUrl(page, "demo.link-preview.test/plain");
    await expect(page.getByLabel("Page URL")).toHaveValue("demo.link-preview.test/plain");
    await expect(card(page, "iMessage")).toContainText("Fieldnote changelog — plain page with no share tags");
    await expect(page.locator(".issues")).toContainText("iMessage is using the page title for the title because og:title is missing");
    await expect(page.locator("[aria-labelledby='tags-h'] .code-block")).toContainText("PLACEHOLDER");

    await previewUrl(page, `${DEMO}/old-launch`);
    await expect(page.locator(".result-facts")).toContainText("Redirected to");
    await expect(page.locator(".result-facts")).toContainText(`${DEMO}/spring-launch?from=old-launch`);

    await previewUrl(page, `${DEMO}/spring-launch?variant=b`);
    await expect(card(page, "Discord")).toContainText("Plan less, ship more with Fieldnote 2");
    await previewUrl(page, `${DEMO}/spring-launch?variant=a`);
    await expect(card(page, "Discord")).toContainText("Introducing Fieldnote 2");
  });

  test("broken image shows a missing-image state and a tool-check issue", async ({ page }) => {
    await page.goto("/");
    await previewUrl(page, `${DEMO}/broken-image`);
    await expect(card(page, "Discord")).toContainText("The image returned HTTP 403 to this tool.");
    await expect(card(page, "X (Twitter)")).toContainText("Image returned HTTP 403");
    await expect(card(page, "X (Twitter)")).toContainText("twitter:card is missing");
    const issue = page.locator(".issue", { hasText: "returned HTTP 403 to this tool" });
    await expect(issue).toContainText("Tool check");
  });

  test("refresh fetches fresh metadata", async ({ page }) => {
    await page.goto("/");
    await previewUrl(page, `${DEMO}/changing`);
    const title = card(page, "Discord").locator(".dc-title");
    await expect(title).toHaveText(/revision \d+/);
    const first = await title.textContent();
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(title).not.toHaveText(first!);
  });

  test("blocked destinations are rejected and the URL is kept", async ({ page }) => {
    await page.goto("/");
    for (const url of ["http://127.0.0.1:3100/", "169.254.169.254/latest/meta-data", "http://[::1]/", "localhost:3000"]) {
      await previewUrl(page, url);
      await expect(page.locator(".error-card")).toContainText("That address isn't allowed");
      await expect(page.getByLabel("Page URL")).toHaveValue(url);
      await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
    }
  });

  test("copy link copies the submitted URL", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Try example" }).click();
    await page.getByRole("button", { name: "Copy link" }).click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(`${DEMO}/spring-launch?utm_source=newsletter&utm_campaign=spring`);
    await page.getByRole("button", { name: "Copy suggested tags" }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('<meta property="og:title"');
  });
});

test.describe("more platforms", () => {
  const NAMES = ["Slack", "WhatsApp", "Telegram", "Facebook", "LinkedIn", "Reddit", "Bluesky", "Mastodon", "Google Search"];

  test("the example renders a card for every platform", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    await page.goto("/");
    await page.getByRole("button", { name: "Try example" }).click();
    await expect(card(page, "iMessage")).toBeVisible();
    for (const name of NAMES) await expect(card(page, name)).toBeVisible();
    await expect(card(page, "Slack")).toContainText("Introducing Fieldnote 2: notes that organize themselves");
    await expect(card(page, "LinkedIn")).toContainText("demo.link-preview.test");
    // LinkedIn doesn't show the description; Facebook does.
    await expect(card(page, "LinkedIn")).not.toContainText("files every note by project");
    await expect(card(page, "Facebook")).toContainText("files every note by project");
    await expect(card(page, "Google Search")).toContainText("Fieldnote 2 — Spring Launch");
    await expect(card(page, "Google Search")).toContainText("demo.link-preview.test");
  });

  test("platform chips hide cards and the field table follows", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Try example" }).click();
    const filter = page.getByRole("group", { name: "Platforms to show" });
    await filter.getByRole("button", { name: "Slack" }).click();
    await filter.getByRole("button", { name: "Google" }).click();
    await expect(card(page, "Slack")).toHaveCount(0);
    await expect(card(page, "Google Search")).toHaveCount(0);
    await expect(card(page, "Discord")).toBeVisible();
    await expect(page.locator("table.fields")).not.toContainText("Slack");
    await expect(page.locator("table.fields")).toContainText("Discord");
    // The choice survives checking another page.
    await previewUrl(page, `${DEMO}/plain`);
    await expect(card(page, "iMessage")).toBeVisible();
    await expect(card(page, "Slack")).toHaveCount(0);
    await page.getByRole("button", { name: "Show all" }).click();
    await expect(card(page, "Slack")).toBeVisible();
    await expect(card(page, "Google Search")).toBeVisible();
  });

  test("diagnostics page: noindex, small image and Slack fields", async ({ page }) => {
    await page.goto("/");
    await previewUrl(page, `${DEMO}/diagnostics`);
    await expect(card(page, "Google Search")).toContainText("noindex");
    await expect(card(page, "Slack")).toContainText("Written by");
    await expect(card(page, "Slack")).toContainText("The Fieldnote team");
    const issues = page.locator(".issues");
    await expect(issues).toContainText("The page tells search engines not to index it");
    await expect(issues).toContainText("will show a small thumbnail instead of a large image");
    await expect(issues).toContainText("Facebook ignores images under 200×200");
    await expect(page.locator("table.fields")).toContainText("Blocked (noindex)");
  });

  test("copy prompts for a coding agent and for chat", async ({ page }) => {
    await page.goto("/");
    await previewUrl(page, `${DEMO}/diagnostics`);
    await page.getByRole("button", { name: "Copy prompt for coding agent" }).click();
    const agent = await page.evaluate(() => navigator.clipboard.readText());
    expect(agent).toContain("You have access to my codebase");
    expect(agent).toContain("The page tells search engines not to index it");
    expect(agent).toContain(`${DEMO}/diagnostics`);
    await page.getByRole("button", { name: "Copy prompt for chat" }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("You can't see my code");
    await page.getByText("Preview the coding-agent prompt").click();
    await expect(page.locator(".ai-handoff pre")).toContainText("What needs fixing");
  });

  test("the app ships its own favicon", async ({ page }) => {
    await page.goto("/");
    const hrefs = await page.locator('link[rel~="icon"]').evaluateAll((els) => els.map((e) => e.getAttribute("href")));
    expect(hrefs.some((h) => h?.includes("icon.svg"))).toBe(true);
    for (const href of hrefs) {
      const res = await page.request.get(href!);
      expect(res.ok()).toBe(true);
    }
  });
});

test.describe("theme", () => {
  const bodyBackground = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  test("defaults to dark, toggles to light and remembers the choice", async ({ page }) => {
    await page.goto("/");
    const html = page.locator("html");
    const toggle = page.getByRole("switch", { name: "Dark mode" });
    await expect(html).toHaveAttribute("data-theme", "dark");
    await expect(toggle).toBeChecked();
    const dark = await bodyBackground(page);

    await toggle.click();
    await expect(html).toHaveAttribute("data-theme", "light");
    await expect(toggle).not.toBeChecked();
    await expect.poll(() => bodyBackground(page)).not.toBe(dark);
    // The temporary cross-fade class cleans itself up.
    await expect(html).not.toHaveClass(/theme-switching/);

    await page.reload();
    await expect(html).toHaveAttribute("data-theme", "light");
    await expect(page.getByRole("switch", { name: "Dark mode" })).not.toBeChecked();

    await page.getByRole("switch", { name: "Dark mode" }).click();
    await expect(html).toHaveAttribute("data-theme", "dark");
    await page.reload();
    await expect(html).toHaveAttribute("data-theme", "dark");
  });

  test("an unreadable saved value falls back to dark", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("lps-theme", "sepia"));
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("the simulated cards follow the theme", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Try example" }).click();
    const stage = card(page, "iMessage").locator(".stage");
    const dark = await stage.evaluate((el) => getComputedStyle(el).backgroundColor);
    await page.getByRole("switch", { name: "Dark mode" }).click();
    await expect.poll(() => stage.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 255, 255)");
    expect(dark).not.toBe("rgb(255, 255, 255)");
  });
});

test.describe("mobile page", () => {
  for (const preset of [
    { button: /iPhone/, viewport: "393×659 CSS px · DPR 3", width: 393 * 3 },
    { button: /Android/, viewport: "412×839 CSS px · DPR 2.625", width: Math.round(412 * 2.625) },
  ]) {
    test(`captures a real screenshot: ${preset.button}`, async ({ page }) => {
      await page.goto("/");
      await page.getByRole("button", { name: "Try example" }).click();
      await page.getByRole("tab", { name: "Mobile page" }).click();
      await page.getByRole("button", { name: preset.button }).click();
      await page.getByRole("button", { name: "Capture screenshot" }).click();
      const shot = page.locator("img.phone-shot");
      await expect(shot).toBeVisible({ timeout: 60_000 });
      const natural = await shot.evaluate((i: HTMLImageElement) => [i.naturalWidth, i.naturalHeight]);
      expect(Math.abs(natural[0] - preset.width)).toBeLessThanOrEqual(2);
      expect(natural[1]).toBeGreaterThan(natural[0]);
      await expect(page.locator(".capture-facts")).toContainText(preset.viewport);
      await expect(page.locator(".capture-facts")).toContainText(/WebKit|Chromium/);
      await expect(page.getByText("Browser emulation")).toBeVisible();
      // The phone screen scrolls the full-page screenshot.
      const scrollable = await page.locator(".phone-screen").evaluate((el) => el.scrollHeight > el.clientHeight);
      expect(scrollable).toBe(true);
    });
  }

  test("capture unavailable keeps the cards usable and offers Open original", async ({ page }) => {
    await page.route("**/api/capture", (route) =>
      route.request().method() === "GET"
        ? route.fulfill({ json: { available: false } })
        : route.fulfill({ status: 503, json: { ok: false, code: "capture_unavailable", message: "x" } }),
    );
    await page.goto("/");
    await page.getByRole("button", { name: "Try example" }).click();
    await page.getByRole("tab", { name: "Mobile page" }).click();
    await expect(page.getByText("Capture unavailable.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Capture screenshot" })).toBeDisabled();
    await expect(page.getByRole("link", { name: "Open original" })).toHaveAttribute("href", /spring-launch/);
    await page.getByRole("tab", { name: "Share cards" }).click();
    await expect(card(page, "iMessage")).toBeVisible();
  });

  test("capture worker refuses private destinations", async ({ request }) => {
    const res = await request.post("/api/capture", { data: { url: "http://192.168.1.1/", preset: "android" } });
    expect(res.status()).toBe(422);
    expect((await res.json()).code).toBe("blocked_destination");
  });
});
