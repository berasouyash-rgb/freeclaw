/**
 * Admin console deep-linking.
 *
 * The active tab used to live only in component state, so:
 *   - /admin always reopened on Dashboard, losing your place on refresh
 *   - the Back button left the console instead of returning to the last view
 *   - a specific tab could not be linked, bookmarked, or handed to someone
 *
 * The tab now lives in the URL as ?tab=<key>. This spec holds that in place.
 *
 * Requires VB_ADMIN_PASSWORD (never committed). Skipped — never silently
 * passed — when it is absent.
 */

import { test, expect } from "@playwright/test";

const TABS = [
	{ key: "reports", marker: /reports/i },
	{ key: "users", marker: /users/i },
	{ key: "polls", marker: /polls/i },
];

test.describe.configure({ retries: 0, timeout: 120_000 });

test.skip(
	!process.env.VB_ADMIN_PASSWORD,
	"set VB_ADMIN_PASSWORD to run the admin deep-link check",
);

async function signIn(
	page: import("@playwright/test").Page,
	request: import("@playwright/test").APIRequestContext,
) {
	const crypto = await import("node:crypto");
	const password_hash = crypto
		.createHash("sha256")
		.update(process.env.VB_ADMIN_PASSWORD as string)
		.digest("hex");
	const res = await request.post("/api/admin", {
		data: { action: "login", password_hash },
	});
	expect(res.ok()).toBe(true);
	const { token } = (await res.json()) as { token: string };
	await page.addInitScript(([t]) => {
		try {
			sessionStorage.setItem(
				"vb:adminAuth",
				JSON.stringify({ token: t, exp: Date.now() + 3_600_000 }),
			);
		} catch {
			/* storage unavailable */
		}
	}, [token]);
}

test("a ?tab= URL opens that tab directly", async ({ page, request }) => {
	await signIn(page, request);

	for (const { key, marker } of TABS) {
		await page.goto(`/admin?tab=${key}`, { waitUntil: "domcontentloaded" });
		await expect(page.getByText(marker).first()).toBeVisible({
			timeout: 20_000,
		});
		// The breadcrumb names the tab, so a wrong tab is a visible failure
		// rather than a silent pass on the nav label alone.
		await expect(
			page.locator("text=/Admin\\s*\\/\\s*" + key + "/i").first(),
		).toBeVisible({ timeout: 20_000 });
	}
});

test("an unknown ?tab= falls back to the first tab instead of blanking", async ({
	page,
	request,
}) => {
	await signIn(page, request);
	await page.goto("/admin?tab=not-a-real-tab", {
		waitUntil: "domcontentloaded",
	});
	await expect(page.locator("text=/Admin\\s*\\/\\s*Dashboard/i").first()).toBeVisible(
		{ timeout: 20_000 },
	);
});

test("switching tabs writes the tab into the URL", async ({ page, request }) => {
	await signIn(page, request);
	await page.goto("/admin", { waitUntil: "domcontentloaded" });
	await expect(page.locator("text=/Admin\\s*\\/\\s*Dashboard/i").first()).toBeVisible(
		{ timeout: 20_000 },
	);

	// Drive the console's own cross-panel navigation event — the same path a
	// dashboard card uses to jump to another view.
	await page.evaluate(() => {
		window.dispatchEvent(new CustomEvent("vb:admin-tab", { detail: "logs" }));
	});

	await expect(page).toHaveURL(/[?&]tab=logs/, { timeout: 20_000 });
});
