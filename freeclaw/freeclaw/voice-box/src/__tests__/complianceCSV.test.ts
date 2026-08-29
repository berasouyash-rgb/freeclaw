/**
 * TDD Tests for Compliance CSV Export
 *
 * Proves that:
 * 1. Date range presets compute correct boundaries
 * 2. filterByDateRange filters posts correctly
 * 3. buildComplianceCSV generates valid CSV with summary, header, and data rows
 * 4. CSV escapes formula-injection characters
 * 5. Edge cases: empty posts, no matches, custom date ranges
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getDateRange,
  filterByDateRange,
  buildComplianceCSV,
  type DateRange,
} from "../lib/complianceCSV";
import type { PostData } from "../types";

// Helper to create a PostData with sensible defaults
function makePost(overrides: Partial<PostData> = {}): PostData {
  return {
    id: "post-1",
    title: "Test Post",
    description: "A test post description",
    category: "Facilities",
    status: "open",
    priority: "medium",
    type: "problem",
    author_id: "user-1",
    created_at: "2025-06-15T10:00:00Z",
    reactions: { support: 5, heart: 2 },
    comment_count: 3,
    ...overrides,
  } as PostData;
}

describe("getDateRange", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-07-20T14:30:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("today returns start and end of current day", () => {
    const { from, to } = getDateRange("today");
    expect(from.getHours()).toBe(0);
    expect(from.getMinutes()).toBe(0);
    expect(to.getTime() - from.getTime()).toBe(86_400_000);
  });

  it("this_week returns Monday to Sunday of current week", () => {
    const { from, to } = getDateRange("this_week");
    // July 20 2025 is a Sunday, so Monday is July 14
    expect(from.getDay()).toBe(1); // Monday
    expect(to.getTime() - from.getTime()).toBe(7 * 86_400_000);
  });

  it("this_month returns first day to first day of next month", () => {
    const { from, to } = getDateRange("this_month");
    expect(from.getDate()).toBe(1);
    expect(to.getDate()).toBe(1);
    expect(to.getMonth()).toBe(from.getMonth() + 1);
  });

  it("last_30_days returns 30 days ago to tomorrow", () => {
    const { from, to } = getDateRange("last_30_days");
    const diffDays = (to.getTime() - from.getTime()) / 86_400_000;
    expect(diffDays).toBe(31); // 30 days + 1 day end
  });

  it("last_90_days returns 90 days ago to tomorrow", () => {
    const { from, to } = getDateRange("last_90_days");
    const diffDays = (to.getTime() - from.getTime()) / 86_400_000;
    expect(diffDays).toBe(91);
  });

  it("all returns epoch to tomorrow", () => {
    const { from, to } = getDateRange("all");
    expect(from.getTime()).toBe(0);
    expect(to.getTime()).toBeGreaterThan(Date.now());
  });
});

describe("filterByDateRange", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-07-20T14:30:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns all posts for 'all' range", () => {
    const posts = [
      makePost({ created_at: "2020-01-01T00:00:00Z" }),
      makePost({ id: "post-2", created_at: "2025-07-19T00:00:00Z" }),
    ];
    const result = filterByDateRange(posts, { preset: "all" });
    expect(result).toHaveLength(2);
  });

  it("filters posts to today only", () => {
    // Use dates clearly outside any timezone offset
    const posts = [
      makePost({ created_at: "2025-07-20T12:00:00Z" }), // today (noon UTC)
      makePost({ id: "p2", created_at: "2025-07-18T12:00:00Z" }), // 2 days ago
      makePost({ id: "p3", created_at: "2025-07-22T12:00:00Z" }), // 2 days ahead
    ];
    const result = filterByDateRange(posts, { preset: "today" });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("post-1");
  });

  it("filters posts for custom date range", () => {
    const posts = [
      makePost({ created_at: "2025-07-10T00:00:00Z" }),
      makePost({ id: "p2", created_at: "2025-07-15T00:00:00Z" }),
      makePost({ id: "p3", created_at: "2025-07-25T00:00:00Z" }),
    ];
    const range: DateRange = {
      preset: "custom",
      start: new Date("2025-07-12"),
      end: new Date("2025-07-20"),
    };
    const result = filterByDateRange(posts, range);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("p2");
  });

  it("returns empty array when no posts match", () => {
    const posts = [
      makePost({ created_at: "2020-01-01T00:00:00Z" }),
    ];
    const result = filterByDateRange(posts, { preset: "today" });
    expect(result).toHaveLength(0);
  });

  it("handles empty posts array", () => {
    const result = filterByDateRange([], { preset: "all" });
    expect(result).toHaveLength(0);
  });
});

describe("buildComplianceCSV", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-07-20T14:30:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns empty-ish CSV when no posts", () => {
    const csv = buildComplianceCSV([], { preset: "all" }, "problem");
    expect(csv).toContain("Voice Box — Compliance Export");
    expect(csv).toContain("Total Records: 0");
    // Should still have header row
    expect(csv).toContain("Title");
    expect(csv).toContain("Category");
  });

  it("includes summary section with status breakdown", () => {
    const posts = [
      makePost({ status: "open" }),
      makePost({ id: "p2", status: "open" }),
      makePost({ id: "p3", status: "solved" }),
    ];
    const csv = buildComplianceCSV(posts, { preset: "all" }, "problem");
    expect(csv).toContain("— Status Breakdown —");
    expect(csv).toContain("— Category Breakdown —");
    expect(csv).toContain("— Priority Breakdown —");
    expect(csv).toContain("— Engagement Summary —");
  });

  it("generates correct CSV header columns", () => {
    const csv = buildComplianceCSV([makePost()], { preset: "all" }, "problem");
    const lines = csv.split("\n");
    // Find the header line (after separator)
    const sepIdx = lines.findIndex((l) => l.includes("══════"));
    const headerLine = lines[sepIdx + 1];
    expect(headerLine).toContain("Title");
    expect(headerLine).toContain("Category");
    expect(headerLine).toContain("Status");
    expect(headerLine).toContain("Priority");
    expect(headerLine).toContain("Created");
    expect(headerLine).toContain("Post ID");
  });

  it("includes data rows with correct values", () => {
    const post = makePost({
      title: "Broken Elevator",
      category: "Facilities",
      status: "open",
    });
    const csv = buildComplianceCSV([post], { preset: "all" }, "problem");
    expect(csv).toContain("Broken Elevator");
    expect(csv).toContain("Facilities");
  });

  it("escapes formula-injection characters", () => {
    const post = makePost({ title: '=cmd|"/c calc"!A0' });
    const csv = buildComplianceCSV([post], { preset: "all" }, "problem");
    // Should be prefixed with single quote to neutralize formula
    expect(csv).toContain("'=cmd");
  });

  it("escapes double quotes in values", () => {
    const post = makePost({ title: 'He said "hello"' });
    const csv = buildComplianceCSV([post], { preset: "all" }, "problem");
    // CSV doubled quotes: "He said ""hello"""
    expect(csv).toContain('He said ""hello""');
  });

  it("formats dates as YYYY-MM-DD HH:MM", () => {
    const post = makePost({ created_at: "2025-03-15T09:05:00Z" });
    const csv = buildComplianceCSV([post], { preset: "all" }, "problem");
    // Date should be formatted (exact time depends on timezone, but format should be present)
    expect(csv).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
  });

  it("includes engagement totals in summary", () => {
    const posts = [
      makePost({ reactions: { support: 10, heart: 5 }, comment_count: 3 }),
      makePost({ id: "p2", reactions: { support: 2, heart: 1 }, comment_count: 7 }),
    ];
    const csv = buildComplianceCSV(posts, { preset: "all" }, "problem");
    expect(csv).toContain("Total Supports");
    expect(csv).toContain("12"); // 10 + 2
    expect(csv).toContain("Total Hearts");
    expect(csv).toContain("6"); // 5 + 1
    expect(csv).toContain("Total Comments");
    expect(csv).toContain("10"); // 3 + 7
  });

  it("labels suggestion type correctly", () => {
    const csv = buildComplianceCSV([makePost()], { preset: "all" }, "suggestion");
    expect(csv).toContain("Suggestions Report");
  });

  it("labels problem type correctly", () => {
    const csv = buildComplianceCSV([makePost()], { preset: "all" }, "problem");
    expect(csv).toContain("Complaints Report");
  });

  it("filters by date range before generating CSV", () => {
    const posts = [
      makePost({ created_at: "2025-07-20T10:00:00Z" }), // today
      makePost({ id: "p2", created_at: "2020-01-01T00:00:00Z" }), // old
    ];
    const csv = buildComplianceCSV(posts, { preset: "today" }, "problem");
    expect(csv).toContain("Total Records: 1");
    expect(csv).toContain("Test Post"); // default title from makePost
  });

  it("shows percentage breakdowns in summary", () => {
    const posts = [
      makePost({ status: "open" }),
      makePost({ id: "p2", status: "open" }),
      makePost({ id: "p3", status: "solved" }),
    ];
    const csv = buildComplianceCSV(posts, { preset: "all" }, "problem");
    // 2/3 = 66.7%, 1/3 = 33.3%
    expect(csv).toMatch(/66\.7%/);
    expect(csv).toMatch(/33\.3%/);
  });

  it("handles posts with missing optional fields", () => {
    const post = makePost({
      description: undefined,
      category: undefined,
      priority: undefined,
      reactions: undefined,
      comment_count: undefined,
    });
    // Should not throw
    const csv = buildComplianceCSV([post], { preset: "all" }, "problem");
    expect(csv).toContain("Title");
    expect(csv).toContain("Test Post");
  });
});
