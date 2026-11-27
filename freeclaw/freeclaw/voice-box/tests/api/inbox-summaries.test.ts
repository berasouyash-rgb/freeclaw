// ═══════════════════════════════════════════════════════════════════
// Inbox summaries — persist + staleness (spec §11/§51)
// ═══════════════════════════════════════════════════════════════════
// summarizeThread persists non-empty summaries to the settings KV so the
// thread LIST shows each conversation's topic without re-running the LLM;
// empty results persist nothing. isSummaryStale marks rows whose thread
// moved after the summary, so the UI never presents stale work as current.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
	msgs: [] as Array<Record<string, unknown>>,
	upserts: [] as Array<Record<string, unknown>>,
}));

function chain(payload: unknown = { data: [], error: null }) {
	const q: Record<string, unknown> = {};
	const h: ProxyHandler<Record<string, unknown>> = {
		get(_t, p) {
			if (p === "then")
				return (res: (v: unknown) => unknown) => Promise.resolve(payload).then(res);
			if (p === "maybeSingle") return async () => ({ data: null, error: null });
			if (p === "upsert" || p === "insert")
				return async (row: Record<string, unknown>) => {
					db.upserts.push(row);
					return { data: null, error: null };
				};
			return (..._a: unknown[]) => new Proxy(q, h);
		},
	};
	return new Proxy(q, h);
}

vi.mock("../../api/_db-client.js", () => ({
	default: {
		from: (table: string) =>
			table === "chat_messages"
				? chain({ data: db.msgs, error: null })
				: chain({ data: [], error: null }),
	},
}));

vi.mock("../../api/_providers.js", () => ({
	callNvidiaFast: vi.fn(),
	callLLMChain: vi.fn(),
}));

import {
	callLLMChain,
	callNvidiaFast,
} from "../../api/_providers.js";
import { isSummaryStale, summarizeThread } from "../../api/_inbox.js";

const MSGS = [
	{ sender: "user", body: "The projector failed three times this week", created_at: "2026-09-01T10:00:00Z" },
	{ sender: "assistant", body: "Noted, checking related reports", created_at: "2026-09-01T10:01:00Z" },
];

beforeEach(() => {
	vi.clearAllMocks();
	db.msgs = [...MSGS];
	db.upserts = [];
});

describe("summarizeThread persistence", () => {
	it("persists a non-empty summary to the settings KV", async () => {
		(callNvidiaFast as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			text: JSON.stringify({
				summary: "Projector failed repeatedly",
				entities: ["projector"],
				resolution_state: "open",
			}),
		});
		const out = await summarizeThread("t1");
		expect(out.summary).toContain("Projector");
		const saved = db.upserts.find((r) => r.key === "inbox_summary:t1") as
			| { value?: { summary?: string; summarized_at?: string } }
			| undefined;
		expect(saved?.value?.summary).toContain("Projector");
		expect(saved?.value?.summarized_at).toBeTruthy();
		expect(callLLMChain).not.toHaveBeenCalled();
	});

	it("persists nothing when the model returns nothing", async () => {
		(callNvidiaFast as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
		(callLLMChain as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
		const out = await summarizeThread("t2");
		expect(out.summary).toBe("");
		expect(db.upserts.filter((r) => r.key === "inbox_summary:t2")).toHaveLength(0);
	});

	it("returns empty without calling anything on an empty thread", async () => {
		db.msgs = [];
		const out = await summarizeThread("t3");
		expect(out).toEqual({ summary: "", entities: [], resolution_state: "open" });
		expect(callNvidiaFast).not.toHaveBeenCalled();
	});
});

describe("isSummaryStale", () => {
	it("marks newer thread activity stale, older current", () => {
		expect(isSummaryStale("2026-09-02T10:00:00Z", "2026-09-01T10:00:00Z")).toBe(true);
		expect(isSummaryStale("2026-09-01T10:00:00Z", "2026-09-02T10:00:00Z")).toBe(false);
		expect(isSummaryStale("2026-09-01T10:00:00Z", "2026-09-01T10:00:00Z")).toBe(false);
	});

	it("treats missing timestamps as fresh (never fake staleness)", () => {
		expect(isSummaryStale(null, "2026-09-01T10:00:00Z")).toBe(false);
		expect(isSummaryStale("2026-09-01T10:00:00Z", null)).toBe(false);
	});
});
