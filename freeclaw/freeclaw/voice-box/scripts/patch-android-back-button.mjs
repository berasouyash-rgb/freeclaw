/**
 * Voice Flow — Capacitor Android hardware-back-button patch (CI native delta).
 *
 * WHY THIS EXISTS
 * `com.getcapacitor.BridgeActivity` does not override `onBackPressed`, so the
 * tap falls through to the Activity default — `finish()`. On a real phone that
 * means one stray press anywhere in the app closes it: a student halfway
 * through writing a complaint taps back out of habit and loses the screen they
 * were on. The WebView has the whole route history and never gets asked.
 *
 * This patch makes back mean "navigate back":
 *
 *   • inside the app (`WebView.canGoBack()`) → `goBack()`, which fires
 *     popstate and lets the router render the previous route;
 *   • at the first entry → a short Toast, and a second tap within two
 *     seconds actually leaves. A single accidental press cannot quit.
 *
 * Same constraint as scripts/patch-android-webview-cookies.mjs: the android/
 * project is generated (`cap add android`) and gitignored, so the delta cannot
 * live in the native tree. This script rewrites the generated MainActivity.java
 * idempotently and runs in the release pipeline between `cap sync` and the
 * gradle build. Re-running it is a no-op.
 *
 * Usage: node scripts/patch-android-back-button.mjs [androidRoot]
 * Exits non-zero when no MainActivity is found, so an unpatched APK cannot be
 * built silently.
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const MARKER = "voice-flow-back-button";

const EXIT_WINDOW_MS = 2000;

// The generated subclass is either the minimal `cap add` shape (no members) or
// one already carrying the cookie patch's onCreate override. Both are fine —
// this script only requires that the class body is recognizable.
const SUBCLASS_RE = /public\s+class\s+MainActivity\s+extends\s+BridgeActivity\s*\{/;

const FIELD_BLOCK = [
	`    // ${MARKER}: timestamp of the first "press back again to exit" tap.`,
	"    private long vbLastBackPress = 0L;",
].join("\n");

const METHOD_BLOCK = [
	"    /**",
	`     * ${MARKER}: BridgeActivity inherits Activity.onBackPressed, which`,
	"     * finishes the app. Walk the WebView's own route history instead, and",
	"     * only leave the app on a deliberate second tap at the first entry.",
	"     */",
	"    @Override",
	"    public void onBackPressed() {",
	"        final android.webkit.WebView webView =",
	"                this.getBridge() == null ? null : this.getBridge().getWebView();",
	"        if (webView != null && webView.canGoBack()) {",
	"            webView.goBack();",
	"            return;",
	"        }",
	`        if (System.currentTimeMillis() - this.vbLastBackPress > ${EXIT_WINDOW_MS}L) {`,
	"            this.vbLastBackPress = System.currentTimeMillis();",
	'            android.widget.Toast.makeText(this, "Press back again to exit", android.widget.Toast.LENGTH_SHORT).show();',
	"            return;",
	"        }",
	"        super.onBackPressed();",
	"    }",
].join("\n");

/** Depth-first search for MainActivity.java under the android project. */
function findMainActivity(root, depth = 0) {
	if (depth > 8 || !existsSync(root)) return null;
	let entries;
	try {
		entries = readdirSync(root, { withFileTypes: true });
	} catch {
		return null;
	}
	for (const entry of entries) {
		const full = join(root, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "build" || entry.name === ".gradle") continue;
			const found = findMainActivity(full, depth + 1);
			if (found) return found;
		} else if (entry.name === "MainActivity.java") {
			return full;
		}
	}
	return null;
}

/**
 * Insert a member just before the class's closing brace, keeping indentation
 * and every existing member byte-for-byte.
 */
function insertBeforeClassEnd(source, block) {
	const classIndex = source.search(SUBCLASS_RE);
	if (classIndex < 0) return null;
	const closeIndex = source.lastIndexOf("}");
	if (closeIndex <= classIndex) return null;
	const head = source.slice(0, closeIndex).replace(/\s*$/, "");
	const tail = source.slice(closeIndex);
	return `${head}\n\n${block}\n${tail}`;
}

const androidRoot = resolve(process.argv[2] || join(process.cwd(), "android"));

if (!existsSync(androidRoot)) {
	console.error(`[back-button] no android project at ${androidRoot}`);
	process.exit(1);
}

const mainActivity = findMainActivity(androidRoot);
if (!mainActivity) {
	console.error(`[back-button] no MainActivity.java under ${androidRoot}`);
	process.exit(1);
}

if (!statSync(mainActivity).isFile()) {
	console.error(`[back-button] ${mainActivity} is not a regular file`);
	process.exit(1);
}

const original = readFileSync(mainActivity, "utf8");

if (original.includes(MARKER)) {
	console.log(`[back-button] already applied — ${mainActivity}`);
	process.exit(0);
}

if (!SUBCLASS_RE.test(original)) {
	console.error(
		`[back-button] ${mainActivity} does not subclass BridgeActivity as expected; refusing to guess`,
	);
	process.exit(1);
}

let patched = insertBeforeClassEnd(original, `${FIELD_BLOCK}\n\n${METHOD_BLOCK}`);
if (!patched) {
	console.error(`[back-button] could not locate the class body in ${mainActivity}`);
	process.exit(1);
}

// Sanity: the two required anchors must survive the edit, or the gradle build
// fails later with a confusing Java error instead of here with a clear one.
if (!patched.includes("super.onBackPressed();") || !/class\s+MainActivity/.test(patched)) {
	console.error(`[back-button] patch produced an unexpected file; refusing to write`);
	process.exit(1);
}

writeFileSync(mainActivity, patched, "utf8");
console.log(`[back-button] applied to ${mainActivity}`);
