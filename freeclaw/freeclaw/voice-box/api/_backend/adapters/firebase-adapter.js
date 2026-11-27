// ─── Firebase (Firestore) adapter ───────────────────────────────
// Uses Firestore's REST API rather than the Admin SDK so the function bundle
// stays small and the credential can be a server-side service account held in
// env. No credential is ever shipped to a client.
//
// Collections are one-per-table (`voiceflow_<table>`) to keep Firestore rules
// simple and avoid giant nested documents.
//
// The adapter is fully injectable (fetch + token provider) so it is testable
// without Firebase: tests assert request shape, value codecs, error mapping.

import crypto from "node:crypto";
import { BaseAdapter } from "./base.js";
import {
	AdapterUnavailableError,
	BackendError,
	StaleWriteError,
} from "../errors.js";
import { inScope, tableMeta } from "../tables.js";

const FIRESTORE = "https://firestore.googleapis.com/v1";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/datastore";

/** JS value -> Firestore REST Value. */
export function encodeValue(value) {
	if (value === null || value === undefined) return { nullValue: null };
	if (typeof value === "string") return { stringValue: value };
	if (typeof value === "boolean") return { booleanValue: value };
	if (typeof value === "number") {
		return Number.isInteger(value)
			? { integerValue: String(value) }
			: { doubleValue: value };
	}
	if (Array.isArray(value)) {
		return { arrayValue: { values: value.map(encodeValue) } };
	}
	if (typeof value === "object") {
		return { mapValue: { fields: encodeFields(value) } };
	}
	return { stringValue: String(value) };
}

/** Firestore REST Value -> JS value. */
export function decodeValue(v) {
	if (!v || typeof v !== "object") return null;
	if ("nullValue" in v) return null;
	if ("stringValue" in v) return v.stringValue;
	if ("booleanValue" in v) return !!v.booleanValue;
	if ("integerValue" in v) return Number(v.integerValue);
	if ("doubleValue" in v) return Number(v.doubleValue);
	if ("timestampValue" in v) return v.timestampValue;
	if ("arrayValue" in v)
		return (v.arrayValue?.values || []).map(decodeValue);
	if ("mapValue" in v) return decodeFields(v.mapValue?.fields || {});
	return null;
}

export function encodeFields(obj) {
	const fields = {};
	for (const [k, v] of Object.entries(obj || {})) {
		if (v !== undefined) fields[k] = encodeValue(v);
	}
	return fields;
}

export function decodeFields(fields) {
	const out = {};
	for (const [k, v] of Object.entries(fields || {})) out[k] = decodeValue(v);
	return out;
}

function decodeDocument(doc) {
	if (!doc) return null;
	const id = String(doc.name || "").split("/").pop();
	return { id, ...decodeFields(doc.fields || {}) };
}

function toBackendError(status, body, adapter) {
	// Firestore returns either { error } or an array of { error } entries
	// (runQuery wraps per-item errors). Surface the real Google message so an
	// IAM/API-enablement problem is distinguishable from a rules denial.
	let err = body?.error;
	if (!err && Array.isArray(body)) {
		const first = body.find((row) => row?.error) || body[0];
		err = first?.error || first;
	}
	const detail = String(err?.message || err?.status || body || "").slice(0, 300);
	const retryable = status === 429 || status >= 500;
	return new BackendError(`firebase HTTP ${status}: ${detail}`, {
		code: retryable ? "FIREBASE_UNAVAILABLE" : "FIREBASE_ERROR",
		retryable,
		adapter,
	});
}

function b64url(input) {
	return Buffer.from(input).toString("base64url");
}

/**
 * Service-account JWT -> OAuth access token, cached until expiry.
 * Never logs or returns the private key.
 */
export function createServiceAccountTokenProvider({
	clientEmail,
	privateKey,
	fetchImpl = fetch,
	now = Date.now,
}) {
	if (!clientEmail || !privateKey) {
		throw new AdapterUnavailableError("firebase", "missing service-account credentials");
	}
	const key = String(privateKey).replace(/\\n/g, "\n");
	let cached = null;

	return async function getAccessToken() {
		if (cached && cached.expiresAt > now() + 60_000) return cached.token;
		const iat = Math.floor(now() / 1000);
		const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
		const claims = b64url(
			JSON.stringify({
				iss: clientEmail,
				scope: SCOPE,
				aud: TOKEN_URL,
				iat,
				exp: iat + 3600,
			}),
		);
		const signer = crypto.createSign("RSA-SHA256");
		signer.update(`${header}.${claims}`);
		const signature = signer.sign(key, "base64url");
		const assertion = `${header}.${claims}.${signature}`;
		const res = await fetchImpl(TOKEN_URL, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${encodeURIComponent(assertion)}`,
		});
		if (!res.ok) {
			throw new BackendError(`firebase token exchange HTTP ${res.status}`, {
				code: "FIREBASE_AUTH_FAILED",
				retryable: res.status >= 500,
				adapter: "firebase",
			});
		}
		const body = await res.json();
		if (!body?.access_token) {
			throw new BackendError("firebase token exchange returned no access_token", {
				code: "FIREBASE_AUTH_FAILED",
				retryable: false,
				adapter: "firebase",
			});
		}
		cached = {
			token: body.access_token,
			expiresAt: now() + (Number(body.expires_in) || 3600) * 1000,
		};
		return cached.token;
	};
}

export class FirebaseAdapter extends BaseAdapter {
	/**
	 * @param {{ projectId: string, getAccessToken: () => Promise<string>,
	 *           fetchImpl?: Function, baseUrl?: string, name?: string }} opts
	 */
	constructor(opts = {}) {
		super(opts.name || "firebase");
		if (!opts.projectId) {
			throw new AdapterUnavailableError(this.name, "missing projectId");
		}
		if (typeof opts.getAccessToken !== "function") {
			throw new AdapterUnavailableError(this.name, "missing token provider");
		}
		this.projectId = opts.projectId;
		this.getAccessToken = opts.getAccessToken;
		this.fetchImpl = opts.fetchImpl || fetch;
		this.baseUrl = (opts.baseUrl || FIRESTORE).replace(/\/+$/, "");
	}

	_guard(table) {
		if (!inScope(table)) throw new Error(`Table "${table}" is outside the VoiceFlow scope`);
		return tableMeta(table);
	}

	_collection(table) {
		return `voiceflow_${table}`;
	}

	_docName(table, id) {
		return `projects/${this.projectId}/databases/(default)/documents/${this._collection(table)}/${encodeURIComponent(String(id))}`;
	}

	async _request(path, init = {}) {
		const token = await this.getAccessToken();
		const res = await this.fetchImpl(`${this.baseUrl}/${path}`, {
			...init,
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
				...(init.headers || {}),
			},
		});
		let body = null;
		try {
			body = await res.json();
		} catch {
			body = null;
		}
		if (!res.ok) throw toBackendError(res.status, body, this.name);
		return { status: res.status, body };
	}

	async health() {
		const started = Date.now();
		try {
			await this._request(
				`projects/${this.projectId}/databases/(default)/documents/voiceflow_settings?pageSize=1`,
				{ method: "GET" },
			);
			return { ok: true, latencyMs: Date.now() - started };
		} catch (err) {
			return {
				ok: false,
				latencyMs: Date.now() - started,
				detail: String(err?.message || err).slice(0, 200),
			};
		}
	}

	async get(table, id) {
		this._guard(table);
		try {
			const { body } = await this._request(this._docName(table, id), { method: "GET" });
			return decodeDocument(body);
		} catch (err) {
			if (err instanceof BackendError && /HTTP 404/.test(err.message)) return null;
			throw err;
		}
	}

	async select(table, opts = {}) {
		this._guard(table);
		const structuredQuery = { from: [{ collectionId: this._collection(table) }] };
		const filters = [];
		for (const [field, value] of Object.entries(opts.where || {})) {
			filters.push({
				fieldFilter: { field: { fieldPath: field }, op: "EQUAL", value: encodeValue(value) },
			});
		}
		if (opts.since?.column && opts.since.value != null) {
			filters.push({
				fieldFilter: {
					field: { fieldPath: opts.since.column },
					op: "GREATER_THAN",
					value: encodeValue(opts.since.value),
				},
			});
		}
		if (filters.length === 1) structuredQuery.where = filters[0];
		else if (filters.length > 1) structuredQuery.where = { compositeFilter: { op: "AND", filters } };
		if (opts.orderBy) {
			structuredQuery.orderBy = [
				{ field: { fieldPath: opts.orderBy }, direction: opts.ascending === false ? "DESCENDING" : "ASCENDING" },
			];
		}
		if (typeof opts.limit === "number") structuredQuery.limit = opts.limit;
		const { body } = await this._request(
			`projects/${this.projectId}/databases/(default)/documents:runQuery`,
			{ method: "POST", body: JSON.stringify({ structuredQuery }) },
		);
		return (Array.isArray(body) ? body : [])
			.map((row) => row.document)
			.filter(Boolean)
			.map(decodeDocument);
	}

	async insert(table, row) {
		const meta = this._guard(table);
		const id = row[meta.pk];
		if (id === undefined || id === null) throw new Error(`insert requires "${meta.pk}"`);
		await this._request(`${this._docName(table, id)}?currentDocument.exists=false`, {
			method: "PATCH",
			body: JSON.stringify({ fields: encodeFields(row) }),
		});
		return row;
	}

	async update(table, id, patch, opts = {}) {
		const meta = this._guard(table);
		const current = await this.get(table, id);
		if (!current) throw new StaleWriteError(table, id, opts.expectedVersion, undefined);
		if (
			typeof opts.expectedVersion === "number" &&
			typeof current.version === "number" &&
			current.version !== opts.expectedVersion
		) {
			throw new StaleWriteError(table, id, opts.expectedVersion, current.version);
		}
		const next = {
			...current,
			...patch,
			version: typeof current.version === "number" ? current.version + 1 : current.version,
		};
		delete next.id;
		const mask = Object.keys(next)
			.map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`)
			.join("&");
		await this._request(`${this._docName(table, id)}?currentDocument.exists=true&${mask}`, {
			method: "PATCH",
			body: JSON.stringify({ fields: encodeFields(next) }),
		});
		return { id, ...next };
	}

	async upsert(table, rows, opts = {}) {
		this._guard(table);
		const list = Array.isArray(rows) ? rows : [rows];
		let written = 0;
		for (const row of list) {
			const meta = tableMeta(table);
			const id = row[meta.pk];
			if (id === undefined || id === null) continue;
			await this._request(this._docName(table, id), {
				method: "PATCH",
				body: JSON.stringify({ fields: encodeFields(row) }),
			});
			written += 1;
		}
		return written;
	}

	async remove(table, id) {
		this._guard(table);
		try {
			await this._request(`${this._docName(table, id)}?currentDocument.exists=true`, {
				method: "DELETE",
			});
			return true;
		} catch (err) {
			if (err instanceof BackendError && /HTTP 404/.test(err.message)) return false;
			throw err;
		}
	}
}

/** Composition helper used by the server; throws if env is incomplete. */
export function createFirebaseAdapterFromEnv(env = process.env, deps = {}) {
	return new FirebaseAdapter({
		projectId: env.FIREBASE_PROJECT_ID,
		getAccessToken: createServiceAccountTokenProvider({
			clientEmail: env.FIREBASE_CLIENT_EMAIL,
			privateKey: env.FIREBASE_PRIVATE_KEY,
			fetchImpl: deps.fetchImpl,
			now: deps.now,
		}),
		fetchImpl: deps.fetchImpl,
		baseUrl: deps.baseUrl,
	});
}
