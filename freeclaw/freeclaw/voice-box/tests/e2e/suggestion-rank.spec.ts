// ═══════════════════════════════════════════════════════════════════
// Suggestion Board — Top ranked rank motion in a real browser
// ═══════════════════════════════════════════════════════════════════
// Locks the feel, not just the end state: a vote must re-order the cards
// with an actual glide (Web Animations running on the real elements) and
// label both moves with ↑/↓ for three seconds. Reduced-motion users get
// the same re-order and labels with no motion.
//
// The API rows are intercepted, so the test never writes to the database
// and its tie-break setup (equal support) stays deterministic.
// ═══════════════════════════════════════════════════════════════════

import { expect, type Page, test } from "@playwright/test";

const base = {
	type: "suggestion",
	description: "A short reason this matters.",
	category: "Academics",
	status: "reported",
	priority: "medium",
	author_id: "anon-e2e",
	updated_at: "2026-02-01T00:00:00Z",
	comment_count: 0,
};

const ideas = [
	{
		...base,
		id: "a",
		title: "Dark mode",
		created_at: "2026-02-02T00:00:00Z",
		reactions: { upvote: 5 },
	},
	{
		...base,
		id: "b",
		title: "Keyboard shortcuts",
		created_at: "2026-02-01T00:00:00Z",
		reactions: { upvote: 5 },
	},
];

async function mockBoard(page: Page) {
	await page.addInitScript(() => {
		try {
			localStorage.setItem("vb:tutorialDone", JSON.stringify(true));
		} catch {
			/* storage unavailable */
		}
	});
	await page.route(/\/api\/posts\?type=suggestion/, (route) =>
		route.fulfill({ json: ideas }),
	);
	// A realtime row read must never leak real data into the mocked board.
	await page.route(/\/api\/posts\?id=/, (route) =>
		route.fulfill({ json: { post: null } }),
	);
	await page.route(/\/api\/reactions/, (route) =>
		route.request().method() === "POST"
			? route.fulfill({
					json: { counts: { upvote: 6 }, mine: ["upvote"], toggled: true },
				})
			: route.fulfill({ json: [] }),
	);
}

/**
 * Reads the FLIP glide actually running on a card, if any.
 *
 * Filters by duration: after a click the pointer rests on the card, so its
 * 150ms hover-lift transition is also a translateY animation. Only the
 * list's own long, decelerating glide counts.
 */
async function glideOf(page: Page, id: string) {
	return page.locator(`article[data-flip-id="${id}"]`).evaluate((node) => {
		for (const animation of node.getAnimations()) {
			const effect = animation.effect;
			if (!effect || !("getKeyframes" in effect)) continue;
			const duration = effect.getTiming().duration;
			if (typeof duration !== "number" || duration < 300) continue;
			const glides = effect
				.getKeyframes()
				.some((frame) =>
					String((frame as { transform?: string }).transform ?? "").includes(
						"translateY",
					),
				);
			if (glides) return duration;
		}
		return null;
	});
}

test("Top ranked glides the voted card up and labels both moves", async ({
	page,
}) => {
	await mockBoard(page);
	await page.goto("/suggestions");
	await expect(
		page.getByRole("heading", { name: /suggestion board/i }),
	).toBeVisible();
	await expect(page.locator("article")).toHaveCount(2);

	await page.getByRole("tab", { name: /top ranked/i }).click();
	// Equal support keeps the served order until a vote breaks the tie.
	await expect(page.locator("article h3").first()).toHaveText("Dark mode");

	await page
		.locator('article[data-flip-id="b"]')
		.getByRole("button", { name: /support this idea/i })
		.click();

	// The glide is real: the board intentionally uses a slow 900ms FLIP so a
	// reorder stays legible (see Suggestions.tsx rank-motion comment).
	expect(await glideOf(page, "b")).toBe(900);

	await expect(page.locator("article h3").first()).toHaveText(
		"Keyboard shortcuts",
	);
	await expect(
		page.locator('article[data-flip-id="b"] [data-testid="rank-delta"]'),
	).toHaveAttribute("data-direction", "up");
	await expect(
		page.locator('article[data-flip-id="a"] [data-testid="rank-delta"]'),
	).toHaveAttribute("data-direction", "down");
});

test.describe("prefers-reduced-motion", () => {
	test("re-orders and labels the move without gliding", async ({ page }) => {
		await page.emulateMedia({ reducedMotion: "reduce" });
		await mockBoard(page);
		await page.goto("/suggestions");
		expect(
			await page.evaluate(
				() => matchMedia("(prefers-reduced-motion: reduce)").matches,
			),
		).toBe(true);
		await expect(page.locator("article")).toHaveCount(2);
		await page.getByRole("tab", { name: /top ranked/i }).click();

		await page
			.locator('article[data-flip-id="b"]')
			.getByRole("button", { name: /support this idea/i })
			.click();

		await expect(page.locator("article h3").first()).toHaveText(
			"Keyboard shortcuts",
		);
		expect(await glideOf(page, "b")).toBeNull();
		await expect(
			page.locator('article[data-flip-id="b"] [data-testid="rank-delta"]'),
		).toHaveAttribute("data-direction", "up");
	});
});
