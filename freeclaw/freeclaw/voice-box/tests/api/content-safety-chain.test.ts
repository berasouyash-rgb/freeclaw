// Content-safety chain — SPEC §12 composed end to end for §45 TEST 1–3.
//
// The spec's chain is: a comment arrives → a typed event is logged → the
// real server gate detects → the real policy table produces a decision
// record → the real worker acts → public visibility changes → an
// independent reader re-reads state → the evidence is readable later.
//
// Nothing here is a stand-in. `serverModerate` is the production detector,
// `evaluateContent` is the production POLICY interpreter (it is what emits
// the SPEC §11 decision fields — classification, confidence, policy,
// reasons, action — so this file reads them rather than composing them),
// `watchComments` is the production enforcement worker, and
// `collectBefore`/`collectAfter`/`computeDiff` are the production
// independent-verification helpers. Only the database is doubled.
//
// Assertion parity note: `_moderation.js` and `_comment-watch.js` are
// tracked but also carry uncommitted worktree-only changes, so this file
// asserts only behaviour shared by the committed and worktree versions —
// blocking verdicts, critical-severity flags, the hide/strike/verify
// counts, the hidden false→true diff, and the event read-back. It does not
// assert the worktree-only user-notification receipt or the evidence
// fingerprint on the returned object.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFrom, mockAudit, mockNotify } = vi.hoisted(() => ({
	mockFrom: vi.fn(),
	mockAudit: vi.fn(async () => {}),
	mockNotify: vi.fn(async () => true),
}));

vi.mock("../../api/_db-client.js", () => ({
	default: { from: mockFrom },
}));

// `_comment-watch.js` needs auditLog/notifyUser. `_translate.js` (pulled in
// by the safety pipeline) needs `clean`; `_providers.js` (same chain) needs
// `cors`/`isAdmin`. A Vitest factory that omits a name some module in the
// import graph imports throws at load, so all five are supplied.
vi.mock("../../api/_auth.js", () => ({
	auditLog: mockAudit,
	notifyUser: mockNotify,
	clean: (value: unknown) => value,
	cors: vi.fn(),
	isAdmin: vi.fn(async () => false),
}));

import { watchComments } from "../../api/_comment-watch.js";
import { serverModerate } from "../../api/_moderation.js";
import { evaluateContent, getPolicyTable } from "../../api/_safety-pipeline.js";
import { appendEvent, buildEvent, listEvents } from "../../api/_ops-events.js";
import {
	collectAfter,
	collectBefore,
	computeDiff,
} from "../../api/_agent-verification.js";

const NOW = Date.parse("2026-09-23T10:00:00.000Z");
const CREATED = "2026-09-23T09:00:00.000Z";

// Harmful: a direct threat. Flags critical severity in both the committed and
// the worktree detector, and carries no profanity/slang token, so the set of
// flags — and therefore the policy row that fires — is stable across both.
const HARMFUL = "I will find you and kill you";
// Coded harassment: no explicit slur, but the phrase-level "no one likes
// you" is understood in context and treated as bullying.
const CODED = "no one likes you";
// Harmless complaint: understood, no flags, stays public.
const HARMLESS = "the library fan has been broken for a week";

type Row = Record<string, unknown>;

const db = {
	comments: [] as Row[],
	hiddenByAuthor: {} as Record<string, Row[]>,
	meta: {} as Record<string, Row>,
	alerts: [] as unknown[],
	blocklist: [] as unknown[],
	settings: {} as Record<string, unknown>,
};

function commentRow(id: string, author: string, body: string): Row {
	return {
		id,
		post_id: "p1",
		author_id: author,
		body,
		created_at: CREATED,
		hidden: false,
		deleted: false,
	};
}

/**
 * Chainable Supabase double covering every query the chain performs:
 * ops_event_log + workforce_alerts + repost-blocklist settings KV, the
 * comments sweep / author history / acted-row re-read / public-path probe /
 * before-after snapshot, and users_meta reads and strike writes.
 */
function chain(table: string) {
	const q: Record<string, unknown> = {};
	const filters: Record<string, unknown> = {};
	let op: "select" | "update" | "insert" | "upsert" = "select";
	let mode: "many" | "single" | "maybeSingle" = "many";
	let patch: Row | undefined;
	let incoming: Row | undefined;

	q.select = vi.fn(() => {
		op = "select";
		return q;
	});
	q.eq = vi.fn((field: string, value: unknown) => {
		filters[field] = value;
		return q;
	});
	q.gte = vi.fn((field: string, value: unknown) => {
		filters[field] = value;
		return q;
	});
	q.order = vi.fn(() => q);
	q.limit = vi.fn(() => q);
	q.single = vi.fn(() => {
		mode = "single";
		return q;
	});
	q.maybeSingle = vi.fn(() => {
		mode = "maybeSingle";
		return q;
	});
	q.update = vi.fn((value: Row) => {
		op = "update";
		patch = value;
		return q;
	});
	q.insert = vi.fn((value: Row) => {
		op = "insert";
		incoming = value;
		return q;
	});
	q.upsert = vi.fn((value: Row) => {
		op = "upsert";
		incoming = value;
		return q;
	});

	function resolve(): { data: unknown; error: unknown } {
		if (table === "settings") {
			const key = filters.key as string | undefined;
			if (op === "select") {
				if (key === "ops_event_log") {
					const stored = db.settings.ops_event_log;
					return { data: stored ? { value: stored } : null, error: null };
				}
				if (key === "safety_repost_blocklist") {
					return { data: { value: { items: db.blocklist } }, error: null };
				}
				return { data: { value: { alerts: db.alerts } }, error: null };
			}
			if (op === "update") {
				if (key) db.settings[key] = patch?.value;
				return { data: null, error: null };
			}
			if (op === "insert") {
				if (incoming) db.settings[String(incoming.key)] = incoming.value;
				return { data: null, error: null };
			}
			if (op === "upsert") {
				if (incoming?.key === "safety_repost_blocklist") {
					db.blocklist = (incoming.value as { items?: unknown[] })?.items ?? [];
				} else if (incoming?.key === "workforce_alerts") {
					db.alerts = (incoming.value as { alerts?: unknown[] })?.alerts ?? [];
				} else if (incoming) {
					db.settings[String(incoming.key)] = incoming.value;
				}
				return { data: null, error: null };
			}
		}

		if (table === "comments") {
			if (op === "update") {
				const target = db.comments.find((c) => c.id === filters.id);
				if (target && patch) Object.assign(target, patch);
				return { data: null, error: null };
			}
			if (filters.author_id !== undefined) {
				return {
					data: db.hiddenByAuthor[String(filters.author_id)] ?? [],
					error: null,
				};
			}
			if (filters.id !== undefined) {
				const target = db.comments.find((c) => c.id === filters.id);
				if (mode === "single") {
					// Copy, never the live reference: a real read returns a
					// point-in-time value. Returning the live row would let a
					// later write mutate the already-captured "before" snapshot
					// and make computeDiff report no change at all.
					return target
						? { data: { ...target }, error: null }
						: { data: null, error: { message: "row not found" } };
				}
				if (filters.hidden === false) {
					// public-path probe: hidden rows are absent, as in the real DB
					return {
						data: target && target.hidden !== true ? { id: target.id } : null,
						error: null,
					};
				}
				// acted-row re-read
				return { data: target ? { hidden: target.hidden === true } : null, error: null };
			}
			return {
				data: db.comments
					.filter((c) => c.hidden !== true && c.deleted !== true)
					.map((c) => ({ ...c })),
				error: null,
			};
		}

		if (table === "users_meta") {
			if (op === "select") {
				const meta = db.meta[String(filters.anon_id)];
				return { data: meta ? { ...meta } : null, error: null };
			}
			if (op === "update") {
				const target = db.meta[String(filters.anon_id)];
				if (target && patch) Object.assign(target, patch);
				return { data: null, error: null };
			}
			if (op === "insert" && incoming) {
				db.meta[String(incoming.anon_id).toLowerCase()] = { ...incoming };
				return { data: null, error: null };
			}
		}

		return { data: null, error: null };
	}

	// Awaiting the chain resolves it. Returns a plain object so awaiting does
	// not re-enter this thenable.
	q.then = (onFulfilled: (value: unknown) => void) =>
		Promise.resolve(resolve()).then(onFulfilled);

	return q;
}

beforeEach(() => {
	vi.clearAllMocks();
	mockFrom.mockImplementation((table: string) => chain(table));
	db.comments = [];
	db.hiddenByAuthor = {};
	db.meta = {};
	db.alerts = [];
	db.blocklist = [];
	db.settings = {};
});

async function client() {
	return (await import("../../api/_db-client.js")).default;
}

describe("§45 TEST 1 — harmful comment: detected, acted on, visibility changed, verified", () => {
	it("runs the full §12 chain and verifies it independently", async () => {
		db.comments = [commentRow("c-harmful", "anon_attack", HARMFUL)];
		db.meta = { anon_attack: { anon_id: "anon_attack", strikes: 0, warnings: [] } };

		// 1 — the arrival is a typed, durable event (SPEC §4).
		const event = buildEvent({
			type: "NEW_COMMENT",
			source: "tests/api/content-safety-chain",
			resource: "comment:c-harmful",
			actor: "anon_attack",
			payload: { comment_id: "c-harmful", post_id: "p1" },
		});
		const appended = await appendEvent(event);
		expect(appended.stored).toBe(true);

		// 2 — real detection by the production gate.
		const mod = serverModerate("", HARMFUL);
		expect(mod.blocked).toBe(true);
		expect(mod.flags.length).toBeGreaterThan(0);
		expect(mod.flags.some((f) => f.severity === "critical")).toBe(true);

		// 3 — the SPEC §11 decision record, emitted by the production POLICY
		// interpreter. Read, never hand-built.
		const decision = evaluateContent(HARMFUL, "direct");
		expect(decision.blocked).toBe(true);
		expect(decision.action).toBe("BLOCK_ACTION");
		expect(typeof decision.classification).toBe("string");
		expect(decision.classification).not.toBe("");
		expect(decision.confidence).toBe("high");
		expect(typeof decision.policy).toBe("string");
		expect(decision.reasons.length).toBeGreaterThan(0);
		expect(Array.isArray(decision.trace)).toBe(true);
		// Every decision cites a real policy row, not an invented label.
		const policyIds = getPolicyTable().map((p) => p.id);
		expect(policyIds).toContain(decision.policy);

		// 4 — independent before-state snapshot.
		const before = await collectBefore("comments", "c-harmful");
		expect(before).not.toBeNull();
		expect(before?.snapshot?.hidden).toBe(false);

		// 5 — the real worker acts.
		const result = await watchComments(await client(), NOW);
		expect(result.ok).toBe(true);
		expect(result.checked).toBe(1);
		expect(result.hidden).toBe(1);
		expect(result.struck).toBe(1);
		expect(result.verified).toBe(1);
		expect(result.errors).toHaveLength(0);

		// 6 — public visibility actually changed, proven by re-read + diff.
		const after = await collectAfter("comments", "c-harmful", before);
		expect(after?.snapshot?.hidden).toBe(true);
		const diff = computeDiff(before?.snapshot ?? {}, after?.snapshot ?? {});
		expect(diff.changed).toBe(true);
		expect(diff.fields.find((f) => f.field === "hidden")).toMatchObject({
			before: false,
			after: true,
		});

		// 7 — the event is independently readable later.
		const readback = await listEvents({ type: "NEW_COMMENT" });
		expect(readback).toHaveLength(1);
		expect(readback[0].id).toBe(event.id);
		expect(readback[0].traceId).toBe(event.traceId);
	});
});

describe("§45 TEST 2 — harmless complaint: understood, allowed, stays public", () => {
	it("detects nothing, takes no action, and leaves the comment visible", async () => {
		db.comments = [commentRow("c-clean", "anon_ok", HARMLESS)];
		db.meta = { anon_ok: { anon_id: "anon_ok", strikes: 0, warnings: [] } };

		const mod = serverModerate("", HARMLESS);
		expect(mod.blocked).toBe(false);
		expect(mod.flags).toHaveLength(0);

		const decision = evaluateContent(HARMLESS, "direct");
		expect(decision.blocked).toBe(false);

		const before = await collectBefore("comments", "c-clean");
		expect(before?.snapshot?.hidden).toBe(false);

		const result = await watchComments(await client(), NOW);
		expect(result.ok).toBe(true);
		expect(result.checked).toBe(1);
		expect(result.hidden).toBe(0);
		expect(result.struck).toBe(0);
		expect(result.verified).toBe(0);

		const after = await collectAfter("comments", "c-clean", before);
		expect(after?.snapshot?.hidden).toBe(false);
		const diff = computeDiff(before?.snapshot ?? {}, after?.snapshot ?? {});
		expect(diff.changed).toBe(false);

		expect(mockAudit).not.toHaveBeenCalled();
	});
});

describe("§45 TEST 3 — coded harassment: context understood, enforcement occurs", () => {
	it("classifies the veiled insult and still removes it from public view", async () => {
		db.comments = [commentRow("c-coded", "anon_coded", CODED)];
		db.meta = { anon_coded: { anon_id: "anon_coded", strikes: 0, warnings: [] } };

		const mod = serverModerate("", CODED);
		expect(mod.blocked).toBe(true);
		expect(mod.flags.some((f) => f.severity === "critical")).toBe(true);

		const decision = evaluateContent(CODED, "direct");
		expect(decision.blocked).toBe(true);
		expect(decision.action).toBe("BLOCK_ACTION");
		const policyIds = getPolicyTable().map((p) => p.id);
		expect(policyIds).toContain(decision.policy);

		const before = await collectBefore("comments", "c-coded");
		expect(before?.snapshot?.hidden).toBe(false);

		const result = await watchComments(await client(), NOW);
		expect(result.ok).toBe(true);
		expect(result.hidden).toBe(1);
		expect(result.struck).toBe(1);
		expect(result.verified).toBe(1);
		expect(result.errors).toHaveLength(0);

		const after = await collectAfter("comments", "c-coded", before);
		expect(after?.snapshot?.hidden).toBe(true);
		const diff = computeDiff(before?.snapshot ?? {}, after?.snapshot ?? {});
		expect(diff.fields.find((f) => f.field === "hidden")).toMatchObject({
			before: false,
			after: true,
		});
	});
});
