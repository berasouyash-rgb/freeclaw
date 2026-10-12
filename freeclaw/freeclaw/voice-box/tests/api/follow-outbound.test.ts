// ═══════════════════════════════════════════════════════════════════
// Follow fan-out — real SMS/email/in-app on followed-post events
// ═══════════════════════════════════════════════════════════════════
// Contract (api/_follows.js notifyFollowers, api/_dispatch.js channels):
//   1. An opted-in follower gets all three: in-app record + SMS + email.
//   2. A follower with status_updates:false gets NOTHING (no spam).
//   3. Follows on other posts are untouched.
//   4. Missing provider keys never block the in-app record (best-effort).
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	settings: [] as Array<Record<string, unknown>>,
}));

type Chain = Record<string, unknown> & {
	then: (fn: (v: unknown) => void) => void;
};

function chainFor(table: string): Chain {
	const filters: Array<[string, unknown]> = [];
	let ilikeF: [string, string] | null = null;
	let op: "select" | "upsert" = "select";
	let patch: Record<string, unknown> | null = null;
	let single = false;
	let limitN: number | null = null;
	const rows = () => state.settings;
	const matches = (r: Record<string, unknown>) =>
		filters.every(([c, v]) => r[c] === v) &&
		(ilikeF
			? String(r[ilikeF[0]] ?? "").startsWith(ilikeF[1].replace(/%/g, ""))
			: true);
	const self: Chain = {
		then(fn) {
			if (op === "upsert") {
				const row = { ...(patch ?? {}) };
				const idx = rows().findIndex((r) => r.key === row.key);
				if (idx >= 0) rows()[idx] = { ...rows()[idx], ...row };
				else rows().push(row);
				fn({ data: single ? row : [row], error: null });
				return;
			}
			let matched = rows().filter(matches);
			if (limitN !== null) matched = matched.slice(0, limitN);
			fn({ data: single ? (matched[0] ?? null) : matched, error: null });
		},
		select() {
			return self;
		},
		maybeSingle() {
			single = true;
			return self;
		},
		upsert(row: Record<string, unknown>) {
			op = "upsert";
			patch = row;
			return self;
		},
		eq(col: string, val: unknown) {
			filters.push([col, val]);
			return self;
		},
		ilike(col: string, val: string) {
			ilikeF = [col, val];
			return self;
		},
		limit(n: number) {
			limitN = n;
			return self;
		},
	};
	return self;
}

vi.mock("../../api/_db-client.js", () => ({
	default: { from: (table: string) => chainFor(table) },
}));

const dispatch = vi.hoisted(() => ({
	sendSms: vi.fn(async () => ({ ok: true, provider: "messagebird" })),
	sendEmail: vi.fn(async () => ({ ok: true, provider: "resend" })),
}));
vi.mock("../../api/_dispatch.js", () => dispatch);

function seed() {
	state.settings = [
		{ key: "follows:anon_a", value: { follows: ["p1"] } },
		{
			key: "notify_prefs:anon_a",
			value: {
				sms_enabled: true,
				phone: "+15551234567",
				email_enabled: true,
				email: "a@school.edu",
				status_updates: true,
			},
		},
		{ key: "follows:anon_b", value: { follows: ["p1"] } },
		{ key: "notify_prefs:anon_b", value: { status_updates: false } },
		{ key: "follows:anon_c", value: { follows: ["p2"] } },
	];
}

function notifsFor(id: string): Array<Record<string, unknown>> {
	const row = state.settings.find((r) => r.key === `notifications:${id}`);
	const v = row?.value as { notifications?: Array<Record<string, unknown>> } | undefined;
	return v?.notifications ?? [];
}

beforeEach(() => {
	vi.clearAllMocks();
	seed();
});

describe("notifyFollowers fan-out", () => {
	it("delivers in-app + SMS + email to an opted-in follower", async () => {
		const { notifyFollowers } = await import("../../api/_follows.js");
		await notifyFollowers("p1", {
			type: "post",
			title: "Solved!",
			body: "The lab taps are fixed.",
		});
		expect(notifsFor("anon_a")).toHaveLength(1);
		expect(notifsFor("anon_a")[0]).toMatchObject({ title: "Solved!" });
		expect(dispatch.sendSms).toHaveBeenCalledWith(
			"+15551234567",
			expect.stringContaining("Solved!"),
		);
		expect(dispatch.sendEmail).toHaveBeenCalledWith(
			"a@school.edu",
			"Solved!",
			expect.stringContaining("lab taps"),
		);
	});

	it("sends nothing anywhere to an opted-out follower", async () => {
		const { notifyFollowers } = await import("../../api/_follows.js");
		await notifyFollowers("p1", { type: "post", title: "Solved!", body: "x" });
		expect(notifsFor("anon_b")).toHaveLength(0);
		expect(dispatch.sendSms).toHaveBeenCalledTimes(1); // anon_a only
		expect(dispatch.sendEmail).toHaveBeenCalledTimes(1);
	});

	it("leaves followers of other posts untouched", async () => {
		const { notifyFollowers } = await import("../../api/_follows.js");
		await notifyFollowers("p1", { type: "post", title: "Solved!", body: "x" });
		expect(notifsFor("anon_c")).toHaveLength(0);
	});

	it("still stores in-app when the providers are down", async () => {
		dispatch.sendSms.mockResolvedValueOnce({
			ok: false,
			provider: "messagebird",
			error: "provider_500",
		});
		dispatch.sendEmail.mockResolvedValueOnce({
			ok: false,
			provider: "resend",
			error: "provider_500",
		});
		const { notifyFollowers } = await import("../../api/_follows.js");
		await expect(
			notifyFollowers("p1", { type: "post", title: "Solved!", body: "x" }),
		).resolves.toBeUndefined();
		expect(notifsFor("anon_a")).toHaveLength(1);
	});
});
