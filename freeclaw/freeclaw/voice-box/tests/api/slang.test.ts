// Slang finder — detection only (never blocking; gates decide that).
// Locks: word boundaries (no "hello"→hell), multi-word phrases,
// Hinglish coverage, case-insensitivity, caps, and merge behavior.
import { describe, expect, it } from "vitest";

import { mergeSlang, scanSlang, slangSummary } from "../../api/_slang.js";

describe("scanSlang", () => {
  it("finds school slang with positions", () => {
    const hits = scanSlang("This canteen food sucks, what a dumb menu");
    expect(hits.map((h) => h.term).sort()).toEqual(["dumb", "sucks"]);
    expect(hits[0]).toMatchObject({ index: expect.any(Number) });
  });

  it("matches multi-word phrases", () => {
    expect(scanSlang("oh shut up already").map((h) => h.term)).toEqual(["shut up"]);
    expect(scanSlang("chup kar yaar").map((h) => h.term)).toEqual(["chup kar"]);
  });

  it("covers Hinglish code-mix case-insensitively", () => {
    expect(scanSlang("Warden Bilkul BEWAKOOF Hai").map((h) => h.term)).toEqual(["bewakoof"]);
    expect(scanSlang("yeh khana bakwas hai").map((h) => h.term)).toEqual(["bakwas"]);
  });

  it("never matches inside larger words", () => {
    expect(scanSlang("hello shell scholarly")).toEqual([]);
    expect(scanSlang("classic assignment")).toEqual([]);
  });

  it("returns empty for non-text", () => {
    expect(scanSlang("")).toEqual([]);
    expect(scanSlang(null)).toEqual([]);
    expect(scanSlang(undefined)).toEqual([]);
  });
});

describe("slangSummary + mergeSlang", () => {
  it("rolls up unique terms with counts", () => {
    const s = slangSummary("dumb dumb sucks");
    expect(s).toMatchObject({ count: 3, terms: ["dumb", "sucks"] });
  });

  it("merges across messages with caps", () => {
    const a = mergeSlang(null, "dumb menu");
    expect(a).toMatchObject({ count: 1, terms: ["dumb"], messages: 1 });
    const b = mergeSlang(a, "clean food today");
    expect(b).toEqual(a);
    const c = mergeSlang(b, "sucks badly");
    expect(c).toMatchObject({ count: 2, messages: 2 });
    expect(c.terms).toContain("sucks");
  });
});
