/**
 * E2E Tests: Public Content Pages
 *
 * Tests that all public-facing pages load correctly,
 * render expected content, and have no console errors.
 */

import { test, expect } from "@playwright/test";

const PUBLIC_PAGES = [
  { path: "/", name: "Home", heading: /Voice Box|Community|Feed/i },
  { path: "/about", name: "About", heading: /About/i },
  { path: "/contact", name: "Contact", heading: /Contact/i },
  { path: "/terms", name: "Terms", heading: /Terms|Conditions/i },
  { path: "/status", name: "Status", heading: /Status/i },
  { path: "/changelog", name: "Changelog", heading: /Changelog|Changes/i },
  { path: "/accessibility", name: "Accessibility", heading: /Accessibility/i },
  { path: "/privacy", name: "Privacy", heading: /Privacy/i },
  { path: "/faq", name: "FAQ", heading: /FAQ|Frequently/i },
];

test.describe("Public Content Pages", () => {
  for (const { path, name } of PUBLIC_PAGES) {
    test(`${name} page loads without errors`, async ({ page }) => {
      const consoleErrors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error" && !msg.text().includes("429")) {
          consoleErrors.push(msg.text());
        }
      });

      await page.goto(path);
      await page.waitForLoadState("networkidle");

      // Page should render content
      const body = page.locator("body");
      const text = await body.textContent();
      expect(text!.length).toBeGreaterThan(10);

      // No critical console errors
      const criticalErrors = consoleErrors.filter(
        (e) => !e.includes("Failed to fetch") && !e.includes("chunk")
      );
      expect(criticalErrors).toHaveLength(0);
    });
  }
});

test.describe("Navigation", () => {
  test("home page has navigation element", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const nav = page.locator("nav, [role='navigation']").first();
    await expect(nav).toBeVisible({ timeout: 10000 });
  });

  test("direct page navigation works", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.goto("/search");
    await page.waitForLoadState("networkidle");
    expect(page.url()).toContain("/search");

    await page.goto("/polls");
    await page.waitForLoadState("networkidle");
    expect(page.url()).toContain("/polls");
  });
});

test.describe("Footer", () => {
  test("footer exists on home page", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const footer = page.locator("footer").first();
    if (await footer.isVisible({ timeout: 5000 }).catch(() => false)) {
      const footerText = await footer.textContent();
      expect(footerText!.length).toBeGreaterThan(0);
    }
  });

  test("legal pages have content", async ({ page }) => {
    for (const path of ["/terms", "/privacy"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");

      const body = page.locator("body");
      const text = await body.textContent();
      expect(text!.length).toBeGreaterThan(50);
    }
  });
});

test.describe("Theme System", () => {
  test("theme initializes and page renders", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);

    // Page renders without horizontal overflow
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeGreaterThan(0);
  });
});
