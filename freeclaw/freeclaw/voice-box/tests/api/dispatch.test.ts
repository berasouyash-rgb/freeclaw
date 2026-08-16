// ═══════════════════════════════════════════════════════════════════
// Dispatch module — real SMS (MessageBird) + email (Resend) outbound
// ═══════════════════════════════════════════════════════════════════
// Locks the contract:
//   1. normalizePhone cleans E.164-ish numbers, rejects garbage
//   2. validEmail accepts sane addresses only
//   3. sendSms / sendEmail are env-gated (no key → not_configured, no fetch)
//   4. With a key: posts to the right provider URL with the right auth
//      header + payload, returns ok:true only on 2xx, surfaces errors
//      without throwing.
// ═══════════════════════════════════════════════════════════════════

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { normalizePhone, sendEmail, sendSms, validEmail } from "../../api/_dispatch.js";

// Keep the module stateless between tests: env is read at call time.
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
	vi.restoreAllMocks();
});

afterEach(() => {
	process.env = { ...ORIGINAL_ENV };
	delete process.env.MESSAGEBIRD_API_KEY;
	delete process.env.RESEND_API_KEY;
});

describe("normalizePhone", () => {
	it("keeps a clean international number with +", () => {
		expect(normalizePhone("+15551234567")).toBe("+15551234567");
	});

	it("adds + when present, strips spaces/dashes/parens", () => {
		expect(normalizePhone("+1 (555) 123-4567")).toBe("+15551234567");
		expect(normalizePhone("15551234567")).toBe("15551234567");
	});

	it("rejects too-short, too-long, and non-numeric input", () => {
		expect(normalizePhone("1234567")).toBeNull(); // 7 digits < 8
		expect(normalizePhone("1234567890123456")).toBeNull(); // 16 digits > 15
		expect(normalizePhone("hello")).toBeNull();
		expect(normalizePhone("")).toBeNull();
		expect(normalizePhone(null)).toBeNull();
		expect(normalizePhone(undefined)).toBeNull();
	});
});

describe("validEmail", () => {
	it("accepts normal addresses", () => {
		expect(validEmail("a@b.co")).toBe(true);
		expect(validEmail("first.last+tag@example.com")).toBe(true);
	});

	it("rejects malformed addresses", () => {
		expect(validEmail("nope")).toBe(false);
		expect(validEmail("a@b")).toBe(false);
		expect(validEmail("a b@c.com")).toBe(false);
		expect(validEmail("")).toBe(false);
	});
});

describe("sendSms", () => {
	it("returns not_configured without an API key and never calls fetch", async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal("fetch", fetchSpy);
		delete process.env.MESSAGEBIRD_API_KEY;
		const r = await sendSms("+15551234567", "Your post was solved!");
		expect(r.ok).toBe(false);
		expect(r.error).toBe("not_configured");
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("posts to MessageBird with AccessKey auth on a 2xx", async () => {
		process.env.MESSAGEBIRD_API_KEY = "mb-test-key";
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({ ok: true, status: 201, text: async () => "" }),
		);
		const r = await sendSms("+1 (555) 123-4567", "Status updated: solved");
		expect(r.ok).toBe(true);
		expect(r.provider).toBe("messagebird");
		const [url, init] = vi.mocked(fetch).mock.calls[0]!;
		expect(url).toBe("https://rest.messagebird.com/messages");
		expect(init.headers.Authorization).toBe("AccessKey mb-test-key");
		const payload = JSON.parse(init.body);
		expect(payload.recipients).toEqual(["+15551234567"]);
		expect(payload.body).toContain("solved");
		expect(payload.originator).toBe("VoiceBox");
	});

	it("maps a provider 4xx to an error result instead of throwing", async () => {
		process.env.MESSAGEBIRD_API_KEY = "mb-test-key";
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: false,
				status: 422,
				text: async () => "bad recipient",
			}),
		);
		const r = await sendSms("+15551234567", "hi");
		expect(r.ok).toBe(false);
		expect(r.error).toBe("provider_422");
	});

	it("rejects an invalid phone before any network call", async () => {
		process.env.MESSAGEBIRD_API_KEY = "mb-test-key";
		const fetchSpy = vi.fn();
		vi.stubGlobal("fetch", fetchSpy);
		const r = await sendSms("not-a-phone", "hi");
		expect(r.ok).toBe(false);
		expect(r.error).toBe("invalid_phone");
		expect(fetchSpy).not.toHaveBeenCalled();
	});
});

describe("sendEmail", () => {
	it("returns not_configured without a key", async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal("fetch", fetchSpy);
		delete process.env.RESEND_API_KEY;
		const r = await sendEmail("a@b.co", "Subject", "Body");
		expect(r.ok).toBe(false);
		expect(r.error).toBe("not_configured");
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("posts to Resend with Bearer auth and from/to/subject/text", async () => {
		process.env.RESEND_API_KEY = "re-test-key";
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "" }),
		);
		const r = await sendEmail("user@example.com", "Post solved", "Your post is solved!");
		expect(r.ok).toBe(true);
		expect(r.provider).toBe("resend");
		const [url, init] = vi.mocked(fetch).mock.calls[0]!;
		expect(url).toBe("https://api.resend.com/emails");
		expect(init.headers.Authorization).toBe("Bearer re-test-key");
		const payload = JSON.parse(init.body);
		expect(payload.to).toEqual(["user@example.com"]);
		expect(payload.subject).toBe("Post solved");
		expect(payload.text).toContain("solved");
		expect(payload.from).toContain("@");
	});

	it("rejects a malformed recipient before any network call", async () => {
		process.env.RESEND_API_KEY = "re-test-key";
		const fetchSpy = vi.fn();
		vi.stubGlobal("fetch", fetchSpy);
		const r = await sendEmail("nope", "Subject", "Body");
		expect(r.ok).toBe(false);
		expect(r.error).toBe("invalid_email");
		expect(fetchSpy).not.toHaveBeenCalled();
	});
});
