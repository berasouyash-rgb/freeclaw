// Post removal verification — admin hides/quarantines prove absence on the
// public read path, record exposure + audit evidence, and fingerprint
// safety-driven removals so the text cannot return verbatim.
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = {
	post: null as unknown,
	updates: [] as unknown[],
	blocklist: [] as unknown[],
	audits: [] as unknown[],
	verifyCalls: 0,
	isAdmin: true,
};

const from = vi.fn();

vi.mock("../../api/_db-client.js", () => ({
	default: { from },
}));

vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	clean: (s: unknown, max = 2000) => String(s ?? "").slice(0, max),
	isAdmin: vi.fn(() => Promise.resolve(store.isAdmin)),
	checkUser: vi.fn(() => Promise.resolve({ ok: true })),
	ensureUser: vi.fn(),
	auditLog: vi.fn((actor: string, action: string, detail: string) => {
		store.audits.push({ actor, action, detail });
		return Promise.resolve(true);
	}),
	maskProfanity: (s: unknown) => String(s ?? ""),
	rateLimited: vi.fn(() => Promise.resolve(false)),
	rateLimitResponse: vi.fn((res: { status: (c: number) => { json: (b: unknown) => unknown } }) =>
		res.status(429).json({ error: "Too many requests" }),
	),
	// Default-allow session gate: the route under test binds writes to the
	// session, and these behavior tests do not model auth failures.
	verifyCallerIdentity: vi.fn(async () => ({ ok: true, callerId: "" })),
}));

vi.mock("../../api/_error.js", () => ({
	sanitizeError: (_res: unknown, err: unknown) => {
		throw err;
	},
}));

vi.mock("../../api/_events.js", () => ({
	emitEvent: vi.fn(() => Promise.resolve()),
	emitEventAndBridge: vi.fn(() => Promise.resolve()),
	EVENT_TYPES: { POST_STATUS_CHANGED: "POST_STATUS_CHANGED" },
}));

vi.mock("../../api/_follows.js", () => ({
	notifyFollowers: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../api/_email.js", () => ({
	sendPostSolvedEmail: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../api/_cache.js", () => ({
	// Faithful stub: staleWhileRevalidate returns a callable SWR wrapper that
	// also exposes .invalidate() — write paths in _posts.js call it.
	staleWhileRevalidate: vi.fn(() =>
		Object.assign(vi.fn(async () => []), { invalidate: vi.fn() }),
	),
	cacheClear: vi.fn(),
}));

vi.mock("../../api/_artifact-filter.js", () => ({
	isTestArtifact: () => false,
}));

// Real moderation: exercises the true fingerprint + verify logic.
vi.mock("../../api/_moderation.js", async (importOriginal) => {
	const real = (await importOriginal()) as Record<string, unknown>;
	return real;
});

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

function wire() {
	from.mockImplementation((table: string) => {
		if (table === "posts") {
			const chain: Record<string, unknown> = {};
			let sawNeq = false;
			chain.select = vi.fn(() => chain);
			chain.eq = vi.fn(() => chain);
			chain.neq = vi.fn(() => {
				sawNeq = true;
				return chain;
			});
			chain.order = vi.fn(() => chain);
			chain.limit = vi.fn(() => chain);
			chain.maybeSingle = vi.fn(async () => {
				if (sawNeq) {
					store.verifyCalls += 1;
					return { data: null, error: null }; // hidden: absent from public path
				}
				return { data: store.post, error: null };
			});
			chain.update = vi.fn((patch: unknown) => {
				store.updates.push(patch);
				return chain;
			});
			chain.single = vi.fn(async () => ({ data: (store.updates[0] ?? {}), error: null }));
			return chain;
		}
		// settings (modflag read + safety blocklist)
		const chain: Record<string, unknown> = {};
		let key = "";
		chain.select = vi.fn(() => chain);
		chain.eq = vi.fn((_c: string, v: string) => {
			key = v;
			return chain;
		});
		chain.delete = vi.fn(async () => ({ error: null }));
		chain.maybeSingle = vi.fn(async () => {
			if (key === "safety_repost_blocklist")
				return { data: { value: { items: store.blocklist } }, error: null };
			return { data: { value: { flags: ["privacy"] } }, error: null };
		});
		chain.upsert = vi.fn(async (row: { key: string; value: { items: unknown[] } }) => {
			if (row.key === "safety_repost_blocklist") store.blocklist = row.value.items;
			return { error: null };
		});
		return chain;
	});
}

const heldPost = {
	id: "p9",
	title: "My address is 12 Park Street, call 9876543210",
	description: "Please come to 12 Park Street and call me on 9876543210 today",
	category: "Facilities",
	author_id: "anon-7",
	status: "pending_review",
	progress: 10,
	status_history: [],
	created_at: new Date(Date.now() - 3600000).toISOString(),
	updated_at: new Date().toISOString(),
	hidden: false,
	deleted: false,
};

beforeEach(() => {
	vi.clearAllMocks();
	store.post = { ...heldPost };
	store.updates = [];
	store.blocklist = [];
	store.audits = [];
	store.verifyCalls = 0;
	store.isAdmin = true;
	wire();
});

describe("PUT /api/posts removal verification", () => {
	it("verifies a safety hide on the public path with evidence + fingerprint", async () => {
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			{ method: "PUT", query: {}, body: { id: "p9", hidden: true }, headers: {} },
			res,
		);
		expect(res.statusCode).toBe(200);
		const body = res.body as { verification?: { ok: boolean; exposure_ms: number; public_path_absent: boolean; proof: string } };
		expect(body.verification?.ok).toBe(true);
		expect(body.verification?.public_path_absent).toBe(true);
		expect(typeof body.verification?.exposure_ms).toBe("number");
		expect(store.verifyCalls).toBe(1);
		expect(
			store.audits.some(
				(a) =>
					(a as { action: string }).action === "post_removal_verified" &&
					(a as { detail: string }).detail.includes("p9"),
			),
		).toBe(true);
		// Safety-held post: text fingerprinted with the modflag rule.
		expect(store.blocklist).toHaveLength(1);
		expect((store.blocklist[0] as { rule: string }).rule).toBe("privacy");
	});

	it("fingerprints an edit blocked for PII so reposts are rejected", async () => {
		store.isAdmin = false;
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			{
				method: "PUT",
				query: {},
				body: {
					id: "p9",
					title: "New title",
					description: "Reach me at 12 Park Street or 9876543210",
				},
				headers: { "x-anon-id": "anon-7" },
			},
			res,
		);
		expect(res.statusCode).toBe(403);
		expect((res.body as { code: string }).code).toBe("PII_BLOCKED");
		expect(store.blocklist).toHaveLength(1);
	});

	it("leaves ordinary admin updates untouched (no verification field)", async () => {
		const { default: handler } = await import("../../api/_posts.js");
		const res = response();
		await handler(
			{ method: "PUT", query: {}, body: { id: "p9", status: "solved" }, headers: {} },
			res,
		);
		expect(res.statusCode).toBe(200);
		expect((res.body as { verification?: unknown }).verification).toBeUndefined();
		expect(store.verifyCalls).toBe(0);
	});
});
