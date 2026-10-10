// ═══════════════════════════════════════════════════════════════════
// AI health ring — observe-only measurement contracts.
// ═══════════════════════════════════════════════════════════════════
// Pins: bounded rings, measured-only aggregates, consecutive-failure
// demotion with cooldown + expiry, never-throws recording, clean reset.
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetAiHealth,
  aiHealthCheck,
  getAiHealth,
  getTaskHealth,
  isLaneDemoted,
  recordAiCall,
} from "../../api/_ai-health.js";

beforeEach(() => {
  __resetAiHealth();
  vi.useRealTimers();
});

describe("ai-health ring", () => {
  it("reports null for never-observed tasks", () => {
    expect(getTaskHealth("nope.missing")).toBeNull();
    expect(getAiHealth().tasks).toEqual({});
    expect(getAiHealth().registry.length).toBeGreaterThan(0);
    expect(isLaneDemoted("nope.missing", "groq")).toBe(false);
  });

  it("aggregates success rate and percentiles from measured samples", () => {
    for (let i = 1; i <= 10; i++) {
      recordAiCall("assist.suggest", { ok: i > 2, latencyMs: i * 100, lane: "chain" });
    }
    const h = getTaskHealth("assist.suggest");
    expect(h?.calls).toBe(10);
    expect(h?.errors).toBe(2);
    expect(h?.successRate).toBeCloseTo(0.8);
    expect(h?.p50).toBe(500);
    expect(h?.p95).toBe(1000);
    expect(h?.lastLane).toBe("chain");
  });

  it("bounds the ring so hot tasks cannot grow memory", () => {
    for (let i = 0; i < 500; i++) {
      recordAiCall("transcribe", { ok: true, latencyMs: 5, lane: "groq" });
    }
    expect(getTaskHealth("transcribe")?.calls).toBe(200);
  });

  it("demotes a lane after consecutive failures and expires the cooldown", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-27T10:00:00Z"));
    for (let i = 0; i < 5; i++) {
      recordAiCall("transcribe", { ok: false, latencyMs: 9, lane: "groq" });
    }
    expect(isLaneDemoted("transcribe", "groq")).toBe(true);
    expect(getTaskHealth("transcribe")?.demoted).toEqual(["groq"]);
    // Other lanes are unaffected.
    expect(isLaneDemoted("transcribe", "nvidia")).toBe(false);
    // Cooldown expiry readmits the lane.
    vi.setSystemTime(new Date("2026-09-27T10:06:00Z"));
    expect(isLaneDemoted("transcribe", "groq")).toBe(false);
    expect(getTaskHealth("transcribe")?.demoted).toEqual([]);
  });

  it("resets consecutive failures on success (no flapping demotion)", () => {
    for (let i = 0; i < 4; i++) {
      recordAiCall("transcribe", { ok: false, latencyMs: 9, lane: "groq" });
    }
    recordAiCall("transcribe", { ok: true, latencyMs: 9, lane: "groq" });
    for (let i = 0; i < 4; i++) {
      recordAiCall("transcribe", { ok: false, latencyMs: 9, lane: "groq" });
    }
    expect(isLaneDemoted("transcribe", "groq")).toBe(false);
  });

  it("never throws on garbage input", () => {
    expect(() =>
      recordAiCall(undefined as unknown as string, undefined),
    ).not.toThrow();
    expect(() =>
      recordAiCall("t", { ok: true, latencyMs: NaN, lane: 42 }),
    ).not.toThrow();
    expect(getTaskHealth("t")?.p50).toBe(0);
  });

  it("resets cleanly between uses", () => {
    recordAiCall("x", { ok: true, latencyMs: 1, lane: "a" });
    __resetAiHealth();
    expect(getAiHealth().tasks).toEqual({});
  });
});

describe("aiHealthCheck", () => {
  it("is ok (not alarming) on a fresh boot with no observations", () => {
    const c = aiHealthCheck();
    expect(c.status).toBe("ok");
    expect(c.tasks).toEqual({});
  });

  it("warns on demoted lanes", () => {
    for (let i = 0; i < 5; i++) {
      recordAiCall("transcribe", { ok: false, latencyMs: 9, lane: "groq" });
    }
    const c = aiHealthCheck();
    expect(c.status).toBe("warning");
    expect(c.issues.join(" ")).toContain("transcribe");
    expect(c.issues.join(" ")).toContain("groq");
  });

  it("warns on sustained low success, but stays quiet on small samples", () => {
    for (let i = 0; i < 4; i++) {
      recordAiCall("assist.suggest", { ok: false, latencyMs: 9, lane: "chain" });
    }
    recordAiCall("assist.suggest", { ok: true, latencyMs: 9, lane: "chain" });
    expect(aiHealthCheck().status).toBe("ok");
    for (let i = 0; i < 10; i++) {
      recordAiCall("assist.suggest", { ok: false, latencyMs: 9, lane: "chain" });
    }
    const c = aiHealthCheck();
    expect(c.status).toBe("warning");
    expect(c.issues.join(" ")).toContain("assist.suggest");
  });

  it("reports healthy tasks with their measured aggregates", () => {
    recordAiCall("inbox.triage", { ok: true, latencyMs: 120, lane: "chain" });
    const c = aiHealthCheck();
    expect(c.status).toBe("ok");
    expect(c.tasks["inbox.triage"].calls).toBe(1);
    expect(c.tasks["inbox.triage"].successRate).toBe(1);
  });
});
