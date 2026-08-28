// ─── Frontend Error Receiver ─────────────────────────────────────
// Receives real JS errors from the frontend via POST /api/errors and
// aggregates them for the admin dashboard. Every error comes from a
// real browser — nothing is simulated.
import { securityCheck } from "./_security.js";

// In-memory aggregation
const _errors = new Map(); // dedup_key → { message, source, filename, count, first, last, samples, device_breakdown }
const _recent = []; // last N errors in order for the admin feed
const MAX_RECENT = 100;
const MAX_SAMPLES = 3; // keep up to 3 stack samples per unique error

export default async function handler(req, res) {
	const identity = securityCheck(req);
	if (identity === null) return res.status(429).json({ error: "rate limited" });

	// ── POST /api/errors — receive errors from frontend ──────────
	if (req.method === "POST") {
		const { errors } = req.body || {};
		if (!Array.isArray(errors) || errors.length === 0) {
			return res.status(400).json({ error: "errors array required" });
		}

		for (const e of errors) {
			if (!e.message || !e.source) continue;

			const key = `${e.source}:${e.message.slice(0, 120)}:${e.filename || ""}:${e.lineno || 0}:${e.colno || 0}`;

			const existing = _errors.get(key);
			const count = e.count || 1;

			if (existing) {
				existing.count += count;
				existing.last = e.timestamp;
				if (existing.samples.length < MAX_SAMPLES && e.stack) {
					existing.samples.push({ stack: e.stack, url: e.url, timestamp: e.timestamp });
				}
				existing.devices[e.device || "unknown"] = (existing.devices[e.device || "unknown"] || 0) + count;
			} else {
				_errors.set(key, {
					id: key,
					message: e.message,
					source: e.source,
					filename: e.filename,
					lineno: e.lineno,
					colno: e.colno,
					count,
					first: e.timestamp,
					last: e.timestamp,
					samples: e.stack ? [{ stack: e.stack, url: e.url, timestamp: e.timestamp }] : [],
					devices: { [e.device || "unknown"]: count },
				});
			}

			// Add to recent feed (deduplicated)
			_recent.unshift({
				message: e.message.slice(0, 200),
				source: e.source,
				filename: e.filename,
				url: e.url,
				device: e.device,
				timestamp: e.timestamp,
			});
			if (_recent.length > MAX_RECENT) _recent.pop();
		}

		return res.status(200).json({ ok: true, received: errors.length });
	}

	// ── GET /api/errors — admin dashboard reads aggregated errors ──
	if (req.method === "GET") {
		const sortByCount = [..._errors.values()]
			.sort((a, b) => b.count - a.count)
			.slice(0, 50);

		return res.status(200).json({
			ok: true,
			summary: {
				total_unique: _errors.size,
				total_reports: sortByCount.reduce((a, e) => a + e.count, 0),
				by_source: sortByCount.reduce((acc, e) => {
					acc[e.source] = (acc[e.source] || 0) + e.count;
					return acc;
				}, {}),
			},
			errors: sortByCount.map((e) => ({
				id: e.id,
				message: e.message,
				source: e.source,
				filename: e.filename,
				count: e.count,
				first: e.first,
				last: e.last,
				devices: e.devices,
				samples: e.samples,
			})),
			recent: _recent,
		});
	}

	res.setHeader("Allow", "GET, POST");
	res.status(405).json({ error: "method not allowed" });
}
