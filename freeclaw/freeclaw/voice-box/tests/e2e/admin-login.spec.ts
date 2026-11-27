/**
 * Admin login feedback — E2E regression for the silent-admin-console bug.
 *
 * REGRESSION: /admin/* mounted outside Layout, so the toast host never
 * rendered there: a wrong password produced NO visible feedback, and a
 * successful login showed no confirmation. The host now mounts app-wide
 * (ToastHost in App.tsx). These tests pin the user-visible contract:
 *
 *   wrong password → an error toast MUST be visible
 *   right password → "Welcome back" toast + the console actually renders
 *
 * Requires VB_ADMIN_PASSWORD (never committed). Skips — never fails — when
 * the env var is absent so unauthenticated CI runs stay green.
 */
import { expect, test } from "@playwright/test";

const PASSWORD = process.env.VB_ADMIN_PASSWORD;

test.skip(!PASSWORD, "set VB_ADMIN_PASSWORD to run the admin login feedback check");

test.describe.configure({ mode: "serial" });

test("wrong password shows visible error feedback", async ({ page }) => {
	await page.goto("/admin");
	const pw = page.locator('input[type="password"]').first();
	await pw.fill("definitely-not-the-password");
	await page.getByRole("button", { name: /sign in/i }).click();
	await expect(
		page.locator('[role="status"] >> text=/incorrect|failed/i').first(),
	).toBeVisible({ timeout: 10000 });
});

test("correct password shows confirmation and renders the console", async ({ page }) => {
	await page.goto("/admin");
	const pw = page.locator('input[type="password"]').first();
	await pw.fill(PASSWORD!);
	await page.getByRole("button", { name: /sign in/i }).click();
	await expect(page.getByText("Welcome back, admin 👋")).toBeVisible({
		timeout: 15000,
	});
	await expect(page.getByText("Admin Access").first()).toBeHidden({
		timeout: 10000,
	});
});
