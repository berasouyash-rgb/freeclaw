/**
 * E2E Tests: User Account Pages
 *
 * Tests settings, notifications, chat, inbox pages.
 */

import { test, expect } from "@playwright/test";

test.describe("Settings Page", () => {
  test("settings page loads", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    const content = page.locator("main, [role='main'], h1, h2").first();
    await expect(content).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Notifications Page", () => {
  test("notifications page loads", async ({ page }) => {
    await page.goto("/notifications");
    await page.waitForLoadState("networkidle");

    const content = page.locator("main, [role='main'], h1, h2").first();
    await expect(content).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Chat Page", () => {
  test("chat page loads", async ({ page }) => {
    await page.goto("/chat");
    await page.waitForLoadState("networkidle");

    const content = page.locator("main, [role='main'], h1, h2").first();
    await expect(content).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Inbox Page", () => {
  test("inbox page loads", async ({ page }) => {
    await page.goto("/inbox");
    await page.waitForLoadState("networkidle");

    const content = page.locator("main, [role='main'], h1, h2").first();
    await expect(content).toBeVisible({ timeout: 10000 });
  });
});
