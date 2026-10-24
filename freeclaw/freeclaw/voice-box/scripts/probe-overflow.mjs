/**
 * Throwaway probe: at 320px, walk <header> and report each element's box and
 * intrinsic min-content width, so the layout floor can be attributed to a
 * specific node instead of guessed at.
 */
import { chromium } from "@playwright/test";

const BASE = process.env.VB_BASE || "http://localhost:5173";
const WIDTH = Number(process.env.VB_WIDTH || 320);

// Set VB_ADMIN=1 to mint a real admin session so /admin renders its panels.
let adminToken;
if (process.env.VB_ADMIN) {
	const crypto = await import("node:crypto");
	// Never default a real credential here — require the env var.
	const password = process.env.VB_ADMIN_PASSWORD;
	if (!password) {
		console.error("[probe] VB_ADMIN=1 requires VB_ADMIN_PASSWORD");
		process.exit(1);
	}
	const password_hash = crypto
		.createHash("sha256")
		.update(password)
		.digest("hex");
	const res = await fetch(BASE + "/api/admin", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ action: "login", password_hash }),
	});
	if (res.ok) adminToken = (await res.json()).token;
	console.log(`[probe] admin login: ${res.ok ? "ok" : res.status}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: WIDTH, height: 800 } });
await page.addInitScript(([token]) => {
	try {
		if (token)
			sessionStorage.setItem(
				"vb:adminAuth",
				JSON.stringify({ token, exp: Date.now() + 3_600_000 }),
			);
	} catch {}
}, [adminToken]);
await page.goto(BASE + (process.env.VB_ROUTE || "/"), {
	waitUntil: "domcontentloaded",
});
await page.waitForTimeout(Number(process.env.VB_WAIT || 2500));
if (process.env.VB_TAB) {
	await page.evaluate((t) => {
		window.dispatchEvent(new CustomEvent("vb:admin-tab", { detail: t }));
	}, process.env.VB_TAB);
	await page.waitForTimeout(2500);
}

const out = await page.evaluate((width) => {
	const de = document.documentElement;
	const lines = [
		`documentElement.scrollWidth = ${de.scrollWidth} (viewport ${width})`,
		`body.scrollWidth = ${document.body.scrollWidth}`,
	];
	const header = document.querySelector("header");
	if (header) {
		lines.push("", "header subtree:");
		const walk = (el, depth) => {
			if (depth > 5) return;
			const r = el.getBoundingClientRect();
			const cs = getComputedStyle(el);
			const cls = (el.className || "").toString().slice(0, 70);
			lines.push(
				`${"  ".repeat(depth)}<${el.tagName.toLowerCase()}> w=${Math.round(r.width)} right=${Math.round(r.right)} ` +
					`minW=${cs.minWidth} flex=${cs.flex} overflowX=${cs.overflowX} whiteSpace=${cs.whiteSpace} class="${cls}"`,
			);
			for (const c of Array.from(el.children)) walk(c, depth + 1);
		};
		walk(header, 0);
	}
	// Which top-level ancestors exceed the viewport?
	lines.push("", "elements with right > viewport (no clipping ancestor):");
	const clipped = (el) => {
		let p = el.parentElement;
		while (p && p !== document.documentElement) {
			const cs = getComputedStyle(p);
			if (
				cs.overflowX !== "visible" ||
				cs.overflow !== "visible"
			)
				return true;
			p = p.parentElement;
		}
		return false;
	};
	let n = 0;
	for (const el of Array.from(document.body.querySelectorAll("*"))) {
		const r = el.getBoundingClientRect();
		if (r.width === 0 || r.height === 0) continue;
		if (r.right <= width + 1) continue;
		if (clipped(el)) continue;
		lines.push(
			`  <${el.tagName.toLowerCase()}> right=${Math.round(r.right)} w=${Math.round(r.width)} class="${(el.className || "").toString().slice(0, 80)}"`,
		);
		if (++n > 25) break;
	}
	if (n === 0) lines.push("  (none — overflow comes from a clipping ancestor)");

	const root = document.getElementById("root");
	const text = (root?.innerText || "").replace(/\s+/g, " ").trim();
	lines.push("", `visible text: ${text.length} chars`);
	lines.push(`  "${text.slice(0, 300)}"`);
	return lines.join("\n");
}, WIDTH);

await browser.close();
console.log(out);
