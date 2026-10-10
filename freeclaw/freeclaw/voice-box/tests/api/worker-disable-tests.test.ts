// ═══════════════════════════════════════════════════════════════════
// Worker disable tests — spec §45: every worker names what measurably
// degrades if it is disabled for 24 hours.
// ═══════════════════════════════════════════════════════════════════
// Locks api/_worker-disable-tests.js coverage: every core-registered and
// every deterministic registry worker has a written, falsifiable disable
// consequence (criterion 14), and no entry points at a removed worker.
// ═══════════════════════════════════════════════════════════════════

import { describe, expect, it, vi } from "vitest";

vi.mock("../../api/_db-client.js", () => ({
	default: {
		from: () => ({
			select: () => ({
				eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
			}),
			upsert: async () => ({ error: null }),
			insert: async () => ({ error: null }),
		}),
	},
}));

vi.mock("../../api/_auth.js", () => ({
	auditLog: vi.fn(async () => {}),
}));

import { WORKERS as REGISTRY_WORKERS } from "../../api/_automation-registry.js";
import { DISABLE_TESTS } from "../../api/_worker-disable-tests.js";
import { getRegistry } from "../../api/_workforce-core.js";
import "../../api/_workforce-workers.js";

describe("disable-test registry coverage", () => {
	it("covers every core-registered worker with a falsifiable consequence", () => {
		const specs = getRegistry() as Array<{ worker_id: string }>;
		const ids = specs.map((s) => s.worker_id);
		expect(ids.length).toBeGreaterThan(0);
		const missing = ids.filter((id) => typeof DISABLE_TESTS[id] !== "string");
		expect(missing).toEqual([]);
		for (const id of ids) {
			const text = DISABLE_TESTS[id] as string;
			expect(text.length).toBeGreaterThanOrEqual(40);
			expect(text).toMatch(/24h/);
		}
	});

	it("covers every deterministic registry worker", () => {
		const missing = (REGISTRY_WORKERS as Array<{ id: string }>)
			.map((w) => w.id)
			.filter((id) => typeof DISABLE_TESTS[id] !== "string");
		expect(missing).toEqual([]);
	});

	it("has no orphan entries for removed workers", () => {
		const known = new Set([
			...(getRegistry() as Array<{ worker_id: string }>).map((s) => s.worker_id),
			...(REGISTRY_WORKERS as Array<{ id: string }>).map((w) => w.id),
		]);
		const orphans = Object.keys(DISABLE_TESTS).filter((id) => !known.has(id));
		expect(orphans).toEqual([]);
	});
});
