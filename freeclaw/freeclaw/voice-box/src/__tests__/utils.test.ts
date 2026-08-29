// ═══════════════════════════════════════════════════════════════════
// lib/utils.ts — pure utility functions
// ═══════════════════════════════════════════════════════════════════
// Locks the serialization/sanitization/formatting/CSV contracts used
// across the app (safeStringify, sanitize, sha256, timeAgo, fmtDate,
// trendingScore, downloadFile, toCSV + metadata tables).
// ═══════════════════════════════════════════════════════════════════

import { webcrypto } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
	CAT_EMOJI,
	CATEGORIES,
	downloadFile,
	errorText,
	fmtDate,
	isExecutableSuggestion,
	PRIORITY_META,
	STATUS_META,
	safeStringify,
	sanitize,
	sha256,
	suggestionEffect,
	timeAgo,
	toCSV,
	trendingScore,
} from "../lib/utils";
import type { PostData } from "../types";

describe("errorText — never allow an object to reach a React child", () => {
	it("passes strings through unchanged", () => {
		expect(errorText("boom")).toBe("boom");
	});

	it("normalizes object error payloads to their message field", () => {
		expect(errorText({ message: "rate limited", code: 429 })).toBe(
			"rate limited",
		);
		expect(errorText({ error: "nope" })).toBe("nope");
		expect(errorText({ reason: "blocked" })).toBe("blocked");
	});

	it("stringifies object payloads without a message field", () => {
		const out = errorText({ code: 500, detail: "x" });
		expect(out).toContain("500");
		expect(out).toContain("x");
	});

	it("uses Error.message and falls back to name", () => {
		expect(errorText(new Error("kaboom"))).toBe("kaboom");
		expect(errorText(new Error(""))).toBe("Error");
	});

	it("coerces primitives and null", () => {
		expect(errorText(42)).toBe("42");
		expect(errorText(true)).toBe("true");
		expect(errorText(null)).toBe("");
		expect(errorText(undefined)).toBe("");
	});

	it("never returns an object (the React-child crash guarantee)", () => {
		const evil = { message: { nested: true } };
		const out = errorText(evil);
		expect(typeof out).toBe("string");
		expect(out).toContain("nested");
	});
});

describe("safeStringify", () => {
	it("stringifies plain objects", () => {
		expect(safeStringify({ a: 1, b: "x" })).toBe('{"a":1,"b":"x"}');
	});

	it("replaces functions with a readable marker", () => {
		const out = safeStringify({
			fn: () => 1,
			named() {
				return 2;
			},
		});
		expect(out).toContain("[Function: fn]");
		expect(out).toContain("[Function: named]");
	});

	it("replaces undefined values with a marker", () => {
		expect(safeStringify({ u: undefined, ok: 1 })).toBe(
			'{"u":"[undefined]","ok":1}',
		);
	});

	it("handles circular references", () => {
		const obj: Record<string, unknown> = { a: 1 };
		obj.self = obj;
		expect(safeStringify(obj)).toContain("[Circular]");
	});

	it("applies indent", () => {
		expect(safeStringify({ a: 1 }, 2)).toContain("\n");
	});

	it("falls back to String() when JSON.stringify throws", () => {
		const evil = {
			toJSON: () => {
				throw new Error("boom");
			},
		};
		expect(safeStringify(evil)).toContain("[object Object]");
	});

	it("returns [Unserializable] when String() also throws", () => {
		const evil = {
			toJSON: () => {
				throw new Error("json");
			},
			toString: () => {
				throw new Error("str");
			},
		};
		expect(safeStringify(evil)).toBe("[Unserializable]");
	});
});

describe("sanitize", () => {
	it("strips HTML tags", () => {
		expect(sanitize("<script>alert(1)</script>hello")).toBe("alert(1)hello");
	});

	it("strips control characters", () => {
		expect(sanitize("a\u0000b\u001Fc")).toBe("abc");
	});

	it("truncates to max length", () => {
		expect(sanitize("abcdefghij", 4)).toBe("abcd");
	});

	it("coerces non-strings", () => {
		expect(sanitize(123 as unknown as string)).toBe("123");
	});
});

describe("sha256", () => {
	beforeAll(() => {
		// jsdom has no crypto.subtle — use Node's WebCrypto
		Object.defineProperty(globalThis, "crypto", {
			value: webcrypto,
			configurable: true,
		});
	});

	it("produces a 64-char hex digest", async () => {
		const h = await sha256("hello");
		expect(h).toMatch(/^[0-9a-f]{64}$/);
	});

	it("is deterministic", async () => {
		expect(await sha256("abc")).toBe(await sha256("abc"));
	});
});

describe("timeAgo", () => {
	it("returns unknown for invalid dates", () => {
		expect(timeAgo("not-a-date")).toBe("unknown");
	});

	it("returns just now under 60s", () => {
		expect(timeAgo(new Date().toISOString())).toBe("just now");
	});

	it("returns minutes for <1h", () => {
		expect(timeAgo(new Date(Date.now() - 5 * 60 * 1000).toISOString())).toBe(
			"5m ago",
		);
	});

	it("returns hours for <24h", () => {
		expect(timeAgo(new Date(Date.now() - 3 * 3600 * 1000).toISOString())).toBe(
			"3h ago",
		);
	});

	it("returns days for <7d", () => {
		expect(timeAgo(new Date(Date.now() - 2 * 86400 * 1000).toISOString())).toBe(
			"2d ago",
		);
	});

	it("returns a locale date beyond 7d", () => {
		const d = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
		const out = timeAgo(d);
		expect(out).toMatch(/[A-Za-z]{3}/);
		expect(out).not.toContain("ago");
	});
});

describe("fmtDate", () => {
	it("formats a date with month/day/hour/minute", () => {
		const out = fmtDate("2026-07-15T10:30:00Z");
		expect(out).toMatch(/Jul/i);
		expect(out).toMatch(/15/);
	});
});

describe("trendingScore", () => {
	const base: PostData = {
		id: "p1",
		type: "problem",
		title: "t",
		description: "d",
		category: "Other",
		priority: "medium",
		tags: [],
		image_url: null,
		author_id: "a",
		status: "reported",
		progress: 0,
		status_history: [],
		created_at: new Date(Date.now() - 3600 * 1000).toISOString(),
		updated_at: new Date().toISOString(),
		reactions: {},
		comment_count: 0,
		hidden: false,
		deleted: false,
	};

	it("weighs support, comments, and concerns with quality factors", () => {
		const fresh: PostData = {
			...base,
			reactions: { support: 10, concerned: 2 },
			comment_count: 5,
		};
		const score = trendingScore(fresh);
		// New formula applies commentRatio, diversityFactor, urgencyBonus, freshness
		expect(score).toBeGreaterThan(0);
	});

	it("gives higher score to posts with comments vs reactions-only", () => {
		const withComments: PostData = {
			...base,
			reactions: { support: 5 },
			comment_count: 5,
		};
		const withoutComments: PostData = {
			...base,
			reactions: { support: 5 },
			comment_count: 0,
		};
		// Posts with comments should score higher (commentRatio bonus)
		// But withoutComments has support*3 + comments*2.5 + concerns*1.5 = 15
		// withComments has support*3 + comments*2.5 + concerns*1.5 = 27.5
		// Both above threshold but withComments should be higher
		expect(trendingScore(withComments)).toBeGreaterThan(trendingScore(withoutComments));
	});

	it("penalizes spam-like posts (high support, zero comments)", () => {
		const spammy: PostData = {
			...base,
			reactions: { support: 15 },
			comment_count: 0,
		};
		const organic: PostData = {
			...base,
			reactions: { support: 5 },
			comment_count: 8,
		};
		// Spammy has support > 10 && comments === 0 => spamPenalty = 0.5
		// Organic has no penalty
		// Both have high engagement so both should trend, but organic should be higher
		expect(trendingScore(organic)).toBeGreaterThan(trendingScore(spammy));
	});

	it("handles missing reactions/comment_count", () => {
		const p: PostData = {
			...base,
			reactions: undefined,
			comment_count: undefined,
		};
		expect(trendingScore(p)).toBe(0);
	});

	it("returns 0 for posts below engagement threshold", () => {
		// Posts with < 4 total engagement don't trend
		const low: PostData = {
			...base,
			reactions: { support: 1 },
			comment_count: 0,
		};
		expect(trendingScore(low)).toBe(0);
	});

	it("posts with 1 like and 1 comment (engage=5) do trend", () => {
		const justEnough: PostData = {
			...base,
			reactions: { support: 1 },
			comment_count: 1,
		};
		const score = trendingScore(justEnough);
		expect(score).toBeGreaterThan(0);
	});
});

describe("downloadFile", () => {
	beforeAll(() => {
		// jsdom lacks URL.createObjectURL — stub it
		Object.defineProperty(URL, "createObjectURL", {
			value: vi.fn(() => "blob:fake"),
			configurable: true,
		});
		Object.defineProperty(URL, "revokeObjectURL", {
			value: vi.fn(),
			configurable: true,
		});
	});

	afterAll(() => {
		vi.restoreAllMocks();
	});

	it("creates a blob anchor and clicks it", () => {
		const click = vi.fn();
		document.createElement = vi.fn(
			() => ({ href: "", download: "", click }) as unknown as HTMLAnchorElement,
		) as typeof document.createElement;
		downloadFile("x.json", "{}");
		expect(click).toHaveBeenCalledTimes(1);
	});
});

describe("toCSV", () => {
	it("returns empty string for no rows", () => {
		expect(toCSV([])).toBe("");
	});

	it("returns empty string when the first row is falsy", () => {
		expect(toCSV([null as unknown as object])).toBe("");
	});

	it("emits header + rows with quoted escaping", () => {
		const csv = toCSV([
			{ name: 'a"b', n: 1 },
			{ name: "c", n: 2 },
		]);
		expect(csv.split("\n")[0]).toBe("name,n");
		expect(csv).toContain('"a""b"');
		expect(csv.split("\n")).toHaveLength(3);
	});

	it("stringifies object values as JSON (quote-escaped inside the cell)", () => {
		const csv = toCSV([{ meta: { x: 1 } }]);
		expect(csv).toContain('"{""x"":1}"');
	});

	it('wraps null as "null" (object branch) and undefined as empty', () => {
		const csv = toCSV([{ a: null, b: undefined }]);
		expect(csv).toContain('"null",""');
	});
});

describe("metadata tables", () => {
	it("exposes the 15 canonical categories", () => {
		expect(CATEGORIES).toHaveLength(15);
		expect(CATEGORIES).toContain("Academics");
		expect(CATEGORIES).toContain("Other");
	});

	it("maps an emoji for every category", () => {
		for (const c of CATEGORIES) expect(CAT_EMOJI[c]).toBeDefined();
	});

	it("defines status metadata for every status", () => {
		for (const s of [
			"reported",
			"verified",
			"in_progress",
			"waiting",
			"solved",
			"archived",
		]) {
			expect(STATUS_META[s]!.label).toBeTruthy();
			expect(STATUS_META[s]!.pct).toBeGreaterThanOrEqual(0);
		}
	});

	it("defines priority metadata for every priority", () => {
		for (const p of ["low", "medium", "high", "critical"]) {
			expect(PRIORITY_META[p]!.color).toMatch(/^#/);
		}
	});
});

describe("suggestionEffect — full consequence of approving a suggestion", () => {
	const c = (kind: string, content: Record<string, unknown>) => ({
		kind,
		content,
	});

	it("explains escalations with the target priority", () => {
		expect(
			suggestionEffect(
				c("escalation", { field: "priority", from: "medium", to: "critical" }),
			),
		).toContain("critical");
		expect(
			suggestionEffect(c("escalation", { field: "priority", to: "high" })),
		).toContain("high");
	});

	it("explains status changes and solved confirmations", () => {
		expect(
			suggestionEffect(
				c("status_change", {
					field: "status",
					from: "reported",
					to: "verified",
				}),
			),
		).toContain("verified");
		expect(
			suggestionEffect(c("solved_confirm", { field: "status", to: "solved" })),
		).toContain("solved");
	});

	it("explains official replies are public and editable", () => {
		const e = suggestionEffect(
			c("reply", { field: "admin_reply", from: "", to: "Thank you" }),
		);
		expect(e).toContain("public official reply");
		expect(e).toContain("edit the text");
	});

	it("explains merges keep the surviving post", () => {
		const e = suggestionEffect(
			c("merge", {
				field: "merged_into",
				to: "keep-id",
				keep_title: "Water leak at gate 3",
			}),
		);
		expect(e).toContain("Water leak at gate 3");
		expect(e).toContain("archived");
	});

	it("explains user warnings apply a strike + notify", () => {
		const e = suggestionEffect(
			c("user_warn", {
				field: "strikes",
				from: 2,
				to: 2,
				author_id: "anon_abc123def",
			}),
		);
		expect(e).toContain("warning");
		expect(e).toContain("strike");
		expect(e).toContain("notification");
	});

	it("explains suspensions are 7 days + notified", () => {
		const e = suggestionEffect(
			c("user_suspend", {
				field: "suspended_until",
				to: "+7 days",
				author_id: "anon_xyz",
			}),
		);
		expect(e).toContain("7 days");
		expect(e).toContain("notified");
	});

	it("explains comment hides keep the record", () => {
		expect(
			suggestionEffect(
				c("hide_comment", { field: "hidden", from: false, to: true }),
			),
		).toContain("record is kept");
	});

	it("counts the exact reports a resolve action will close", () => {
		const e = suggestionEffect(
			c("resolve_report", { field: "reports", report_ids: [1, 2, 3] }),
		);
		expect(e).toContain("3 pending reports");
	});

	it("is honest that review decisions touch nothing", () => {
		const e = suggestionEffect(
			c("review_decision", {
				field: "decision",
				from: "pending",
				to: "approve|reject",
			}),
		);
		expect(e).toContain("no content is touched");
		expect(e).toContain("Reports");
	});

	it("is honest that advisory kinds execute NO action (no fake completion)", () => {
		const e = suggestionEffect(c("enforcement", { from: "a", to: "b" }));
		expect(e).toContain("advisory");
		expect(e).toContain("no automatic action will be executed");
		expect(e).toContain("dismiss");
		// The old generic "applies the change... audit trail" claim is GONE for
		// non-executable kinds — approving them would be a silent no-op.
		expect(e).not.toContain("audit trail");
	});

	it("distinguishes executable kinds from advisory kinds", () => {
		expect(isExecutableSuggestion("escalation")).toBe(true);
		expect(isExecutableSuggestion("merge")).toBe(true);
		expect(isExecutableSuggestion("user_warn")).toBe(true);
		expect(isExecutableSuggestion("resolve_report")).toBe(true);
		expect(isExecutableSuggestion("review_decision")).toBe(true);
		// Free-text / LLM-invented kinds are advisory only
		expect(isExecutableSuggestion("enforcement")).toBe(false);
		expect(isExecutableSuggestion("policy")).toBe(false);
		expect(isExecutableSuggestion("stale_report")).toBe(false);
		expect(isExecutableSuggestion("trend")).toBe(false);
		expect(isExecutableSuggestion("")).toBe(false);
	});
});
