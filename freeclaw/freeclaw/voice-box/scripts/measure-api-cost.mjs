/**
 * One-off measurement: how many /api/* requests does a single page view cost?
 *
 * This sizes the shared abuse limiter honestly. ABUSE_LIMITS in
 * api/_security.js allows 120 requests/minute per identity-or-IP and, once
 * crossed, blocks *every* endpoint for 30s. If a single page view costs ~15
 * requests then a user who navigates ~8 times in a minute self-inflicts an
 * outage — which is exactly the "works after refresh" symptom.
 *
 * Run: node scripts/measure-api-cost.mjs
 */

import { chromium } from "@playwright/test";

const BASE = process.env.VB_BASE || "http://localhost:5173";
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
];
// Allow a warm-up run for the dev server's first compile.
const SETTLE_MS = 2500;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
let bucket = [];
page.on("request", (r) => {
	const u = r.url();
	if (u.includes("/api/")) bucket.push(new URL(u).pathname + new URL(u).search);
});

const rows = [];
for (const route of ROUTES) {
	bucket = [];
	await page.goto(BASE + route, { waitUntil: "domcontentloaded" });
	await page.waitForTimeout(SETTLE_MS);
	const counts = {};
	for (const p of bucket) counts[p] = (counts[p] || 0) + 1;
	rows.push({ route, total: bucket.length, unique: Object.keys(counts).length, counts });
	await page.waitForTimeout(1200); // stay under the limiter between samples
}

await browser.close();

console.log("\nAPI cost per page view\n");
console.log("route".padEnd(16), "reqs", "uniq", "worst endpoint");
for (const r of rows) {
	const worst = Object.entries(r.counts).sort((a, b) => b[1] - a[1])[0];
	console.log(
		r.route.padEnd(16),
		String(r.total).padStart(4),
		String(r.unique).padStart(4),
		worst ? `${worst[0]} ×${worst[1]}` : "—",
	);
}

const totals = rows.map((r) => r.total);
const sum = totals.reduce((a, b) => a + b, 0);
const avg = sum / totals.length;
const max = Math.max(...totals);
console.log(
	`\ntotal ${sum} across ${rows.length} views — avg ${avg.toFixed(1)}, max ${max} per view`,
);
console.log(
	`at the 120 req/min cap that is ~${Math.floor(120 / avg)} page views per minute before the block`,
);
