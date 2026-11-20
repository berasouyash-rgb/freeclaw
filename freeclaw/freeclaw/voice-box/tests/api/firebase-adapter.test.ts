// Firestore adapter: codecs, request shape, auth token exchange, error mapping.
// No live Firebase is touched; fetch is injected.

import crypto from "node:crypto";
import { describe, expect, it } from "vitest";

import {
	FirebaseAdapter,
	createServiceAccountTokenProvider,
	decodeValue,
	encodeValue,
} from "../../api/_backend/adapters/firebase-adapter.js";
import { AdapterUnavailableError, BackendError } from "../../api/_backend/errors.js";

const response = (status, body) => ({
	ok: status >= 200 && status < 300,
	status,
	json: async () => body,
});

function build(handler) {
	const calls = [];
	const fetchImpl = async (url, init) => {
		calls.push({ url, init, body: init?.body });
		return handler(url, init);
	};
	const adapter = new FirebaseAdapter({
		projectId: "voicelflow",
		getAccessToken: async () => "test-token",
		fetchImpl,
		baseUrl: "https://firestore.test/v1",
	});
	return { adapter, calls };
}

describe("Firestore value codecs", () => {
	it("round-trips scalars, arrays and maps", () => {
		const value = {
			s: "hi",
			n: 42,
			f: 1.5,
			b: true,
			nil: null,
			arr: [1, "two"],
			map: { nested: "yes" },
		};
		expect(decodeValue(encodeValue(value))).toEqual(value);
	});

	it("preserves integer precision as strings internally", () => {
		expect(encodeValue(7)).toEqual({ integerValue: "7" });
		expect(encodeValue(7.25)).toEqual({ doubleValue: 7.25 });
	});
});

describe("FirebaseAdapter", () => {
	it("requires project id and token provider", () => {
		expect(() => new FirebaseAdapter({})).toThrow(AdapterUnavailableError);
		expect(
			() => new FirebaseAdapter({ projectId: "voicelflow" }),
		).toThrow(AdapterUnavailableError);
	});

	it("inserts with a create-only precondition", async () => {
		const { adapter, calls } = build(() => response(200, {}));
		await adapter.insert("posts", { id: "p1", title: "hi", version: 1 });
		expect(calls[0].url).toContain(
			"/projects/voicelflow/databases/(default)/documents/voiceflow_posts/p1",
		);
		expect(calls[0].url).toContain("currentDocument.exists=false");
		expect(calls[0].init.headers.Authorization).toBe("Bearer test-token");
		const body = JSON.parse(calls[0].body);
		expect(body.fields.id).toEqual({ stringValue: "p1" });
		expect(body.fields.version).toEqual({ integerValue: "1" });
	});

	it("returns null for a missing document", async () => {
		const { adapter } = build(() =>
			response(404, { error: { status: "NOT_FOUND" } }),
		);
		expect(await adapter.get("posts", "p404")).toBeNull();
	});

	it("builds a structured query and decodes rows", async () => {
		const { adapter, calls } = build(() =>
			response(200, [
				{
					document: {
						name: "projects/voicelflow/databases/(default)/documents/voiceflow_posts/p1",
						fields: {
							id: { stringValue: "p1" },
							version: { integerValue: "2" },
							author_id: { stringValue: "a1" },
						},
					},
				},
			]),
		);
		const rows = await adapter.select("posts", {
			where: { author_id: "a1" },
			orderBy: "created_at",
			ascending: false,
			limit: 10,
		});
		expect(rows).toEqual([{ id: "p1", version: 2, author_id: "a1" }]);
		const query = JSON.parse(calls[0].body).structuredQuery;
		expect(query.from[0].collectionId).toBe("voiceflow_posts");
		expect(query.where.fieldFilter).toMatchObject({
			field: { fieldPath: "author_id" },
			op: "EQUAL",
		});
		expect(query.orderBy[0].direction).toBe("DESCENDING");
		expect(query.limit).toBe(10);
	});

	it("maps 503 to a retryable backend error", async () => {
		const { adapter } = build(() => response(503, { error: { status: "UNAVAILABLE" } }));
		await expect(adapter.select("posts")).rejects.toMatchObject({
			retryable: true,
			code: "FIREBASE_UNAVAILABLE",
		});
	});

	it("rejects tables outside the VoiceFlow scope", async () => {
		const { adapter } = build(() => response(200, {}));
		await expect(adapter.select("cricket_stats")).rejects.toThrow(
			/outside the VoiceFlow scope/,
		);
	});
});

describe("service-account token provider", () => {
	it("exchanges a signed JWT and caches the access token", async () => {
		const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
			modulusLength: 2048,
			privateKeyEncoding: { type: "pkcs8", format: "pem" },
			publicKeyEncoding: { type: "spki", format: "pem" },
		});
		let tokenCalls = 0;
		let assertion = "";
		const fetchImpl = async (url, init) => {
			tokenCalls += 1;
			const params = new URLSearchParams(String(init.body));
			assertion = params.get("assertion");
			return response(200, { access_token: "ya29.test", expires_in: 3600 });
		};
		const getToken = createServiceAccountTokenProvider({
			clientEmail: "svc@voicelflow.iam.gserviceaccount.com",
			privateKey,
			fetchImpl,
			now: () => 1_700_000_000_000,
		});
		expect(await getToken()).toBe("ya29.test");
		expect(await getToken()).toBe("ya29.test"); // cached
		expect(tokenCalls).toBe(1);

		const [header, claims, signature] = assertion.split(".");
		const verify = crypto.createVerify("RSA-SHA256");
		verify.update(`${header}.${claims}`);
		expect(verify.verify(publicKey, signature, "base64url")).toBe(true);
		const parsedClaims = JSON.parse(Buffer.from(claims, "base64url").toString());
		expect(parsedClaims.iss).toBe("svc@voicelflow.iam.gserviceaccount.com");
		expect(parsedClaims.scope).toBe("https://www.googleapis.com/auth/datastore");
	});

	it("throws AdapterUnavailableError without credentials", () => {
		expect(() => createServiceAccountTokenProvider({})).toThrow(
			AdapterUnavailableError,
		);
	});
});

describe("BackendError shape", () => {
	it("is an Error with a code", () => {
		const err = new BackendError("x", { code: "TEST" });
		expect(err).toBeInstanceOf(Error);
		expect(err.code).toBe("TEST");
	});
});
