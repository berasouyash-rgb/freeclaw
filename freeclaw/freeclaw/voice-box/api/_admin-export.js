// ─── Admin Export Engine ────────────────────────────────────────
// POST /api/admin-export — Export admin table data as CSV
//
// Accepts:
//   resource: "reports" | "posts" | "users" | "comments" | "polls" | "incidents"
//   filters:  { status?, category?, date_from?, date_to?, search? }
//   sort:     { field: string, direction: "asc" | "desc" }
//   limit:    number (max rows, default 10000)
//   format:   "csv" (default) — extensible to "json"
//
// Returns CSV with proper headers, escaped values, and metadata row.
// Respects authorization — only admin can export.

import { cors, isAdmin } from "./_auth.js";
import supabase from "./_db-client.js";
import { logger } from "./_observability.js";

const MAX_ROWS = 50000;
const DEFAULT_ROWS = 10000;

// ─── Column definitions per resource ──────────────────────────
const RESOURCE_COLUMNS = {
	reports: {
		table: "reports",
		columns: [
			{ key: "id", header: "ID" },
			{ key: "target_id", header: "Target ID" },
			{ key: "target_type", header: "Target Type" },
			{ key: "reason", header: "Reason" },
			{ key: "details", header: "Details" },
			{ key: "status", header: "Status" },
			{ key: "author_id", header: "Reporter" },
			{ key: "created_at", header: "Created At" },
		],
		statusCol: "status",
		dateCol: "created_at",
		searchCols: ["reason", "details", "target_id"],
	},
	posts: {
		table: "posts",
		columns: [
			{ key: "id", header: "ID" },
			{ key: "title", header: "Title" },
			{ key: "description", header: "Description" },
			{ key: "category", header: "Category" },
			{ key: "author_id", header: "Author" },
			{ key: "created_at", header: "Created At" },
			{ key: "image_url", header: "Has Image" },
		],
		statusCol: null,
		dateCol: "created_at",
		searchCols: ["title", "description", "id"],
	},
	users: {
		table: "users_meta",
		columns: [
			{ key: "anon_id", header: "Anon ID" },
			{ key: "created_at", header: "Created At" },
			{ key: "last_seen", header: "Last Seen" },
			{ key: "strikes", header: "Strikes" },
			{ key: "banned", header: "Banned" },
			{ key: "suspended_until", header: "Suspended Until" },
		],
		statusCol: null,
		dateCol: "created_at",
		searchCols: ["anon_id"],
	},
	comments: {
		table: "comments",
		columns: [
			{ key: "id", header: "ID" },
			{ key: "post_id", header: "Post ID" },
			{ key: "body", header: "Body" },
			{ key: "author_id", header: "Author" },
			{ key: "created_at", header: "Created At" },
		],
		statusCol: null,
		dateCol: "created_at",
		searchCols: ["body", "id"],
	},
	polls: {
		table: "polls",
		columns: [
			{ key: "id", header: "ID" },
			{ key: "question", header: "Question" },
			{ key: "options", header: "Options" },
			{ key: "author_id", header: "Author" },
			{ key: "created_at", header: "Created At" },
			{ key: "expires_at", header: "Expires At" },
		],
		statusCol: null,
		dateCol: "created_at",
		searchCols: ["question", "id"],
	},
	incidents: {
		table: "incidents",
		columns: [
			{ key: "id", header: "ID" },
			{ key: "title", header: "Title" },
			{ key: "severity", header: "Severity" },
			{ key: "status", header: "Status" },
			{ key: "service", header: "Service" },
			{ key: "created_at", header: "Created At" },
			{ key: "resolved_at", header: "Resolved At" },
		],
		statusCol: "status",
		dateCol: "created_at",
		searchCols: ["title", "service"],
	},
};

// ─── CSV Escaping ─────────────────────────────────────────────
function escapeCsvValue(val) {
	if (val === null || val === undefined) return "";
	const str = typeof val === "object" ? JSON.stringify(val) : String(val);
	// If value contains comma, newline, or quotes — wrap in quotes
	if (str.includes(",") || str.includes("\n") || str.includes('"')) {
		return `"${str.replace(/"/g, '""')}"`;
	}
	return str;
}

function toCsv(headers, rows) {
	const lines = [headers.map(escapeCsvValue).join(",")];
	for (const row of rows) {
		lines.push(headers.map((h) => escapeCsvValue(row[h])).join(","));
	}
	return lines.join("\n");
}

// ─── Build Supabase query from filters ───────────────────────
function buildQuery(resource, filters = {}, sort = {}) {
	const config = RESOURCE_COLUMNS[resource];
	if (!config) return null;

	let query = supabase.from(config.table).select("*");

	// Status filter
	if (filters.status && config.statusCol) {
		query = query.eq(config.statusCol, filters.status);
	}

	// Category filter (for posts)
	if (filters.category && resource === "posts") {
		query = query.eq("category", filters.category);
	}

	// Date range filter
	if (filters.date_from && config.dateCol) {
		query = query.gte(config.dateCol, filters.date_from);
	}
	if (filters.date_to && config.dateCol) {
		query = query.lte(config.dateCol, filters.date_to);
	}

	// Search filter (OR across search columns)
	if (filters.search && config.searchCols && config.searchCols.length > 0) {
		const searchFilter = config.searchCols
			.map((col) => `${col}.ilike.%${filters.search}%`)
			.join(",");
		query = query.or(searchFilter);
	}

	// Sort
	if (sort.field && config.columns.some((c) => c.key === sort.field)) {
		query = query.order(sort.field, { ascending: sort.direction === "asc" });
	} else if (config.dateCol) {
		query = query.order(config.dateCol, { ascending: false });
	}

	return query;
}

// ─── Handler ──────────────────────────────────────────────────
export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();

	// Authorization
	const authed = await isAdmin(req);
	if (!authed) {
		return res.status(401).json({ error: "Admin access required" });
	}

	if (req.method !== "POST") {
		return res.status(405).json({ error: "POST required" });
	}

	const { resource, filters = {}, sort = {}, limit, format = "csv" } = req.body || {};

	if (!resource || !RESOURCE_COLUMNS[resource]) {
		return res.status(400).json({
			error: "Invalid resource",
			available: Object.keys(RESOURCE_COLUMNS),
		});
	}

	try {
		const config = RESOURCE_COLUMNS[resource];
		const rowLimit = Math.min(Number(limit) || DEFAULT_ROWS, MAX_ROWS);

		const query = buildQuery(resource, filters, sort);
		if (!query) {
			return res.status(400).json({ error: "Failed to build query" });
		}

		const { data, error, count } = await query.limit(rowLimit);

		if (error) {
			logger.error("admin-export", "query_failed", { resource, error: error.message });
			return res.status(500).json({ error: "Query failed", detail: error.message });
		}

		const rows = data || [];

		// Build header mapping (only include columns that exist in the data)
		const existingKeys = new Set();
		for (const row of rows) {
			for (const key of Object.keys(row)) existingKeys.add(key);
		}

		const exportColumns = config.columns.filter(
			(c) => existingKeys.has(c.key) || rows.some((r) => r[c.key] !== undefined),
		);

		// Add any extra keys not in our column definition
		for (const key of existingKeys) {
			if (!exportColumns.some((c) => c.key === key)) {
				exportColumns.push({ key, header: key });
			}
		}

		const headers = exportColumns.map((c) => c.header);
		const headerKeys = exportColumns.map((c) => c.key);

		if (format === "csv") {
			const csvData = rows.map((row) => {
				const mapped = {};
				for (let i = 0; i < headerKeys.length; i++) {
					mapped[headers[i]] = row[headerKeys[i]];
				}
				return mapped;
			});

			const csv = toCsv(headers, csvData);

			// Add metadata footer
			const metadata = [
				"",
				`# Export: ${resource}`,
				`# Rows: ${rows.length}`,
				`# Filters: ${JSON.stringify(filters)}`,
				`# Exported at: ${new Date().toISOString()}`,
				`# Exported by: admin`,
			].join("\n");

			const fullCsv = csv + "\n" + metadata;

			const filename = `voicebox-${resource}-${new Date().toISOString().slice(0, 10)}.csv`;

			res.setHeader("Content-Type", "text/csv; charset=utf-8");
			res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
			res.setHeader("X-Export-Rows", String(rows.length));
			res.setHeader("X-Export-Resource", resource);

			logger.info("admin-export", "export_completed", {
				resource,
				rows: rows.length,
				filters: Object.keys(filters).length > 0 ? filters : "none",
			});

			// NOTE: this codebase's response shim implements status/json/end only
			// (no Express-style .send), so the CSV must go out through end().
			// Using .send() here threw "res.status(...).send is not a function"
			// AFTER the query succeeded — a 500 on every export.
			const payload = "\ufeff" + fullCsv; // BOM for Excel
			res.setHeader("Content-Length", String(Buffer.byteLength(payload, "utf8")));
			return res.status(200).end(payload);
		}

		// JSON format fallback
		return res.status(200).json({
			resource,
			rows: rows.length,
			columns: exportColumns.map((c) => ({ key: c.key, header: c.header })),
			data: rows,
			filters,
			sort,
			exported_at: new Date().toISOString(),
		});
	} catch (err) {
		logger.error("admin-export", "export_error", { resource, error: err.message });
		return res.status(500).json({ error: "Export failed" });
	}
}
