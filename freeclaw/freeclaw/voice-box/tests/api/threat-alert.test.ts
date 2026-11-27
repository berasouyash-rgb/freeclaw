/**
 * NAMED ADMIN ALERT on immediate-stop blocks.
 *
 * "I will kill Rahul" must do two things: stop (403 — already enforced
 * by POLICY) AND tell an admin WHO did it, with the words, so a human
 * can act fast. Strikes and fingerprints are not alerts: nothing pages
 * a human today when a threat is blocked at write time.
 *
 * `alertAdminThreat` writes ONE entry to the admin notification store
 * (`notifications:admin`, the same row the admin inbox reads), naming
 * the author's anonymous id and quoting the threat excerpt with the
 * matched flag types. It never throws and never blocks a publish path:
 * throttled to one alert per author per cooldown window so a looped
 * client cannot flood the admin inbox, and every failure resolves to
 * { alerted: false }.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, unknown>();
const upserts: string[] = [];

const dbMocks = vi.hoisted(() => ({
	from: vi.fn(),
}));

function defaultFrom(_table: string) {
	return {
		select: () => ({
			eq: (_col: string, key: string) => ({
				maybeSingle: async () => {
					if (store.has(key))
						return { data: { value: store.get(key) }, error: null };
					return { data: null, error: null };
				},
			}),
		}),
		upsert: async (row: { key: string; value: unknown }) => {
			store.set(row.key, row.value);
			upserts.push(row.key);
			return { data: null, error: null };
		},
	};
}

vi.mock("../../api/_db-client.js", () => ({
	default: {
		from: (...args: unknown[]) =>
			(dbMocks.from as (...a: unknown[]) => unknown)(...args),
	},
}));

import { alertAdminThreat } from "../../api/_moderation.js";

const THREAT = [{ type: "threat", severity: "critical", message: "x" }];
const VIOLENCE = [{ type: "violence", severity: "critical", message: "x" }];

beforeEach(() => {
	vi.clearAllMocks();
	store.clear();
	upserts.length = 0;
	dbMocks.from.mockImplementation(defaultFrom);
});

describe("threat blocks page a human", () => {
	it("writes a named alert with author, excerpt, and flag types", async () => {
		const r = await alertAdminThreat({
			surface: "post",
			authorId: "anon_attacker",
			excerpt: "I will kill Rahul tomorrow",
			flags: THREAT,
		});
		expect(r).toEqual({ alerted: true });
		expect(upserts).toContain("notifications:admin");
		const adminStore = store.get("notifications:admin") as {
			notifications: Array<{
				title: string;
				body: string;
				read: boolean;
			}>;
		};
		const entry = adminStore.notifications[0];
		expect(entry.title).toMatch(/threat/i);
		expect(entry.body).toContain("anon_attacker");
		expect(entry.body).toContain("I will kill Rahul tomorrow");
		expect(entry.body).toContain("threat");
		expect(entry.read).toBe(false);
		// Throttle marker is recorded so the next identical block stays quiet.
		expect(store.has("threat_alert:anon_attacker")).toBe(true);
	});

	it("alerts on violent content too, naming the surface", async () => {
		const r = await alertAdminThreat({
			surface: "comment",
			authorId: "anon_attacker",
			excerpt: "bring a knife to school tomorrow",
			flags: VIOLENCE,
		});
		expect(r).toEqual({ alerted: true });
		const adminStore = store.get("notifications:admin") as {
			notifications: Array<{ body: string }>;
		};
		expect(adminStore.notifications[0].body).toContain("comment");
	});

	it("a second block inside the cooldown window stays quiet", async () => {
		await alertAdminThreat({
			surface: "post",
			authorId: "anon_attacker",
			excerpt: "I will kill Rahul tomorrow",
			flags: THREAT,
		});
		const adminWrites = upserts.filter((k) => k === "notifications:admin");
		expect(adminWrites.length).toBe(1);
		const r = await alertAdminThreat({
			surface: "post",
			authorId: "anon_attacker",
			excerpt: "I will kill Rahul tomorrow again",
			flags: THREAT,
		});
		expect(r).toEqual({ alerted: false, reason: "cooldown" });
		expect(
			upserts.filter((k) => k === "notifications:admin").length,
		).toBe(1);
	});

	it("non-threat blocks never page anyone", async () => {
		for (const flags of [
			[{ type: "profanity", severity: "high", message: "x" }],
			[{ type: "privacy", severity: "critical", message: "x" }],
			[],
		]) {
			const r = await alertAdminThreat({
				surface: "post",
				authorId: "anon_x",
				excerpt: "something",
				flags,
			});
			expect(r.alerted).toBe(false);
		}
		expect(upserts).not.toContain("notifications:admin");
	});

	it("missing author never pages anyone", async () => {
		const r = await alertAdminThreat({
			surface: "post",
			authorId: "",
			excerpt: "I will kill Rahul",
			flags: THREAT,
		});
		expect(r).toEqual({ alerted: false, reason: "no-author" });
		expect(upserts).not.toContain("notifications:admin");
	});

	it("a dead database never breaks the publish path", async () => {
		dbMocks.from.mockImplementationOnce(() => {
			throw new Error("db down");
		});
		const r = await alertAdminThreat({
			surface: "post",
			authorId: "anon_x",
			excerpt: "I will kill Rahul tomorrow",
			flags: THREAT,
		});
		expect(r).toEqual({ alerted: false, reason: "error" });
	});
});
