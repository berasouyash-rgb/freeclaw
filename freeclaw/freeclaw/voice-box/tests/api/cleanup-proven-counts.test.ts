import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	deleteError: null as null | { message: string },
	rows: [] as Array<Record<string, unknown>>,
	table: "comments",
}));

function from(table: string) {
	const query: Record<string, unknown> = {};
	const handler: ProxyHandler<Record<string, unknown>> = {
		get(_target, property) {
			const self = new Proxy(query, handler);
			if (property === "then") {
				return (resolve: (value: unknown) => unknown) => {
					if (query.__deleting) {
						void resolve({ data: null, error: state.deleteError });
						return;
					}
					if (query.__headCount) {
						void resolve({
							count: table === state.table ? state.rows.length : 0,
							error: null,
						});
						return;
					}
					void resolve({
						data: table === state.table ? state.rows : [],
						error: null,
					});
				};
			}
			if (property === "select") {
				return (_columns: unknown, options?: { head?: boolean }) => {
					query.__headCount = options?.head === true;
					return self;
				};
			}
			if (
				property === "eq" ||
				property === "in" ||
				property === "like" ||
				property === "lt" ||
				property === "lte" ||
				property === "limit" ||
				property === "order"
			) {
				return () => self;
			}
			if (property === "delete") {
				return () => {
					query.__deleting = true;
					return self;
				};
			}
			if (property === "insert" || property === "update" || property === "upsert") {
				return () => self;
			}
			if (property === "maybeSingle" || property === "single") {
				return async () => ({ data: null, error: null });
			}
			return () => self;
		},
	};
	return new Proxy(query, handler);
}

vi.mock("../../api/_db-client.js", () => ({ default: { from } }));
vi.mock("../../api/_auth.js", () => ({
	cors: vi.fn(),
	isAdmin: vi.fn(async () => true),
	auditLog: vi.fn(async () => ({})),
}));
vi.mock("../../api/_error.js", () => ({
	sanitizeError: vi.fn(),
}));

beforeEach(() => {
	vi.resetModules();
	state.deleteError = null;
	state.rows = [];
	state.table = "comments";
});

async function cleanup() {
	const { runCleanup } = await import("../../api/_cleanup.js");
	return runCleanup();
}

describe("cleanup janitor class toggles", () => {
  it("deletes gated rows on the success path (scope hoisted past pass 1)", async () => {
    state.table = "comments";
    state.rows = [{ id: "row-1" }];
    state.deleteError = null;
    const result = await cleanup();
    expect(result?.details?.deleted_comments).toBe(1);
  });
});

describe("cleanup proven counts", () => {
	it.each([
		["posts", "deleted_posts", { id: "row-1", deleted: true }],
		["comments", "deleted_comments", { id: "row-1", archived: true }],
		["reactions", "deleted_reactions", { id: "row-1" }],
		["chat_messages", "deleted_messages", { id: "row-1" }],
		["activity_logs", "deleted_logs", { id: "row-1" }],
		["agent_conversations", "deleted_conversations", { id: "row-1" }],
		["polls", "deleted_polls", { id: "row-1", archived: true }],
		["agent_executions", "pruned_executions", { id: "row-1" }],
		["agent_insights", "pruned_insights", { id: "row-1" }],
		[
			"poll_votes",
			"deleted_orphan_votes",
			{ id: "row-1", poll_id: "missing-poll" },
		],
		[
			"reactions",
			"deleted_orphan_reactions",
			{ id: "row-1", target_id: "missing-post", target_type: "post" },
		],
	])("does not count %s rows when delete fails", async (table, countKey, row) => {
		state.table = table;
		state.rows = [row];
		state.deleteError = { message: "delete failed" };

		const result = await cleanup();

		expect(result?.details?.[countKey]).toBeUndefined();
	});
});
