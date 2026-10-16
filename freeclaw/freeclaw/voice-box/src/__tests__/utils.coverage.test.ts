// ═══════════════════════════════════════════════════════════════════
// lib/utils.ts — branch coverage supplement
// ═══════════════════════════════════════════════════════════════════
// Extends utils.test.ts with the branches it leaves uncovered: cn,
// errorText fallbacks, safeStringify edge shapes, sanitize defaults,
// maskContactPreview edge shapes, sha256 known vectors, timeAgo
// boundaries, trendingScore factor tiers, presenceTier boundaries,
// downloadFile options, toCSV formula-injection guards, metadata
// tables, and suggestionEffect fallback branches. Pure unit tests only
// (no React rendering).
// ═══════════════════════════════════════════════════════════════════

import { webcrypto } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
	CATEGORIES,
	cn,
	dedupeById,
	downloadFile,
	errorText,
	EXECUTABLE_SUGGESTION_KINDS,
	isExecutableSuggestion,
	isTestAccount,
	maskContactPreview,
	PRESENCE_META,
	presenceTier,
	safeStringify,
	sanitize,
	sha256,
	suggestionEffect,
	timeAgo,
	toCSV,
	trendingScore,
} from "../lib/utils";
import type { PostData } from "../types";

function makePost(
	overrides: Partial<PostData> = {},
): PostData {
	return {
		id: "p1",
		type: "problem",
		title: "t",
		description: "d",
		category: "Other",
		status: "reported",
		priority: "medium",
		author_id: "a",
		created_at: new Date(Date.now() - 3600 * 1000).toISOString(),
		reactions: {},
		comment_count: 0,
		...overrides,
	};
}

describe("cn — tailwind-aware class merging", () => {
	it("should merge conflicting tailwind classes keeping the last", () => {
		expect(cn("px-2", "px-4")).toBe("px-4");
	});

	it("should join non-conflicting classes", () => {
		expect(cn("font-bold", "text-sm")).toBe("font-bold text-sm");
	});

	it("should support conditional and falsy inputs", () => {
		expect(cn("a", false && "b", undefined, null, "c")).toBe("a c");
	});

	it("should support object and array inputs", () => {
		expect(cn({ active: true, hidden: false }, ["extra"])).toBe(
			"active extra",
		);
	});

	it("should return empty string for no inputs", () => {
		expect(cn()).toBe("");
	});
});

describe("errorText — fallback branches", () => {
	it("should return the fallback message for an empty object payload", () => {
		expect(errorText({})).toBe(
			"Operation failed (no error details available)",
		);
	});

	it("should skip empty message strings and use the next field", () => {
		expect(errorText({ message: "", error: "fallback-err" })).toBe(
			"fallback-err",
		);
		expect(errorText({ message: "", error: "", reason: "why" })).toBe("why");
	});

	it("should stringify nested-object message payloads", () => {
		const out = errorText({ message: { nested: true } });
		expect(typeof out).toBe("string");
		expect(out).toContain("nested");
	});

	it("should fall back to Error name when message is empty", () => {
		const err = new Error("");
		err.name = "CustomName";
		expect(errorText(err)).toBe("CustomName");
	});

	it("should coerce zero and false primitives", () => {
		expect(errorText(0)).toBe("0");
		expect(errorText(false)).toBe("false");
	});

	it("should stringify array payloads", () => {
		const out = errorText(["a", "b"]);
		expect(out).toContain("a");
	});

	it("should return the fallback for payloads that stringify to empty shapes", () => {
		// {} stringifies to "{}", null/undefined markers hit the guard too.
		expect(errorText({})).toContain("Operation failed");
		expect(errorText([])).not.toBe("");
	});
});

describe("safeStringify — edge shapes", () => {
	it("should mark anonymous functions without a name", () => {
		const fn = (() => {
			const f = function () {
				return 1;
			};
			Object.defineProperty(f, "name", { value: "" });
			return f;
		})();
		expect(safeStringify({ fn })).toContain("[Function: anonymous]");
	});

	it("should stringify a top-level function value", () => {
		function namedTop() {
			return 1;
		}
		expect(safeStringify(namedTop)).toContain("[Function: namedTop]");
	});

	it("should handle nested circular references", () => {
		const inner: Record<string, unknown> = { x: 1 };
		const outer: Record<string, unknown> = { inner };
		(inner as Record<string, unknown>).back = outer;
		outer.self = outer;
		const out = safeStringify(outer);
		expect(out).toContain("[Circular]");
	});

	it("should stringify null and arrays", () => {
		expect(safeStringify(null)).toBe("null");
		expect(safeStringify([1, undefined])).toBe('[1,"[undefined]"]');
	});
});

describe("sanitize — defaults and coercions", () => {
	it("should truncate to the default 500 chars", () => {
		expect(sanitize("x".repeat(600))).toHaveLength(500);
	});

	it("should strip nested tags", () => {
		expect(sanitize("<div><p>hi</p></div>")).toBe("hi");
	});

	it("should strip vertical tab, form feed and unit separators", () => {
		expect(sanitize("abcd")).toBe("abcd");
	});

	it("should coerce nullish values to strings", () => {
		expect(sanitize(null as unknown as string)).toBe("null");
		expect(sanitize(undefined as unknown as string)).toBe("undefined");
	});

	it("should leave plain text untouched", () => {
		expect(sanitize("hello world")).toBe("hello world");
	});
});

describe("maskContactPreview — edge shapes", () => {
	it("should return empty string for nullish input", () => {
		expect(maskContactPreview(null as unknown as string)).toBe("");
		expect(maskContactPreview(undefined as unknown as string)).toBe("");
		expect(maskContactPreview("")).toBe("");
	});

	it("should mask single-char local parts but keep the domain", () => {
		const out = maskContactPreview("a@b.co wrote this");
		expect(out).toContain("@b.co");
		expect(out).not.toContain("a@b.co");
	});

	it("should leave domain-less addresses alone", () => {
		expect(maskContactPreview("mail me at john.doe here")).toBe(
			"mail me at john.doe here",
		);
	});

	it("should leave short digit runs alone", () => {
		expect(maskContactPreview("call 12345 now")).toBe("call 12345 now");
	});

	it("should cap long digit runs at 12 bullets", () => {
		const out = maskContactPreview("num 12345678901234567890 end");
		expect(out).not.toContain("12345678901234567890");
		expect(out).toContain("•".repeat(12));
	});

	it("should mask every email in multi-email text", () => {
		const out = maskContactPreview("a@x.com and long.name@y.org ok");
		expect(out).not.toContain("a@x.com");
		expect(out).not.toContain("long.name@");
		expect(out).toContain("@x.com");
		expect(out).toContain("@y.org");
	});
});

describe("dedupeById — edge shapes", () => {
	it("should keep a single item", () => {
		expect(dedupeById([{ id: "a" }])).toEqual([{ id: "a" }]);
	});

	it("should collapse an all-duplicate list to the first", () => {
		expect(
			dedupeById([
				{ id: "a", v: 1 },
				{ id: "a", v: 2 },
			]),
		).toEqual([{ id: "a", v: 1 }]);
	});
});

describe("sha256 — known vectors", () => {
	beforeAll(() => {
		Object.defineProperty(globalThis, "crypto", {
			value: webcrypto,
			configurable: true,
		});
	});

	it("should match the FIPS vector for 'abc'", async () => {
		expect(await sha256("abc")).toBe(
			"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
		);
	});

	it("should hash the empty string to its known digest", async () => {
		expect(await sha256("")).toBe(
			"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
		);
	});
});

describe("timeAgo — boundary branches", () => {
	it("should report just now at 0s and 59s", () => {
		expect(timeAgo(new Date(Date.now() - 1000).toISOString())).toBe(
			"just now",
		);
		expect(timeAgo(new Date(Date.now() - 59 * 1000).toISOString())).toBe(
			"just now",
		);
	});

	it("should flip to minutes at exactly 60s", () => {
		expect(timeAgo(new Date(Date.now() - 60 * 1000).toISOString())).toBe(
			"1m ago",
		);
	});

	it("should flip to hours at exactly 60min", () => {
		expect(timeAgo(new Date(Date.now() - 3600 * 1000).toISOString())).toBe(
			"1h ago",
		);
	});

	it("should flip to days at exactly 24h", () => {
		expect(timeAgo(new Date(Date.now() - 86400 * 1000).toISOString())).toBe(
			"1d ago",
		);
	});

	it("should render a locale date at exactly 7d", () => {
		const out = timeAgo(new Date(Date.now() - 604800 * 1000).toISOString());
		expect(out).not.toContain("ago");
		expect(out).toMatch(/[A-Za-z]{3}/);
	});

	it("should return unknown for the empty string", () => {
		expect(timeAgo("")).toBe("unknown");
	});
});

describe("trendingScore — factor tiers", () => {
	it("should apply the low-diversity penalty below 3 contributors", () => {
		const low = makePost({ reactions: { support: 2 }, comment_count: 0 });
		const mid = makePost({ reactions: { support: 2 }, comment_count: 1 });
		// low: engage=6, contributors=2 -> 0.7x; mid: engage=8.5, contributors=3 -> 1.0x
		expect(trendingScore(mid)).toBeGreaterThan(trendingScore(low));
	});

	it("should apply the full diversity bonus at 5+ contributors", () => {
		const mid = makePost({ reactions: { support: 2 }, comment_count: 2 });
		const wide = makePost({ reactions: { support: 4 }, comment_count: 2 });
		expect(trendingScore(wide)).toBeGreaterThan(trendingScore(mid));
	});

	it("should cap the urgency bonus for many concerns", () => {
		const some = makePost({
			reactions: { support: 5, concerned: 2 },
			comment_count: 2,
		});
		const many = makePost({
			reactions: { support: 5, concerned: 40 },
			comment_count: 2,
		});
		expect(trendingScore(many)).toBeGreaterThan(trendingScore(some));
		const capped = makePost({
			reactions: { support: 5, concerned: 80 },
			comment_count: 2,
		});
		// The urgency bonus caps at 1.3x, so piling on concerns shows
		// diminishing returns: the capped/many step is smaller than the
		// many/some step (concerns still add raw engagement weight).
		expect(trendingScore(capped) / trendingScore(many)).toBeLessThan(
			trendingScore(many) / trendingScore(some),
		);
	});

	it("should cap the comment-ratio bonus at 1.5x", () => {
		const heavy = makePost({ reactions: { support: 1 }, comment_count: 50 });
		const heavier = makePost({
			reactions: { support: 1 },
			comment_count: 100,
		});
		expect(trendingScore(heavier)).toBeGreaterThanOrEqual(
			trendingScore(heavy),
		);
	});

	it("should count legacy appreciate and downvote weights", () => {
		const legacy = makePost({
			reactions: { appreciate: 2 },
			comment_count: 0,
		});
		expect(trendingScore(legacy)).toBeGreaterThan(0);
		const withDown = makePost({
			reactions: { appreciate: 2, downvote: 1 },
			comment_count: 0,
		});
		expect(trendingScore(withDown)).toBeLessThan(trendingScore(legacy));
	});

	it("should not penalize up=10 with zero comments, but penalize up=11", () => {
		const edge = makePost({ reactions: { support: 10 }, comment_count: 0 });
		const over = makePost({ reactions: { support: 11 }, comment_count: 0 });
		// spamPenalty 0.5 halves the 11-up score below the 10-up score
		// despite higher raw engagement.
		expect(trendingScore(over)).toBeLessThan(trendingScore(edge));
	});

	it("should score older posts lower (freshness decay)", () => {
		const fresh = makePost({
			reactions: { support: 5 },
			comment_count: 2,
			created_at: new Date(Date.now() - 3600 * 1000).toISOString(),
		});
		const old = makePost({
			reactions: { support: 5 },
			comment_count: 2,
			created_at: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
		});
		expect(trendingScore(fresh)).toBeGreaterThan(trendingScore(old));
	});

	it("should floor the freshness window for future-dated posts", () => {
		const future = makePost({
			reactions: { support: 5 },
			comment_count: 2,
			created_at: new Date(Date.now() + 3600 * 1000).toISOString(),
		});
		expect(Number.isFinite(trendingScore(future))).toBe(true);
		expect(trendingScore(future)).toBeGreaterThan(0);
	});
});

describe("presenceTier — boundaries and metadata", () => {
	const NOW = new Date("2026-09-27T12:00:00.000Z").getTime();
	const iso = (ms: number) => new Date(ms).toISOString();

	it("should report now at age zero", () => {
		expect(presenceTier(iso(NOW), NOW)).toBe("now");
	});

	it("should flip to hour exactly at 2 minutes", () => {
		expect(presenceTier(iso(NOW - 2 * 60 * 1000), NOW)).toBe("hour");
	});

	it("should flip to today exactly at 60 minutes", () => {
		expect(presenceTier(iso(NOW - 60 * 60 * 1000), NOW)).toBe("today");
	});

	it("should flip to idle exactly at 24 hours", () => {
		expect(presenceTier(iso(NOW - 24 * 60 * 60 * 1000), NOW)).toBe("idle");
	});

	it("should treat empty strings as idle", () => {
		expect(presenceTier("", NOW)).toBe("idle");
	});

	it("should expose a label and color for every tier", () => {
		for (const tier of ["now", "hour", "today", "idle"] as const) {
			expect(PRESENCE_META[tier].label).toBeTruthy();
			expect(PRESENCE_META[tier].color).toMatch(/^var\(--vb-/);
		}
	});

	it("should reject non-string anon ids", () => {
		expect(isTestAccount(null)).toBe(false);
		expect(isTestAccount(123 as unknown as string)).toBe(false);
		expect(isTestAccount("")).toBe(false);
	});
});

describe("downloadFile — options and cleanup", () => {
	beforeAll(() => {
		if (!("createObjectURL" in URL)) {
			Object.defineProperty(URL, "createObjectURL", {
				value: vi.fn(() => "blob:fake"),
				configurable: true,
			});
		} else {
			Object.defineProperty(URL, "createObjectURL", {
				value: vi.fn(() => "blob:fake"),
				configurable: true,
			});
		}
		Object.defineProperty(URL, "revokeObjectURL", {
			value: vi.fn(),
			configurable: true,
		});
	});

	it("should revoke the object URL after clicking", () => {
		const click = vi.fn();
		document.createElement = vi.fn(
			() => ({ href: "", download: "", click }) as unknown as HTMLAnchorElement,
		) as typeof document.createElement;
		downloadFile("x.json", "{}");
		expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake");
	});

	it("should honor a custom mime type", () => {
		const create = URL.createObjectURL as unknown as ReturnType<typeof vi.fn>;
		create.mockClear();
		const click = vi.fn();
		document.createElement = vi.fn(
			() => ({ href: "", download: "", click }) as unknown as HTMLAnchorElement,
		) as typeof document.createElement;
		downloadFile("x.csv", "a,b", "text/csv");
		const blob = create.mock.calls[0][0] as Blob;
		expect(blob.type).toBe("text/csv");
	});

	it("should default to application/json", () => {
		const create = URL.createObjectURL as unknown as ReturnType<typeof vi.fn>;
		create.mockClear();
		const click = vi.fn();
		document.createElement = vi.fn(
			() => ({ href: "", download: "", click }) as unknown as HTMLAnchorElement,
		) as typeof document.createElement;
		downloadFile("x.json", "{}");
		const blob = create.mock.calls[0][0] as Blob;
		expect(blob.type).toBe("application/json");
	});
});

describe("toCSV — formula-injection guard", () => {
	it.each(["=1+1", "+cmd", "-x", "@user", "	text", "\rrow"])(
		"should single-quote-prefix values starting with %p",
		(prefix) => {
			const csv = toCSV([{ v: `${prefix}evil` }]);
			expect(csv).toContain(`"'${prefix}evil"`);
		},
	);

	it("should not prefix ordinary values", () => {
		expect(toCSV([{ v: "hello" }])).toBe('v\n"hello"');
	});

	it("should escape quotes before applying the formula guard", () => {
		const csv = toCSV([{ v: '="a"b' }]);
		expect(csv).toContain(`"'=`);
		expect(csv).toContain('""');
	});

	it("should serialize numbers and booleans as cells", () => {
		expect(toCSV([{ n: 7, ok: true }])).toBe('n,ok\n"7","true"');
	});

	it("should use the first row's keys for later rows (missing -> empty cell)", () => {
		expect(toCSV([{ a: 1 }, { b: 2 } as unknown as { a: number }])).toBe(
			'a\n"1"\n""',
		);
	});
});

describe("suggestionEffect — fallback branches", () => {
	it("should default escalation and status targets when content is missing", () => {
		expect(suggestionEffect({ kind: "escalation" })).toContain("critical");
		expect(suggestionEffect({ kind: "status_change" })).toContain("verified");
	});

	it("should describe merges without a kept title", () => {
		expect(suggestionEffect({ kind: "merge", content: {} })).toContain(
			"the kept post",
		);
	});

	it("should fall back to the title when author_id is missing", () => {
		const e = suggestionEffect({
			kind: "user_warn",
			title: "Spammer Sam",
			content: {},
		});
		expect(e).toContain("Spammer Sam");
	});

	it("should fall back to 'this user' with no id and no title", () => {
		expect(
			suggestionEffect({ kind: "user_suspend", content: {} }),
		).toContain("this user");
	});

	it("should slice long author ids to 12 chars", () => {
		const e = suggestionEffect({
			kind: "user_warn",
			content: { author_id: "anon_abcdefghijklmnopqrstuvwxyz" },
		});
		expect(e).toContain("anon_abcdef");
		expect(e).not.toContain("anon_abcdefghijklmnopqrstuvwxyz");
	});

	it("should ignore non-string author ids", () => {
		const e = suggestionEffect({
			kind: "user_warn",
			title: "Fallback Name",
			content: { author_id: 42 },
		});
		expect(e).toContain("Fallback Name");
	});

	it("should use singular wording for one resolved report", () => {
		const e = suggestionEffect({
			kind: "resolve_report",
			content: { report_ids: ["only"] },
		});
		expect(e).toContain("1 pending report");
		expect(e).not.toContain("reports");
	});

	it("should treat a non-array report_ids as a single report", () => {
		const e = suggestionEffect({
			kind: "resolve_report",
			content: { report_ids: "nope" },
		});
		expect(e).toContain("1 pending report");
	});

	it("should cover the generic executable fallback for future kinds", () => {
		EXECUTABLE_SUGGESTION_KINDS.add("future_kind");
		try {
			expect(
				suggestionEffect({
					kind: "future_kind",
					content: { from: "a", to: "b" },
				}),
			).toContain("a → b");
			expect(suggestionEffect({ kind: "future_kind", content: {} })).toContain(
				"approved action",
			);
		} finally {
			EXECUTABLE_SUGGESTION_KINDS.delete("future_kind");
		}
	});

	it("should classify every executable kind and reject unknowns", () => {
		for (const kind of [
			"status_change",
			"solved_confirm",
			"reply",
			"hide_comment",
			"user_suspend",
		]) {
			expect(isExecutableSuggestion(kind)).toBe(true);
		}
		expect(EXECUTABLE_SUGGESTION_KINDS.size).toBe(10);
		expect(isExecutableSuggestion("future_kind")).toBe(false);
	});

	it("should expose the canonical category list", () => {
		expect(CATEGORIES).toHaveLength(15);
	});
});
