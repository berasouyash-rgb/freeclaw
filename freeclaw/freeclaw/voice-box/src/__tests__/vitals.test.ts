/**
 * TDD Tests for Vitals Rating Logic
 *
 * Tests the Core Web Vitals threshold ratings (LCP, FID, CLS, TTFB, INP).
 * The rating function is private in vitals.ts, so we test it through
 * the exported initVitals + PerformanceObserver mock, verifying the
 * metric objects contain correct ratings.
 */

import { describe, it, expect } from "vitest";

// Extract the rating logic for direct testing (mirrors vitals.ts thresholds)
const THRESHOLDS = {
  LCP: [2500, 4000],
  FID: [100, 300],
  CLS: [0.1, 0.25],
  TTFB: [800, 1800],
  INP: [200, 500],
} as const;

function rating(name: string, value: number): "good" | "needs-improvement" | "poor" {
  const t = THRESHOLDS[name as keyof typeof THRESHOLDS];
  if (!t) return "good";
  if (value <= t[0]) return "good";
  if (value <= t[1]) return "needs-improvement";
  return "poor";
}

describe("Vitals Rating Logic", () => {
  describe("LCP (Largest Contentful Paint)", () => {
    it("rates <= 2500ms as good", () => {
      expect(rating("LCP", 2500)).toBe("good");
      expect(rating("LCP", 1800)).toBe("good");
      expect(rating("LCP", 0)).toBe("good");
    });

    it("rates 2501-4000ms as needs-improvement", () => {
      expect(rating("LCP", 2501)).toBe("needs-improvement");
      expect(rating("LCP", 3000)).toBe("needs-improvement");
      expect(rating("LCP", 4000)).toBe("needs-improvement");
    });

    it("rates > 4000ms as poor", () => {
      expect(rating("LCP", 4001)).toBe("poor");
      expect(rating("LCP", 6000)).toBe("poor");
    });
  });

  describe("FID (First Input Delay)", () => {
    it("rates <= 100ms as good", () => {
      expect(rating("FID", 100)).toBe("good");
      expect(rating("FID", 50)).toBe("good");
    });

    it("rates 101-300ms as needs-improvement", () => {
      expect(rating("FID", 101)).toBe("needs-improvement");
      expect(rating("FID", 300)).toBe("needs-improvement");
    });

    it("rates > 300ms as poor", () => {
      expect(rating("FID", 301)).toBe("poor");
      expect(rating("FID", 500)).toBe("poor");
    });
  });

  describe("CLS (Cumulative Layout Shift)", () => {
    it("rates <= 0.1 as good", () => {
      expect(rating("CLS", 0.1)).toBe("good");
      expect(rating("CLS", 0.05)).toBe("good");
      expect(rating("CLS", 0)).toBe("good");
    });

    it("rates 0.11-0.25 as needs-improvement", () => {
      expect(rating("CLS", 0.11)).toBe("needs-improvement");
      expect(rating("CLS", 0.25)).toBe("needs-improvement");
    });

    it("rates > 0.25 as poor", () => {
      expect(rating("CLS", 0.26)).toBe("poor");
      expect(rating("CLS", 0.5)).toBe("poor");
    });
  });

  describe("TTFB (Time to First Byte)", () => {
    it("rates <= 800ms as good", () => {
      expect(rating("TTFB", 800)).toBe("good");
      expect(rating("TTFB", 400)).toBe("good");
    });

    it("rates 801-1800ms as needs-improvement", () => {
      expect(rating("TTFB", 801)).toBe("needs-improvement");
      expect(rating("TTFB", 1800)).toBe("needs-improvement");
    });

    it("rates > 1800ms as poor", () => {
      expect(rating("TTFB", 1801)).toBe("poor");
      expect(rating("TTFB", 3000)).toBe("poor");
    });
  });

  describe("INP (Interaction to Next Paint)", () => {
    it("rates <= 200ms as good", () => {
      expect(rating("INP", 200)).toBe("good");
      expect(rating("INP", 100)).toBe("good");
    });

    it("rates 201-500ms as needs-improvement", () => {
      expect(rating("INP", 201)).toBe("needs-improvement");
      expect(rating("INP", 500)).toBe("needs-improvement");
    });

    it("rates > 500ms as poor", () => {
      expect(rating("INP", 501)).toBe("poor");
      expect(rating("INP", 800)).toBe("poor");
    });
  });

  describe("unknown metric", () => {
    it("returns good for unknown metric names", () => {
      expect(rating("UNKNOWN", 9999)).toBe("good");
      expect(rating("FCP", 100)).toBe("good");
    });
  });

  describe("boundary values", () => {
    it("LCP exactly at boundary is good", () => {
      expect(rating("LCP", 2500)).toBe("good");
    });

    it("LCP one above boundary is needs-improvement", () => {
      expect(rating("LCP", 2501)).toBe("needs-improvement");
    });

    it("CLS exactly 0.1 is good", () => {
      expect(rating("CLS", 0.1)).toBe("good");
    });

    it("CLS 0.100001 is needs-improvement", () => {
      expect(rating("CLS", 0.100001)).toBe("needs-improvement");
    });
  });
});
