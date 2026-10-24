// ═══════════════════════════════════════════════════════════════════
// WORKFORCE PROOF API — Admin endpoint for workforce verification
// ═══════════════════════════════════════════════════════════════════
// Exposes:
//   GET /api/workforce-proof?action=run     → run all proof tests
//   GET /api/workforce-proof?action=results → get latest results
//   GET /api/workforce-proof?action=memory  → memory stats
//   GET /api/workforce-proof?action=learning → learning status
//   GET /api/workforce-proof?action=versions → version history
//   GET /api/workforce-proof?action=canaries → canary status
// ═══════════════════════════════════════════════════════════════════

import { cors, isAdmin } from "./_auth.js";
import { setSecurityHeaders } from "./_security.js";
import { runWorkforceProof, getProofResults, getProofSummary } from "./_workforce-proof.js";
import { getMemoryStats, queryMemory, discardStaleMemories } from "./_worker-memory.js";
import { getLearningStatus, collectProductionEvidence, getAllCanaries, getVersionHistory } from "./_continuous-learning.js";
import { getRegistry } from "./_workforce-core.js";

export default async function handler(req, res) {
	// This is an admin surface: it exposes worker memory contents, learning
	// evidence and proof runs, and `memory-cleanup` mutates state. It shipped
	// with no auth check at all, so gate it exactly like /api/workforce-api.
	cors(res, req.method === "OPTIONS");
	if (req.method === "OPTIONS") return res.status(200).end();
	if (!(await isAdmin(req)))
		return res.status(401).json({ error: "Admin required" });
	setSecurityHeaders(res);

	const action = req.query?.action || req.body?.action || "summary";

	try {
		switch (action) {
			case "run": {
				const results = await runWorkforceProof();
				return res.json({ ok: true, results });
			}
			case "results": {
				return res.json({ ok: true, results: getProofResults(), summary: getProofSummary() });
			}
			case "memory": {
				const stats = await getMemoryStats();
				return res.json({ ok: true, stats });
			}
			case "memory-query": {
				const workerId = req.query?.worker_id;
				const type = req.query?.type;
				const memories = await queryMemory(workerId, { type, limit: 20 });
				return res.json({ ok: true, memories });
			}
			case "memory-cleanup": {
				const result = await discardStaleMemories();
				return res.json({ ok: true, result });
			}
			case "learning": {
				const status = await getLearningStatus();
				return res.json({ ok: true, status });
			}
			case "evidence": {
				const evidence = await collectProductionEvidence();
				return res.json({ ok: true, evidence });
			}
			case "versions": {
				const workerId = req.query?.worker_id;
				if (workerId) {
					const history = await getVersionHistory(workerId);
					return res.json({ ok: true, worker_id: workerId, versions: history });
				}
				// Return all versions
				const workers = getRegistry();
				const allVersions = {};
				for (const w of workers) {
					allVersions[w.worker_id] = await getVersionHistory(w.worker_id);
				}
				return res.json({ ok: true, versions: allVersions });
			}
			case "canaries": {
				const canaries = await getAllCanaries();
				return res.json({ ok: true, canaries });
			}
			default: {
				// Summary view
				const [proofSummary, memoryStats, learningStatus] = await Promise.all([
					getProofSummary(),
					getMemoryStats(),
					getLearningStatus(),
				]);
				return res.json({
					ok: true,
					proof: proofSummary,
					memory: memoryStats,
					learning: learningStatus,
				});
			}
		}
	} catch (err) {
		return res.status(500).json({ ok: false, error: err.message });
	}
}
