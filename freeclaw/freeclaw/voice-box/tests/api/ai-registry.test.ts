// ═══════════════════════════════════════════════════════════════════
// AI registry contract — the manifest must stay truthful.
// ═══════════════════════════════════════════════════════════════════
// Slice 1 of the AI management harness. The registry is read-only metadata
// today (nothing imports it), so these tests pin its internal consistency:
// unique keys, sane shapes, bounded timeouts, known fallback vocabulary,
// honest rate buckets. When slice 2 wires callers to the registry, these
// same tests grow cross-checks against the owner files.
// ═══════════════════════════════════════════════════════════════════

import { describe, expect, it } from "vitest";
import { AI_TASKS, getAiTask } from "../../api/_ai-registry.js";

describe("AI registry contract", () => {
  it("has unique, well-formed task keys", async () => {
    const keys = AI_TASKS.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) {
      expect(typeof k).toBe("string");
      expect(k.length).toBeGreaterThan(0);
    }
  });

  it("gives every task an owner, description, and admin flag", async () => {
    for (const t of AI_TASKS) {
      expect(t.owner.startsWith("api/")).toBe(true);
      expect(t.description.length).toBeGreaterThan(10);
      expect(typeof t.adminOnly).toBe("boolean");
    }
  });

  it("bounds every lane timeout between 1s and 30s", async () => {
    for (const t of AI_TASKS) {
      for (const lane of t.lanes) {
        expect(lane.provider.length).toBeGreaterThan(0);
        expect(lane.model.length).toBeGreaterThan(0);
        expect(lane.timeoutMs).toBeGreaterThanOrEqual(1000);
        expect(lane.timeoutMs).toBeLessThanOrEqual(30000);
      }
    }
  });

  it("restricts fallbacks to the known vocabulary", async () => {
    for (const t of AI_TASKS) {
      expect(["local", "none"]).toContain(t.fallback);
    }
  });

  it("requires honest rate buckets (or an explicit stateless marker)", async () => {
    for (const t of AI_TASKS) {
      if (t.rate.bucket === "none") {
        expect(t.rate.max).toBe(0);
        continue;
      }
      expect(t.rate.bucket.length).toBeGreaterThan(0);
      expect(t.rate.windowSec).toBeGreaterThan(0);
      expect(t.rate.max).toBeGreaterThan(0);
      expect(t.rate.scope.length).toBeGreaterThan(0);
    }
  });

  it("marks the known-bad NVIDIA STT lane so no one relies on it alone", async () => {
    const stt = getAiTask("transcribe");
    const nvidia = stt?.lanes.find((l) => l.provider === "nvidia");
    expect(nvidia?.knownBad).toBe(true);
  });

  it("looks tasks up by key and misses cleanly", async () => {
    expect(getAiTask("assist.suggest")?.owner).toBe("api/_assist.js");
    expect(getAiTask("nope.missing")).toBeUndefined();
  });

  it("keeps moderation honest: heuristic entry is local-only with no lanes", async () => {
    const mod = getAiTask("moderation.heuristic");
    expect(mod?.lanes).toEqual([]);
    expect(mod?.fallback).toBe("local");
  });
});
