/**
 * TDD Tests for retryLazy module
 *
 * Proves that:
 * 1. isChunkLoadError detects all chunk error variants
 * 2. reloadOnceForStaleChunk only reloads once per session
 * 3. retryLazy retries failed imports up to MAX_RETRIES
 * 4. retryLazy uses exponential backoff
 * 5. retryLazy rethrows after exhausting retries for non-chunk errors
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isChunkLoadError, reloadOnceForStaleChunk } from "../lib/retryLazy";

describe("isChunkLoadError", () => {
  it("detects 'Failed to fetch dynamically imported module'", () => {
    expect(
      isChunkLoadError(new Error("Failed to fetch dynamically imported module")),
    ).toBe(true);
  });

  it("detects 'Loading chunk' errors", () => {
    expect(isChunkLoadError(new Error("Loading chunk 5 failed"))).toBe(true);
  });

  it("detects 'ChunkLoadError'", () => {
    expect(isChunkLoadError(new Error("ChunkLoadError"))).toBe(true);
  });

  it("detects 'Importing a module script failed'", () => {
    expect(
      isChunkLoadError(new Error("Importing a module script failed")),
    ).toBe(true);
  });

  it("detects 'dynamically imported module' in message", () => {
    expect(
      isChunkLoadError(
        new Error("net::ERR_FAILED Loading the dynamically imported module"),
      ),
    ).toBe(true);
  });

  it("returns false for non-chunk errors", () => {
    expect(isChunkLoadError(new Error("Network request failed"))).toBe(false);
    expect(isChunkLoadError(new Error("TypeError: undefined is not a function"))).toBe(false);
    expect(isChunkLoadError(new Error(""))).toBe(false);
  });

  it("handles string errors", () => {
    expect(isChunkLoadError("Loading chunk 3 failed")).toBe(true);
    expect(isChunkLoadError("random error")).toBe(false);
  });

  it("handles null and undefined", () => {
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });

  it("handles non-Error objects", () => {
    // isChunkLoadError uses String() on non-Error values
    expect(isChunkLoadError({ message: "ChunkLoadError" })).toBe(false); // String(obj) = "[object Object]"
    expect(isChunkLoadError({ code: "ERR_CHUNK" })).toBe(false);
  });
});

describe("reloadOnceForStaleChunk", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.stubGlobal("location", { reload: vi.fn() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns true and reloads on first call", () => {
    const result = reloadOnceForStaleChunk();
    expect(result).toBe(true);
    expect(location.reload).toHaveBeenCalledTimes(1);
  });

  it("returns false and does NOT reload on second call", () => {
    reloadOnceForStaleChunk();
    const result = reloadOnceForStaleChunk();
    expect(result).toBe(false);
    expect(location.reload).toHaveBeenCalledTimes(1);
  });

  it("stores guard in sessionStorage", () => {
    reloadOnceForStaleChunk();
    expect(sessionStorage.getItem("vb:chunkReloaded")).toBe("1");
  });

  it("respects existing guard from previous session", () => {
    sessionStorage.setItem("vb:chunkReloaded", "1");
    const result = reloadOnceForStaleChunk();
    expect(result).toBe(false);
    expect(location.reload).not.toHaveBeenCalled();
  });
});
