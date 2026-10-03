// ═══════════════════════════════════════════════════════════════════
// Credential-leak moderation — passwords, API keys, tokens (spec §14)
// ═══════════════════════════════════════════════════════════════════
// Leaked secrets BLOCK like PII; plain words without a value assignment
// ("I forgot my password", "secret santa") publish. maskPII redacts residuals.
// ═══════════════════════════════════════════════════════════════════

import { describe, expect, it } from "vitest";

import { maskPII, serverModerate } from "../../api/_moderation.js";

function mod(text: string) {
	return serverModerate("Report", text);
}

describe("credential leaks BLOCK", () => {
	it("blocks a pasted password assignment", () => {
		const r = mod("my password: hunter2hunter, please don't share");
		expect(r.blocked).toBe(true);
		expect(r.flags.some((f) => f.type === "privacy")).toBe(true);
	});

	it("blocks an api key assignment", () => {
		const r = mod("api_key = ak_live_9876543210abcdef use it fast");
		expect(r.blocked).toBe(true);
	});

	it("blocks a token assignment", () => {
		const r = mod("token: xyz9876543210qwerty");
		expect(r.blocked).toBe(true);
	});

	it("blocks vendor key prefixes without any label", () => {
		expect(mod("key sk-abcdefghijklmnopqrstuvwx here").blocked).toBe(true);
		expect(mod("deploy with ghp_123456789012345678901234567890123456 leaked").blocked).toBe(true);
		expect(mod("use AKIAIOSFODNN7EXAMPLE now").blocked).toBe(true);
		expect(mod("invite xoxb-1234-abcdef sent").blocked).toBe(true);
		expect(mod("auth Bearer abcdefghijklmnopqr now").blocked).toBe(true);
	});
});

describe("plain words without values still publish", () => {
	it("publishes password talk with no value", () => {
		const r = mod("I forgot my password, how do I reset it");
		expect(r.blocked).toBe(false);
		expect(r.flags.some((f) => f.type === "privacy")).toBe(false);
	});

	it("publishes secret santa talk", () => {
		const r = mod("secret santa gifts are due Friday");
		expect(r.blocked).toBe(false);
	});

	it("publishes token of appreciation", () => {
		const r = mod("A small token of appreciation for the volunteers");
		expect(r.blocked).toBe(false);
	});
});

describe("maskPII redacts residuals", () => {
	it("redacts passwords and keys", () => {
		const out = maskPII("password: hunter2 and sk-abcdefghijklmnopqrstuvwx here");
		expect(out).toContain("[CREDENTIAL]");
		expect(out).not.toContain("hunter2");
		expect(out).not.toContain("sk-abcdefghijklmnopqrstuvwx");
	});
});
