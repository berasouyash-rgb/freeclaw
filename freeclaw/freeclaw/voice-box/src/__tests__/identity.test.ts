// ═══════════════════════════════════════════════════════════════════
// Frontend Identity Tests
// ═══════════════════════════════════════════════════════════════════
// Tests anonymous ID generation, localStorage helpers, cooldowns,
// and identity management utilities.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it } from "vitest";
import {
	anonCreatedAt,
	checkCooldown,
	clearAllLocalData,
	getAnonId,
	getDisplayName,
	getProfile,
	lsGet,
	lsSet,
	profileInitial,
	resetAnonId,
	resetDisplayName,
	setDisplayName,
	setProfile,
	stampCooldown,
} from "../lib/identity";

describe("Identity - Anonymous ID", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it("generates a valid anonymous ID", () => {
		const id = getAnonId();
		expect(id).toMatch(/^anon_[a-z0-9]+$/);
		expect(id.length).toBeGreaterThan(10);
	});

	it("returns the same ID on subsequent calls", () => {
		const id1 = getAnonId();
		const id2 = getAnonId();
		expect(id1).toBe(id2);
	});

	it("persists ID across calls", () => {
		const id1 = getAnonId();
		// Simulate page reload by clearing in-memory state
		localStorage.getItem("vb:anonId"); // verify it's stored
		const stored = localStorage.getItem("vb:anonId");
		expect(stored).toBe(id1);
	});

	it("generates IDs in lowercase", () => {
		const id = getAnonId();
		expect(id).toBe(id.toLowerCase());
	});

	it("has no two IDs the same (different instances)", () => {
		const id1 = getAnonId();
		// Clear and reset
		localStorage.clear();
		const id2 = getAnonId();
		expect(id1).not.toBe(id2);
	});

	it("normalizes an existing stored ID to lowercase", () => {
		localStorage.setItem("vb:anonId", "ANON_TEST_ID");
		localStorage.setItem("vb:anonCreated", new Date().toISOString());
		const id = getAnonId();
		expect(id).toBe("anon_test_id");
		expect(localStorage.getItem("vb:anonId")).toBe("anon_test_id");
	});
});

describe("Identity - Reset", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it("generates a new ID on reset", () => {
		const original = getAnonId();
		const newId = resetAnonId();
		expect(newId).not.toBe(original);
	});

	it("clears associated data on reset", () => {
		lsSet("vb:bookmarks", ["post_1", "post_2"]);
		lsSet("vb:recentlyViewed", ["post_3"]);
		lsSet("vb:drafts", { draft: "content" });

		resetAnonId();

		expect(lsGet("vb:bookmarks", null)).toBeNull();
		expect(lsGet("vb:recentlyViewed", null)).toBeNull();
		expect(lsGet("vb:drafts", null)).toBeNull();
	});
});

describe("Identity - Creation Timestamp", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it("returns a valid ISO date string", () => {
		getAnonId(); // Creates the timestamp
		const createdAt = anonCreatedAt();
		expect(() => new Date(createdAt)).not.toThrow();
		expect(new Date(createdAt).getTime()).toBeLessThanOrEqual(Date.now());
	});

	it("returns a date even if no ID exists", () => {
		const createdAt = anonCreatedAt();
		expect(() => new Date(createdAt)).not.toThrow();
	});
});

describe("Identity - Clear All Data", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it("clears all vb-prefixed keys", () => {
		// Use direct localStorage.setItem to avoid any interaction with getAnonId()
		localStorage.setItem("vb:bookmarks", JSON.stringify(["a"]));
		localStorage.setItem("vb:theme", JSON.stringify("dark"));
		localStorage.setItem("vb:notifications", JSON.stringify([]));
		localStorage.setItem("other_key", "value");

		clearAllLocalData();

		// After clearing, the keys should be removed
		expect(localStorage.getItem("vb:bookmarks")).toBeNull();
		expect(localStorage.getItem("vb:theme")).toBeNull();
		expect(localStorage.getItem("vb:notifications")).toBeNull();
		// Non-vb keys should remain
		expect(localStorage.getItem("other_key")).toBe("value");
	});
});

describe("Identity - localStorage Helpers", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it("lsGet returns fallback for missing key", () => {
		expect(lsGet("nonexistent", "default")).toBe("default");
	});

	it("lsGet returns stored values", () => {
		lsSet("test_key", { hello: "world" });
		expect(lsGet("test_key", null)).toEqual({ hello: "world" });
	});

	it("lsGet parses JSON correctly", () => {
		lsSet("number_key", 42);
		expect(lsGet("number_key", 0)).toBe(42);
	});

	it("lsGet returns fallback for malformed JSON", () => {
		localStorage.setItem("bad_json", "{invalid");
		expect(lsGet("bad_json", "fallback")).toBe("fallback");
	});

	it("lsSet stores JSON values", () => {
		lsSet("complex", { a: 1, b: [2, 3], c: { nested: true } });
		expect(lsGet("complex", null)).toEqual({
			a: 1,
			b: [2, 3],
			c: { nested: true },
		});
	});

	it("handles storage quota errors gracefully", () => {
		// Simulate storage full
		const originalSetItem = Storage.prototype.setItem;
		Storage.prototype.setItem = () => {
			throw new Error("QuotaExceededError");
		};

		// Should not throw
		expect(() => lsSet("key", "value")).not.toThrow();

		Storage.prototype.setItem = originalSetItem;
	});
});

describe("Identity - Cooldowns", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it("returns 0 for never-before-used action", () => {
		expect(checkCooldown("submit_post", 60)).toBe(0);
	});

	it("returns remaining seconds for active cooldown", () => {
		stampCooldown("submit_post");
		const remaining = checkCooldown("submit_post", 60);
		expect(remaining).toBeGreaterThan(0);
		expect(remaining).toBeLessThanOrEqual(60);
	});

	it("returns 0 when cooldown has expired", () => {
		// Stamp with a very old timestamp
		localStorage.setItem("vb:cd:test_action", String(Date.now() - 120000));
		const remaining = checkCooldown("test_action", 60);
		expect(remaining).toBe(0);
	});

	it("tracks different actions independently", () => {
		stampCooldown("action_a");
		stampCooldown("action_b");

		const remainingA = checkCooldown("action_a", 30);
		const remainingB = checkCooldown("action_b", 30);

		expect(remainingA).toBeGreaterThan(0);
		expect(remainingB).toBeGreaterThan(0);
	});
});

describe("Identity - Display name (optional, local only)", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it("returns an empty string when never set", () => {
		expect(getDisplayName()).toBe("");
	});

	it("stores and returns the display name", () => {
		setDisplayName("Alex");
		expect(getDisplayName()).toBe("Alex");
	});

	it("persists across calls (same storage key)", () => {
		setDisplayName("Sam");
		// fresh read path — the value comes back from storage, not memory
		expect(getDisplayName()).toBe("Sam");
	});

	it("trims surrounding whitespace", () => {
		setDisplayName("  Jordan  ");
		expect(getDisplayName()).toBe("Jordan");
	});

	it("caps the length at 24 characters", () => {
		setDisplayName("A name far too long to ever fit the header");
		expect(getDisplayName().length).toBeLessThanOrEqual(24);
	});

	it("rejects storing an empty name after trim (clears it)", () => {
		setDisplayName("Taylor");
		setDisplayName("   ");
		expect(getDisplayName()).toBe("");
	});

	it("resetDisplayName clears the stored name", () => {
		setDisplayName("Riley");
		resetDisplayName();
		expect(getDisplayName()).toBe("");
	});

	it("does not affect the anonymous ID", () => {
		const id = getAnonId();
		setDisplayName("Casey");
		expect(getAnonId()).toBe(id);
	});

	it("survives resetAnonId (name is optional, ID is the identity)", () => {
		setDisplayName("Morgan");
		resetAnonId();
		expect(getDisplayName()).toBe("Morgan");
	});

	it("never stores a name when storage is blocked (safe fallback)", () => {
		const originalGet = Storage.prototype.getItem;
		const originalSet = Storage.prototype.setItem;
		const originalRemove = Storage.prototype.removeItem;
		Storage.prototype.getItem = () => {
			throw new Error("blocked");
		};
		Storage.prototype.setItem = () => {
			throw new Error("blocked");
		};
		Storage.prototype.removeItem = () => {
			throw new Error("blocked");
		};
		try {
			expect(() => setDisplayName("Nobody")).not.toThrow();
			expect(() => getDisplayName()).not.toThrow();
		} finally {
			Storage.prototype.getItem = originalGet;
			Storage.prototype.setItem = originalSet;
			Storage.prototype.removeItem = originalRemove;
		}
	});
});	describe("local profile (avatar + photo + bio)", () => {
	beforeEach(() => localStorage.clear());

	it("defaults to an empty profile", () => {
		expect(getProfile()).toEqual({ avatar: "", bio: "", photo: "" });
	});

	it("round-trips a valid emoji avatar and bio", () => {
		setProfile({ avatar: "🦊", bio: "Night owl coder" });
		expect(getProfile()).toEqual({ avatar: "🦊", bio: "Night owl coder", photo: "" });
	});

	it("rejects non-emoji avatars and clamps the bio", () => {
		const clean = setProfile({ avatar: "not-an-emoji!", bio: "x".repeat(400) });
		expect(clean.avatar).toBe("");
		expect((clean.bio || "").length).toBe(160);
	});

	it("round-trips a data-URL profile photo and rejects non-images", () => {
		const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
		setProfile({ photo: dataUrl });
		expect(getProfile().photo).toBe(dataUrl);

		// non-image junk is rejected — and does NOT clobber the existing photo
		const clean = setProfile({ photo: "javascript:alert(1)" });
		expect(clean.photo).toBe(dataUrl);
		expect(getProfile().photo).toBe(dataUrl);

		// an explicit empty photo clears it
		const cleared = setProfile({ photo: "" });
		expect(cleared.photo).toBe("");
		expect(getProfile().photo).toBe("");
	});

	it("returns the first character as the initials fallback", () => {
		expect(profileInitial("Alice")).toBe("A");
		expect(profileInitial("")).toBe("•");
		expect(profileInitial("  ")).toBe("•");
	});

	it("ignores junk stored under the profile key", () => {
		localStorage.setItem("vb:profile", "{oops");
		expect(getProfile()).toEqual({ avatar: "", bio: "", photo: "" });
	});
});
