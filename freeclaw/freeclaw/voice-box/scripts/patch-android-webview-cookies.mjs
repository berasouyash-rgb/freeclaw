/**
 * Voice Flow — Capacitor Android WebView cookie patch (CI native delta).
 *
 * The APK is a Capacitor shell and the API lives on another origin, so the
 * vb_session cookie is third-party inside the WebView. Android drops
 * third-party cookies by default (CookieManager): without this patch every
 * session-bound call 403s ~20s after install, once the server-side
 * boot-race window (api/_auth.js) expires.
 *
 * The android/ project is generated in CI (`cap add android`) and is
 * gitignored, so the delta cannot live in the native tree. Instead this
 * script patches the generated MainActivity.java idempotently and runs in
 * .github/workflows/native.yml between `cap sync` and the gradle build.
 * The remaining manual deltas are listed in capacitor.config.ts.
 *
 * Usage: node scripts/patch-android-webview-cookies.mjs [androidRoot]
 * Exits non-zero when no MainActivity is found (fail the build loudly —
 * a silently unpatched APK would ship the 20s lockout again).
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const MARKER = "voice-flow-webview-cookies";
const SUPER_ON_CREATE = "super.onCreate(savedInstanceState);";
// Minimal `cap add` output has no onCreate at all — just an empty
// BridgeActivity subclass. Recognized exactly (nothing else qualifies),
// so the script still refuses to guess on foreign shapes.
const MINIMAL_SUBCLASS_RE =
	/public\s+class\s+MainActivity\s+extends\s+BridgeActivity\s*\{\s*\}/;

const COOKIE_BLOCK = [
	`        // ${MARKER}: the session cookie (vb_session) is third-party`,
	"        // inside this shell (the API lives on another origin), and Android",
	"        // drops third-party cookies by default — without this, every",
	"        // session-bound call 403s ~20s after install. Applied by",
	"        // scripts/patch-android-webview-cookies.mjs during CI.",
	"        final android.webkit.CookieManager cookieManager = android.webkit.CookieManager.getInstance();",
	"        cookieManager.setAcceptCookie(true);",
	"        if (this.getBridge() != null && this.getBridge().getWebView() != null) {",
	"            cookieManager.setAcceptThirdPartyCookies(this.getBridge().getWebView(), true);",
	"        }",
].join("\n");

const ON_CREATE_OVERRIDE = [
	"    @Override",
	"    protected void onCreate(android.os.Bundle savedInstanceState) {",
	`        ${SUPER_ON_CREATE}`,
	COOKIE_BLOCK,
	"    }",
].join("\n");

/**
 * Insert the cookie-acceptance block after super.onCreate(). Pure — operates
 * on source text only. Idempotent: a source already carrying the marker is
 * returned byte-identical. Throws when the anchor is missing so CI fails
 * loudly instead of shipping an unpatched shell.
 */
export function patchMainActivity(source) {
	if (source.includes(MARKER)) return source;
	const anchor = source.indexOf(SUPER_ON_CREATE);
	if (anchor !== -1) {
		const insertAt = anchor + SUPER_ON_CREATE.length;
		return `${source.slice(0, insertAt)}\n${COOKIE_BLOCK}${source.slice(insertAt)}`;
	}
	// Minimal template: no onCreate to anchor to. Add the override with the
	// cookie block inside it — same calls, same order, fully-qualified
	// Bundle so no import edit is needed.
	if (MINIMAL_SUBCLASS_RE.test(source)) {
		return source.replace(
			MINIMAL_SUBCLASS_RE,
			(m) => m.replace(/\{\s*\}$/, "{\n" + ON_CREATE_OVERRIDE + "\n}"),
		);
	}
	throw new Error(
		`patch-android-webview-cookies: no "${SUPER_ON_CREATE}" anchor found — refusing to guess where the WebView exists`,
	);
}

function findMainActivities(dir, out = []) {
	let entries = [];
	try {
		entries = readdirSync(dir);
	} catch {
		return out;
	}
	for (const entry of entries) {
		const full = join(dir, entry);
		let st = null;
		try {
			st = statSync(full);
		} catch {
			continue;
		}
		if (st.isDirectory()) findMainActivities(full, out);
		else if (entry === "MainActivity.java") out.push(full);
	}
	return out;
}

function main() {
	const root = resolve(process.argv[2] || join(process.cwd(), "android"));
	const targets = findMainActivities(join(root, "app", "src", "main", "java"));
	if (targets.length === 0) {
		console.error(
			`patch-android-webview-cookies: no MainActivity.java under ${root} — run after "cap add android"`,
		);
		process.exitCode = 1;
		return;
	}
	for (const file of targets) {
		const before = readFileSync(file, "utf8");
		const after = patchMainActivity(before);
		if (after !== before) {
			writeFileSync(file, after, "utf8");
			console.log(`patch-android-webview-cookies: patched ${file}`);
		} else {
			console.log(`patch-android-webview-cookies: already patched ${file}`);
		}
	}
}

function invokedAsCli() {
	if (!process.argv[1]) return false;
	const invoked = resolve(process.argv[1]).toLowerCase();
	const self = resolve(
		new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
	).toLowerCase();
	return invoked === self;
}

if (invokedAsCli()) {
	if (!existsSync(join(process.cwd(), "package.json"))) {
		console.error("patch-android-webview-cookies: run from the repo root (voice-box/)");
		process.exitCode = 1;
	} else {
		main();
	}
}
