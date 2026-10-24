/**
 * E2E Tests: Accessibility claims are TRUE
 *
 * `/accessibility` publishes hard, falsifiable promises to users:
 *
 *   • "Minimum 4.5:1 color contrast ratio for normal text"
 *   • "ARIA labels on all interactive elements"
 *   • "Form labels associated with inputs"
 *   • "Alt text for informative images"
 *   • "Focus indicators visible on all interactive elements"
 *   • "Skip navigation links provided"
 *   • "Minimum 44x44px touch targets on mobile"
 *   • "WCAG 2.1 Level A: 29/29 criteria met"
 *
 * A published claim that is not tested is an unverified claim. This spec turns
 * each promise into a regression test so the page can never quietly become
 * false advertising: WCAG-AA rules are enforced with axe-core (AxeBuilder),
 * and the claims axe does not express (skip link, focus ring, touch targets)
 * are asserted directly against the DOM.
 *
 * Regression protection: once a violation is fixed here, it stays fixed.
 *
 * Env:
 *   VB_A11Y_PATHS   comma-separated routes to audit (defaults below)
 */

import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The user-facing routes that carry the product's core workflows, plus the
// admin entry. Audit the surfaces a real visitor actually meets.
const DEFAULT_PATHS = [
	"/",
	"/submit",
	"/polls",
	"/accessibility",
	"/settings",
	"/admin",
	"/search",
	"/notifications",
];

const ROUTES = (process.env.VB_A11Y_PATHS?.split(",").map((p) => p.trim()).filter(Boolean) ??
	DEFAULT_PATHS) as string[];

/** WCAG 2.1 Level A + AA — the level the site claims to target. */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/** axe impact levels that are hard failures (AA breaches, not advisories). */
const HARD_IMPACTS = new Set(["critical", "serious"]);

test.describe.configure({ retries: 0, timeout: 180_000 });

/**
 * Boot the app with a pinned theme, then wait for real content.
 *
 * The theme is pinned explicitly: the palette is themed by CSS variables, so
 * a light-only audit would miss every dark-mode regression (and vice versa).
 */
async function boot(
	page: Page,
	path: string,
	scheme: "light" | "dark" = "light",
): Promise<void> {
	await page.emulateMedia({ colorScheme: scheme });
	await page.addInitScript(
		([theme]) => {
			try {
				localStorage.setItem("vb:theme", JSON.stringify(theme));
			} catch {
				/* storage unavailable */
			}
		},
		[scheme],
	);
	await page.goto(path);
	await page
		.locator("#root > *")
		.first()
		.waitFor({ state: "attached", timeout: 20_000 })
		.catch(() => undefined);
	await page.waitForLoadState("networkidle").catch(() => undefined);
	await page.waitForTimeout(400);
}

// ── WCAG AA rules, enforced by axe ────────────────────────────────────────

test.describe("WCAG 2.1 A/AA (axe-core)", () => {
	for (const scheme of ["light", "dark"] as const) {
		for (const path of ROUTES) {
			test(`[${scheme}] ${path} has no serious or critical violations`, async ({ page }) => {
				await boot(page, path, scheme);

				const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();

				// Persist the full report so a failure is diagnosable without a rerun.
				const outDir = join(process.cwd(), "test-results");
				mkdirSync(outDir, { recursive: true });
				const slug = `${scheme}-${path.replace(/\W+/g, "_") || "root"}`;
				writeFileSync(
					join(outDir, `a11y-${slug}.json`),
					JSON.stringify(results.violations, null, 2),
				);

				const hard = results.violations.filter((v) => HARD_IMPACTS.has(v.impact ?? ""));

				// Failure output must name the rule, the element count and a selector —
				// enough to fix it without re-running the audit.
				const detail = hard
					.map(
						(v) =>
							`\n  [${v.impact}] ${v.id} — ${v.help} (${v.nodes.length} node(s))\n` +
							v.nodes
								.slice(0, 3)
								.map((n) => `      ${n.target.join(" ")}`)
								.join("\n"),
					)
					.join("");

				expect(
					hard.map((v) => `${v.id}(${v.nodes.length})`),
					`WCAG A/AA violations on ${scheme} ${path}${detail}`,				).toEqual([]);
				});
			}
		}
});

// ── Claims axe does not express ───────────────────────────────────────────

test.describe("Published claims beyond axe", () => {
	test("skip navigation link is provided and functional", async ({ page }) => {
		await boot(page, "/");

		const skip = page.locator("a.skip-to-content").first();
		await expect(skip).toBeAttached();
		await expect(skip).toHaveText(/skip/i);

		// It must reveal on focus (a link that never appears is unusable).
		// The reveal is a 0.2s `top` transition, so poll instead of sampling
		// once — a single immediate read measures the animation mid-flight.
		await skip.focus();
		await expect
			.poll(async () => (await skip.boundingBox())?.y ?? Number.NEGATIVE_INFINITY, {
				message: "skip link must slide into view once focused",
				timeout: 2_000,
			})
			.toBeGreaterThanOrEqual(0);

		const box = await skip.boundingBox();
		expect(box, "skip link must be laid out when focused").not.toBeNull();
		expect(box!.y).toBeLessThan(200);

		// And its target must exist, or the link does nothing.
		const target = page.locator("#main-content").first();
		await expect(target).toBeAttached();
	});

	test("keyboard focus indicator is visible on the first controls", async ({ page }) => {
		await boot(page, "/submit");

		// Tab through the first few stops and require a visible ring on each
		// interactive element we land on.
		const missing: string[] = [];
		for (let i = 0; i < 6; i++) {
			await page.keyboard.press("Tab");
			const info = await page.evaluate(() => {
				const el = document.activeElement as HTMLElement | null;
				if (!el || el === document.body) return null;
				const s = getComputedStyle(el);
				const outlineVisible =
					s.outlineStyle !== "none" && parseFloat(s.outlineWidth || "0") > 0;
				const shadowVisible = s.boxShadow !== "none" && s.boxShadow !== "";
				return {
					tag: el.tagName.toLowerCase(),
					label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30),
					outline: s.outline,
					boxShadow: s.boxShadow,
					visible: outlineVisible || shadowVisible,
				};
			});
			if (info && !info.visible) {
				missing.push(`<${info.tag}> "${info.label}" (outline: ${info.outline})`);
			}
		}

		expect(missing, `Focusable controls with no visible focus indicator:\n  ${missing.join("\n  ")}`).toEqual([]);
	});

});

/**
 * The 44x44 claim is a *touch* claim, so it must be tested on a touch device:
 * the fix lives behind `@media (pointer: coarse)`, which a mouse-driven
 * browser never matches. A phone-width viewport with a mouse would both miss
 * the media query and misrepresent the real input device.
 */
test.describe("Published claim: 44x44 touch targets", () => {
	test.use({
		viewport: { width: 390, height: 844 },
		hasTouch: true,
		isMobile: true,
		deviceScaleFactor: 3,
	});

	for (const path of ["/", "/submit", "/polls"]) {
		test(`${path} honours the 44x44 minimum on touch`, async ({ page }) => {
			await boot(page, path);

			// Inline prose links are deliberately exempt: WCAG does not treat a
			// link inside a sentence as a touch target, and padding them to 44px
			// would reflow body text. Buttons and form controls are the promise.
			const small = await page.evaluate(() => {
				const out: string[] = [];
				const nodes = document.querySelectorAll<HTMLElement>(
					'button, [role="button"], select, .btn',
				);
				for (const el of Array.from(nodes)) {
					const rect = el.getBoundingClientRect();
					if (rect.width === 0 || rect.height === 0) continue; // not rendered
					const s = getComputedStyle(el);
					if (s.visibility === "hidden" || s.display === "none") continue;
					if (rect.width < 44 || rect.height < 44) {
						const label = (el.getAttribute("aria-label") || el.textContent || "")
							.trim()
							.slice(0, 30);
						out.push(
							`${el.tagName.toLowerCase()} "${label}" ${Math.round(rect.width)}x${Math.round(rect.height)}`,
						);
					}
				}
				return out;
			});

			expect(small, `Touch targets under 44x44px on ${path}:\n  ${small.join("\n  ")}`).toEqual([]);
		});
	}
});
