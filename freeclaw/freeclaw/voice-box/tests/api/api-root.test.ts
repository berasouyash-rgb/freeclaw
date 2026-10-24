// ═══════════════════════════════════════════════════════════════════
// Root API Index & Health Contract (/api, /api/, /api/index)
// ═══════════════════════════════════════════════════════════════════

import { describe, expect, it } from "vitest";
import handler from "../../api/index.js";

function createMockReqRes(url: string, method = "GET") {
	const headers: Record<string, string> = { host: "localhost:5173" };
	const req = {
		url,
		method,
		headers,
		query: {},
	} as any;

	let statusCode = 200;
	const resHeaders: Record<string, string> = {};
	let body = "";

	const res = {
		statusCode,
		status(code: number) {
			statusCode = code;
			res.statusCode = code;
			return res;
		},
		setHeader(k: string, v: string) {
			resHeaders[k.toLowerCase()] = v;
			return res;
		},
		getHeader(k: string) {
			return resHeaders[k.toLowerCase()];
		},
		json(obj: any) {
			resHeaders["content-type"] = "application/json";
			body = JSON.stringify(obj);
			return res;
		},
		end(data?: any) {
			if (data) body = String(data);
			return res;
		},
		get _body() {
			return body ? JSON.parse(body) : null;
		},
		get _statusCode() {
			return statusCode;
		},
	} as any;

	return { req, res };
}

describe("Root API index / ping", () => {
	it("returns 200 OK with healthy status for GET /api", async () => {
		const { req, res } = createMockReqRes("/api");
		await handler(req, res);
		expect(res._statusCode).toBe(200);
		expect(res._body).toMatchObject({
			status: "ok",
			name: "VoiceBox API",
			version: "36.0.0",
		});
	});

	it("returns 200 OK with healthy status for GET /api/", async () => {
		const { req, res } = createMockReqRes("/api/");
		await handler(req, res);
		expect(res._statusCode).toBe(200);
		expect(res._body).toMatchObject({
			status: "ok",
			name: "VoiceBox API",
			version: "36.0.0",
		});
	});

	it("returns 200 OK with healthy status for GET /api/index", async () => {
		const { req, res } = createMockReqRes("/api/index");
		await handler(req, res);
		expect(res._statusCode).toBe(200);
		expect(res._body).toMatchObject({
			status: "ok",
			name: "VoiceBox API",
			version: "36.0.0",
		});
	});
});
