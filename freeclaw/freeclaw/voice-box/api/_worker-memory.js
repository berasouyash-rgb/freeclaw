// ═══════════════════════════════════════════════════════════════════
// WORKER MEMORY — Operational knowledge persistence
// ═══════════════════════════════════════════════════════════════════
// Workers store and retrieve operational knowledge:
//   EPISODIC:      what happened (incidents, fixes, outcomes)
//   SEMANTIC:      known system facts (baselines, configurations)
//   PROCEDURAL:    how to perform tasks (tool sequences, patterns)
//   FAILURE:       what previously failed (avoid repeating)
//   OPTIMIZATION:  what improved metrics (reusable patterns)
//   POLICY:        what actions are allowed (guardrails)
//
// Every memory record has:
//   source, timestamp, confidence, version, scope
//
// Workers must be able to discard stale knowledge.
// ═══════════════════════════════════════════════════════════════════

import supabase from "./_db-client.js";

const MEMORY_KEY = "workforce_memory";
const MEMORY_MAX_ENTRIES = 500;
const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ── Memory Types ───────────────────────────────────────────────
export const MemoryType = {
	EPISODIC: "episodic",       // what happened
	SEMANTIC: "semantic",       // known facts
	PROCEDURAL: "procedural",   // how to do things
	FAILURE: "failure",         // what failed
	OPTIMIZATION: "optimization", // what improved metrics
	POLICY: "policy",           // what's allowed
};

// ── Core Memory Operations ─────────────────────────────────────

/**
 * Store a memory record.
 * @param {string} workerId - the worker storing this memory
 * @param {string} type - one of MemoryType values
 * @param {Object} record - { title, details, context?, tags?, confidence? }
 */
export async function storeMemory(workerId, type, record) {
	const entry = {
		id: `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
		worker_id: workerId,
		type,
		title: record.title || "untitled",
		details: record.details || "",
		context: record.context || null,
		tags: record.tags || [],
		confidence: record.confidence ?? 0.8,
		version: record.version || "1.0",
		scope: record.scope || "local",
		created_at: new Date().toISOString(),
		last_accessed: new Date().toISOString(),
		access_count: 0,
	};

	try {
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", MEMORY_KEY)
			.maybeSingle();

		const memories = data?.value?.memories || [];
		memories.unshift(entry);

		// Trim to max entries, removing oldest unused
		if (memories.length > MEMORY_MAX_ENTRIES) {
			memories.sort((a, b) => a.access_count - b.access_count || new Date(a.created_at) - new Date(b.created_at));
			memories.length = MEMORY_MAX_ENTRIES;
		}

		await supabase.from("settings").upsert(
			{
				key: MEMORY_KEY,
				value: { memories, updated_at: new Date().toISOString() },
			},
			{ onConflict: "key" },
		);

		return entry;
	} catch (err) {
		console.error("[memory] store failed:", err?.message);
		return null;
	}
}

/**
 * Query memories by worker, type, or tags.
 */
export async function queryMemory(workerId, options = {}) {
	const { type, tags, limit = 20, includeStale = false } = options;

	try {
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", MEMORY_KEY)
			.maybeSingle();

		let memories = data?.value?.memories || [];

		// Filter by worker
		if (workerId) {
			memories = memories.filter(m => m.worker_id === workerId || m.scope === "global");
		}

		// Filter by type
		if (type) {
			memories = memories.filter(m => m.type === type);
		}

		// Filter by tags
		if (tags && tags.length > 0) {
			memories = memories.filter(m => tags.some(t => m.tags?.includes(t)));
		}

		// Filter out stale memories unless requested
		if (!includeStale) {
			const cutoff = Date.now() - STALE_THRESHOLD_MS;
			memories = memories.filter(m => {
				const lastAccess = new Date(m.last_accessed).getTime();
				return lastAccess > cutoff || m.type === MemoryType.POLICY; // policies never go stale
			});
		}

		return memories.slice(0, limit);
	} catch {
		return [];
	}
}

/**
 * Access a memory (updates access count and timestamp).
 */
export async function accessMemory(memoryId) {
	try {
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", MEMORY_KEY)
			.maybeSingle();

		const memories = data?.value?.memories || [];
		const mem = memories.find(m => m.id === memoryId);
		if (mem) {
			mem.last_accessed = new Date().toISOString();
			mem.access_count = (mem.access_count || 0) + 1;
			await supabase.from("settings").upsert(
				{
					key: MEMORY_KEY,
					value: { memories, updated_at: new Date().toISOString() },
				},
				{ onConflict: "key" },
			);
		}
		return mem || null;
	} catch {
		return null;
	}
}

/**
 * Discard stale memories (older than threshold and not recently accessed).
 */
export async function discardStaleMemories() {
	try {
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", MEMORY_KEY)
			.maybeSingle();

		const memories = data?.value?.memories || [];
		const cutoff = Date.now() - STALE_THRESHOLD_MS;
		const before = memories.length;

		const kept = memories.filter(m => {
			if (m.type === MemoryType.POLICY) return true; // never discard policies
			const lastAccess = new Date(m.last_accessed).getTime();
			return lastAccess > cutoff;
		});

		if (kept.length < before) {
			await supabase.from("settings").upsert(
				{
					key: MEMORY_KEY,
					value: { memories: kept, updated_at: new Date().toISOString() },
				},
				{ onConflict: "key" },
			);
		}

		return { discarded: before - kept.length, remaining: kept.length };
	} catch {
		return { discarded: 0, remaining: 0 };
	}
}

/**
 * Get memory statistics.
 */
export async function getMemoryStats() {
	try {
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", MEMORY_KEY)
			.maybeSingle();

		const memories = data?.value?.memories || [];
		const byType = {};
		const byWorker = {};

		for (const m of memories) {
			byType[m.type] = (byType[m.type] || 0) + 1;
			byWorker[m.worker_id] = (byWorker[m.worker_id] || 0) + 1;
		}

		const now = Date.now();
		const staleCount = memories.filter(m => {
			if (m.type === MemoryType.POLICY) return false;
			return now - new Date(m.last_accessed).getTime() > STALE_THRESHOLD_MS;
		}).length;

		return {
			total: memories.length,
			by_type: byType,
			by_worker: byWorker,
			stale: staleCount,
			healthy: memories.length - staleCount,
		};
	} catch {
		return { total: 0, by_type: {}, by_worker: {}, stale: 0, healthy: 0 };
	}
}

/**
 * Get relevant memories for a specific task.
 * Combines episodic, procedural, and failure memories.
 */
export async function getTaskContext(workerId, taskType) {
	const [episodic, procedural, failures, optimizations] = await Promise.all([
		queryMemory(workerId, { type: MemoryType.EPISODIC, limit: 5 }),
		queryMemory(workerId, { type: MemoryType.PROCEDURAL, limit: 5 }),
		queryMemory(workerId, { type: MemoryType.FAILURE, limit: 3 }),
		queryMemory(workerId, { type: MemoryType.OPTIMIZATION, limit: 3 }),
	]);

	return {
		recent_events: episodic,
		known_procedures: procedural,
		known_failures: failures,
		proven_optimizations: optimizations,
	};
}

// ── Knowledge Ingestion ────────────────────────────────────────

/**
 * Ingest knowledge from a verified incident.
 */
export async function ingestIncident(workerId, incident) {
	return storeMemory(workerId, MemoryType.EPISODIC, {
		title: incident.title || "incident",
		details: incident.description || "",
		context: {
			severity: incident.severity,
			affected_systems: incident.affected_systems,
			resolution: incident.resolution,
			duration_ms: incident.duration_ms,
		},
		tags: ["incident", ...(incident.tags || [])],
		confidence: 1.0,
		scope: "global",
	});
}

/**
 * Ingest a verified optimization (proven to improve metrics).
 */
export async function ingestOptimization(workerId, optimization) {
	return storeMemory(workerId, MemoryType.OPTIMIZATION, {
		title: optimization.title || "optimization",
		details: optimization.description || "",
		context: {
			metric: optimization.metric,
			before: optimization.before,
			after: optimization.after,
			improvement: optimization.improvement,
			method: optimization.method,
		},
		tags: ["optimization", optimization.metric, ...(optimization.tags || [])],
		confidence: 1.0,
		scope: "global",
	});
}

/**
 * Ingest a known failure pattern (to avoid repeating).
 */
export async function ingestFailure(workerId, failure) {
	return storeMemory(workerId, MemoryType.FAILURE, {
		title: failure.title || "failure pattern",
		details: failure.description || "",
		context: {
			cause: failure.cause,
			what_tried: failure.what_tried,
			what_worked: failure.resolution,
			root_cause: failure.root_cause,
		},
		tags: ["failure", ...(failure.tags || [])],
		confidence: 0.9,
		scope: "local",
	});
}
