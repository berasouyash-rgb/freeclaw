// Comment watch — abusive comments vanish with strikes, audit, alerts;
// clean comments and clean authors are never touched.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFrom, mockAudit, mockNotify } = vi.hoisted(() => ({
	mockFrom: vi.fn(),
	mockAudit: vi.fn(async () => {}),
	mockNotify: vi.fn(async () => true),
}));

vi.mock("../../api/_db-client.js", () => ({
	default: { from: mockFrom },
}));

vi.mock("../../api/_auth.js", () => ({
	auditLog: mockAudit,
	notifyUser: mockNotify,
}));

import { watchComments } from "../../api/_comment-watch.js";

const abusive = {
	id: "c1",
	post_id: "p1",
	author_id: "anon_bad",
	body: "You are an idiot and everyone hates you, I will post your nudes",
	created_at: new Date().toISOString(),
};
const clean = {
	id: "c2",
	post_id: "p1",
	author_id: "anon_ok",
	body: "Thanks for reporting this, I see the same issue near the library",
	created_at: new Date().toISOString(),
};
const borderline = {
	id: "c3",
	post_id: "p1",
	author_id: "anon_repeat",
	body: "You suck, shut up nobody wants you here",
	created_at: new Date().toISOString(),
};
const slangOnly = {
	id: "c4",
	post_id: "p1",
	author_id: "anon_slang",
	body: "this canteen food sucks, fix it",
	created_at: new Date().toISOString(),
};

const db: Record<string, unknown> = {
	comments: [],
	hiddenByAuthor: {},
	meta: {},
	alerts: [],
	blocklist: [],
	updates: [],
};

function chain() {
	const q: Record<string, unknown> = {};
	for (const m of ["select", "eq", "order", "limit", "upsert", "update", "insert", "gte"]) {
		q[m] = vi.fn(() => q);
	}
	return q;
}

function wire() {
	mockFrom.mockImplementation((t: string) => {
		if (t === "comments") {
			const q = chain();
			const resolveRows = () => {
				const calls = (q.eq as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
				const authorEq = calls.find((a) => a[0] === "author_id");
				const hiddenEq = calls.find((a) => a[0] === "hidden");
				if (authorEq && hiddenEq && hiddenEq[1] === true) {
					return (
						(db.hiddenByAuthor as Record<string, unknown[]>)[authorEq[1] as string] || []
					);
				}
				return db.comments;
			};
			(q.then as unknown) = (resolve: (v: unknown) => void) =>
				Promise.resolve({ data: resolveRows(), error: null }).then(resolve);
			(q.maybeSingle as unknown) = vi.fn(async () => {
				const calls = (q.eq as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
				const authorEq = calls.find((a) => a[0] === "author_id");
				const idEq = calls.find((a) => a[0] === "id");
				const publicEq = calls.find((a) => a[0] === "hidden" && a[1] === false);
				if (idEq) {
					// verify re-read: hidden only if we updated it
					const upd = (db.updates as Array<{ id: string }>).find(
						(u) => u.id === idEq[1],
					);
					if (publicEq) {
						// public-path check: hidden rows are invisible, like the real DB
						return upd ? { data: null, error: null } : { data: { id: idEq[1] }, error: null };
					}
					return upd
						? { data: { hidden: true }, error: null }
						: { data: { hidden: false }, error: null };
				}
				if (authorEq) {
					const rows =
						(db.hiddenByAuthor as Record<string, unknown[]>)[authorEq[1] as string] || [];
					return { data: rows, error: null };
				}
				return { data: db.comments, error: null };
			});
			(q.update as unknown) = vi.fn((patch: unknown) => ({
				eq: vi.fn(async (_col: string, id: string) => {
					(db.updates as Array<unknown>).push({ id, patch });
					return { error: null };
				}),
			}));
			return q;
		}
		if (t === "users_meta") {
			const q = chain();
			(q.maybeSingle as unknown) = vi.fn(async () => {
				const calls = (q.eq as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
				const authorEq = calls.find((a) => a[0] === "anon_id");
				const row = authorEq
					? (db.meta as Record<string, unknown>)[authorEq[1] as string]
					: null;
				return { data: row || null, error: null };
			});
			// Chainable like PostgREST (.update(patch).eq(...)) AND persistent,
			// so strike-ladder writes are observable on re-read.
			(q.update as unknown) = vi.fn((patch: unknown) => ({
				eq: vi.fn(async (col: string, val: string) => {
					if (col === "anon_id") {
						const row = (db.meta as Record<string, Record<string, unknown>>)[val];
						if (row) Object.assign(row, patch);
					}
					return { error: null };
				}),
			}));
			(q.insert as unknown) = vi.fn(async () => ({ error: null }));
			return q;
		}
		// settings (alerts + safety blocklist, routed by key)
		const q = chain();
		(q.maybeSingle as unknown) = vi.fn(async () => {
			const calls = (q.eq as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
			const keyEq = calls.find((a) => a[0] === "key");
			if (keyEq && keyEq[1] === "safety_repost_blocklist") {
				return { data: { value: { items: db.blocklist } }, error: null };
			}
			return { data: { value: { alerts: db.alerts } }, error: null };
		});
		(q.upsert as unknown) = vi.fn(async (row: { key: string; value: { alerts?: unknown[]; items?: unknown[] } }) => {
			if (row.key === "safety_repost_blocklist") db.blocklist = row.value.items || [];
			else db.alerts = row.value.alerts;
			return { error: null };
		});
		return q;
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	db.comments = [];
	db.hiddenByAuthor = {};
	db.meta = {};
	db.alerts = [];
	db.blocklist = [];
	db.updates = [];
});

describe("watchComments", () => {
	it("hides an abusive comment, strikes, alerts, audits, verifies", async () => {
		db.comments = [abusive, clean];
		db.meta = { anon_bad: { anon_id: "anon_bad", strikes: 0, warnings: [] } };
		wire();
		const client = (await import("../../api/_db-client.js")).default;
		const r = await watchComments(client, Date.now());
		expect(r.ok).toBe(true);
		expect(r.checked).toBe(2);
		expect(r.hidden).toBe(1);
		expect(r.verified).toBe(1);
		expect(r.struck).toBe(1);
		expect(mockAudit).toHaveBeenCalledTimes(1);
		const auditDetail = String(mockAudit.mock.calls[0]?.[2] || "");
		expect(auditDetail).toContain("[rule=");
		expect(auditDetail).toContain("exposure_ms=");
		expect(auditDetail).toContain("public=absent");
		expect(r.errors).toHaveLength(0);
		expect(r.evidence).toHaveLength(1);
		expect(r.evidence[0]).toMatchObject({
			comment_id: "c1",
			post_id: "p1",
			verify: { row_hidden: true, public_path_absent: true },
		});
		expect(typeof r.evidence[0].exposure_ms).toBe("number");
		expect(
			(db.alerts as Array<{ key: string }>).some((a) => a.key === "comment-watch:c1"),
		).toBe(true);
		// RECEIPT: the struck author gets a persistent enforcement notice.
		expect(mockNotify).toHaveBeenCalledTimes(1);
		expect(mockNotify).toHaveBeenCalledWith(
			"anon_bad",
			"warning",
			"Comment removed — strike issued",
			expect.stringContaining("strike 1"),
		);
		const receiptBody = String(mockNotify.mock.calls[0]?.[3] || "");
		expect(receiptBody).toMatch(/violence|hate_speech|bullying|explicit|privacy|threat/);
		expect(receiptBody).toContain("3 strikes in 7 days");
	});

	it("leaves clean comments and clean authors alone", async () => {
		db.comments = [clean];
		wire();
		const client = (await import("../../api/_db-client.js")).default;
		const r = await watchComments(client, Date.now());
		expect(r.hidden).toBe(0);
		expect(r.struck).toBe(0);
		expect(mockAudit).not.toHaveBeenCalled();
		expect(mockNotify).not.toHaveBeenCalled();
		expect(db.alerts).toHaveLength(0);
	});

	it("hides borderline abuse from a repeat offender", async () => {
		db.comments = [borderline];
		db.hiddenByAuthor = { anon_repeat: [{ id: "old1" }, { id: "old2" }] };
		db.meta = { anon_repeat: { anon_id: "anon_repeat", strikes: 1, warnings: [] } };
		wire();
		const client = (await import("../../api/_db-client.js")).default;
		const r = await watchComments(client, Date.now());
		expect(r.hidden).toBe(1);
		expect(r.verified).toBe(1);
	});

	it("names suspension in the receipt when the ladder escalates", async () => {
		db.comments = [borderline];
		const recent = new Date().toISOString();
		db.hiddenByAuthor = { anon_repeat: [{ id: "old1" }, { id: "old2" }] };
		db.meta = {
			anon_repeat: {
				anon_id: "anon_repeat",
				strikes: 2,
				warnings: [
					{ text: "w1", at: recent, source: "comment-watch" },
					{ text: "w2", at: recent, source: "comment-watch" },
				],
			},
		};
		wire();
		const client = (await import("../../api/_db-client.js")).default;
		const r = await watchComments(client, Date.now());
		expect(r.hidden).toBe(1);
		expect(r.verified).toBe(1);
		expect(mockNotify).toHaveBeenCalledWith(
			"anon_repeat",
			"warning",
			"Account temporarily suspended",
			expect.stringContaining("strike 3"),
		);
	});

	it("deletes pure slang on sight — hidden, struck, receipted, no report needed", async () => {
		db.comments = [slangOnly];
		db.meta = { anon_slang: { anon_id: "anon_slang", strikes: 0, warnings: [] } };
		wire();
		const client = (await import("../../api/_db-client.js")).default;
		const r = await watchComments(client, Date.now());
		expect(r.checked).toBe(1);
		expect(r.hidden).toBe(1);
		expect(r.verified).toBe(1);
		expect(r.struck).toBe(1);
		expect(r.errors).toHaveLength(0);
		expect(mockNotify).toHaveBeenCalledWith(
			"anon_slang",
			"warning",
			"Comment removed — strike issued",
			expect.stringContaining("strike 1"),
		);
		expect(mockAudit).toHaveBeenCalledTimes(1);
	});

	it("fingerprints confirmed-removed text so trivial reposts are blocked", async () => {
		db.comments = [abusive];
		db.meta = { anon_bad: { anon_id: "anon_bad", strikes: 0, warnings: [] } };
		wire();
		const client = (await import("../../api/_db-client.js")).default;
		const r = await watchComments(client, Date.now());
		expect(r.verified).toBe(1);
		const { checkSafetyRepost } = await import("../../api/_moderation.js");
		// Same body, different case/spacing/punctuation → still matches.
		const evaded = await checkSafetyRepost(
			client,
			abusive.body.toUpperCase().replace(/ /g, "   ") + "!!!",
		);
		expect(evaded.blocked).toBe(true);
		expect(evaded.attempts).toBe(1);
		// Unrelated clean text is unaffected.
		const cleanHit = await checkSafetyRepost(client, clean.body);
		expect(cleanHit.blocked).toBe(false);
	});
});
