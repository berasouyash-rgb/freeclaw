// ═══════════════════════════════════════════════════════════════════
// EVIDENCE — human-readable consequences of a tool run.
// An agent card must show WHAT CHANGED (counts, targets, sentences) —
// never a generic JSON dump. Pure functions, no React.
// ═══════════════════════════════════════════════════════════════════

export interface EvidenceRow {
	label: string;
	value: string;
}

export interface Evidence {
	/** Primary sentence: message / summary / proof / note / … */
	message?: string;
	/** Flattened key → value consequences (top-level primitives). */
	rows: EvidenceRow[];
	/** Affected-entity lines: "#id · title · status". */
	items: string[];
	/** Nothing extractable — render the verify-in-tab hint instead. */
	fallback: boolean;
}

/** Keys whose string value is a sentence, not a data field. */
const MESSAGE_KEYS =
	/^(message|summary|proof|note|reason|detail|details|description|text|hint)$/i;
/** Keys that hold huge blobs — never echo them into a card. */
const SKIP_KEYS = /^(html|raw|stack|trace|csv)$/i;
const MAX_ROWS = 10;
const MAX_ITEMS = 6;
const MAX_DEPTH = 2;

/** open_reports_removed → "Open Reports Removed", post_id → "Post ID". */
export function humanizeKey(key: string): string {
	const spaced = key
		.replace(/_/g, " ")
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/\bid\b/gi, "ID");
	return spaced.replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function fmt(v: string | number | boolean): string {
	return typeof v === "boolean" ? (v ? "Yes" : "No") : String(v);
}

function countLabel(n: number): string {
	return `${n} item${n === 1 ? "" : "s"}`;
}

/** "#7 · My post · solved" — best-effort single line for one entity. */
function itemLine(v: unknown): string | null {
	if (v == null) return null;
	if (typeof v !== "object") return String(v);
	const o = v as Record<string, unknown>;
	const parts: string[] = [];
	if (o.id != null) parts.push(`#${String(o.id)}`);
	for (const k of ["title", "name", "label", "status", "outcome"]) {
		const val = o[k];
		if (typeof val === "string" || typeof val === "number") {
			parts.push(String(val));
		}
	}
	return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * Turn a tool result into message + consequence rows + entity lines.
 * Depth- and size-capped; deep leftovers are dropped rather than
 * dumped as JSON. `fallback: true` when there is nothing to show —
 * the caller then points at the tab where the change is verifiable.
 */
export function extractEvidence(data: unknown): Evidence {
	const rows: EvidenceRow[] = [];
	const items: string[] = [];
	let message: string | undefined;

	const pushRow = (label: string, value: string) => {
		if (rows.length < MAX_ROWS && !rows.some((r) => r.label === label)) {
			rows.push({ label, value });
		}
	};
	const pushItem = (line: string | null) => {
		if (line && items.length < MAX_ITEMS && !items.includes(line)) {
			items.push(line);
		}
	};

	if (typeof data === "string") {
		message = data.trim() || undefined;
	} else if (typeof data === "number" || typeof data === "boolean") {
		pushRow("Result", fmt(data));
	} else if (Array.isArray(data)) {
		pushRow("Items", countLabel(data.length));
		for (const v of data) pushItem(itemLine(v));
	} else if (isPlainObject(data)) {
		const walk = (obj: Record<string, unknown>, path: string[], depth: number): void => {
			for (const [k, v] of Object.entries(obj)) {
				if (v == null || SKIP_KEYS.test(k)) continue;
				const label = humanizeKey([...path, k].join("_"));
				if (typeof v === "string") {
					if (v === "") continue;
					if (MESSAGE_KEYS.test(k) && !message) {
						message = v;
					} else {
						pushRow(label, v);
					}
				} else if (typeof v === "number" || typeof v === "boolean") {
					pushRow(label, fmt(v));
				} else if (Array.isArray(v)) {
					pushRow(label, countLabel(v.length));
					for (const item of v) pushItem(itemLine(item));
				} else if (isPlainObject(v) && depth < MAX_DEPTH) {
					walk(v, [...path, k], depth + 1);
				}
			}
		};
		walk(data, [], 0);
	}

	return {
		message,
		rows,
		items,
		fallback: !message && rows.length === 0 && items.length === 0,
	};
}

/** Flatten tool args into label/value rows (depth-capped, never JSON). */
export function flattenArgs(args: Record<string, unknown> | undefined): EvidenceRow[] {
	const out: EvidenceRow[] = [];
	const walk = (obj: Record<string, unknown>, path: string[], depth: number): void => {
		for (const [k, v] of Object.entries(obj)) {
			if (out.length >= MAX_ROWS) return;
			if (v == null || v === "" || SKIP_KEYS.test(k)) continue;
			const label = humanizeKey([...path, k].join("_"));
			if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
				if (!out.some((r) => r.label === label)) out.push({ label, value: fmt(v) });
			} else if (Array.isArray(v)) {
				if (!out.some((r) => r.label === label)) {
					out.push({ label, value: countLabel(v.length) });
				}
			} else if (isPlainObject(v)) {
				if (depth < MAX_DEPTH) walk(v, [...path, k], depth + 1);
				else if (!out.some((r) => r.label === label)) {
					out.push({ label, value: `${Object.keys(v).length} fields` });
				}
			}
		}
	};
	if (isPlainObject(args)) walk(args, [], 0);
	return out;
}

/** One-line human summary of args: "Status: hidden · Ids: 3 items". */
export function summarizeArgs(args: Record<string, unknown>): string {
	const rows = flattenArgs(args);
	return rows.length > 0
		? rows.map((r) => `${r.label}: ${r.value}`).join(" · ")
		: "No parameters";
}
