// ═══════════════════════════════════════════════════════════════════
// Evidence Upload Scanner — POST /api/evidence/scan
// ═══════════════════════════════════════════════════════════════════
// Locks the /api/evidence/scan contract:
//   1. Admin-only → 403 without a valid token.
//   2. SSRF guard: file_url is only fetched when it is a public http(s)
//      URL — literal private/loopback/metadata IPs, reserved hostnames,
//      non-http schemes, and hosts that DNS-resolve to private addresses
//      (incl. DNS-rebinding) are refused without any fetch.
//   3. Redirects are never followed (redirect: 'manual') on both the
//      content GET and the size HEAD.
//   4. Content scans surface PII and fail closed on timeout.
// ═══════════════════════════════════════════════════════════════════

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.fn();

vi.mock("../../api/_db-client.js", () => ({
	default: { from },
}));
vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	isAdmin: vi.fn().mockResolvedValue(true),
	auditLog: vi.fn().mockResolvedValue({ error: null }),
}));

const dnsLookup = vi.fn();
vi.mock("node:dns/promises", () => ({
	default: { lookup: dnsLookup },
}));

const fetchMock = vi.fn();

function response() {
	const res = { statusCode: 200, body: undefined as unknown };
	return Object.assign(res, {
		status(code: number) {
			res.statusCode = code;
			return this;
		},
		setHeader: vi.fn(),
		json(body: unknown) {
			res.body = body;
			return this;
		},
		end: vi.fn(),
	});
}

const REQ = {
	method: "POST",
	headers: { "x-admin-token": "t" },
	body: {
		file_url: "https://example.com/doc.txt",
		file_type: "text/plain",
		file_name: "doc.txt",
	},
};

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	vi.useFakeTimers();
	from.mockReset();
	dnsLookup.mockReset().mockResolvedValue([]);
	fetchMock
		.mockReset()
		.mockResolvedValue({
			ok: true,
			text: async () => "",
			headers: { get: () => null },
		});
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("POST /api/evidence/scan — auth & validation", () => {
	it("403s without admin auth", async () => {
		const { isAdmin } = await import("../../api/_auth.js");
		(isAdmin as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
		const { default: handler } = await import("../../api/_evidence-scan.js");
		const res = response();
		await handler({ method: "POST", body: {}, headers: {} }, res);
		expect(res.statusCode).toBe(403);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("400s when neither file_url nor file_name is provided", async () => {
		const { default: handler } = await import("../../api/_evidence-scan.js");
		const res = response();
		await handler(
			{ method: "POST", body: {}, headers: { "x-admin-token": "t" } },
			res,
		);
		expect(res.statusCode).toBe(400);
	});
});

describe("SSRF guard — URLs that must never be fetched", () => {
	const cases: Array<[string, string]> = [
		["cloud metadata literal", "http://169.254.169.254/latest/meta-data/"],
		["loopback literal", "http://127.0.0.1:5432/"],
		["private net literal", "http://10.0.0.8/file.txt"],
		["docker bridge literal", "http://172.17.0.1/file.txt"],
		["non-http scheme", "file:///etc/passwd"],
		["ftp scheme", "ftp://example.com/file.txt"],
		["reserved hostname", "http://localhost/file.txt"],
	];

	it.each(cases)("refuses %s", async (_label, file_url) => {
		const { default: handler } = await import("../../api/_evidence-scan.js");
		const res = response();
		await handler(
			{ method: "POST", body: { ...REQ.body, file_url }, headers: REQ.headers },
			res,
		);
		expect(res.statusCode).toBe(200);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(res.body).toMatchObject({ safe: true, risk_level: "low" });
		expect(res.body.findings.join(" ")).toContain("not a public http(s) URL");
	});

	it("refuses a host that DNS-resolves to a private address (DNS rebinding)", async () => {
		dnsLookup.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
		const { default: handler } = await import("../../api/_evidence-scan.js");
		const res = response();
		await handler(
			{
				method: "POST",
				body: {
					...REQ.body,
					file_url: "https://metadata-ok.example.com/latest",
				},
				headers: REQ.headers,
			},
			res,
		);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(res.body.findings.join(" ")).toContain("not a public http(s) URL");
	});

	it("refuses a host that DNS-resolves to a private 10.x address", async () => {
		dnsLookup.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
		const { default: handler } = await import("../../api/_evidence-scan.js");
		const res = response();
		await handler(
			{
				method: "POST",
				body: { ...REQ.body, file_url: "https://intranet.example.com/x.txt" },
				headers: REQ.headers,
			},
			res,
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe("POST /api/evidence/scan — safe public URLs", () => {
	it("scans content for PII and reports high risk", async () => {
		dnsLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
		fetchMock.mockResolvedValue({
			ok: true,
			text: async () => "Call me at 555-123-4567 or write to jane@example.com",
			headers: { get: () => null },
		});
		const { default: handler } = await import("../../api/_evidence-scan.js");
		const res = response();
		await handler(REQ, res);
		expect(res.statusCode).toBe(200);
		expect(res.body).toMatchObject({ safe: false, risk_level: "high" });
		const findings = (res.body.findings as string[]).join(" ");
		expect(findings).toContain("Phone number detected");
		expect(findings).toContain("Email address detected");
		// Both the content GET and the size HEAD happened.
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("never follows redirects (redirect: manual) on the content GET and size HEAD", async () => {
		dnsLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
		const { default: handler } = await import("../../api/_evidence-scan.js");
		const res = response();
		await handler(REQ, res);
		const getCall = fetchMock.mock.calls.find(([, opts]) => !opts?.method);
		expect(getCall?.[1]).toMatchObject({ redirect: "manual" });
		const headCall = fetchMock.mock.calls.find(
			([, opts]) => opts?.method === "HEAD",
		);
		expect(headCall?.[1]).toMatchObject({ redirect: "manual" });
	});

	it("returns safe for clean text content", async () => {
		dnsLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
		const { default: handler } = await import("../../api/_evidence-scan.js");
		const res = response();
		await handler(REQ, res);
		expect(res.statusCode).toBe(200);
		expect(res.body).toMatchObject({ safe: true, risk_level: "low" });
	});

	it("does not fetch content for non-text file types", async () => {
		dnsLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
		const { default: handler } = await import("../../api/_evidence-scan.js");
		const res = response();
		await handler(
			{
				method: "POST",
				body: { ...REQ.body, file_type: "image/jpeg", file_name: "photo.jpg" },
				headers: REQ.headers,
			},
			res,
		);
		// Content GET skipped (non-text) — only the HEAD size check runs.
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const opts = fetchMock.mock.calls[0][1];
		expect(opts?.method).toBe("HEAD");
	});
});

describe("POST /api/evidence/scan — fail-closed timeout", () => {
	it("returns safe:false with a timeout finding when the scan hangs", async () => {
		dnsLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
		fetchMock.mockResolvedValue(new Promise(() => {})); // content GET never resolves
		const { default: handler } = await import("../../api/_evidence-scan.js");
		const res = response();
		const pending = handler(REQ, res);
		await vi.advanceTimersByTimeAsync(26000);
		await pending;
		expect(res.statusCode).toBe(200);
		expect(res.body).toMatchObject({ safe: false, risk_level: "high" });
		expect(res.body.findings.join(" ")).toContain("timed out");
	});
});
