// ═══════════════════════════════════════════════════════════════════
// Notification delivery ledger — bounded retry + independent verification
// ═══════════════════════════════════════════════════════════════════
// Locks the contract of api/_notification-delivery.js:
//   1. The store is `settings` keyed `notifications:<anonId>` — never a
//      phantom `notifications` table.
//   2. verifyNotificationStored is a real read-back, not the write's self-report.
//   3. A retry is only "delivered" when the read-back contains the id; a write
//      that reports success but does not persist is "failed", then "dead" after
//      MAX_DELIVERY_ATTEMPTS — never silently success.
//   4. recordPendingDelivery is idempotent on the notification id.
//   5. appendNotification refuses to blind-overwrite history when the current
//      store cannot be read, and never drops existing notifications.
//   6. A ledger that cannot be read is never overwritten (no data loss).
//   7. summarizeNotificationStore measures the real store and ignores the
//      dead-letter ledger key itself.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock is hoisted above imports, so all mutable state and the fake Supabase
// client must be created inside vi.hoisted.
const h = vi.hoisted(() => {
	const rows: any[] = [];
	const activityLogs: any[] = [];
	let failReadKeys = new Set<string>();
	let failUpsertKeys = new Set<string>();
	let silentUpsertKeys = new Set<string>();
	let likeError: string | null = null;

	function settingsQuery() {
		const q: any = {};
		q.eq = (_col: string, val: string) => ({
			maybeSingle: async () => {
				if (failReadKeys.has(val))
					return { data: null, error: { message: "read boom" } };
				const row = rows.find((r) => r.key === val);
				return { data: row ? { value: row.value } : null, error: null };
			},
		});
		q.like = (_col: string, pattern: string) => {
			const prefix = pattern.replace(/%$/, "");
			return {
				order: () => ({
					limit: async (n: number) => {
						if (likeError) return { data: null, error: { message: likeError } };
						return {
							data: rows
								.filter((r) => r.key.startsWith(prefix))
								.slice(0, n)
								.map((r) => ({ key: r.key, value: r.value })),
							error: null,
						};
					},
				}),
			};
		};
		return q;
	}

	const from = vi.fn((table: string) => {
		if (table === "activity_logs") {
			return {
				insert: async (row: any) => {
					activityLogs.push(row);
					return { error: null };
				},
			};
		}
		if (table === "settings") {
			return {
				select: () => settingsQuery(),
				upsert: async (row: any) => {
					if (failUpsertKeys.has(row.key))
						return { error: { message: "upsert boom" } };
					if (silentUpsertKeys.has(row.key))
						return { error: null }; // lies: reports success, writes nothing
					const i = rows.findIndex((r) => r.key === row.key);
					const stored = { ...row, updated_at: new Date().toISOString() };
					if (i >= 0) rows[i] = stored;
					else rows.push(stored);
					return { error: null };
				},
			};
		}
		throw new Error(`unexpected table ${table}`);
	});

	return {
		rows,
		activityLogs,
		from,
		reset() {
			rows.length = 0;
			activityLogs.length = 0;
			failReadKeys = new Set();
			failUpsertKeys = new Set();
			silentUpsertKeys = new Set();
			likeError = null;
		},
		failRead: (k: string) => failReadKeys.add(k),
		failUpsert: (k: string) => failUpsertKeys.add(k),
		silentUpsert: (k: string) => silentUpsertKeys.add(k),
		setLikeError: (m: string | null) => {
			likeError = m;
		},
	};
});

vi.mock("../../api/_db-client.js", () => ({ default: { from: h.from } }));

import {
	LEDGER_KEY,
	MAX_DELIVERY_ATTEMPTS,
	appendNotification,
	dispatchNotifications,
	readNotificationStore,
	recordPendingDelivery,
	retryPendingDeliveries,
	summarizeNotificationStore,
	verifyNotificationStored,
} from "../../api/_notification-delivery.js";

const USER = "anon_alice123";
const USER_KEY = `notifications:${USER}`;

function notif(id: string, read = false) {
	return { id, type: "info", title: "t", body: "b", read, created_at: "2026-01-01" };
}

function seedLedger(entries: any[]) {
	h.rows.push({ key: LEDGER_KEY, value: { entries } });
}

function pendingRec(id: string, anon = USER) {
	return {
		id: `dl_${id}`,
		anon_id: anon,
		entry: notif(id),
		reason: "notifyUser_write_failed",
		attempts: 0,
		status: "pending",
		first_failed_at: "2026-01-01",
		last_attempt_at: null,
	};
}

function ledgerEntries(): any[] {
	return h.rows.find((r) => r.key === LEDGER_KEY)?.value?.entries || [];
}

function storedIds(): string[] {
	return (
		h.rows.find((r) => r.key === USER_KEY)?.value?.notifications?.map((n: any) => n.id) || []
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	h.reset();
});

describe("notification store access", () => {
	it("reads the real settings store, not a notifications table", async () => {
		h.rows.push({ key: USER_KEY, value: { notifications: [notif("n1"), notif("n2")] } });
		const list = await readNotificationStore(USER);
		expect(list.map((n) => n.id)).toEqual(["n1", "n2"]);
		expect(h.from).toHaveBeenCalledWith("settings");
		expect(h.from).not.toHaveBeenCalledWith("notifications");
	});

	it("verifyNotificationStored is a real read-back (true present / false absent)", async () => {
		h.rows.push({ key: USER_KEY, value: { notifications: [notif("n1")] } });
		expect(await verifyNotificationStored(USER, "n1")).toBe(true);
		expect(await verifyNotificationStored(USER, "n2")).toBe(false);
	});

	it("never claims delivery when the read errors", async () => {
		h.rows.push({ key: USER_KEY, value: { notifications: [notif("n1")] } });
		h.failRead(USER_KEY);
		expect(await verifyNotificationStored(USER, "n1")).toBe(false);
	});
});

describe("appendNotification", () => {
	it("prepends and preserves existing history", async () => {
		h.rows.push({
			key: USER_KEY,
			value: { notifications: [notif("old1"), notif("old2")] },
		});
		expect(await appendNotification(USER, notif("new1"))).toBe(true);
		expect(storedIds()).toEqual(["new1", "old1", "old2"]);
	});

	it("refuses to overwrite history when the store cannot be read", async () => {
		const original = [notif("old1")];
		h.rows.push({ key: USER_KEY, value: { notifications: original } });
		h.failRead(USER_KEY);
		expect(await appendNotification(USER, notif("new1"))).toBe(false);
		// The read failed, so the real (unreadable) row must be untouched.
		expect(h.rows.find((r) => r.key === USER_KEY)!.value.notifications).toEqual(original);
	});

	it("is idempotent on the notification id (no duplicate prepend)", async () => {
		h.rows.push({ key: USER_KEY, value: { notifications: [notif("n1")] } });
		await appendNotification(USER, notif("n1"));
		expect(storedIds().filter((id) => id === "n1")).toHaveLength(1);
	});
});

describe("recordPendingDelivery", () => {
	it("appends a pending record and is idempotent on the id", async () => {
		expect(await recordPendingDelivery(USER, notif("n1"), "boom")).toBe(true);
		expect(await recordPendingDelivery(USER, notif("n1"), "boom")).toBe(true);
		const entries = ledgerEntries();
		expect(entries).toHaveLength(1);
		expect(entries[0].status).toBe("pending");
		expect(entries[0].attempts).toBe(0);
		expect(h.activityLogs.map((l) => l.action)).toEqual(["notification_dead_lettered"]);
	});

	it("does not record without a valid id", async () => {
		expect(await recordPendingDelivery(USER, { title: "x" } as any, "boom")).toBe(false);
		expect(ledgerEntries()).toHaveLength(0);
	});
});

describe("retryPendingDeliveries — independent verification", () => {
	it("delivers a pending notification and VERIFIES it via read-back", async () => {
		seedLedger([pendingRec("n1")]);
		const report = await retryPendingDeliveries();
		expect(report.retried).toBe(1);
		expect(report.delivered).toBe(1);
		expect(report.failed).toBe(0);
		expect(report.dead).toBe(0);
		expect(report.delivered_ids).toEqual(["n1"]);
		expect(storedIds()).toContain("n1");
		// Proven-delivered records are pruned from the ledger.
		expect(ledgerEntries()).toHaveLength(0);
		expect(h.activityLogs.map((l) => l.action)).toContain("notification_delivery_verified");
	});

	it("does NOT trust a write that reports success but does not persist", async () => {
		seedLedger([pendingRec("n1")]);
		h.silentUpsert(USER_KEY); // upsert returns {error:null} but writes nothing
		const report = await retryPendingDeliveries();
		expect(report.delivered).toBe(0);
		expect(report.failed).toBe(1);
		const rec = ledgerEntries()[0];
		expect(rec.status).toBe("pending");
		expect(rec.attempts).toBe(1);
		expect(h.activityLogs.map((l) => l.action)).not.toContain(
			"notification_delivery_verified",
		);
	});

	it("escalates to a dead letter after MAX_DELIVERY_ATTEMPTS and stops retrying", async () => {
		seedLedger([pendingRec("n1")]);
		h.silentUpsert(USER_KEY);
		for (let i = 0; i < MAX_DELIVERY_ATTEMPTS; i++) {
			const r = await retryPendingDeliveries();
			expect(r.retried).toBe(1);
		}
		const rec = ledgerEntries()[0];
		expect(rec.status).toBe("dead");
		expect(rec.attempts).toBe(MAX_DELIVERY_ATTEMPTS);
		expect(h.activityLogs.map((l) => l.action)).toContain("notification_delivery_dead");
		// A dead letter is no longer retried.
		const after = await retryPendingDeliveries();
		expect(after.retried).toBe(0);
		expect(after.dead).toBe(0);
	});

	it("counts are consistent: delivered + failed + dead === retried", async () => {
		seedLedger([pendingRec("good"), pendingRec("bad")]);
		h.silentUpsert(USER_KEY); // affects both, so both fail this pass
		const report = await retryPendingDeliveries();
		expect(report.retried).toBe(2);
		expect(report.delivered + report.failed + report.dead).toBe(report.retried);
	});

	it("respects the limit (bounded work per pass)", async () => {
		seedLedger([pendingRec("a"), pendingRec("b"), pendingRec("c")]);
		const report = await retryPendingDeliveries({ limit: 2 });
		expect(report.retried).toBe(2);
		expect(report.pending_after).toBe(1);
	});

	it("never overwrites a ledger it could not read", async () => {
		seedLedger([pendingRec("n1")]);
		h.failRead(LEDGER_KEY);
		const report = await retryPendingDeliveries();
		expect(report.ledger_ok).toBe(false);
		expect(report.retried).toBe(0);
		expect(ledgerEntries()).toHaveLength(1); // untouched
	});
});

describe("summarizeNotificationStore", () => {
	it("measures the real unread count and ignores the ledger key", async () => {
		h.rows.push({
			key: "notifications:anon_bob",
			value: { notifications: [notif("b1"), notif("b2", true)] },
		});
		h.rows.push({ key: USER_KEY, value: { notifications: [notif("a1", true)] } });
		h.rows.push({ key: LEDGER_KEY, value: { entries: [pendingRec("z")] } });
		const scan = await summarizeNotificationStore();
		expect(scan.read_error).toBeNull();
		expect(scan.stores_scanned).toBe(2); // ledger key excluded by prefix
		expect(scan.unread_total).toBe(1);
		expect(scan.users_with_unread).toBe(1);
	});

	it("reports a read error instead of a fake zero", async () => {
		h.setLikeError("nope");
		const scan = await summarizeNotificationStore();
		expect(scan.read_error).toBe("nope");
		expect(scan.unread_total).toBe(0);
	});
});

describe("dispatchNotifications — the notification-dispatcher agent's real output", () => {
	it("reports the real unread count and drains the ledger in one pass", async () => {
		h.rows.push({
			key: "notifications:anon_bob",
			value: { notifications: [notif("b1"), notif("b2", true)] },
		});
		seedLedger([pendingRec("n1")]);
		const result = await dispatchNotifications();
		expect(result.status).toBe("active");
		expect(result.unread_count).toBe(1);
		expect(result.stores_scanned).toBe(1);
		// The agent did real work, not a read-only count.
		expect(result.evidence.retry_delivered).toBe(1);
		expect(result.evidence.retry_delivered_ids).toEqual(["n1"]);
		expect(result.evidence.store).toBe("settings:notifications:*");
		expect(result.summary).toContain("delivered + read-back verified");
		expect(storedIds()).toContain("n1");
	});

	it("does not report a stale zero when the store read fails", async () => {
		h.setLikeError("db down");
		const result = await dispatchNotifications();
		expect(result.evidence.store_read_error).toBe("db down");
		expect(result.evidence.ledger_ok).toBe(true);
	});
});
