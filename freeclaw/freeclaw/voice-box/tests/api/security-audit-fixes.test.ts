import { describe, expect, it, vi } from "vitest";
import handler from "../../api/index.js";
import goldenWorkflowsHandler from "../../api/_golden-workflows.js";
import techDebtHandler from "../../api/_tech-debt.js";
import uploadHandler from "../../api/_upload.js";
import { checkUser, isAllowedOrigin, isAdmin } from "../../api/_auth.js";

function createMockReqRes({
	url = "/api/posts",
	method = "POST",
	headers = {},
	body = {},
}: {
	url?: string;
	method?: string;
	headers?: Record<string, string>;
	body?: Record<string, unknown>;
}) {
	const req = {
		url,
		method,
		headers: { ...headers },
		body,
		query: {},
	};
	let statusCode = 200;
	let jsonBody: Record<string, unknown> = {};
	const responseHeaders: Record<string, string> = {};

	const res = {
		statusCode,
		setHeader: vi.fn((k: string, v: string) => {
			responseHeaders[k.toLowerCase()] = String(v);
		}),
		getHeader: vi.fn((k: string) => responseHeaders[k.toLowerCase()]),
		status: vi.fn((code: number) => {
			statusCode = code;
			res.statusCode = code;
			return res;
		}),
		json: vi.fn((data: Record<string, unknown>) => {
			jsonBody = data;
			return res;
		}),
		end: vi.fn(),
		writeHead: vi.fn((code: number) => {
			statusCode = code;
			res.statusCode = code;
			return res;
		}),
	};

	return { req, res, getStatus: () => statusCode, getJson: () => jsonBody, getHeaders: () => responseHeaders };
}

describe("Security Audit Fixes Verification", () => {
	describe("C1: Origin Allowlist on State-Changing Routes (CSRF Defense)", () => {
		it("isAllowedOrigin permits production domains and local dev", () => {
			expect(isAllowedOrigin("https://voice-box.vercel.app")).toBe(true);
			expect(isAllowedOrigin("https://voice-box-preview-123.vercel.app")).toBe(true);
			expect(isAllowedOrigin("http://localhost:5173")).toBe(true);
			expect(isAllowedOrigin("capacitor://localhost")).toBe(true);
		});

		it("isAllowedOrigin blocks malicious origins", () => {
			expect(isAllowedOrigin("https://evil-attacker.com")).toBe(false);
			expect(isAllowedOrigin("https://phishing-voice-box.com")).toBe(false);
		});

		it("handler blocks cross-origin state-changing POST requests with invalid origin", async () => {
			const { req, res, getStatus, getJson } = createMockReqRes({
				url: "/api/posts",
				method: "POST",
				headers: {
					origin: "https://evil-attacker.com",
				},
				body: { title: "Spam post" },
			});

			await handler(req as any, res as any);
			expect(getStatus()).toBe(403);
			expect(getJson().error).toMatch(/Invalid origin \/ CSRF blocked/);
		});

		it("handler blocks state-changing requests with sec-fetch-site: cross-site", async () => {
			const { req, res, getStatus, getJson } = createMockReqRes({
				url: "/api/posts",
				method: "POST",
				headers: {
					origin: "https://voice-box.vercel.app",
					"sec-fetch-site": "cross-site",
				},
				body: { title: "Cross-site attack" },
			});

			await handler(req as any, res as any);
			expect(getStatus()).toBe(403);
			expect(getJson().error).toMatch(/Cross-site request blocked/);
		});
	});

	describe("H1: Prototype pollution defense via Object.hasOwn", () => {
		it("returns 404 for Object prototype properties instead of executing them", async () => {
			const { req, res, getStatus, getJson } = createMockReqRes({
				url: "/api/toString",
				method: "GET",
			});

			await handler(req as any, res as any);
			expect(getStatus()).toBe(404);
			expect(getJson().error).toBe("Not found");
		});

		it("returns 404 for constructor endpoint", async () => {
			const { req, res, getStatus, getJson } = createMockReqRes({
				url: "/api/constructor",
				method: "GET",
			});

			await handler(req as any, res as any);
			expect(getStatus()).toBe(404);
			expect(getJson().error).toBe("Not found");
		});
	});

	describe("H6: Upload Session Identity Trust", () => {
		it("rejects uploads missing session identity header even if body contains author_id", async () => {
			const { req, res, getStatus, getJson } = createMockReqRes({
				url: "/api/upload",
				method: "POST",
				headers: {}, // No x-anon-id
				body: {
					author_id: "spoofed_target_user",
					fileBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
					contentType: "image/png",
				},
			});

			await uploadHandler(req as any, res as any);
			expect(getStatus()).toBe(403);
			expect(getJson().error).toMatch(/session identity/i);
		});
	});

	describe("M1 & M2: Missing isAdmin gates", () => {
		it("M1: golden-workflows rejects unauthenticated callers with 401", async () => {
			const { req, res, getStatus, getJson } = createMockReqRes({
				url: "/api/golden-workflows?action=run",
				method: "GET",
				headers: {},
			});

			await goldenWorkflowsHandler(req as any, res as any);
			expect(getStatus()).toBe(401);
			expect(getJson().error).toMatch(/Admin access required/);
		});

		it("M2: tech-debt rejects unauthenticated callers with 401", async () => {
			const { req, res, getStatus, getJson } = createMockReqRes({
				url: "/api/tech-debt?action=summary",
				method: "GET",
				headers: {},
			});

			await techDebtHandler(req as any, res as any);
			expect(getStatus()).toBe(401);
			expect(getJson().error).toMatch(/Admin access required/);
		});
	});
});
