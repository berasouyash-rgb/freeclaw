import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
	parseRequestBody,
	RequestBodyTooLargeError,
} from "../../api/_request-body.js";

const MAX_BYTES = 32;

function request(body: unknown, contentType = "application/json") {
	return {
		method: "POST",
		headers: { "content-type": contentType },
		body,
	};
}

describe("bounded request body parser", () => {
	it("accepts a Buffer exactly at the byte limit", async () => {
		const raw = `{"value":"${"x".repeat(MAX_BYTES - 12)}"}`;
		expect(Buffer.byteLength(raw)).toBe(MAX_BYTES);
		const req = request(Buffer.from(raw));

		await parseRequestBody(req, { maxBytes: MAX_BYTES });

		expect(req.body).toEqual({ value: "x".repeat(MAX_BYTES - 12) });
	});

	it("cancels an oversized Web stream and reports byte overflow", async () => {
		const cancel = vi.fn();
		const read = vi
			.fn()
			.mockResolvedValueOnce({ done: false, value: new TextEncoder().encode("x".repeat(MAX_BYTES)) })
			.mockResolvedValueOnce({ done: false, value: new TextEncoder().encode("y") });
		const stream = {
			getReader: () => ({
				read,
				cancel,
				releaseLock: vi.fn(),
			}),
		};
		const req = request(stream);

		await expect(
			parseRequestBody(req, { maxBytes: MAX_BYTES }),
		).rejects.toMatchObject({
			name: "RequestBodyTooLargeError",
			maxBytes: MAX_BYTES,
			receivedBytes: MAX_BYTES + 1,
		});
		expect(cancel).toHaveBeenCalledTimes(1);
	});

	it("counts UTF-8 bytes rather than JavaScript string length", async () => {
		const req = request("é".repeat(MAX_BYTES / 2 + 1));

		await expect(
			parseRequestBody(req, { maxBytes: MAX_BYTES }),
		).rejects.toBeInstanceOf(RequestBodyTooLargeError);
	});

	it("destroys an oversized Node stream", async () => {
		const stream = Readable.from([
			Buffer.alloc(MAX_BYTES),
			Buffer.from("x"),
		]);
		const req = request(stream);

		await expect(
			parseRequestBody(req, { maxBytes: MAX_BYTES }),
		).rejects.toBeInstanceOf(RequestBodyTooLargeError);
		expect(stream.destroyed).toBe(true);
	});

	it("parses URL-encoded bodies", async () => {
		const req = request("name=Ada&role=student", "application/x-www-form-urlencoded");

		await parseRequestBody(req, { maxBytes: MAX_BYTES });

		expect(req.body).toEqual({ name: "Ada", role: "student" });
	});

	it("leaves a pre-parsed object unchanged", async () => {
		const body = { title: "already parsed" };
		const req = request(body);

		await parseRequestBody(req, { maxBytes: MAX_BYTES });

		expect(req.body).toBe(body);
	});

	it("rejects malformed JSON rather than silently returning an empty object", async () => {
		const req = request("{not-json");

		await expect(
			parseRequestBody(req, { maxBytes: MAX_BYTES }),
		).rejects.toBeInstanceOf(SyntaxError);
	});

	it("turns an absent body into an empty object", async () => {
		const req = request(undefined);

		await parseRequestBody(req, { maxBytes: MAX_BYTES });

		expect(req.body).toEqual({});
	});
});
