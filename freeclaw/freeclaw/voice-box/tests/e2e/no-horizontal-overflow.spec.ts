/**
 * Regression guard: no page may scroll sideways.
 *
 * WHY THIS EXISTS
 * Every component class in src/index.css used to live outside any cascade
 * layer. Unlayered CSS outranks `@layer utilities`, so `.btn { display:
 * inline-flex }` silently defeated `hidden sm:inline-flex` — responsive
 * hiding simply did not work. The visible result was a 392px minimum content
 * width, so every page scrolled horizontally on a 375px or 320px phone.
 *
 * The component rules now live in `@layer components`. This spec locks that
 * in: if anyone moves them back out, or adds a fixed width wider than a
 * phone, this fails loudly instead of shipping a sideways-scrolling app.
 *
 * `documentElement.scrollWidth` is the page-level truth — it ignores
 * intentional horizontal scrollers (carousels) because those clip their own
 * content rather than widening the document.
 *
 * Run: npx playwright test tests/e2e/no-horizontal-overflow.spec.ts
 */

import { test, expect } from "@playwright/test";

// The narrowest viewports worth supporting: 320 = iPhone SE (1st gen),
// 375 = iPhone SE/mini, 430 = iPhone Pro Max.
const WIDTHS = [320, 375, 430];

const ROUTES = [
	"/",
	"/submit",
	"/polls",
	"/suggestions",
	"/leaderboard",
	"/communities",
	"/board",
	"/activity",
	"/saved",
	"/search",
	"/insights",
	"/settings",
	"/notifications",
	"/chat",
	"/about",
	"/terms",
	"/privacy",
	"/faq",
	"/status",
	"/changelog",
	"/accessibility",
	"/contact",
];

/** Admin tabs are deep-linked via ?tab= (see src/pages/Admin.tsx). */
const ADMIN_TABS = [
	"dashboard",
	"builder",
	"ops-center",
	"system-health",
	"performance",
	"security",
	"activity-stream",
	"reports",
	"posts",
	"users",
	"categories",
	"polls",
	"inbox",
	"errors",
	"logs",
	"settings",
];

test.describe.configure({ retries: 0, timeout: 600_000 });

async function seed(page: import("@playwright/test").Page, adminToken?: string) {
	await page.addInitScript(
		([token]) => {
			try {
				if (token)
					sessionStorage.setItem(
						"vb:adminAuth",
						JSON.stringify({ token, exp: Date.now() + 3_600_000 }),
					);
			} catch {
				/* storage unavailable */
			}
		},
		[adminToken],
	);
}

/**
 * Wait until the route's data has rendered: layout settles independently of
 * network timing, and a too-short wait misses the widest state (real data
 * renders wider than skeletons — that miss hid two real overflows during the
 * first audit pass).
 */
async function settle(page: import("@playwright/test").Page) {
	await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {
		/* slow endpoint — the fixed wait below still covers rendering */
	});
	await page.waitForTimeout(1_500);
}

async function overflow(page: import("@playwright/test").Page) {
	return page.evaluate(() => {
		const de = document.documentElement;
		const viewport = window.innerWidth;
		if (de.scrollWidth <= viewport + 1) return null;

		let worst: { tag: string; right: number; cls: string } | null = null;
		for (const el of Array.from(
			document.body.querySelectorAll<HTMLElement>("*"),
		)) {
			const r = el.getBoundingClientRect();
			if (r.width === 0 || r.height === 0) continue;
			if (r.right <= viewport + 1) continue;
			if (!worst || r.right > worst.right)
				worst = {
					tag: el.tagName.toLowerCase(),
					right: Math.round(r.right),
					// getAttribute, not el.className: on SVG elements className
					// is an SVGAnimatedString object, which stringifies to the
					// useless "[object SVGAnimatedString]" in failure output.
					cls: (el.getAttribute("class") || "").slice(0, 90),
				};
		}
		return {
			viewport,
			scrollWidth: de.scrollWidth,
			overflow: de.scrollWidth - viewport,
			worst,
		};
	});
}

for (const width of WIDTHS) {
	test(`user pages do not overflow a ${width}px viewport`, async ({ page }) => {
		await seed(page);
		await page.setViewportSize({ width, height: 800 });
		const failures: string[] = [];

		for (const route of ROUTES) {
			await page.goto(route, { waitUntil: "domcontentloaded" });
			await settle(page);
			const o = await overflow(page);
			if (o)
				failures.push(
					`${route}: scrollWidth ${o.scrollWidth} > ${o.viewport} (+${o.overflow}px)` +
						(o.worst
							? ` — widest <${o.worst.tag}> right=${o.worst.right} class="${o.worst.cls}"`
							: ""),
				);
		}

		expect(failures, failures.join("\n")).toEqual([]);
	});
}

test("admin tabs do not overflow a 375px viewport", async ({ page, request }) => {
	// The admin console needs a real session. The password is never committed:
	// set VB_ADMIN_PASSWORD to run this. Without it the admin check is skipped
	// (never silently passed).
	const password = process.env.VB_ADMIN_PASSWORD;
	test.skip(
		!password,
		"set VB_ADMIN_PASSWORD to run the admin overflow check",
	);

	const crypto = await import("node:crypto");
	const password_hash = crypto
		.createHash("sha256")
		.update(password as string)
		.digest("hex");
	const res = await request.post("/api/admin", {
		data: { action: "login", password_hash },
	});
	expect(res.ok(), "admin login must succeed for this check to mean anything").toBe(
		true,
	);
	const { token } = (await res.json()) as { token: string };

	await seed(page, token);
	await page.setViewportSize({ width: 375, height: 812 });
	const failures: string[] = [];

	for (const tab of ADMIN_TABS) {
		await page.goto(`/admin?tab=${tab}`, { waitUntil: "domcontentloaded" });
		await settle(page);
		const o = await overflow(page);
		if (o)
			failures.push(
				`/admin?tab=${tab}: scrollWidth ${o.scrollWidth} > ${o.viewport} (+${o.overflow}px)` +
					(o.worst
						? ` — widest <${o.worst.tag}> right=${o.worst.right} class="${o.worst.cls}"`
						: ""),
			);
	}

	expect(failures, failures.join("\n")).toEqual([]);
});
