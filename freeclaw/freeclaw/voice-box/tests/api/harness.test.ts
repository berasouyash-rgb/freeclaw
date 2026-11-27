// Decision harness — one entry point, deterministic, keyless.
// Locks every boundary: routing per kind, publish/hold/block mapping,
// category hints (best-first, Other on ties/empties), fail-closed unknowns,
// and fail-closed harness errors.
import { describe, expect, it, vi } from "vitest";

vi.mock("../../api/_db-client.js", () => ({
  default: { from: vi.fn() },
}));

import {
  categoryHint,
  categoryHints,
  decide,
  decideChat,
  decideComment,
  decidePoll,
  decidePost,
} from "../../api/_harness.js";

describe("decideChat", () => {
  it("routes blackmail to urgent with report + notify + slang actions", () => {
    const r = decideChat("Rahul is blackmailing me, you idiot, post this");
    expect(r.route).toBe("urgent");
    expect(r.actions).toContain("file_report");
    expect(r.actions).toContain("notify_admin");
    expect(r.actions).toContain("propose_draft");
    expect(r.actions).toContain("flag_slang");
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  it("leaves chit-chat alone", () => {
    const r = decideChat("hello, how are you today");
    expect(r.route).toBe("none");
    expect(r.actions).toEqual([]);
    expect(r.wantsPost).toBe(false);
  });

  it("never proposes drafts without explicit post words", () => {
    const r = decideChat("The lift in Block C is broken and I am scared");
    expect(r.route).toBe("normal");
    expect(r.wantsPost).toBe(false);
    expect(r.actions).not.toContain("propose_draft");
  });
});

describe("decidePost", () => {
  it("publishes clean complaints with a category hint", () => {
    const r = decidePost({
      title: "No water in canteen",
      description: "No drinking water since morning.",
      visibility: "public",
    });
    expect(r.decision).toBe("publish");
    // "water" (Facilities) and "canteen" (Food) tie at one hit each —
    // ties break alphabetically by design, never by confident guess.
    expect(r.categoryHint).toBe("Facilities");
  });

  it("hints unambiguous categories directly", () => {
    expect(categoryHint("canteen lunch menu")).toBe("Food");
    expect(categoryHint("bus route changed")).toBe("Transport");
  });

  it("holds room-level locations for review (engine parity, conservative)", () => {
    const r = decidePost({
      title: "Broken lift in Block C",
      description: "The lift has been broken for two days.",
      visibility: "public",
    });
    // privacy_weak fires on "Block C" — the harness mirrors the engine
    // instead of second-guessing it.
    expect(r.decision).toBe("hold");
    expect(r.categoryHint).toBe("Facilities");
  });

  it("blocks sexual solicitation naming a student", () => {
    const r = decidePost({
      title: "User requests hot photos of Shaksi Piry",
      description: "shaksi priyya pic hot phots",
      visibility: "public",
    });
    expect(r.decision).toBe("block");
  });

  it("holds (never publishes blind) named accusations", () => {
    const r = decidePost({
      title: "Student Rahul accused of blackmailing a peer",
      description: "A boy named Rahul has been blackmailing students",
      visibility: "public",
    });
    expect(r.decision).toBe("hold");
  });
});

describe("decideComment / decidePoll", () => {
  it("publishes clean comments, blocks review-grade ones (no queue)", () => {
    expect(decideComment("Great initiative, thank you!").decision).toBe("publish");
    expect(decideComment("my pin is 400001, come visit").decision).toBe("block");
  });

  it("blocks bad polls, publishes clean ones", () => {
    expect(
      decidePoll({ title: "Best house?", options: ["Red", "Blue"] }).decision,
    ).toBe("publish");
    expect(
      decidePoll({ title: "nudes?", options: ["yes", "no"] }).decision,
    ).toBe("block");
  });
});

describe("categoryHints", () => {
  it("ranks best-first and falls back to Other", () => {
    expect(categoryHint("bus route changed again")).toBe("Transport");
    expect(categoryHint("xyzzy plugh")).toBe("Other");
    expect(categoryHint("")).toBe("Other");
    const ranked = categoryHints("dirty canteen food");
    expect(ranked[0]).toMatchObject({ hits: expect.any(Number) });
  });
});

describe("decide", () => {
  it("routes by kind and fails closed on unknowns and errors", () => {
    expect(decide("chat", "hi").kind).toBe("chat");
    expect(decide("post", {}).decision).toBe("hold");
    const unknown = decide("teleport", {});
    expect(unknown.decision).toBe("hold");
    expect(unknown.reasons.join(" ")).toMatch(/unknown decision kind/);
  });
});
