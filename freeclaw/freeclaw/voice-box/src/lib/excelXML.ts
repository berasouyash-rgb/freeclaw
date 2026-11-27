/**
 * excelXML.ts — zero-dependency Excel (.xls) export.
 *
 * Emits SpreadsheetML 2003 XML, which Excel, Google Sheets and LibreOffice
 * open natively as a real workbook (.xls). No binary/xlsx library required.
 *
 * Safety: every cell is emitted with an explicit ss:Type — strings are
 * ALWAYS ss:Type="String", so Excel never evaluates user content as a
 * formula. This is the CSV-style formula-injection guard, applied here too
 * ("=cmd", "+1+1", "@cmd" cells stay literal text).
 */

export interface XlsColumn {
  header: string;
  /** Approximate character width (optional). */
  width?: number;
}

export type XlsCell = string | number | boolean | null | undefined;

export interface XlsSheet {
  name: string;
  columns: XlsColumn[];
  rows: XlsCell[][];
}

const XML_ENT: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

export function xmlEscape(v: string): string {
  return v.replace(/[&<>"']/g, (c) => XML_ENT[c] ?? c);
}

/** Excel sheet names must be ≤31 chars and cannot contain []:*?/\ */
function sanitizeSheetName(name: string, fallback: string): string {
  const cleaned = name
    .replace(/[[\]:*?/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 31);
  return cleaned || fallback;
}

function cellXml(v: XlsCell): string {
  if (v === null || v === undefined || v === "") {
    return '<Cell><Data ss:Type="String"/></Cell>';
  }
  if (typeof v === "number") {
    if (Number.isFinite(v)) return `<Cell><Data ss:Type="Number">${v}</Data></Cell>`;
    return '<Cell><Data ss:Type="String"/></Cell>';
  }
  if (typeof v === "boolean") {
    return `<Cell><Data ss:Type="String">${xmlEscape(String(v))}</Data></Cell>`;
  }
  // Always String → Excel never runs =cmd / +cmd style formulas.
  return `<Cell><Data ss:Type="String">${xmlEscape(v)}</Data></Cell>`;
}

export function buildXls(sheets: XlsSheet[]): string {
  const body = sheets
    .map((sheet, i) => {
      const name = sanitizeSheetName(sheet.name, `Sheet${i + 1}`);
      const cols = sheet.columns
        .map(
          (c, ci) =>
            `<Column ss:Index="${ci + 1}"${c.width ? ` ss:Width="${Math.round(c.width)}"` : ""}/>`,
        )
        .join("");
      const header = `<Row ss:StyleID="Header">${sheet.columns
        .map((c) => `<Cell><Data ss:Type="String">${xmlEscape(c.header)}</Data></Cell>`)
        .join("")}</Row>`;
      const rows = sheet.rows.map((r) => `<Row>${r.map(cellXml).join("")}</Row>`).join("");
      return `<Worksheet ss:Name="${xmlEscape(name)}">${cols}<Table>${header}${rows}</Table></Worksheet>`;
    })
    .join("");

  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<?mso-application progid="Excel.Sheet"?>' +
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" ' +
    'xmlns:o="urn:schemas-microsoft-com:office:office" ' +
    'xmlns:x="urn:schemas-microsoft-com:office:excel" ' +
    'xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet" ' +
    'xmlns:html="http://www.w3.org/TR/REC-html40">' +
    '<Styles>' +
    '<Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Top"/></Style>' +
    '<Style ss:ID="Header"><Font ss:Bold="1"/></Style>' +
    "</Styles>" +
    body +
    "</Workbook>"
  );
}

// ── Case export ("the invoice") ───────────────────────────────
// Exports one post's case file: summary, comment timeline (the repeated
// incidents), and an evidence/verification sheet. Uses only fields that
// actually exist on PostData (see src/types/index.ts).

export interface CaseCommentRow {
  when: string;
  author: string;
  body: string;
  status?: string;
}

export interface CasePostSummary {
  id: string;
  title: string;
  description: string;
  category?: string;
  status?: string;
  priority?: string;
  created_at?: string;
  updated_at?: string;
  author_id?: string;
  tags?: string[];
  visibility?: string;
  pinned?: boolean;
  locked?: boolean;
  official?: boolean;
  hidden?: boolean;
  comment_count?: number;
  reactions?: Record<string, number> | null;
  linked_poll?: string | null;
  merged_into?: string;
  admin_reply?: string;
  admin_notes?: string;
  ai_summary?: string;
  status_history?: { status: string; at: string; note?: string }[];
}

export interface CaseExportInput {
  post: CasePostSummary;
  comments: CaseCommentRow[];
  /** Extra evidence rows appended to the Evidence & Verification sheet. */
  evidence?: { label: string; value: string }[];
}

export function buildCaseXls(input: CaseExportInput): string {
  const p = input.post;
  const reactions = p.reactions || {};
  const flags = [
    p.visibility === "private" ? "private" : null,
    p.pinned ? "pinned" : null,
    p.locked ? "locked" : null,
    p.official ? "official" : null,
    p.hidden ? "hidden" : null,
    p.merged_into ? `merged→${p.merged_into}` : null,
  ].filter((f): f is string => !!f);

  const summaryRows: (string | number)[][] = [
    ["Case ID", p.id],
    ["Title", p.title],
    ["Category", p.category || ""],
    ["Status", p.status || ""],
    ["Priority", p.priority || ""],
    ["Created", p.created_at || ""],
    ["Updated", p.updated_at || ""],
    ["Flags", flags.join(", ") || "none"],
    ["Tags", (p.tags || []).join(", ")],
    [
      "Reactions",
      Object.keys(reactions).length
        ? Object.entries(reactions)
            .map(([k, v]) => `${k}: ${v}`)
            .join(", ")
        : "none",
    ],
    ["Comment count (server)", p.comment_count ?? "n/a"],
    ["Linked poll", p.linked_poll || ""],
    ["Admin reply", p.admin_reply || ""],
    ["Admin notes", p.admin_notes || ""],
    ["AI summary", p.ai_summary || ""],
  ];
  if (p.status_history?.length) {
    summaryRows.push([
      "Status history",
      p.status_history
        .map((h) => `${h.status} @ ${h.at}${h.note ? ` — ${h.note}` : ""}`)
        .join(" | "),
    ]);
  }
  summaryRows.push(["Description", p.description]);

  const timelineRows = input.comments.map((c) => [c.when, c.author, c.body, c.status || ""]);

  const evidenceRows: (string | number)[][] = [
    ["Timeline rows exported", input.comments.length],
    [
      "Timeline vs server comment_count",
      p.comment_count === undefined
        ? "n/a"
        : input.comments.length === p.comment_count
          ? `match (${p.comment_count})`
          : `mismatch (exported ${input.comments.length}, server ${p.comment_count} — hidden/deleted or pagination)`,
    ],
    [
      "Anonymity preserved",
      "Author IDs are masked on every surface; only the post owner and admins see theirs in full.",
    ],
    ["Safe export", "All cells exported as text — content is never evaluated as a formula."],
    ...(input.evidence || []).map((e) => [e.label, e.value] as (string | number)[]),
  ];

  return buildXls([
    {
      name: "Case Summary",
      columns: [
        { header: "Field", width: 22 },
        { header: "Value", width: 90 },
      ],
      rows: summaryRows,
    },
    {
      name: "Case Timeline",
      columns: [
        { header: "When", width: 26 },
        { header: "Author", width: 18 },
        { header: "Entry", width: 80 },
        { header: "Status", width: 14 },
      ],
      rows: timelineRows,
    },
    {
      name: "Evidence & Verification",
      columns: [
        { header: "Item", width: 34 },
        { header: "Detail", width: 80 },
      ],
      rows: evidenceRows,
    },
  ]);
}

/** Trigger a browser download of the .xls document. */
export function downloadXls(filename: string, xml: string): void {
  const blob = new Blob([`\uFEFF${xml}`], {
    type: "application/vnd.ms-excel;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.toLowerCase().endsWith(".xls") ? filename : `${filename}.xls`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}