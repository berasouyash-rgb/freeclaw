/**
 * Mechanical UI/UX audit.
 *
 * Walks every real route (and every admin tab) at desktop and mobile widths
 * against a live dev server, and records objective defects:
 *
 *   - uncaught exceptions
 *   - console errors (with the first stack line, so they are actionable)
 *   - API responses that failed (status >= 400)
 *   - horizontal overflow, naming the widest offending element
 *   - blank renders (shell mounted but no visible text)
 *
 * 429 responses are deliberately NOT findings. The sweep walks 71 pages
 * back-to-back, so tripping the rate limiter is self-inflicted load — evidence
 * the limiter works, not a product defect — and counting it produced 258 entries
 * that buried the one real defect in the report. They are tallied separately.
 * Repeats of an identical finding are collapsed into a count for the same reason.
 *
 * It asserts nothing on purpose: one broken route must not stop the sweep.
 * The report is written to tests/e2e/.audit-report.json and printed as a table.
 */

import { test, expect } from "@playwright/test";
import { persistReport, REPORT_PATH } from "./audit-report";

// The whole point is to sweep everything in one pass, so the per-test budget
// is generous (the default 60s would cut a route list short).
test.describe.configure({ retries: 0, mode: "serial", timeout: 600_000 });

// Never hardcode the admin password in a committed test. Set
// VB_ADMIN_PASSWORD to audit the admin console; without it the admin sweep
// still runs, but unauthenticated (it will only catch the login gate).
const ADMIN_PASSWORD = process.env.VB_ADMIN_PASSWORD;

const USER_ROUTES = [
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
	"/definitely-not-a-real-route",
];

/** Admin tabs are local state keyed by this list (see src/pages/Admin.tsx). */
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
	"email-templates",
	"settings",
];

type Finding = {
	route: string;
	width: number;
	kind: string;
	detail: string;
	/** How many times this identical finding recurred during the sweep. */
	count: number;
};

const findings: Finding[] = [];
/** Dedupe index: finding key → position in `findings`. */
const findingIndex = new Map<string, number>();
/** Sum of every finding occurrence, including the collapsed repeats. */
let findingOccurrences = 0;

/** Rate-limit responses caused by *this sweep's* pace, kept out of `findings`. */
const rateLimited = new Map<string, number>();

const visited: { route: string; width: number; ms: number }[] = [];

function record(
	route: string,
	width: number,
	kind: string,
	detail: string,
) {
	findingOccurrences++;
	const trimmed = detail.slice(0, 400);
	const key = `${width}|${route}|${kind}|${trimmed}`;
	const seen = findingIndex.get(key);
	if (seen != null) {
		findings[seen].count++;
		return;
	}
	findingIndex.set(key, findings.length);
	findings.push({ route, width, kind, detail: trimmed, count: 1 });
}

/** Tallied, not recorded as a defect — see the header note. */
function recordRateLimit(path: string) {
	rateLimited.set(path, (rateLimited.get(path) || 0) + 1);
}

/** Seed the flags the app reads before first paint: skip the boot film, carry an admin session. */
async function seed(page: import("@playwright/test").Page, adminToken?: string) {
	await page.addInitScript(
		([token]) => {
			try {
				if (token) {
					sessionStorage.setItem(
						"vb:adminAuth",
						JSON.stringify({ token, exp: Date.now() + 3_600_000 }),
					);
				}
			} catch {
				/* storage unavailable */
			}
		},
		[adminToken],
	);
}

function attachListeners(
	page: import("@playwright/test").Page,
	route: string,
	width: number,
) {
	page.on("pageerror", (err) =>
		record(route, width, "pageerror", `${err.name}: ${err.message}`),
	);
	page.on("console", (msg) => {
		if (msg.type() !== "error") return;
		const text = msg.text();
		// React's dev-only act()/hydration chatter is noise, not a product defect.
		if (/Download the React DevTools/.test(text)) return;
		// The browser logs its own "Failed to load resource … 429" for each
		// rate-limited request. That is the same self-inflicted event the response
		// handler already tallies, so recording it again only doubles the noise.
		if (/Failed to load resource/.test(text) && /\b429\b/.test(text)) return;
		record(route, width, "console.error", text);
	});
	page.on("response", (res) => {
		const status = res.status();
		if (status < 400) return;
		const url = res.url();
		if (!url.includes("/api/")) return;
		// A 401 on the admin verify probe is the correct answer for an
		// unauthenticated visitor, not a defect.
		if (status === 401) return;
		const path = new URL(url).pathname + new URL(url).search;
		// Self-inflicted load, not a defect — tallied separately so it cannot
		// drown out genuine failures (see the header note).
		if (status === 429) return recordRateLimit(path);
		record(route, width, `http.${status}`, path);
	});
}

/** Measure viewport overflow and name the widest element that causes it. */
async function measureOverflow(page: import("@playwright/test").Page) {
	return page.evaluate(() => {
		const de = document.documentElement;
		const viewport = window.innerWidth;
		const scrollWidth = de.scrollWidth;
		if (scrollWidth <= viewport + 1) return null;

		let worst: { tag: string; right: number; cls: string } | null = null;
		for (const el of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
			const r = el.getBoundingClientRect();
			if (r.width === 0 || r.height === 0) continue;
			if (r.right <= viewport + 1) continue;
			if (!worst || r.right > worst.right) {
				worst = {
					tag: el.tagName.toLowerCase(),
					right: Math.round(r.right),
					cls: (el.className || "").toString().slice(0, 120),
				};
			}
		}
		return {
			viewport,
			scrollWidth,
			overflow: scrollWidth - viewport,
			worst,
		};
	});
}

/** A page is "blank" when the shell mounted but rendered no visible text. */
async function measureBlank(page: import("@playwright/test").Page) {
	return page.evaluate(() => {
		const root = document.getElementById("root");
		const text = (root?.innerText || "").replace(/\s+/g, " ").trim();
		return { chars: text.length, sample: text.slice(0, 90) };
	});
}

/**
 * `label` is what findings are filed under (so an admin tab reads
 * "/admin#reports"); `url` is where the browser actually goes.
 */
async function sweep(
	page: import("@playwright/test").Page,
	url: string,
	width: number,
	label: string = url,
) {
	attachListeners(page, label, width);
	const started = Date.now();
	await page.goto(url, { waitUntil: "domcontentloaded" });
	// Let the lazy route chunk, its data, and any realtime subscribe settle.
	await page.waitForTimeout(2500);
	visited.push({ route: label, width, ms: Date.now() - started });

	await measure(page, label, width);
	page.removeAllListeners();
}

/** Measure the currently-rendered page and file findings under `label`. */
async function measure(
	page: import("@playwright/test").Page,
	label: string,
	width: number,
) {
	const route = label;

	const overflow = await measureOverflow(page);
	if (overflow) {
		record(
			route,
			width,
			"overflow",
			`scrollWidth ${overflow.scrollWidth} > viewport ${overflow.viewport} (+${overflow.overflow}px)` +
				(overflow.worst
					? ` widest <${overflow.worst.tag}> right=${overflow.worst.right} class="${overflow.worst.cls}"`
					: ""),
		);
	}

	const blank = await measureBlank(page);
	if (blank.chars < 40) {
		record(route, width, "blank", `only ${blank.chars} chars: "${blank.sample}"`);
	}
}

/** Persist and print the report. Called at the end of every test so a later
 *  failure can never discard the findings already gathered. */
function writeReport() {
	const byKind: Record<string, number> = {};
	for (const f of findings) byKind[f.kind] = (byKind[f.kind] || 0) + 1;
	const rateLimitTotal = [...rateLimited.values()].reduce((a, b) => a + b, 0);

	// Never let a report write fail the sweep (see ./audit-report.ts).
	const { path: writtenTo, errors } = persistReport(
		JSON.stringify(
			{
				generatedAt: new Date().toISOString(),
				adminAuthenticated: !!adminToken,
				pagesVisited: visited.length,
				findingsByKind: byKind,
				findingOccurrences,
				findings,
				// Self-inflicted rate limiting, deliberately kept out of `findings`.
				rateLimitedResponses: rateLimitTotal,
				rateLimitedByPath: Object.fromEntries(
					[...rateLimited.entries()].sort((a, b) => b[1] - a[1]),
				),
			},
			null,
			2,
		),
	);

	if (writtenTo) {
		lastReportPath = writtenTo;
		if (writtenTo !== REPORT_PATH) {
			console.warn(
				`[audit] primary report path unwritable — wrote ${writtenTo} instead`,
			);
		}
	} else {
		console.warn(
			`[audit] report could NOT be written anywhere (findings are still in this output):\n  ${errors.join("\n  ")}`,
		);
	}

	console.log("\n════════ AUDIT SUMMARY ════════");
	console.log(`pages visited : ${visited.length}`);
	console.log(`admin authed  : ${!!adminToken}`);
	console.log(
		`findings      : ${findings.length} distinct (${findingOccurrences} occurrences)`,
	);
	console.log(`by kind       : ${JSON.stringify(byKind)}`);
	console.log(
		`rate-limited  : ${rateLimitTotal} self-inflicted 429s, excluded from findings\n`,
	);

	for (const [kind, n] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) {
		console.log(`── ${kind} (${n}) ──`);
		for (const f of findings.filter((x) => x.kind === kind).slice(0, 20)) {
			console.log(
				`  [${f.width}] ${f.route} — ${f.detail}${f.count > 1 ? ` (×${f.count})` : ""}`,
			);
		}
	}
}

let adminToken: string | undefined;
/** Where the most recent report landed, for the closing log line. */
let lastReportPath: string | undefined;

test.beforeAll(async ({ request }) => {
	if (!ADMIN_PASSWORD) return;
	const crypto = await import("node:crypto");
	const password_hash = crypto
		.createHash("sha256")
		.update(ADMIN_PASSWORD)
		.digest("hex");
	const res = await request.post("/api/admin", {
		data: { action: "login", password_hash },
	});
	if (res.ok()) {
		const body = (await res.json()) as { token?: string };
		adminToken = body.token;
		console.log(`[audit] admin login OK (token ${adminToken ? "minted" : "MISSING"})`);
	} else {
		console.log(
			`[audit] admin login FAILED (${res.status()}) — admin sweep runs unauthenticated`,
		);
	}
});

test("user routes — desktop 1280", async ({ page }) => {
	await seed(page);
	await page.setViewportSize({ width: 1280, height: 900 });
	for (const route of USER_ROUTES) await sweep(page, route, 1280);
	writeReport();
	expect(true).toBe(true);
});

test("user routes — mobile 375", async ({ page }) => {
	await seed(page);
	await page.setViewportSize({ width: 375, height: 812 });
	for (const route of USER_ROUTES) await sweep(page, route, 375);
	writeReport();
	expect(true).toBe(true);
});

test("user routes — small mobile 320", async ({ page }) => {
	await seed(page);
	await page.setViewportSize({ width: 320, height: 720 });
	for (const route of USER_ROUTES) await sweep(page, route, 320);
	writeReport();
	expect(true).toBe(true);
});

/**
 * Admin tabs are local state, so a real admin switches tabs in place rather
 * than reloading. Auditing it that way also exercises the switch itself, and
 * removes 17 redundant page loads from the sweep.
 */
async function sweepAdminTabs(
	page: import("@playwright/test").Page,
	width: number,
) {
	const shell = `/admin (shell)`;
	await sweep(page, "/admin", width, shell);

	for (const tab of ADMIN_TABS) {
		const label = `/admin#${tab}`;
		attachListeners(page, label, width);
		try {
			await page.evaluate((t) => {
				window.dispatchEvent(new CustomEvent("vb:admin-tab", { detail: t }));
			}, tab);
			// Deliberately long: ops-summary runs real DB scans (~3.6s live), and a
			// 2.5s wait here reported the Ops Center as a *blank page*. That was a
			// false positive which then cost time to disprove — slow panels get a
			// slow wait so the report stays trustworthy.
			await page.waitForTimeout(6000);
		} catch (e) {
			record(label, width, "navigation", `tab switch failed: ${String(e)}`);
		}
		await measure(page, label, width);
		page.removeAllListeners();
	}
}

test("admin tabs — desktop 1440", async ({ page }) => {
	await seed(page, adminToken);
	await page.setViewportSize({ width: 1440, height: 900 });
	await sweepAdminTabs(page, 1440);
	writeReport();
	expect(true).toBe(true);
});

test("admin tabs — mobile 375", async ({ page }) => {
	await seed(page, adminToken);
	await page.setViewportSize({ width: 375, height: 812 });
	await sweepAdminTabs(page, 375);
	writeReport();
	expect(true).toBe(true);
});

test.afterAll(async () => {
	writeReport();
	console.log(`report        : ${lastReportPath ?? "(not written)"}`);
});
