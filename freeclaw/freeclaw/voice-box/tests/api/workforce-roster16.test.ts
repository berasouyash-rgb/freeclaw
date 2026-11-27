// ═══════════════════════════════════════════════════════════════════
// Roster #15-16 — multilingual + search-intel lifecycle (spec §60)
// ═══════════════════════════════════════════════════════════════════
// Locks: both workers run observe→analyze→execute→verify→measure through
// runWorker against a mocked DB, translate only advisory content (the
// original post is never rewritten), verify re-reads persisted state, and
// healthy telemetry skips without acting. Uses synthetic-adjacent fixtures
// so no production state moves.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const kv = vi.hoisted(() => ({ store: new Map<string, unknown>() }));
const logs = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }));
const saved = vi.hoisted(() => ({ calls: [] as Array<unknown> }));
let logSeq = 0;

function activityQuery(filters: Record<string, unknown> = {}) {
	return {
		eq: (col: string, val: unknown) => {
			filters[col] = val;
			return activityQuery(filters);
		},
		limit: async () => ({
			data: logs.rows.filter((r) =>
				Object.entries(filters).every(([k, v]) => r[k] === v),
			),
			error: null,
		}),
	};
}

vi.mock("../../api/_db-client.js", () => ({
	default: {
		from: (table: string) => {
			if (table === "settings")
				return {
					select: () => ({
						eq: (_c: string, key: string) => ({
							maybeSingle: async () => ({
								data: kv.store.has(key) ? { value: kv.store.get(key) } : null,
								error: null,
							}),
						}),
					}),
					upsert: async (row: { key: string; value: unknown }) => {
						kv.store.set(row.key, row.value);
						return { error: null };
					},
				};
			if (table === "activity_logs")
				return {
					select: (_cols: string) => activityQuery(),
					// Chainable like the PostgREST builder: insert(..).select(..)
					insert: (row: Record<string, unknown>) => {
						logSeq += 1;
						const id = `log-${logSeq}`;
						logs.rows.push({ id, ...row });
						return {
							select: (_c: string) => Promise.resolve({ data: [{ id }], error: null }),
						};
					},
				};
			return {
				select: () => ({
					eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
					ilike: () => ({ limit: async () => ({ data: [{ id: "x" }], error: null }) }),
				}),
			};
		},
	},
}));

vi.mock("../../api/_auth.js", () => ({
	auditLog: vi.fn(async () => {}),
}));

vi.mock("../../api/_translate.js", () => ({
	detectLanguage: vi.fn((text: string) =>
		/HINDI/.test(text)
			? { ok: true, language: "hi", script: "Devanagari" }
			: { ok: true, language: "en", script: "Latin" },
	),
	translateText: vi.fn(async () => ({
		ok: true,
		title_translation: "Translated title",
		description_translation: "Translated body",
		provider: "mock",
	})),
	saveTranslation: vi.fn(async (...args: unknown[]) => {
		saved.calls.push(args);
		return { ok: true };
	}),
	getTranslation: vi.fn(async () => ({
		ok: true,
		translation: { title_translation: "Translated title" },
	})),
}));

vi.mock("../../api/_live-posts.js", () => ({
	readLivePosts: vi.fn(async () => ({
		ok: true,
		source: "supabase",
		posts: [
			{ id: "p-hi", title: "HINDI post", description: "HINDI body", category: "general", status: "open", created_at: "2026-09-22T09:00:00Z" },
			{ id: "p-en", title: "Broken projector", description: "Room 2B HDMI", category: "general", status: "open", created_at: "2026-09-22T09:05:00Z" },
		],
	})),
}));

vi.mock("../../api/_artifact-filter.js", () => ({
	isTestArtifact: vi.fn(() => false),
}));

const metrics = vi.hoisted(() => ({
	current: { total_searches: 100, zero_result_rate: "25%", latency: { avg: 800 } },
}));
vi.mock("../../api/_search-quality.js", () => ({
	calculateMetrics: vi.fn(() => metrics.current),
}));

import { getTranslation, saveTranslation } from "../../api/_translate.js";
import { readLedger, runWorker } from "../../api/_workforce-core.js";
import { resetSupervisorState } from "../../api/_worker-supervisor.js";
import "../../api/_workforce-workers.js";

beforeEach(() => {
	kv.store.clear();
	logs.rows.length = 0;
	saved.calls.length = 0;
	logSeq = 0;
	vi.clearAllMocks();
	resetSupervisorState();
});

describe("multilingual worker", () => {
	it("translates only the non-English post and verifies the persisted advisory", async () => {
		const row = await runWorker("multilingual", "test");
		expect(row.outcome).toBe("verified_success");
		expect(row.verification).toMatch(/1\/1 translations persisted/);
		// Advisory-only: exactly one translation saved, for the Hindi post.
		expect(saveTranslation).toHaveBeenCalledTimes(1);
		expect(saveTranslation).toHaveBeenCalledWith(
			"p-hi",
			expect.objectContaining({ language: "hi", provider: "mock" }),
		);
		expect(getTranslation).toHaveBeenCalledWith("p-hi");
		// Evidence + metrics recorded on the ledger row, not fabricated.
		const [ledger] = await readLedger(5);
		expect(ledger.worker_id).toBe("multilingual");
		expect(ledger.metrics).toMatchObject({ metric: "translations.stored", before: 0, after: 1 });
	});

	it("skips honestly when every post is already in English", async () => {
		const { readLivePosts } = await import("../../api/_live-posts.js");
		(readLivePosts as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			ok: true,
			source: "supabase",
			posts: [{ id: "p-en", title: "Broken projector", description: "Room 2B" }],
		});
		const row = await runWorker("multilingual", "test");
		expect(row.outcome).toBe("skipped");
		expect(saveTranslation).not.toHaveBeenCalled();
	});
});

describe("search-intel worker", () => {
	it("logs an advisory report when telemetry degrades and verifies the delta", async () => {
		const row = await runWorker("search-intel", "test");
		expect(row.outcome).toBe("verified_success");
		expect(row.verification).toMatch(/1 search-quality report\(s\) logged/);
		expect(row.action_type).toBe("search_quality_report");
		const [ledger] = await readLedger(5);
		expect(ledger.metrics).toMatchObject({ metric: "search.reports", before: 0, after: 1 });
	});

	it("skips without acting when telemetry is healthy", async () => {
		metrics.current = { total_searches: 100, zero_result_rate: "2%", latency: { avg: 120 } };
		const row = await runWorker("search-intel", "test");
		expect(row.outcome).toBe("skipped");
		expect(logs.rows).toHaveLength(0);
		metrics.current = { total_searches: 100, zero_result_rate: "25%", latency: { avg: 800 } };
	});
});
