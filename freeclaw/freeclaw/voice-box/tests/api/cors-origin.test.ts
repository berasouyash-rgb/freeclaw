// Credentialed-CORS origin pin.
//
// Regression guard for the forgeable-allowlist finding: any Vercel user can
// create a project named "voice-box-<anything>", so prefix matching on
// *.vercel.app handed an attacker a credentialed origin. The same-origin
// branch must also trust only the platform Host header — a forged
// X-Forwarded-Host previously let an arbitrary origin through.

import { describe, expect, it, vi } from "vitest";

vi.mock("../../api/_db-client.js", () => ({ default: { from: vi.fn() } }));

import { isAllowedOrigin } from "../../api/_auth.js";

const req = (headers: Record<string, string> = {}) => ({ headers });

describe("credentialed CORS allowlist", () => {
	it("allows the canonical production origins", () => {
		expect(isAllowedOrigin("https://voice-box.vercel.app", req())).toBe(true);
		expect(isAllowedOrigin("https://voice-box-psi.vercel.app", req())).toBe(
			true,
		);
	});

	it("rejects lookalike Vercel project names", () => {
		for (const origin of [
			"https://voice-box-evil.vercel.app",
			"https://voice-box-evil-team.vercel.app",
			"https://voice-box-preview-123.vercel.app",
			"https://voice-box.vercel.app.evil.example",
		]) {
			expect(isAllowedOrigin(origin, req())).toBe(false);
		}
	});

	it("rejects unrelated origins and empty origins", () => {
		expect(isAllowedOrigin("https://evil.example", req())).toBe(false);
		expect(isAllowedOrigin("", req())).toBe(false);
	});

	it("allows a true same-origin request via the Host header", () => {
		expect(
			isAllowedOrigin(
				"https://voice-box.vercel.app",
				req({ host: "voice-box.vercel.app" }),
			),
		).toBe(true);
	});

	it("does not trust a forged X-Forwarded-Host", () => {
		expect(
			isAllowedOrigin(
				"https://evil.example",
				req({
					host: "voice-box.vercel.app",
					"x-forwarded-host": "evil.example",
				}),
			),
		).toBe(false);
	});

	it("honours explicitly configured extra origins", () => {
		const prev = process.env.ALLOWED_ORIGINS;
		process.env.ALLOWED_ORIGINS = "https://preview.example";
		try {
			expect(isAllowedOrigin("https://preview.example", req())).toBe(true);
		} finally {
			if (prev === undefined) delete process.env.ALLOWED_ORIGINS;
			else process.env.ALLOWED_ORIGINS = prev;
		}
	});
});
