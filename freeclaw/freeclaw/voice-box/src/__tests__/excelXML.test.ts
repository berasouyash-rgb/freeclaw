/**
 * TDD Tests for the zero-dependency Excel (.xls) export library.
 *
 * Proves that:
 * 1. xmlEscape escapes every XML-sensitive character
 * 2. buildXls produces a valid SpreadsheetML 2003 workbook with named sheets
 * 3. Every string cell is emitted as ss:Type="String" — formula-injection safe
 * 4. Numbers are emitted as Number cells, booleans stay strings
 * 5. buildCaseXls produces Case Summary / Case Timeline / Evidence sheets
 *    with the real post fields and a timeline-vs-comment_count reconciliation
 * 6. Sheet names are sanitized to Excel's 31-char / []:*?\/ rules
 */

import { describe, it, expect } from "vitest";
import {
  buildCaseXls,
  buildXls,
  downloadXls,
  xmlEscape,
  type CaseExportInput,
} from "../lib/excelXML";

describe("xmlEscape", () => {
  it("escapes all five XML-sensitive characters", () => {
    expect(xmlEscape(`& < > " '`)).toBe("&amp; &lt; &gt; &quot; &apos;");
  });

  it("leaves plain text untouched", () => {
    expect(xmlEscape("plain text 123")).toBe("plain text 123");
  });
});

describe("buildXls", () => {
  it("emits a SpreadsheetML workbook with the requested sheet", () => {
    const xml = buildXls([
      {
        name: "Report",
        columns: [{ header: "Name" }, { header: "Value" }],
        rows: [["alice", 42]],
      },
    ]);
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<?mso-application progid="Excel.Sheet"?>');
    expect(xml).toContain('xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"');
    expect(xml).toContain('<Worksheet ss:Name="Report">');
    expect(xml).toContain('<Row ss:StyleID="Header">');
    expect(xml).toContain("<Table>");
    expect(xml).toContain("</Workbook>");
  });

  it("always emits strings as ss:Type=\"String\" — even formula-looking content", () => {
    const xml = buildXls([
      {
        name: "S",
        columns: [{ header: "C" }],
        rows: [["=cmd|'/C calc'!A0"], ["+1+1"], ["@SUM(A1)"], ["-2+3"]],
      },
    ]);
    // Deep-inside-the-cell string type, never Number for user content
    expect(xml).toContain('<Data ss:Type="String">=cmd|&apos;/C calc&apos;!A0</Data>');
    expect(xml).toContain('<Data ss:Type="String">+1+1</Data>');
    expect(xml).toContain('<Data ss:Type="String">@SUM(A1)</Data>');
    // Excel would run "-2+3" as a formula in CSV; here it stays text.
    expect(xml).toContain('<Data ss:Type="String">-2+3</Data>');
  });

  it("emits finite numbers as Number cells", () => {
    const xml = buildXls([
      {
        name: "N",
        columns: [{ header: "Count" }],
        rows: [[7]],
      },
    ]);
    expect(xml).toContain('<Data ss:Type="Number">7</Data>');
  });

  it("sanitizes invalid sheet names and truncates to 31 chars", () => {
    const xml = buildXls([
      { name: "bad[]:*?/\\name", columns: [{ header: "A" }], rows: [] },
      { name: "0123456789012345678901234567890123456789", columns: [{ header: "A" }], rows: [] },
    ]);
    expect(xml).toContain('<Worksheet ss:Name="bad name">');
    expect(xml).toContain('<Worksheet ss:Name="0123456789012345678901234567890">');
  });
});

describe("buildCaseXls", () => {
  const base: CaseExportInput = {
    post: {
      id: "post-1",
      title: "Repeated harassment at the cafeteria",
      description: "Daily incidents at lunch",
      category: "Bullying",
      status: "in_progress",
      priority: "high",
      created_at: "2026-09-01T08:00:00Z",
      updated_at: "2026-09-05T12:00:00Z",
      tags: ["harassment", "cafeteria"],
      visibility: "public",
      pinned: true,
      locked: false,
      official: true,
      hidden: false,
      comment_count: 2,
      reactions: { support: 3 },
      linked_poll: "poll-9",
      admin_reply: "We are investigating",
      admin_notes: "Escalated to student support",
      status_history: [
        { status: "reported", at: "2026-09-01T08:00:00Z" },
        { status: "in_progress", at: "2026-09-03T10:00:00Z", note: "counselor assigned" },
      ],
    },
    comments: [
      { when: "9/1/2026, 8:05:00 AM", author: "ad3f1c2b9a0d…", body: "This happened again today." },
      { when: "9/1/2026, 8:20:00 AM", author: "Admin", body: "Logged; investigating.", status: "admin" },
    ],
  };

  it("produces all three sheets with the post on the summary", () => {
    const xml = buildCaseXls(base);
    expect(xml).toContain('<Worksheet ss:Name="Case Summary">');
    expect(xml).toContain('<Worksheet ss:Name="Case Timeline">');
    expect(xml).toContain('<Worksheet ss:Name="Evidence &amp; Verification">');
    expect(xml).toContain("Repeated harassment at the cafeteria");
    expect(xml).toContain("high");
  });

  it("includes the status history as a single reconciled row", () => {
    const xml = buildCaseXls(base);
    expect(xml).toContain("Status history");
    expect(xml).toContain("reported @ 2026-09-01T08:00:00Z");
    expect(xml).toContain("in_progress @ 2026-09-03T10:00:00Z");
  });

  it("reconciles exported timeline rows against the server comment_count", () => {
    const xml = buildCaseXls(base);
    expect(xml).toContain("match (2)");

    const mismatch = buildCaseXls({
      ...base,
      comments: base.comments.slice(0, 1),
    });
    expect(mismatch).toContain("mismatch");
  });

  it("appends caller evidence rows to the Evidence sheet", () => {
    const xml = buildCaseXls({
      ...base,
      evidence: [{ label: "Verified by", value: "resident-agent-01" }],
    });
    expect(xml).toContain("Verified by");
    expect(xml).toContain("resident-agent-01");
  });
});

describe("downloadXls", () => {
  it("normalizes a missing .xls extension on the filename", () => {
    // jsdom lacks URL.createObjectURL — stub it and capture the anchor.
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = () => "blob:fake";
    URL.revokeObjectURL = () => {};

    const anchor = document.createElement("a");
    const originalCreateElement = document.createElement.bind(document);
    document.createElement = ((tag: string) =>
      tag === "a" ? anchor : originalCreateElement(tag)) as typeof document.createElement;

    try {
      downloadXls("case-1", "<Workbook/>");
      expect(anchor.download).toBe("case-1.xls");
      expect(anchor.href).toBe("blob:fake");
      downloadXls("case-2.xls", "<Workbook/>");
      expect(anchor.download).toBe("case-2.xls");
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      document.createElement = originalCreateElement;
    }
  });
});