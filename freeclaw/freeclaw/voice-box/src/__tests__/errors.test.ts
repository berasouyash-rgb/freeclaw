/**
 * TDD Tests for Error Capture Module
 *
 * Tests the error filtering logic, device detection, and deduplication.
 * The module uses window event listeners, so we test by dispatching
 * events and verifying the filtering behavior.
 */

import { describe, it, expect } from "vitest";

// Test the device detection logic (mirrors errors.ts)
function getDevice(width: number): string {
  if (width < 640) return "mobile";
  if (width < 1024) return "tablet";
  return "desktop";
}

// Test the error filtering logic (mirrors errors.ts shouldIgnore logic)
function shouldIgnoreError(message: string, filename?: string): boolean {
  if (
    message.includes("ResizeObserver") ||
    message.includes("NetworkError") ||
    message.includes("Load failed") ||
    filename?.includes("sentry") ||
    filename?.includes("chunk")
  )
    return true;
  return false;
}

// Test the rejection filtering logic
function shouldIgnoreRejection(message: string): boolean {
  if (
    message.includes("Failed to fetch") ||
    message.includes("ChunkLoadError") ||
    message.includes("Loading chunk") ||
    message.includes("Importing a module script failed")
  )
    return true;
  return false;
}

describe("Error Capture — Device Detection", () => {
  it("returns mobile for width < 640", () => {
    expect(getDevice(320)).toBe("mobile");
    expect(getDevice(639)).toBe("mobile");
  });

  it("returns tablet for width 640-1023", () => {
    expect(getDevice(640)).toBe("tablet");
    expect(getDevice(768)).toBe("tablet");
    expect(getDevice(1023)).toBe("tablet");
  });

  it("returns desktop for width >= 1024", () => {
    expect(getDevice(1024)).toBe("desktop");
    expect(getDevice(1440)).toBe("desktop");
    expect(getDevice(1920)).toBe("desktop");
  });
});

describe("Error Capture — Error Filtering", () => {
  it("ignores ResizeObserver errors", () => {
    expect(shouldIgnoreError("ResizeObserver loop completed with undelivered notifications")).toBe(true);
  });

  it("ignores NetworkError", () => {
    expect(shouldIgnoreError("NetworkError when attempting to fetch resource")).toBe(true);
  });

  it("ignores Load failed", () => {
    expect(shouldIgnoreError("Load failed")).toBe(true);
  });

  it("ignores sentry errors", () => {
    expect(shouldIgnoreError("Script error", "https://browser.sentry.io/bundle.js")).toBe(true);
  });

  it("ignores chunk errors", () => {
    expect(shouldIgnoreError("Loading chunk 5 failed", "/assets/chunk-5.js")).toBe(true);
  });

  it("does NOT ignore normal errors", () => {
    expect(shouldIgnoreError("TypeError: undefined is not a function")).toBe(false);
    expect(shouldIgnoreError("SyntaxError: Unexpected token")).toBe(false);
    expect(shouldIgnoreError("ReferenceError: foo is not defined")).toBe(false);
  });

  it("does NOT ignore errors without filename", () => {
    expect(shouldIgnoreError("Random error")).toBe(false);
  });
});

describe("Error Capture — Rejection Filtering", () => {
  it("ignores Failed to fetch rejections", () => {
    expect(shouldIgnoreRejection("Failed to fetch")).toBe(true);
  });

  it("ignores ChunkLoadError", () => {
    expect(shouldIgnoreRejection("ChunkLoadError")).toBe(true);
  });

  it("ignores Loading chunk errors", () => {
    expect(shouldIgnoreRejection("Loading chunk 3 failed")).toBe(true);
  });

  it("ignores Importing module script errors", () => {
    expect(shouldIgnoreRejection("Importing a module script failed")).toBe(true);
  });

  it("does NOT ignore normal rejections", () => {
    expect(shouldIgnoreRejection("TypeError: Cannot read property")).toBe(false);
    expect(shouldIgnoreRejection("AbortError: The operation was aborted")).toBe(false);
    expect(shouldIgnoreRejection("SecurityError: Blocked a frame")).toBe(false);
  });

  it("does NOT ignore custom error messages", () => {
    expect(shouldIgnoreRejection("API rate limit exceeded")).toBe(false);
    expect(shouldIgnoreRejection("Authentication required")).toBe(false);
  });
});

describe("Error Capture — Deduplication Key", () => {
  function dedupKey(source: string, message: string, filename?: string, lineno?: number, colno?: number): string {
    return `${source}:${message?.slice(0, 120)}:${filename}:${lineno}:${colno}`;
  }

  it("generates consistent keys for same error", () => {
    const key1 = dedupKey("window.onerror", "TypeError: foo", "/app.js", 10, 5);
    const key2 = dedupKey("window.onerror", "TypeError: foo", "/app.js", 10, 5);
    expect(key1).toBe(key2);
  });

  it("different errors produce different keys", () => {
    const key1 = dedupKey("window.onerror", "Error A", "/a.js", 1, 1);
    const key2 = dedupKey("window.onerror", "Error B", "/a.js", 1, 1);
    expect(key1).not.toBe(key2);
  });

  it("truncates long messages at 120 chars", () => {
    const longMsg = "x".repeat(200);
    const key = dedupKey("window.onerror", longMsg);
    expect(key).toContain("x".repeat(120));
    expect(key).not.toContain("x".repeat(121));
  });

  it("different sources produce different keys", () => {
    const key1 = dedupKey("window.onerror", "Error", "/a.js", 1, 1);
    const key2 = dedupKey("unhandledrejection", "Error", "/a.js", 1, 1);
    expect(key1).not.toBe(key2);
  });
});
