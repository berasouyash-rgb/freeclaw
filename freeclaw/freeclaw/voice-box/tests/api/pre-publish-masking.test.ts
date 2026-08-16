// Outbound PII masking for the pre-publish moderation gate.
//
// Verifies that _pre-publish.js never sends raw phone/email/address to the
// NVIDIA moderation endpoint: maskPII runs at the callNvidiaLLM chokepoint,
// a note is appended when PII was redacted (so the AI still flags it), and
// the deterministic emergencyRegex gate on the ORIGINAL text still floors
// the risk at 80 → decision stays 'high_risk' even when the AI says 'safe'.

import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

// ─── Mock supabase with a thenable query chain ─────────────────────────
// The handler awaits chains like from('posts').select(...).eq(...).gte(...);
// a `then` on the chain makes `await chain` resolve to { count: 0, data: null }.
const { supabaseMock } = vi.hoisted(() => {
	const queryChain: any = {
		select: () => queryChain,
		eq: () => queryChain,
		gte: () => queryChain,
		lte: () => queryChain,
		limit: () => queryChain,
		order: () => queryChain,
		insert: () => queryChain,
		maybeSingle: async () => ({ data: null, error: null }),
		then(resolve: (v: unknown) => void) {
			resolve({ data: null, error: null, count: 0 });
		},
	};
	const supabaseMock = { from: vi.fn(() => queryChain) };
	return { supabaseMock };
});

vi.mock("../../api/_db-client.js", () => ({ default: supabaseMock }));

// ─── Mock fetch and capture the outbound NVIDIA request ────────────────
const mockFetch = vi.fn();
globalThis.fetch = mockFetch as unknown as typeof fetch;

const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

function jsonResponse(content: string) {
	return {
		ok: true,
		status: 200,
		json: async () => ({ choices: [{ message: { content } }] }),
		text: async () => "",
	} as unknown as Response;
}

function aiSaysSafe() {
	return JSON.stringify({
		risk_score: 20,
		decision: "safe",
		personal_info_detected: false,
		threats_detected: false,
		bullying_detected: false,
		hate_speech_detected: false,
		doxxing_detected: false,
		blackmail_detected: false,
		explicit_detected: false,
		spam_detected: false,
		privacy_issues: [],
		safety_issues: [],
		spam_issues: [],
		quality_issues: [],
		reason: "clean",
		summary: "clean",
		suggested_priority: "low",
		suggested_category: "Academics",
	});
}

function sentRequest(): {
	url: string;
	userContent: string;
	systemContent: string;
} {
	const call = mockFetch.mock.calls[0];
	expect(call).toBeTruthy();
	const [url, init] = call as [string, { body?: string }];
	const body = init?.body ? JSON.parse(init.body) : {};
	const user =
		body.messages?.find((m: any) => m.role === "user")?.content ?? "";
	const system =
		body.messages?.find((m: any) => m.role === "system")?.content ?? "";
	return { url, userContent: String(user), systemContent: String(system) };
}

function makeRes() {
	const res: any = {
		status: vi.fn(() => res),
		json: vi.fn(() => res),
		end: vi.fn(() => res),
		setHeader: vi.fn(() => res),
	};
	return res;
}

// ─── Module under test (real implementation, loaded after env set) ─────
let handler: (req: any, res: any) => Promise<void>;

beforeAll(async () => {
	vi.resetModules();
	process.env.NVIDIA_API_KEY = "test-key";
	const mod = await import("../../api/_pre-publish.js");
	handler = mod.default;
});

afterAll(() => {
	delete process.env.NVIDIA_API_KEY;
});

beforeEach(() => {
	mockFetch.mockReset();
});

describe("pre-publish outbound PII masking", () => {
	it("masks PII in the body sent to NVIDIA, signals the AI, and still returns high_risk", async () => {
		mockFetch.mockResolvedValue(jsonResponse(aiSaysSafe()));
		const res = makeRes();

		await handler(
			{
				method: "POST",
				query: {},
				headers: {},
				body: {
					content_type: "post",
					title: "Complaint",
					description:
						"call me at 555-123-4567 or email jane.doe@example.com, i live at 12 rose street",
					author_id: "anon-mask-1",
				},
			},
			res,
		);

		// 1) Exactly one outbound call to the NVIDIA endpoint, PII redacted.
		expect(mockFetch).toHaveBeenCalledTimes(1);
		const req = sentRequest();
		expect(req.url).toBe(NVIDIA_URL);
		expect(req.userContent).toContain("[PHONE]");
		expect(req.userContent).toContain("[EMAIL]");
		expect(req.userContent).toContain("[ADDRESS]");
		expect(req.userContent).not.toContain("555-123-4567");
		expect(req.userContent).not.toContain("jane.doe@example.com");
		expect(req.userContent).not.toContain("rose street");

		// 2) The note tells the model the placeholders mean PII was found.
		expect(req.userContent).toMatch(/personal information found/i);

		// 3) Deterministic regex gate on the ORIGINAL text floors risk at 80,
		//    so even a "safe" AI verdict cannot publish PII.
		const payload = res.json.mock.calls[0][0];
		expect(payload.decision).toBe("high_risk");
		expect(payload.risk_score).toBeGreaterThanOrEqual(80);
		expect(payload.checks.privacy.pass).toBe(false);
	});

	it("masks the reported MAAM KAULI name+address case end-to-end", async () => {
		mockFetch.mockResolvedValue(jsonResponse(aiSaysSafe()));
		const res = makeRes();

		await handler(
			{
				method: "POST",
				query: {},
				headers: {},
				body: {
					content_type: "post",
					title: "Complaint",
					description: "MAAM KAULI LIVES IN STREE 123 AND BALLY HOWRAG",
					author_id: "anon-mask-3",
				},
			},
			res,
		);

		const req = sentRequest();
		expect(req.userContent).toContain("[ADDRESS]");
		expect(req.userContent).not.toContain("STREE 123");
		expect(req.userContent).not.toContain("MAAM");
		expect(req.userContent).not.toContain("HOWRAG");

		const payload = res.json.mock.calls[0][0];
		expect(payload.decision).toBe("high_risk");
		expect(payload.risk_score).toBeGreaterThanOrEqual(80);
	});

	it("sends clean text unchanged (no placeholders, no note) and returns safe", async () => {
		mockFetch.mockResolvedValue(jsonResponse(aiSaysSafe()));
		const res = makeRes();

		await handler(
			{
				method: "POST",
				query: {},
				headers: {},
				body: {
					content_type: "post",
					title: "Wifi issue",
					description: "the wifi in the library is very slow, please fix it",
					author_id: "anon-mask-2",
				},
			},
			res,
		);

		const req = sentRequest();
		expect(req.userContent).not.toContain("[PHONE]");
		expect(req.userContent).not.toContain("[EMAIL]");
		expect(req.userContent).not.toContain("[ADDRESS]");
		expect(req.userContent).not.toMatch(/personal information found/i);
		expect(req.userContent).toContain("the wifi in the library is very slow");

		const payload = res.json.mock.calls[0][0];
		expect(payload.decision).toBe("safe");
		expect(payload.risk_score).toBeLessThan(30);
	});

	it("keeps the moderation system prompt (examples) intact — only user content is masked", async () => {
		mockFetch.mockResolvedValue(jsonResponse(aiSaysSafe()));
		const res = makeRes();

		await handler(
			{
				method: "POST",
				query: {},
				headers: {},
				body: {
					content_type: "post",
					title: "T",
					description: "call 555-123-4567",
					author_id: "anon-mask-4",
				},
			},
			res,
		);

		const req = sentRequest();
		expect(req.systemContent).toContain("school content moderation AI");
		expect(req.systemContent).toContain("personal_info_detected");
	});
});
