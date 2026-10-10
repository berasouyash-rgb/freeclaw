// ═══════════════════════════════════════════════════════════════════
// Storage contract — "clear cache deletes nothing"
// ═══════════════════════════════════════════════════════════════════
// Platform guarantee: clearing cached images/files (the common "clear
// cache" tap) must never sign the user out, lose drafts, bookmarks, or
// settings. Those stores — Cache API, sessionStorage, IndexedDB — are the
// only ones a cache clear can touch, so user-critical data must never
// depend on them. This file pins that independence: with sessionStorage
// rigged to explode on ANY access and caches/indexedDB absent, identity,
// drafts, bookmarks, and settings must all keep working through
// localStorage (+ the identity cookie fallback).
//
// Legitimate sessionStorage uses (admin token, vote-dedupe flags, reload
// guard) are deliberately session-scoped and are NOT covered here.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAnonId,
  lsGet,
  lsSet,
  resetAnonId,
} from "../lib/identity";

function breakSessionStorage() {
  const bomb = () => {
    throw new Error("sessionStorage must never back user data");
  };
  Object.defineProperty(window, "sessionStorage", {
    value: new Proxy(
      {},
      {
        get: bomb,
        set: () => {
          throw new Error("sessionStorage must never back user data");
        },
      },
    ),
    configurable: true,
  });
}

beforeEach(() => {
  localStorage.clear();
  breakSessionStorage();
  delete (window as { caches?: unknown }).caches;
  delete (window as { indexedDB?: unknown }).indexedDB;
});

describe("storage contract — cache-clear survival", () => {
  it("mints a stable anonymous ID without volatile stores", () => {
    const first = getAnonId();
    expect(first).toMatch(/^anon_[a-z0-9]+$/);
    expect(getAnonId()).toBe(first);
  });

  it("round-trips drafts, bookmarks, and settings through localStorage", () => {
    lsSet("vb:drafts", [{ title: "t", body: "b" }]);
    lsSet("vb:bookmarks", ["post-1"]);
    lsSet("vb:theme", "dark");
    expect(lsGet("vb:drafts", [])).toEqual([{ title: "t", body: "b" }]);
    expect(lsGet("vb:bookmarks", [])).toEqual(["post-1"]);
    expect(lsGet("vb:theme", "light")).toBe("dark");
    // And they landed in real localStorage — the store a cache clear keeps.
    expect(JSON.parse(localStorage.getItem("vb:drafts") ?? "[]")).toEqual([
      { title: "t", body: "b" },
    ]);
  });

  it("reset issues a fresh ID that also survives", () => {
    const before = getAnonId();
    const next = resetAnonId();
    expect(next).not.toBe(before);
    expect(getAnonId()).toBe(next);
  });

  it("falls back to the identity cookie when localStorage is blocked", () => {
    const blocked = new Error("denied");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw blocked;
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw blocked;
    });
    try {
      const id = getAnonId();
      expect(id).toMatch(/^anon_[a-z0-9]+$/);
      // Cookie fallback keeps it stable across reads.
      expect(getAnonId()).toBe(id);
    } finally {
      vi.restoreAllMocks();
    }
  });
});
