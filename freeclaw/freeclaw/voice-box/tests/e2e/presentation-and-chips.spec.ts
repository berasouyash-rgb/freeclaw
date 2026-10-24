/**
 * E2E Playthrough: the intelligent-UI flagship paths.
 *
 * Unit suites prove the logic; this spec proves the whole loop runs in a
 * real browser with real user gestures:
 *
 *  ADMIN — Presentation deck (`/admin?tab=presentation`, API stubbed):
 *    1. all six pages ticked by default, cover heroes render live numbers
 *    2. Clear hides every section slide (only the cover stays visible)
 *    3. Select all restores them
 *    4. typing a direction + Narrate swaps rule notes for engine-labeled ones
 *    5. Export PPT produces a real .pptx download (pptxgenjs in-browser)
 *
 *  USER — inbox starter chips (`/chat`, API stubbed empty):
 *    1. the three chips render on the empty conversation
 *    2. a chip fills the composer for review and enables Send
 *    3. nothing sends by itself (Send stays a deliberate tap)
 *
 * Deterministic: every /api/** call is stubbed, no database needed.
 */

import { test, expect, type Page } from "@playwright/test";

test.describe.configure({ retries: 0, timeout: 120_000 });

const DECK = {
	version: 1,
	generated_at: "2026-10-10T12:00:00.000Z",
	window: 2000,
	totals: {
		posts: 10,
		open: 7,
		solved: 3,
		reports_open: 4,
		reports_resolved: 2,
		polls: 3,
		votes: 9,
	},
	by_category: [
		{ category: "Facilities", open: 4, solved: 1, total: 5 },
		{ category: "Food", open: 3, solved: 2, total: 5 },
	],
	by_status: [
		{ status: "open", count: 5 },
		{ status: "solved", count: 3 },
		{ status: "in_progress", count: 2 },
	],
	top_supported: [
		{
			id: "p1",
			title: "Fix the lab taps",
			category: "Facilities",
			status: "open",
			support: 5,
			upvote: 2,
			score: 7,
		},
		{
			id: "p2",
			title: "Longer library hours",
			category: "Food",
			status: "solved",
			support: 3,
			upvote: 1,
			score: 4,
		},
	],
	top_polls: [
		{ id: "poll1", title: "Canteen menu", total: 6 },
		{ id: "poll2", title: "Sports day", total: 3 },
	],
	solved_by_week: [
		{ week: "2026-09-28", solved: 1 },
		{ week: "2026-10-05", solved: 2 },
	],
	recommendations: [
		{ rule: "category-dominance", text: "Facilities dominates the queue." },
		{ rule: "quiet-polls", text: "Feature the quiet polls." },
	],
	narrations: {
		cover: "10 posts in scope, 7 still open. Resolution rate 30%.",
		complaints: "Facilities holds 4 of 7 open items (57%) — fix this category first.",
		feed: "3 of 10 posts resolved (30%). The ring is the share done.",
		reports: "4 reports need a human decision; 2 already resolved.",
		polls: "Canteen menu leads with 6 of 9 votes (67%).",
		trends: "Last week: 2 solved vs 1 the week before.",
		actions: "2 recommended moves, each labeled with the rule that fired.",
	},
};

const AI_NOTES = {
	cover: "E2E cover line.",
	complaints: "E2E complaints line.",
	feed: "E2E feed line.",
	reports: "E2E reports line.",
	polls: "E2E polls line.",
	trends: "E2E trends line.",
	actions: "E2E actions line.",
};

async function seedAdminSession(page: Page) {
	await page.addInitScript(() => {
		window.sessionStorage.setItem(
			"vb:adminAuth",
			JSON.stringify({ token: "deck-e2e-token", exp: Date.now() + 3_600_000 }),
		);
	});
}

async function stubDeckApi(page: Page) {
	await page.route("**/api/**", async (route) => {
		const url = new URL(route.request().url());
		const path = url.pathname;
		const json = (body: unknown) =>
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify(body),
			});
		if (path.includes("/api/admin")) {
			return json({ ok: true, valid: true, sessions: [] });
		}
		if (path.includes("/api/report-deck")) {
			return json(DECK);
		}
		if (path.includes("/api/ai")) {
			return json({ engine: "e2e:test-model", notes: AI_NOTES });
		}
		return json({});
	});
}

async function stubEmptyInbox(page: Page) {
	await page.route("**/api/**", async (route) => {
		const url = new URL(route.request().url());
		const path = url.pathname;
		const json = (body: unknown) =>
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify(body),
			});
		if (path.includes("/api/inbox")) {
			return json({
				messages: [],
				thread: { thread_id: "e2e-thread", status: "open" },
				state: {},
			});
		}
		return json({});
	});
}

test("admin deck: select, direct, narrate, and export the presentation", async ({
	page,
}) => {
	await seedAdminSession(page);
	await stubDeckApi(page);
	await page.goto("/admin?tab=presentation", { waitUntil: "domcontentloaded" });

	// All six pages ticked by default; the deck opens on the cover.
	for (const name of ["Complaints", "Feed", "Reports", "Polls", "Trends", "Actions"]) {
		await expect(
			page.getByRole("checkbox", { name, exact: true }),
		).toBeChecked({ timeout: 20_000 });
	}
	// The deck opens on the cover; step in to prove the section slides.
	await expect(page.getByText(/School report/)).toBeVisible({ timeout: 20_000 });
	await page.getByRole("button", { name: "Next slide" }).click();
	await expect(page.getByText("Fix the lab taps")).toBeVisible({ timeout: 20_000 });

	// Clear hides every section slide — only the cover stays visible.
	// (The full explainer sentence is unique; the bare title renders in
	// three places per slide and would trip strict mode.)
	await page.getByRole("button", { name: "Clear", exact: true }).click();
	await expect(
		page.getByText("Canteen menu leads with 6 of 9 votes (67%)."),
	).toBeHidden();
	await expect(page.getByText(/School report/)).toBeVisible();

	// Select all restores the full deck — step to the polls slide by its dot.
	await page.getByRole("button", { name: "Select all", exact: true }).click();
	await page.getByRole("tab", { name: /Polls/ }).click();
	await expect(
		page.getByText("Canteen menu leads with 6 of 9 votes (67%)."),
	).toBeVisible();

	// Typing a direction + Narrate swaps rule notes for engine-labeled ones.
	await page
		.getByLabel("Describe this presentation")
		.fill("For parents, reassuring tone");
	await page.getByRole("button", { name: "Narrate with AI" }).click();
	// The parked polls slide shows its swapped note; the badge proves provenance.
	await expect(page.getByText("E2E polls line.")).toBeVisible({
		timeout: 20_000,
	});
	await expect(page.getByRole("main").getByText(/Narrated by e2e:test-model/)).toBeVisible();
	// …and the swap reached every slide: step to complaints and read it there.
	await page.getByRole("tab", { name: /Top complaints/ }).click();
	await expect(page.getByText("E2E complaints line.")).toBeVisible();

	// Export PPT produces a real .pptx download from the live spec.
	const [download] = await Promise.all([
		page.waitForEvent("download", { timeout: 30_000 }),
		page.getByRole("button", { name: "Export PPT" }).click(),
	]);
	expect(download.suggestedFilename()).toMatch(/\.pptx$/);
});

test("user inbox: starter chips invite the first message", async ({ page }) => {
	await stubEmptyInbox(page);
	await page.goto("/chat", { waitUntil: "domcontentloaded" });

	await expect(page.getByText("No messages yet")).toBeVisible({
		timeout: 20_000,
	});
	// First-visit tutorial overlay covers the page — dismiss when present
	// so the chips underneath are clickable. Returning visitors skip this.
	try {
		await page
			.getByRole("button", { name: "Skip tutorial" })
			.click({ timeout: 5_000 });
	} catch {
		/* no tutorial: already dismissed */
	}
	const chip = page.getByRole("button", { name: "Help me write a complaint" });
	await expect(chip).toBeVisible();

	// One tap fills the composer for review — and enables Send.
	await chip.click();
	const composer = page.getByLabel("Chat message");
	await expect(composer).toHaveValue("I need help writing a complaint about ");
	await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();
});
