// Workforce Fabric proxy — the browser reaches the FastAPI agent runtime
// only through these admin-gated actions. Unreachable backend answers
// {ok:false} honestly; input is validated before any fetch.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock("../../api/_db-client.js", () => ({
	default: { from: mocks.from },
}));
vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	isAdmin: vi.fn(async () => true),
	auditLog: vi.fn(async () => {}),
	clean: (s: unknown, max = 2000) => String(s ?? "").slice(0, max),
	rateLimitResponse: vi.fn(),
}));
vi.mock("../../api/_error.js", () => ({
	sanitizeError: vi.fn((err: Error) => err.message),
}));

const llm = vi.hoisted(() => ({
	hasUsableLLM: vi.fn(async () => false),
	callLLMChain: vi.fn(),
}));

vi.mock("../../api/_providers.js", () => ({
	hasUsableLLM: llm.hasUsableLLM,
	callLLMChain: llm.callLLMChain,
	invalidateLLMStatus: vi.fn(),
	buildChain: vi.fn(async () => []),
	callProviderStream: vi.fn(async () => ({ ok: false, text: "" })),
	getProviderConfig: vi.fn(async () => null),
}));

import workforceHandler from "../../api/_workforce.js";

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

function req(body: unknown) {
	return { method: "POST", body, headers: {}, query: {} };
}

beforeEach(() => {
	vi.clearAllMocks();
	delete process.env.WORKFORCE_BASE_URL;
	delete process.env.WORKFORCE_URL;
});

afterEach(() => {
	delete process.env.WORKFORCE_BASE_URL;
	delete process.env.WORKFORCE_URL;
});

// The backend is opt-in: tests that exercise the fetch path set an explicit
// URL; without one the proxy must answer configured:false with NO network
// probe and NO localhost fallback.
function withBackend() {
	process.env.WORKFORCE_BASE_URL = "http://test-backend:8000";
}

describe("fabric-run proxy", () => {
	it("reports an unconfigured backend with setup guidance, no localhost probe", async () => {
		const fetchMock = vi.fn();
		global.fetch = fetchMock as unknown as typeof fetch;
		const res = response();
		await workforceHandler(req({ action: "fabric-run", input: "hello" }), res);
		expect(res.statusCode).toBe(200);
		const body = res.body as Record<string, unknown>;
		expect(body.ok).toBe(false);
		expect(body.configured).toBe(false);
		expect(body.backend).toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
		expect(JSON.stringify(body)).not.toContain("localhost");
	});

	it("reports unreachable backend honestly instead of throwing", async () => {
		withBackend();
		global.fetch = vi.fn(async () => {
			throw new Error("connect ECONNREFUSED");
		}) as unknown as typeof fetch;
		const res = response();
		await workforceHandler(req({ action: "fabric-run", input: "hello" }), res);
		expect(res.statusCode).toBe(200);
		const body = res.body as Record<string, unknown>;
		expect(body.ok).toBe(false);
		expect(body.unavailable).toBe(true);
		expect(body.configured).toBe(true);
	});

	it("rejects empty input without touching the network", async () => {
		withBackend();
		const fetchMock = vi.fn();
		global.fetch = fetchMock as unknown as typeof fetch;
		const res = response();
		await workforceHandler(req({ action: "fabric-run", input: "   " }), res);
		const body = res.body as Record<string, unknown>;
		expect(body.ok).toBe(false);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("passes a live backend result through", async () => {
		withBackend();
		global.fetch = (vi.fn(async () => ({
			ok: true,
			json: async () => ({ status: "succeeded", response: "hi" }),
		})) as unknown) as typeof fetch;
		const res = response();
		await workforceHandler(req({ action: "fabric-run", input: "hello" }), res);
		const body = res.body as Record<string, unknown>;
		expect(body.ok).toBe(true);
		expect(body.status).toBe("succeeded");
	});
});

describe("fabric-status proxy", () => {
	it("reports unreachable backend honestly", async () => {
		withBackend();
		global.fetch = vi.fn(async () => {
			throw new Error("connect ECONNREFUSED");
		}) as unknown as typeof fetch;
		const res = response();
		await workforceHandler(req({ action: "fabric-status" }), res);
		const body = res.body as Record<string, unknown>;
		expect(body.ok).toBe(false);
		expect(body.unavailable).toBe(true);
	});

	it("reports disabled instead of unreachable when unconfigured", async () => {
		const fetchMock = vi.fn();
		global.fetch = fetchMock as unknown as typeof fetch;
		const res = response();
		await workforceHandler(req({ action: "fabric-status" }), res);
		const body = res.body as Record<string, unknown>;
		expect(body.ok).toBe(false);
		expect(body.configured).toBe(false);
		expect(body.disabled).toBe(true);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe("ask-agent router", () => {
	it("delegates to the fabric backend when one is configured", async () => {
		withBackend();
		global.fetch = (vi.fn(async () => ({
			ok: true,
			json: async () => ({ status: "succeeded", response: "hi from fabric" }),
		})) as unknown) as typeof fetch;
		const res = response();
		await workforceHandler(req({ action: "ask-agent", input: "hello" }), res);
		const body = res.body as Record<string, unknown>;
		expect(body.ok).toBe(true);
		expect(body.response).toBe("hi from fabric");
	});

	it("answers via the built-in engine when no backend is configured", async () => {
		llm.hasUsableLLM.mockResolvedValue(true);
		llm.callLLMChain.mockResolvedValue({
			text: "3 open reports, 1 paused worker.",
			provider: "test",
			model: "test-model",
		});
		const res = response();
		await workforceHandler(req({ action: "ask-agent", input: "what needs attention?" }), res);
		const body = res.body as Record<string, unknown>;
		expect(res.statusCode).toBe(200);
		expect(body.ok).toBe(true);
		expect(body.status).toBe("succeeded");
		expect(body.backend).toBe("builtin");
		expect(body.response).toBe("3 open reports, 1 paused worker.");
		expect(llm.callLLMChain).toHaveBeenCalledTimes(1);
	});

	it("says plainly which key to add when no provider exists either", async () => {
		llm.hasUsableLLM.mockResolvedValue(false);
		const res = response();
		await workforceHandler(req({ action: "ask-agent", input: "hello" }), res);
		const body = res.body as Record<string, unknown>;
		expect(body.ok).toBe(false);
		expect(body.configured).toBe(false);
		expect(String(body.error)).toContain("NVIDIA_API_KEY");
		expect(llm.callLLMChain).not.toHaveBeenCalled();
	});

	it("rejects empty input without calling anything", async () => {
		const fetchMock = vi.fn();
		global.fetch = fetchMock as unknown as typeof fetch;
		const res = response();
		await workforceHandler(req({ action: "ask-agent", input: "   " }), res);
		const body = res.body as Record<string, unknown>;
		expect(body.ok).toBe(false);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(llm.callLLMChain).not.toHaveBeenCalled();
	});

	it("blames congestion — not the question — when the chain returns null", async () => {
		llm.hasUsableLLM.mockResolvedValue(true);
		llm.callLLMChain.mockResolvedValue(null);
		const res = response();
		await workforceHandler(req({ action: "ask-agent", input: "summarize" }), res);
		const body = res.body as Record<string, unknown>;
		expect(body.ok).toBe(false);
		expect(String(body.error)).toContain("busy");
		expect(String(body.error)).not.toContain("shorter question");
	});

	it("keeps the empty-answer message only for actual empty text", async () => {
		llm.hasUsableLLM.mockResolvedValue(true);
		llm.callLLMChain.mockResolvedValue({ text: "   ", provider: "t", model: "m" });
		const res = response();
		await workforceHandler(req({ action: "ask-agent", input: "summarize" }), res);
		const body = res.body as Record<string, unknown>;
		expect(body.ok).toBe(false);
		expect(String(body.error)).toContain("empty answer");
	});
});
