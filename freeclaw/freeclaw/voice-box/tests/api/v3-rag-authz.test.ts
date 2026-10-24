// ═══════════════════════════════════════════════════════════════════
// /api/v3/rag — admin gate
// ═══════════════════════════════════════════════════════════════════
// This endpoint reads the internal knowledge_base table (content, source,
// verification state) and returns RAG prompt scaffolding. `protect()` in
// api/index.js only adds headers — it does NOT authenticate — so without
// an explicit gate any anonymous caller could dump KB rows and analytics.
// Locks:
//   - anonymous POST/GET → 403 BEFORE the try block, and no KB helper runs
//   - OPTIONS stays open (preflight must never require a session)
//   - an admin still gets search / retrieve / analytics unchanged
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = {
	cors: vi.fn(),
	isAdmin: vi.fn().mockResolvedValue(false),
};
vi.mock("../../api/_auth.js", () => authMocks);
vi.mock("../../api/_error.js", () => ({
	sanitizeError: vi.fn((res: unknown, err: unknown) => {
		throw err;
	}),
}));

const ragMocks = {
	appendCitations: vi.fn((x: unknown) => x),
	buildRAGPrompt: vi.fn(() => ({
		systemPrompt: "S".repeat(600),
		userPrompt: "U",
	})),
	getKBAnalytics: vi.fn(async () => ({ total: 3 })),
	retrieveContext: vi.fn(async () => ({
		context: "ctx",
		citations: [{ id: "kb1" }],
		hasRelevantContent: true,
	})),
	searchKB: vi.fn(async () => [{ id: "kb1" }]),
};
vi.mock("../../api/_rag.js", () => ragMocks);

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

async function call(
	req: Record<string, unknown>,
): Promise<ReturnType<typeof response>> {
	const { default: handler } = await import("../../api/v3/_rag.js");
	const res = response();
	await handler(req, res);
	return res;
}

function expectNoKbAccess() {
	expect(ragMocks.searchKB).not.toHaveBeenCalled();
	expect(ragMocks.retrieveContext).not.toHaveBeenCalled();
	expect(ragMocks.getKBAnalytics).not.toHaveBeenCalled();
	expect(ragMocks.buildRAGPrompt).not.toHaveBeenCalled();
}

beforeEach(() => {
	vi.clearAllMocks();
	authMocks.isAdmin.mockResolvedValue(false);
});

describe("/api/v3/rag authorization", () => {
	it("refuses an anonymous search and never touches the knowledge base", async () => {
		const res = await call({
			method: "POST",
			body: { action: "search", query: "exam policy" },
			headers: {},
		});

		expect(res.statusCode).toBe(403);
		expect(res.body).toEqual({ error: "Admin only" });
		expectNoKbAccess();
	});

	it("refuses an anonymous retrieve and never builds a prompt", async () => {
		const res = await call({
			method: "POST",
			body: { action: "retrieve", query: "exam policy" },
			headers: {},
		});

		expect(res.statusCode).toBe(403);
		expectNoKbAccess();
	});

	it("refuses anonymous analytics", async () => {
		const res = await call({ method: "GET", query: {}, headers: {} });

		expect(res.statusCode).toBe(403);
		expectNoKbAccess();
	});

	it("keeps the CORS preflight open without a session", async () => {
		const res = await call({ method: "OPTIONS", headers: {} });

		expect(res.statusCode).toBe(204);
		expect(authMocks.isAdmin).not.toHaveBeenCalled();
		expectNoKbAccess();
	});

	it("passes the real request to isAdmin (no hardcoded allow)", async () => {
		const req = {
			method: "POST",
			body: { action: "search", query: "q" },
			headers: { authorization: "Bearer forged" },
		};
		await call(req);

		expect(authMocks.isAdmin).toHaveBeenCalledTimes(1);
		expect(authMocks.isAdmin).toHaveBeenCalledWith(req);
	});

	it("serves search results to an admin", async () => {
		authMocks.isAdmin.mockResolvedValue(true);
		const res = await call({
			method: "POST",
			body: { action: "search", query: "exam policy", limit: 5 },
			headers: {},
		});

		expect(res.statusCode).toBe(200);
		expect(res.body).toMatchObject({
			query: "exam policy",
			results: [{ id: "kb1" }],
			count: 1,
		});
		expect(ragMocks.searchKB).toHaveBeenCalledWith("exam policy", {
			category: undefined,
			limit: 5,
			minConfidence: 0.3,
		});
	});

	it("serves retrieve context + truncated prompt to an admin", async () => {
		authMocks.isAdmin.mockResolvedValue(true);
		const res = await call({
			method: "POST",
			body: { action: "retrieve", query: "exam policy" },
			headers: {},
		});

		expect(res.statusCode).toBe(200);
		const body = res.body as {
			context: string;
			citations: unknown[];
			hasRelevantContent: boolean;
			prompt: { system: string; user: string };
		};
		expect(body.context).toBe("ctx");
		expect(body.citations).toHaveLength(1);
		expect(body.hasRelevantContent).toBe(true);
		expect(body.prompt.system).toHaveLength(503);
		expect(body.prompt.user).toBe("U");
	});

	it("serves analytics to an admin", async () => {
		authMocks.isAdmin.mockResolvedValue(true);
		const res = await call({ method: "GET", query: {}, headers: {} });

		expect(res.statusCode).toBe(200);
		expect(res.body).toMatchObject({
			service: "rag-engine",
			status: "operational",
			analytics: { total: 3 },
		});
	});
});
