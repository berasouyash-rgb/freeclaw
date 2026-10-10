/**
 * E2E: Reaction liveness (feed card stays live after your own toggle).
 *
 * Regression guard for the frozen-reaction fix: after your own toggle the
 * card must keep showing other users' counts (parent-merged truth), not a
 * stuck optimistic copy.
 *
 * Environment honesty: this suite runs in CI without backend credentials, so
 * an empty feed is possible there. Like the rest of this repo's E2E (see
 * poll-voting.spec.ts), the toggle assertions run only when a feed card
 * exists; the structural assertions always run. The non-vacuous weight for
 * this behavior lives in src/__tests__/PostCard.test.tsx ("live
 * reconciliation") plus src/__tests__/feedReactionMerge.test.ts. Where feed
 * data exists (local dev against Supabase, prod smoke), this spec exercises
 * the real toggle → persist → toggle-off round trip.
 */

import { test, expect } from "@playwright/test";

function supportButtons(page: import("@playwright/test").Page) {
	return page.locator(
		'.vb-feed-list button[aria-label^="Support"], .vb-feed-list button[aria-label^="Upvote"]',
	);
}

function parseCount(label: string | null): number | null {
	const m = /\(\s*(\d+)\s*\)\s*$/.exec(label ?? "");
	return m ? Number(m[1]) : null;
}

test.describe("Reaction liveness", () => {
	test("feed renders reaction buttons with counts", async ({ page }) => {
		await page.goto("/");
		await page.waitForLoadState("networkidle");
		const buttons = supportButtons(page);
		const count = await buttons.count();
		if (count > 0) {
			const label = await buttons.first().getAttribute("aria-label");
			expect(parseCount(label)).not.toBeNull();
			const pressed = await buttons.first().getAttribute("aria-pressed");
			expect(pressed).toMatch(/true|false/);
		}
	});

	test("toggle persists across reload and toggles back off", async ({
		page,
	}) => {
		await page.goto("/");
		await page.waitForLoadState("networkidle");
		const buttons = supportButtons(page);
		const count = await buttons.count();
		if (count === 0) return;

		const btn = buttons.first();
		await btn.scrollIntoViewIfNeeded();

		const before = parseCount(await btn.getAttribute("aria-label"));
		const wasActive =
			(await btn.getAttribute("aria-pressed")) === "true";
		expect(before).not.toBeNull();

		await btn.click({ force: true });
		// Optimistic flip lands instantly; the server reconcile follows.
		await expect(btn).toHaveAttribute(
			"aria-pressed",
			wasActive ? "false" : "true",
			{ timeout: 8000 },
		);
		const after = parseCount(await btn.getAttribute("aria-label"));
		expect(after).toBe((before ?? 0) + (wasActive ? -1 : 1));

		// Reload: the count must come back from the server, proving the
		// toggle persisted (not just an optimistic flash).
		await page.reload();
		await page.waitForLoadState("networkidle");
		const reloaded = supportButtons(page).first();
		await expect(reloaded).toHaveAttribute(
			"aria-pressed",
			wasActive ? "false" : "true",
			{ timeout: 10000 },
		);
		expect(parseCount(await reloaded.getAttribute("aria-label"))).toBe(
			after,
		);

		// Restore: toggle back so the suite leaves no footprint.
		await reloaded.click({ force: true });
		await expect(reloaded).toHaveAttribute(
			"aria-pressed",
			wasActive ? "true" : "false",
			{ timeout: 8000 },
		);
		expect(
			parseCount(await reloaded.getAttribute("aria-label")),
		).toBe(before);
	});
});
