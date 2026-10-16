// ═══════════════════════════════════════════════════════════════════
// Android WebView cookie patch — CI-applied native delta
// ════════════════════════════════════════════════════════ patch block
// The APK is a Capacitor shell: the API lives on another origin, so the
// vb_session cookie is third-party inside the WebView — and Android drops
// third-party cookies by default. Without the MainActivity patch, every
// session-bound call 403s ~20s after install (past the boot-race window).
// The android/ project is CI-generated (cap add), so the patch lives as a
// script + this test, wired into native.yml between sync and build.

import { describe, expect, it } from "vitest";
import { patchMainActivity } from "../../scripts/patch-android-webview-cookies.mjs";

// Stock Capacitor 7 template as `cap add android` generates it.
const STOCK = `package app.voicebox;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
    }
}
`;

describe("patchMainActivity", () => {
	it("accepts third-party cookies right after super.onCreate", () => {
		const out = patchMainActivity(STOCK);
		expect(out).toContain("setAcceptThirdPartyCookies");
		expect(out).toContain("setAcceptCookie(true)");
		// The bridge owns the WebView — the call must come after it exists.
		expect(out.indexOf("super.onCreate(savedInstanceState);")).toBeLessThan(
			out.indexOf("setAcceptThirdPartyCookies"),
		);
		// Fully-qualified references: no import-position fragility.
		expect(out).toContain("android.webkit.CookieManager");
	});

	it("is idempotent — a second CI run changes nothing", () => {
		expect(patchMainActivity(patchMainActivity(STOCK))).toBe(
			patchMainActivity(STOCK),
		);
	});

	it("adds an onCreate override to the minimal subclass template", () => {
		const minimal = `package app.voicebox;\n\nimport com.getcapacitor.BridgeActivity;\n\npublic class MainActivity extends BridgeActivity {}\n`;
		const out = patchMainActivity(minimal);
		expect(out).toContain("protected void onCreate(android.os.Bundle savedInstanceState)");
		expect(out).toContain("setAcceptThirdPartyCookies");
		expect(out.indexOf("super.onCreate(savedInstanceState);")).toBeLessThan(
			out.indexOf("setAcceptThirdPartyCookies"),
		);
		// Idempotent on the generated form too.
		expect(patchMainActivity(out)).toBe(out);
	});

	it("fails loudly when the template has no super.onCreate anchor", () => {
		expect(() =>
			patchMainActivity("package x;\npublic class MainActivity {}\n"),
		).toThrow(/super\.onCreate/);
	});
});
