import { Buffer } from "node:buffer";

export class RequestBodyTooLargeError extends Error {
	constructor(maxBytes, receivedBytes) {
		super(`Request body exceeds ${maxBytes} bytes`);
		this.name = "RequestBodyTooLargeError";
		this.maxBytes = maxBytes;
		this.receivedBytes = receivedBytes;
	}
}

function headerValue(req, name) {
	const headers = req?.headers || {};
	const key = Object.keys(headers).find(
		(candidate) => candidate.toLowerCase() === name.toLowerCase(),
	);
	const value = key ? headers[key] : undefined;
	return Array.isArray(value) ? value[0] : value;
}

function isWebStream(value) {
	return Boolean(value && typeof value.getReader === "function");
}

function isNodeStream(value) {
	return Boolean(
		value &&
			(typeof value.pipe === "function" ||
				typeof value[Symbol.asyncIterator] === "function"),
	);
}

function toBuffer(value) {
	if (Buffer.isBuffer(value)) return value;
	if (value instanceof ArrayBuffer) return Buffer.from(value);
	if (ArrayBuffer.isView(value)) {
		return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
	}
	if (typeof value === "string") return Buffer.from(value, "utf8");
	return Buffer.from(String(value), "utf8");
}

async function cancelReader(reader) {
	try {
		await reader.cancel();
	} catch {
		// The stream may already be closed; the size error remains authoritative.
	}
}

async function readWebStream(stream, maxBytes) {
	const reader = stream.getReader();
	const chunks = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			const chunk = toBuffer(value);
			const nextTotal = total + chunk.byteLength;
			if (nextTotal > maxBytes) {
				await cancelReader(reader);
				throw new RequestBodyTooLargeError(maxBytes, nextTotal);
			}
			chunks.push(chunk);
			total = nextTotal;
		}
	} finally {
		try {
			reader.releaseLock?.();
		} catch {
			// A cancelled reader may already have released its lock.
		}
	}
	return Buffer.concat(chunks, total);
}

async function readNodeStream(stream, maxBytes) {
	const chunks = [];
	let total = 0;
	try {
		for await (const value of stream) {
			const chunk = toBuffer(value);
			const nextTotal = total + chunk.byteLength;
			if (nextTotal > maxBytes) {
				stream.destroy?.();
				throw new RequestBodyTooLargeError(maxBytes, nextTotal);
			}
			chunks.push(chunk);
			total = nextTotal;
		}
	} catch (error) {
		if (error instanceof RequestBodyTooLargeError) throw error;
		throw error;
	}
	return Buffer.concat(chunks, total);
}

function parseTextBody(req, raw, contentType) {
	const text = raw.toString("utf8");
	const trimmed = text.trim();
	if (!trimmed) {
		req.body = {};
		return;
	}

	const isJson =
		contentType.includes("json") ||
		trimmed.startsWith("{") ||
		trimmed.startsWith("[");
	if (isJson) {
		try {
			req.body = JSON.parse(trimmed);
			return;
		} catch (error) {
			if (contentType.includes("json")) throw error;
		}
	}

	if (contentType.includes("x-www-form-urlencoded")) {
		req.body = Object.fromEntries(new URLSearchParams(trimmed));
		return;
	}

	try {
		req.body = JSON.parse(trimmed);
	} catch (error) {
		if (trimmed.startsWith("{") || trimmed.startsWith("[")) throw error;
		req.body = Object.fromEntries(new URLSearchParams(trimmed));
	}
}

/**
 * Normalize a Vercel/Node request body without buffering beyond maxBytes.
 * The parser is intentionally strict for JSON so malformed input cannot be
 * mistaken for a successful empty request.
 */
export async function parseRequestBody(req, { maxBytes = 500_000 } = {}) {
	if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
		throw new RangeError("maxBytes must be a positive safe integer");
	}
	if (req.method === "GET" || req.method === "OPTIONS" || req.method === "HEAD") {
		return;
	}

	const body = req.body;
	if (
		body !== undefined &&
		body !== null &&
		typeof body === "object" &&
		!Buffer.isBuffer(body) &&
		!ArrayBuffer.isView(body) &&
		!isWebStream(body) &&
		!isNodeStream(body)
	) {
		return;
	}

	const source =
		body ??
		(isWebStream(req) || isNodeStream(req) ? req : undefined);
	if (source === undefined || source === null) {
		req.body = {};
		return;
	}

	let raw;
	if (isWebStream(source)) {
		raw = await readWebStream(source, maxBytes);
	} else if (isNodeStream(source)) {
		raw = await readNodeStream(source, maxBytes);
	} else {
		raw = toBuffer(source);
		if (raw.byteLength > maxBytes) {
			throw new RequestBodyTooLargeError(maxBytes, raw.byteLength);
		}
	}

	parseTextBody(req, raw, String(headerValue(req, "content-type") || "").toLowerCase());
}
