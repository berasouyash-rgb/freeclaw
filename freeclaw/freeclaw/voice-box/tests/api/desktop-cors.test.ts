// ═══════════════════════════════════════════════════════════════════
// Desktop "Failed to fetch" regression — real cors() from api/_auth.js
// ═══════════════════════════════════════════════════════════════════
// The Windows app booted (dist/index.html loaded over file://) but every API
// call died as TypeError: Failed to fetch. Three server-side causes shared
// one root: native shells were never an allowed CORS origin.
//   1. Origin "null" (Electron file:// fetch) got NO Allow-Origin header.
//   2. No-Origin requests (curl, file:// GET) got NO Allow-Origin header.
//   3. x-anon-id was missing from Allow-Headers, so every preflight with the
//      identity header failed before the handler ever ran.
// This file pins the fixed contract with the REAL cors() (mocked DB only).
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/_db-client.js", () => ({
	default: { from: vi.fn() },
}));
vi.mock("../../api/_notification-delivery.js", () => ({
	recordPendingDelivery: vi.fn(async () => {}),
}));

import { cors, setSessionCookie } from "../../api/_auth.js";

function res() {
	const headers: Record<string, string> = {};
	return {
		headers,
		setHeader(k: string, v: string) {
			headers[k] = v;
		},
	};
}

function reqWith(origin: string | undefined) {
	return { headers: origin === undefined ? {} : { origin } };
}

beforeEach(() => {
	vi.resetModules();
});

describe("cors — desktop/mobile shells", () => {
	it("echoes Origin null for Electron file:// fetches", () => {
		const r = res();
		cors(r as never, reqWith("null") as never);
		expect(r.headers["Access-Control-Allow-Origin"]).toBe("null");
		expect(r.headers["Access-Control-Allow-Credentials"]).toBe("true");
	});

	it("answers null when no Origin header is sent at all", () => {
		const r = res();
		cors(r as never, reqWith(undefined) as never);
		expect(r.headers["Access-Control-Allow-Origin"]).toBe("null");
	});

	it("allows Capacitor and Ionic app origins", () => {
		for (const o of ["capacitor://localhost", "ionic://localhost"]) {
			const r = res();
			cors(r as never, reqWith(o) as never);
			expect(r.headers["Access-Control-Allow-Origin"]).toBe(o);
		}
	});

	it("allows the canonical production domain (was missing)", () => {
		const r = res();
		cors(r as never, reqWith("https://voice-box.vercel.app") as never);
		expect(r.headers["Access-Control-Allow-Origin"]).toBe(
			"https://voice-box.vercel.app",
		);
	});

	it("still allows the preview + localhost dev origins", () => {
		for (const o of [
			"https://voice-box-psi.vercel.app",
			"http://localhost:5173",
		]) {
			const r = res();
			cors(r as never, reqWith(o) as never);
			expect(r.headers["Access-Control-Allow-Origin"]).toBe(o);
		}
	});

	it("still refuses a random evil origin (no echo, no reflection)", () => {
		const r = res();
		cors(r as never, reqWith("https://evil-site.com") as never);
		expect(r.headers["Access-Control-Allow-Origin"] ?? "").not.toContain(
			"evil-site",
		);
	});

	it("permits the x-anon-id identity header in preflights", () => {
		const r = res();
		cors(r as never, reqWith("null") as never);
		expect(r.headers["Access-Control-Allow-Headers"]).toContain("x-anon-id");
	});

	it("echoes https://localhost — the Capacitor 7 default Android origin", () => {
		// CapConfig.java: androidScheme defaults to HTTPS, hostname to
		// localhost. The APK therefore fetches with Origin: https://localhost,
		// which was missing from ALLOWED_ORIGINS → every call died as
		// TypeError: Failed to fetch on the "Failed to fetch" error screen.
		const r = res();
		cors(r as never, reqWith("https://localhost") as never);
		expect(r.headers["Access-Control-Allow-Origin"]).toBe("https://localhost");
	});

	it("echoes http://localhost — older Capacitor scheme / explicit config", () => {
		const r = res();
		cors(r as never, reqWith("http://localhost") as never);
		expect(r.headers["Access-Control-Allow-Origin"]).toBe("http://localhost");
	});
});

describe("setSessionCookie — native cross-site shells", () => {
	function cookieFor(origin: string, proto: string) {
		const r = res();
		setSessionCookie(r as never, "tok123", {
			headers: { origin, "x-forwarded-proto": proto },
		} as never);
		return r.headers["Set-Cookie"] as string;
	}

	it("gives https://localhost SameSite=None + Secure over https", () => {
		// Without None+Secure the WebView never sends the cookie back and
		// every authed call 403s as session_unrecoverable right after login.
		const c = cookieFor("https://localhost", "https");
		expect(c).toContain("SameSite=None");
		expect(c).toContain("Secure");
	});

	it("keeps capacitor://localhost on SameSite=None + Secure (no regress)", () => {
		const c = cookieFor("capacitor://localhost", "https");
		expect(c).toContain("SameSite=None");
		expect(c).toContain("Secure");
	});
});
