// Anonymity guardian — clean schema stays silent; identity columns and
// masking regressions raise exactly one critical alert each.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFrom, mockAudit } = vi.hoisted(() => ({
	mockFrom: vi.fn(),
	mockAudit: vi.fn(async () => {}),
}));

vi.mock("../../api/_db-client.js", () => ({
	default: { from: mockFrom },
}));

vi.mock("../../api/_auth.js", () => ({
	auditLog: mockAudit,
}));

import { checkAnonymity } from "../../api/_anonymity.js";
import { maskPII } from "../../api/_moderation.js";

let alertRows: unknown[] = [];

function wire(
	row: unknown,
	mask: (s: string) => string = maskPII,
	commentRow: unknown = { id: "c1", body: "hello" },
) {
	alertRows = [];
	mockFrom.mockImplementation((table: string) => {
		if (table === "posts" || table === "comments") {
			const q: Record<string, unknown> = {};
			for (const m of ["select", "limit"]) {
				q[m] = vi.fn(() => q);
			}
			(q.maybeSingle as unknown) = vi.fn(async () => ({
				data: table === "posts" ? row : commentRow,
				error: null,
			}));
			return q;
		}
		const q: Record<string, unknown> = {};
		for (const m of ["select", "eq", "upsert"]) {
			q[m] = vi.fn(() => q);
		}
		(q.maybeSingle as unknown) = vi.fn(async () => ({
			data: { value: { alerts: alertRows } },
		}));
		(q.upsert as unknown) = vi.fn(async (r: { value: { alerts: unknown[] } }) => {
			alertRows = r.value.alerts;
			return { error: null };
		});
		return q;
	});
	return mask;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("checkAnonymity", () => {
	it("stays silent on a clean schema with a working mask", async () => {
		const mask = wire({ id: "p1", title: "t", author_id: "anon_x" });
		const client = (await import("../../api/_db-client.js")).default;
		const r = await checkAnonymity(client, mask);
		expect(r.ok).toBe(true);
		expect(r.findings).toHaveLength(0);
		expect(mockAudit).not.toHaveBeenCalled();
	});

	it("raises one critical alert per identity column found", async () => {
		const mask = wire({ id: "p1", ip_address: "1.2.3.4", session_id: "s" });
		const client = (await import("../../api/_db-client.js")).default;
		const r = await checkAnonymity(client, mask);
		expect(r.findings).toHaveLength(2);
		expect(
			alertRows.filter((a) => (a as { severity: string }).severity === "critical"),
		).toHaveLength(2);
		expect(mockAudit).toHaveBeenCalledTimes(1);
	});

	it("catches a masking regression", async () => {
		const mask = wire({ id: "p1", title: "t" }, (s: string) => s);
		const client = (await import("../../api/_db-client.js")).default;
		const r = await checkAnonymity(client, mask);
		expect(r.findings.some((f: { surface: string }) => f.surface === "maskPII")).toBe(true);
	});
});
