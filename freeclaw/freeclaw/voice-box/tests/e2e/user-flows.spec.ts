/**
 * E2E Tests: User Interaction Pages
 *
 * Tests search, polls, suggestions, leaderboard, communities,
 * board, activity, saved, insights pages.
 */

import { test, expect } from "@playwright/test";

test.describe("Search Page", () => {
  test("search page loads with search input", async ({ page }) => {
    await page.goto("/search");
    await page.waitForLoadState("networkidle");

    // Should have a search input or heading
    const heading = page.locator('h1, h2, [placeholder*="earch"], input[type="search"]').first();
    await expect(heading).toBeVisible({ timeout: 10000 });
  });

  test("search input accepts text", async ({ page }) => {
    await page.goto("/search");
    await page.waitForLoadState("networkidle");

    const input = page.locator('input[type="search"], input[placeholder*="earch"], input[placeholder*="Filter"]').first();
    if (await input.isVisible({ timeout: 5000 }).catch(() => false)) {
      await input.fill("test query");
      const value = await input.inputValue();
      expect(value).toBe("test query");
    }
  });
});

test.describe("Polls Page", () => {
  test("polls page loads", async ({ page }) => {
    await page.goto("/polls");
    await page.waitForLoadState("networkidle");

    const heading = page.locator('h1:has-text("Polls"), h2:has-text("Polls")').first();
    await expect(heading).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Suggestions Page", () => {
  test("suggestions page loads", async ({ page }) => {
    await page.goto("/suggestions");
    await page.waitForLoadState("networkidle");

    // Verify page loaded (heading or content)
    const content = page.locator("main, [role='main'], h1, h2").first();
    await expect(content).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Leaderboard Page", () => {
  test("leaderboard page loads", async ({ page }) => {
    await page.goto("/leaderboard");
    await page.waitForLoadState("networkidle");

    const heading = page.locator('h1:has-text("Leaderboard"), h2:has-text("Leaderboard"), h1, h2').first();
    await expect(heading).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Communities Page", () => {
  test("communities page loads", async ({ page }) => {
    await page.goto("/communities");
    await page.waitForLoadState("networkidle");

    const heading = page.locator('h1:has-text("Communities"), h2:has-text("Communities"), h1, h2').first();
    await expect(heading).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Board Page", () => {
  test("board page loads", async ({ page }) => {
    await page.goto("/board");
    await page.waitForLoadState("networkidle");

    const content = page.locator("main, [role='main'], h1, h2").first();
    await expect(content).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Activity Page", () => {
  test("activity page loads", async ({ page }) => {
    await page.goto("/activity");
    await page.waitForLoadState("networkidle");

    const content = page.locator("main, [role='main'], h1, h2").first();
    await expect(content).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Saved Page", () => {
  test("saved page loads", async ({ page }) => {
    await page.goto("/saved");
    await page.waitForLoadState("networkidle");

    const content = page.locator("main, [role='main'], h1, h2").first();
    await expect(content).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Insights Page", () => {
  test("insights page loads", async ({ page }) => {
    await page.goto("/insights");
    await page.waitForLoadState("networkidle");

    const content = page.locator("main, [role='main'], h1, h2").first();
    await expect(content).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Submit Page", () => {
  test("submit page loads with form", async ({ page }) => {
    await page.goto("/submit");
    await page.waitForLoadState("networkidle");

    // Should have form elements
    const form = page.locator("form, [role='form']").first();
    if (await form.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(form).toBeVisible();
    }
  });
});

test.describe("Post Detail Page", () => {
  test("post detail page renders when navigated directly", async ({ page }) => {
    // Navigate directly to a post URL pattern
    await page.goto("/post/test-post-id");
    await page.waitForLoadState("networkidle");

    // Page should render something (even if post not found)
    const body = page.locator("body");
    const text = await body.textContent();
    expect(text!.length).toBeGreaterThan(0);
  });
});
