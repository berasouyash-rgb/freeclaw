import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
	from: vi.fn(),
	callLLMChain: vi.fn(),
	hasUsableLLM: vi.fn(async () => true),
	buildChain: vi.fn(async () => [{ id: "nvidia", model: "test-model" }]),
	auditLog: vi.fn(async () => {}),
	generateBriefing: vi.fn(async () => ({ ok: true, briefing: { headline: "Live" } })),
}));

vi.mock("../../api/_db-client.js", () => ({ default: { from: h.from } }));
vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(), isAdmin: vi.fn(async () => true), auditLog: h.auditLog,
	clean: (s: unknown, max = 2000) => String(s ?? "").slice(0, max),
}));
vi.mock("../../api/_error.js", () => ({ sanitizeError: vi.fn() }));
vi.mock("../../api/_providers.js", () => ({
	callLLMChain: h.callLLMChain,
	hasUsableLLM: h.hasUsableLLM,
	buildChain: h.buildChain,
}));
vi.mock("../../api/_briefing.js", () => ({ generateBriefing: h.generateBriefing }));

import handler from "../../api/_smart-features.js";

function req(body: Record<string, unknown>) {
	return { method: "POST", headers: {}, body, query: {} } as never;
}
function res() {
	const r = { statusCode: 200, body: undefined as unknown };
	return Object.assign(r, {
		status(c: number) { r.statusCode = c; return this; },
		json(b: unknown) { r.body = b; return this; },
		end() { return this; }, setHeader: vi.fn(),
	});
}

const POSTS = [
	{ id: "p1", title: "Broken projector in class 4", description: "The projector does not turn on", category: "Facilities", status: "reported", priority: "high", created_at: new Date(Date.now() - 2 * 86400000).toISOString() },
	{ id: "p2", title: "Broken projector in class 4 again", description: "The projector does not turn on again", category: "Facilities", status: "reported", priority: "medium", created_at: new Date(Date.now() - 86400000).toISOString() },
];

beforeEach(() => {
	h.from.mockReset();
	h.callLLMChain.mockReset();
	h.auditLog.mockClear();
	h.callLLMChain.mockResolvedValue({ ok: true, text: '{"verdict":"legitimate","reason":"facilities complaint"}' });
});

describe("Smart features — real data paths", () => {
	it("lists all ten features", async () => {
		const r = res();
		await handler(req({ action: "list" }), r as never);
		expect((r.body as { features: string[] }).features).toHaveLength(10);
	});

	it("clusters duplicate posts from live rows", async () => {
		const table = {
			select: () => ({
				eq: () => ({ eq: () => ({ gte: () => ({ order: () => ({ limit: async () => ({ data: POSTS, error: null }) }) }) }) }),
			}),
		};
		h.from.mockImplementation((name: string) => (name === "posts" ? table : { select: () => ({ limit: async () => ({ data: [] }) }) }));
		const r = res();
		await handler(req({ action: "duplicates", days: 30 }), r as never);
		expect(r.statusCode).toBe(200);
		const body = r.body as { groups: Array<{ count: number }>; scanned: number };
		expect(body.scanned).toBe(2);
		expect(body.groups[0].count).toBe(2);
	});

	it("never auto-hides during moderation triage", async () => {
		h.from.mockImplementation((name: string) => {
			if (name === "posts")
				return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: POSTS[0], error: null }) }) }) };
			return { select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) };
		});
		const r = res();
		await handler(req({ action: "moderation", post_id: "p1" }), r as never);
		const body = r.body as { auto_hidden: boolean; verdict: { verdict: string } };
		expect(body.auto_hidden).toBe(false);
		expect(body.verdict.verdict).toBe("legitimate");
	});

	it("explains student status from the live record", async () => {
		h.from.mockImplementation(() => ({
			select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "p1", title: "X", status: "solved" }, error: null }) }) }),
		}));
		const r = res();
		await handler(req({ action: "student_status", post_id: "p1" }), r as never);
		expect((r.body as { explanation: string }).explanation).toMatch(/resolved/i);
	});

	it("reports real provider availability in the watchdog", async () => {
		const r = res();
		await handler(req({ action: "quota" }), r as never);
		const body = r.body as { model_available: boolean; configured_providers: number };
		expect(body.model_available).toBe(true);
		expect(body.configured_providers).toBe(1);
	});
});
