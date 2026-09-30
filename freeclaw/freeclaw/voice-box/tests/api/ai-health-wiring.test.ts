// ═══════════════════════════════════════════════════════════════════
// AI health wiring — handler paths really feed the ring.
// ═══════════════════════════════════════════════════════════════════
// Unit tests prove the ring math; this file proves the calls exist in the
// request paths (a record line deleted in a refactor would otherwise go
// unnoticed while the ring sat empty in production).
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it, vi } from "vitest";

const providerMocks = vi.hoisted(() => ({
  callNvidiaFast: vi.fn(),
  callLLMChain: vi.fn(),
  hasUsableLLM: vi.fn(),
}));
vi.mock("../../api/_providers.js", () => providerMocks);

vi.mock("../../api/_auth.js", () => ({
  cors: vi.fn(),
  isAdmin: vi.fn().mockResolvedValue(false),
  rateLimited: vi.fn().mockResolvedValue(false),
  rateLimitResponse: vi.fn(),
  clientIp: vi.fn(() => "203.0.0.9"),
}));
vi.mock("../../api/_error.js", () => ({
  sanitizeError: (_res: unknown, err: unknown) => {
    throw err;
  },
}));

function response() {
  const res = { statusCode: 200, body: undefined as unknown };
  return Object.assign(res, {
    status(code: number) {
      res.statusCode = code;
      return this;
    },
    setHeader: vi.fn(),
    json(body: unknown) {
      res.body = body;
      return this;
    },
    end: vi.fn(),
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  providerMocks.hasUsableLLM.mockResolvedValue(false);
  providerMocks.callNvidiaFast.mockResolvedValue(null);
  providerMocks.callLLMChain.mockResolvedValue(null);
});

describe("ai-health wiring", () => {
  it("records a fast-lane win for voice_complaint", async () => {
    providerMocks.callNvidiaFast.mockResolvedValueOnce({
      provider: "nvidia-fast",
      model: "test-model",
      text: JSON.stringify({
        title: "Broken tap in block C",
        description: "The tap has leaked since Monday morning.",
        category: "Facilities",
        tags: ["tap"],
        priority: "medium",
      }),
    });
    const { default: handler } = await import("../../api/_assist.js");
    const { getTaskHealth, __resetAiHealth } = await import(
      "../../api/_ai-health.js"
    );
    __resetAiHealth();
    const res = response();
    await handler(
      {
        method: "POST",
        query: {},
        body: { task: "voice_complaint", text: "block c tap leak monday" },
        headers: {},
      },
      res,
    );
    expect(res.statusCode).toBe(200);
    const h = getTaskHealth("assist.voice_complaint");
    expect(h?.calls).toBe(1);
    expect(h?.errors).toBe(0);
    expect(h?.lastLane).toBe("nvidia-fast");
    expect(typeof h?.p50).toBe("number");
  });

  it("records both-lane failure when the local backbone serves", async () => {
    providerMocks.callLLMChain.mockRejectedValueOnce(new Error("down"));
    const { default: handler } = await import("../../api/_assist.js");
    const { getTaskHealth, __resetAiHealth } = await import(
      "../../api/_ai-health.js"
    );
    __resetAiHealth();
    const res = response();
    await handler(
      {
        method: "POST",
        query: {},
        body: { task: "suggest", text: "the library roof leaks every rain" },
        headers: {},
      },
      res,
    );
    expect(res.statusCode).toBe(200);
    const h = getTaskHealth("assist.suggest");
    // Fast lane failed (null) and chain failed (rejected): both recorded.
    expect(h?.calls).toBe(2);
    expect(h?.errors).toBe(2);
  });
});
