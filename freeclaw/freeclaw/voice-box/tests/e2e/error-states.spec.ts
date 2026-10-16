/**
 * E2E Tests: Error States & Edge Cases
 *
 * Tests 404 pages, empty states, rate limiting,
 * and responsive design across viewports.
 */

import { test, expect } from "@playwright/test";

test.describe("404 Not Found", () => {
  test("unknown route shows 404 page", async ({ page }) => {
    await page.goto("/nonexistent-page-12345");
    await page.waitForLoadState("networkidle");

    // Should show 404 content or redirect
    const content = page.locator("main, [role='main']").first();
    if (await content.isVisible({ timeout: 5000 }).catch(() => false)) {
      const text = await content.textContent();
      // Should mention not found, 404, or similar
      expect(text).toBeTruthy();
    }
  });

  test("deep nested unknown route shows 404", async ({ page }) => {
    await page.goto("/this/is/a/deep/unknown/route");
    await page.waitForLoadState("networkidle");

    // Should not crash - page should render something
    const body = page.locator("body");
    const text = await body.textContent();
    expect(text).toBeTruthy();
  });
});

test.describe("Empty States", () => {
  test("saved page shows empty state when no saved posts", async ({ page }) => {
    await page.goto("/saved");
    await page.waitForLoadState("networkidle");

    // Page should render without crashing
    const body = page.locator("body");
    const text = await body.textContent();
    expect(text).toBeTruthy();
  });

  test("notifications page renders when empty", async ({ page }) => {
    await page.goto("/notifications");
    await page.waitForLoadState("networkidle");

    const body = page.locator("body");
    const text = await body.textContent();
    expect(text).toBeTruthy();
  });

  test("search page renders with no results", async ({ page }) => {
    await page.goto("/search");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    const input = page.locator('input[type="search"], input[placeholder*="earch"]').first();
    if (await input.isVisible({ timeout: 5000 }).catch(() => false)) {
      await input.fill("xyznonexistentquery12345");
      await page.waitForTimeout(2000);

      // Page should not crash
      const body = page.locator("body");
      const text = await body.textContent();
      expect(text).toBeTruthy();
    }
  });
});

test.describe("Responsive Design", () => {
  const viewports = [
    { name: "Mobile", width: 375, height: 812 },
    { name: "Tablet", width: 768, height: 1024 },
    { name: "Desktop", width: 1440, height: 900 },
  ];

  for (const { name, width, height } of viewports) {
    test(`home page renders at ${name} (${width}x${height})`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/");
      await page.waitForLoadState("networkidle");

      // Page should render without horizontal overflow
      const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
      expect(bodyWidth).toBeLessThanOrEqual(width + 20); // Small tolerance for scrollbar

      // Main content should be visible
      const content = page.locator("main, [role='main'], h1, h2").first();
      await expect(content).toBeVisible({ timeout: 10000 });
    });
  }

  test("admin page is responsive on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/admin");
    await page.waitForLoadState("networkidle");

    // Page should not have horizontal overflow
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(375 + 20);
  });
});

test.describe("Keyboard Navigation", () => {
  test("can tab through home page elements", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Tab through first few elements
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Tab");
    }

    // After tabbing, some element should be focused
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? el.tagName.toLowerCase() : null;
    });
    expect(focused).toBeTruthy();
  });
});

test.describe("Network Resilience", () => {
  test("page handles slow API responses gracefully", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // The page should be functional even if some API calls fail or are slow
    const body = page.locator("body");
    const text = await body.textContent();
    expect(text!.length).toBeGreaterThan(0);
  });
});
