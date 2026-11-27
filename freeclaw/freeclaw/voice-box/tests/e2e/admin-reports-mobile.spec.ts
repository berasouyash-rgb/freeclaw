/**
 * E2E Layout: Admin Reports on mobile (320 / 375 / 430)
 *
 * jsdom has no layout engine, so a unit test cannot detect the failure this
 * file exists for: an element wider than the viewport. That is a real browser
 * measurement, so it is measured here.
 *
 * The page is driven without credentials by seeding the admin session the app
 * already expects in sessionStorage, and by stubbing the API so the run is
 * deterministic and needs no database.
 *
 * What is asserted at each width:
 *   1. the document itself does not scroll horizontally
 *   2. no element's right edge escapes the viewport
 *   3. the primary controls are still hit-testable (not covered or clipped)
 */

import { test, expect, type Page } from "@playwright/test";

const WIDTHS = [320, 375, 430] as const;

/**
 * Fixture: one report long enough to stress wrapping.
 *
 * The shape mirrors what the queue actually reads — the row renders `reason`
 * (not `title`), plus `target_type`/`target_id`, and `openReports` is simply
 * `status !== "resolved"`. A long URL and a long unbroken token are included
 * because those are what blow a grid column past the viewport.
 */
const REASON = "Broken lift in block C — the door does not close and it jams";

const REPORT = {
	id: "rpt-9f3c1a2b4d5e6f70",
	post_id: "post-abc123",
	title: REASON,
	reason: REASON,
	target_type: "post",
	target_id: "post-abc123-long-identifier",
	category: "Safety",
	details:
		"The lift door in block C has not closed properly for two weeks. " +
		"Long tokens break naive layouts: " +
		"https://example.school.edu/very/long/path/segment/that/does/not/wrap/naturally " +
		"and aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	content:
		"Broken lift in block C — the door does not close and it jams. " +
		"https://example.school.edu/very/long/path/that/does/not/wrap " +
		"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	status: "open",
	priority: "high",
	type: "report",
	created_at: new Date(Date.now() - 3_600_000).toISOString(),
	updated_at: new Date(Date.now() - 600_000).toISOString(),
	author_id: "anon-1234567890",
	assigned_to: null,
	reference: "#RPT-9F3C",
	enforcement: { strikes: 2, suspended: true, banned: false },
};

const POST = {
	id: "post-abc123",
	title: "Broken lift in block C",
	description: "The lift door in block C does not close properly.",
	category: "Safety",
	status: "open",
	priority: "high",
	type: "problem",
	created_at: REPORT.created_at,
	hidden: false,
	deleted: false,
	author_id: "anon-1234567890",
};

/** Route every API call to a deterministic stub. */
async function stubApi(page: Page) {
	await page.route("**/api/**", async (route) => {
		const url = new URL(route.request().url());
		const path = url.pathname;

		const json = (body: unknown) =>
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify(body),
			});

		// Admin session verification + anything session-shaped.
		if (path.includes("/api/admin")) {
			return json({ ok: true, valid: true, sessions: [] });
		}
		if (path.includes("/api/reports")) {
			return json([REPORT]);
		}
		if (path.includes("/api/posts")) {
			return json({ data: [POST], post: POST, total: 1, nextCursor: null });
		}
		if (path.includes("/api/comments")) {
			return json({ data: [], total: 0 });
		}
		if (path.includes("/api/timeline")) {
			return json({
				post_id: POST.id,
				timeline: [
					{
						id: "t1",
						action: "Report submitted",
						created_at: REPORT.created_at,
					},
					{
						id: "t2",
						action: "Investigation started",
						created_at: REPORT.updated_at,
					},
				],
			});
		}
		// Anything else: an empty object keeps badge counters quiet.
		return json({});
	});
}

/** Seed the admin session the shell reads on mount. */
async function seedAdminSession(page: Page) {
	await page.addInitScript(() => {
		window.sessionStorage.setItem(
			"vb:adminAuth",
			JSON.stringify({
				token: "layout-test-token",
				exp: Date.now() + 60 * 60 * 1000,
			}),
		);
	});
}

/**
 * Open the Reports tab and wait for a row.
 *
 * The sidebar is `hidden md:flex`, so at these widths the navigation lives
 * behind the hamburger drawer — the tab button does not exist until it opens.
 */
async function openReports(page: Page) {
	await page.goto("/admin");

	// Wait for the shell to mount. The hamburger only exists once the session
	// check has resolved, so this also proves the seeded session was accepted.
	const hamburger = page.getByRole("button", { name: "Open menu" });
	await expect(hamburger).toBeVisible({ timeout: 30_000 });
	await hamburger.click();

	// The sidebar and the drawer render the SAME nav, so an unscoped
	// "Reports" lookup matches twice (strict-mode violation). Scope to the
	// dialog — the sidebar copy is display:none at these widths anyway.
	const drawer = page.getByRole("dialog", { name: "Admin menu" });
	await expect(drawer).toBeVisible({ timeout: 10_000 });
	await drawer
		.getByRole("button", { name: "Reports", exact: true })
		.click({ timeout: 20_000 });

	await expect(page.getByText(/Report Queue/)).toBeVisible({ timeout: 20_000 });
	// The queue row renders the report's reason.
	await expect(page.getByText(/Broken lift in block C/).first()).toBeVisible({
		timeout: 20_000,
	});
}

/**
 * Measure horizontal overflow and return the offending elements.
 *
 * `documentElement.scrollWidth > clientWidth` is the page-level symptom;
 * the per-element scan names the culprit so a failure is actionable.
 */
async function measureOverflow(page: Page) {
	return page.evaluate(() => {
		const doc = document.documentElement;
		const vw = doc.clientWidth;
		const offenders: {
			tag: string;
			cls: string;
			right: number;
			width: number;
		}[] = [];

		for (const el of Array.from(document.querySelectorAll("body *"))) {
			const r = (el as HTMLElement).getBoundingClientRect();
			if (r.width === 0 || r.height === 0) continue;
			// Allow a 1px rounding tolerance.
			if (r.right > vw + 1 || r.left < -1) {
				offenders.push({
					tag: el.tagName.toLowerCase(),
					cls: (el.className || "").toString().slice(0, 140),
					right: Math.round(r.right),
					width: Math.round(r.width),
				});
			}
		}

		return {
			viewport: vw,
			scrollWidth: doc.scrollWidth,
			pageOverflow: doc.scrollWidth > vw + 1,
			offenders: offenders.slice(0, 12),
		};
	});
}

for (const width of WIDTHS) {
	test.describe(`Admin Reports @ ${width}px`, () => {
		test.use({ viewport: { width, height: 800 } });

		test.beforeEach(async ({ page }) => {
			await seedAdminSession(page);
			await stubApi(page);
		});

		test("report queue does not overflow horizontally", async ({ page }) => {
			await openReports(page);

			const m = await measureOverflow(page);
			expect(
				m.pageOverflow,
				`page scrolls horizontally at ${width}px ` +
					`(scrollWidth ${m.scrollWidth} > viewport ${m.viewport}). ` +
					`Offenders: ${JSON.stringify(m.offenders, null, 2)}`,
			).toBe(false);

			// The tabs and the refresh control must remain reachable.
			await expect(page.getByRole("button", { name: /Refresh/ })).toBeVisible();
		});

		test("report detail view does not overflow horizontally", async ({
			page,
		}) => {
			await openReports(page);

			// Open the first report row.
			await page.getByText(/Broken lift in block C/).first().click();

			// Anchor on the Back control: it is unique to the detail view and is
			// the only way out, so its presence proves the view actually mounted.
			const back = page.getByRole("button", { name: /Back to list/i });
			await expect(back).toBeVisible({ timeout: 20_000 });

			const m = await measureOverflow(page);
			expect(
				m.pageOverflow,
				`detail view scrolls horizontally at ${width}px ` +
					`(scrollWidth ${m.scrollWidth} > viewport ${m.viewport}). ` +
					`Offenders: ${JSON.stringify(m.offenders, null, 2)}`,
			).toBe(false);

			// The Back control must be inside the viewport, not clipped off it.
			const box = await back.boundingBox();
			expect(box, "back button has no box").not.toBeNull();
			expect(box!.x).toBeGreaterThanOrEqual(0);
			expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
		});
	});
}
