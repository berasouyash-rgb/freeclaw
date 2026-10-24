// Pre-publish decision forcing on the EMERGENCY (LLM-down) path.
//
// callNvidiaLLM has no provider-chain fallback — on fetch failure it returns
// null and runChecks falls through to emergencyRegex(). These tests mock
// fetch to REJECT so every assertion below is about the deterministic
// regex gate, not the model:
//   1. Threats / PII / slurs / first-person self-harm are FORCED to
//      high_risk regardless of the raw score (decision > score).
//   2. First-person self-harm surfaces a SELF-HARM safety issue.
//   3. Victim reports ("a kid told me to kill myself") stay safe — the
//      reporting-word guard mirrors the prompt's pinned L118 example.
//   4. Clean text with the LLM down stays safe (fail-open for clean
//      content; fail-closed only applies to thrown errors, which the
//      handler catches separately).
// Risk SCORES are unchanged by slice 10 — only decisions are forced.

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

// ─── LLM DOWN: fetch always rejects → emergencyRegex path ──────────────
const mockFetch = vi.fn();
globalThis.fetch = mockFetch as unknown as typeof fetch;

function makeRes() {
	const res: any = {
		status: vi.fn(() => res),
		json: vi.fn(() => res),
		end: vi.fn(() => res),
		setHeader: vi.fn(() => res),
	};
	return res;
}

let handler: (req: any, res: any) => Promise<void>;
let authorSeq = 0;

async function runEmergency(body: Record<string, unknown>) {
	mockFetch.mockReset();
	mockFetch.mockRejectedValue(new Error("nvidia down"));
	const res = makeRes();
	await handler(
		{
			method: "POST",
			query: {},
			headers: {},
			body: {
				content_type: "post",
				author_id: `anon-dec-${authorSeq++}`,
				...body,
			},
		},
		res,
	);
	expect(res.json).toHaveBeenCalled();
	return res.json.mock.calls[0][0] as {
		decision: string;
		risk_score: number;
		checks: { safety: { issues: string[] }; privacy: { pass: boolean } };
	};
}

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

describe("pre-publish emergency path — decision forcing", () => {
	it("forces a direct threat to high_risk (score alone would be 60)", async () => {
		const payload = await runEmergency({
			title: "Complaint",
			description: "I will hurt you after school",
		});
		expect(payload.decision).toBe("high_risk");
		expect(payload.checks.safety.issues).toContain("DIRECT THREATS");
	});

	it("forces PII to high_risk — phone number scores only 25 but always queues", async () => {
		const payload = await runEmergency({
			title: "Complaint",
			description: "call me, my number is 123-456-7890",
		});
		expect(payload.decision).toBe("high_risk");
		expect(payload.checks.privacy.pass).toBe(false);
	});

	it("forces a slur to high_risk", async () => {
		const payload = await runEmergency({
			title: "Complaint",
			description: "you are a retard",
		});
		expect(payload.decision).toBe("high_risk");
		expect(payload.checks.safety.issues).toContain("HATE SPEECH");
	});

	it("keeps clean text safe when the LLM is down", async () => {
		const payload = await runEmergency({
			title: "Wifi issue",
			description: "the wifi in the library is very slow, please fix it",
		});
		expect(payload.decision).toBe("safe");
		expect(payload.risk_score).toBeLessThan(30);
	});

	it("forces FIRST-PERSON self-harm to high_risk with a SELF-HARM issue", async () => {
		const payload = await runEmergency({
			title: "Complaint",
			description: "i want to kill myself, i can't go on anymore",
		});
		expect(payload.decision).toBe("high_risk");
		expect(payload.checks.safety.issues).toContain("SELF-HARM");
	});

	it("keeps a victim report safe — 'a kid told me to kill myself'", async () => {
		const payload = await runEmergency({
			title: "Complaint",
			description: "a kid told me to kill myself yesterday in class",
		});
		expect(payload.decision).toBe("safe");
		expect(payload.checks.safety.issues).not.toContain("SELF-HARM");
	});
});
