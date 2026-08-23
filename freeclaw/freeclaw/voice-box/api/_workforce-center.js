// ═══════════════════════════════════════════════════════════════
// Workforce Center API — admin command center for the hidden workforce.
// GET  /api/workforce-center            → { workers, health, ledger }
// POST /api/workforce-center            → actions:
//        { action: "run_scan" }         → runs the Phase-2 roster now
//        { action: "run_worker", id }   → runs ONE worker now
// Every number served here originates from recorded ledger rows or live
// queries performed at request time. Nothing is fabricated or cached.
// ═══════════════════════════════════════════════════════════════

import { cors, isAdmin } from "./_auth.js";
import supabase from "./_db-client.js";
import { sanitizeError } from "./_error.js";
import {
	getRegistry,
	readLedger,
	runWorker,
	workforceHealth,
} from "./_workforce-core.js";

// Load worker specs so the roster registers before we serve metadata.
let rosterLoaded = false;
async function ensureRoster() {
	if (!rosterLoaded) {
		await import("./_workforce-workers.js");
		rosterLoaded = true;
	}
}

export default async function handler(req, res) {
	cors(res, req);
	if (req.method === "OPTIONS") return res.status(204).end();

	try {
		if (!(await isAdmin(req)))
			return res.status(403).json({ error: "Admin only" });

		await ensureRoster();

		if (req.method === "GET") {
			const [health, ledger] = await Promise.all([
				workforceHealth(),
				readLedger(60),
			]);
			const workers = getRegistry().map((w) => ({
				worker_id: w.worker_id,
				name: w.name,
				responsibility: w.responsibility,
				execution_class: w.execution_class,
				risk_level: w.risk_level,
				trigger_types: w.trigger_types,
				budget: w.budget,
				tools: w.tools,
			}));
			return res.status(200).json({ workers, health, ledger });
		}

		if (req.method === "POST") {
			const b = req.body || {};
			if (b.action === "run_scan") {
				const { runHighValueRoster } = await import(
					"./_workforce-workers.js"
				);
				const results = await runHighValueRoster("admin_manual");
				const health = await workforceHealth();
				return res.status(200).json({ ok: true, results, health });
			}
			if (b.action === "run_worker" && typeof b.id === "string") {
				const known = getRegistry().some((w) => w.worker_id === b.id);
				if (!known)
					return res.status(404).json({ error: "Unknown worker" });
				const result = await runWorker(b.id, "admin_manual");
				const health = await workforceHealth();
				return res.status(200).json({ ok: true, result, health });
			}
			return res.status(400).json({ error: "Unknown action" });
		}

		return res.status(405).json({ error: "Method not allowed" });
	} catch (err) {
		return sanitizeError(res, err, "workforce-center");
	}
}
