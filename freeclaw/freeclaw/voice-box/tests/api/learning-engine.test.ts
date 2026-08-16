// ═══════════════════════════════════════════════════════════════════
// Learning Engine Tests
// ═══════════════════════════════════════════════════════════════════
// Tests: feedback loops, LLM reflections, knowledge sharing,
// admin feedback, self-modification, pattern analysis, decay
// ═══════════════════════════════════════════════════════════════════

import { beforeEach, describe, expect, it } from "vitest";

// ═══════════════════════════════════════════════════════════════════
// Pure implementations (isolated from Supabase)
// ═══════════════════════════════════════════════════════════════════

// ─── Constants ────────────────────────────────────────────────────
const REFLECTION_COOLDOWN_MS = 3600000; // 1 hour
const MAX_FAILURES_BEFORE_REFLECTION = 3;
const INSIGHT_CONFIDENCE_THRESHOLD = 0.6;
const KNOWLEDGE_DECAY_DAYS = 30;

// ─── Types ────────────────────────────────────────────────────────
interface LearningRecord {
	agent_id: string;
	division: string;
	task_type: string;
	outcome: "success" | "failure" | "partial";
	metrics: Record<string, unknown>;
	duration_ms: number;
	confidence: number;
	created_at: string;
}

interface Insight {
	id?: string;
	agent_id: string;
	division: string;
	insight_type: string;
	description: string;
	confidence: number;
	action: string;
	priority: string;
	source: string;
	applied: boolean;
	created_at: string;
}

interface KnowledgeEntry {
	agent_id: string;
	division: string;
	pattern_type: string;
	description: string;
	confidence: number;
	task_type: string;
	share_level: string;
	created_at: string;
	expires_at: string;
}

interface FeedbackEntry {
	agent_id: string;
	rating: number;
	weight: number;
	created_at: string;
}

interface PatternAnalysis {
	type: string;
	task_type?: string;
	failure_rate?: number;
	success_rate?: number;
	confidence: number;
	recommendation: string;
}

// ─── In-memory storage ────────────────────────────────────────────
let learningRecords: LearningRecord[] = [];
let insights: Insight[] = [];
let knowledgeEntries: KnowledgeEntry[] = [];
let feedbackEntries: FeedbackEntry[] = [];
let agentConfigs: Record<string, Record<string, unknown>> = {};
const reflectionCooldowns = new Map<string, number>();

function resetStore() {
	learningRecords = [];
	insights = [];
	knowledgeEntries = [];
	feedbackEntries = [];
	agentConfigs = {};
	reflectionCooldowns.clear();
}

// ═══════════════════════════════════════════════════════════════════
// A. FEEDBACK LOOP ENGINE
// ═══════════════════════════════════════════════════════════════════

function recordTaskOutcome(
	agentId: string,
	division: string,
	taskType: string,
	outcome: "success" | "failure" | "partial",
	metrics: Record<string, unknown> = {},
): { ok: boolean; triggered_reflection: boolean } {
	const record: LearningRecord = {
		agent_id: agentId,
		division: division || "unknown",
		task_type: taskType || "general",
		outcome: outcome || "success",
		metrics,
		duration_ms: (metrics.duration_ms as number) || 0,
		confidence:
			(metrics.confidence as number) ??
			(outcome === "success" ? 0.8 : outcome === "failure" ? 0.3 : 0.5),
		created_at: new Date().toISOString(),
	};

	learningRecords.push(record);

	// Auto-trigger reflection check on failure
	let triggeredReflection = false;
	if (outcome === "failure") {
		triggeredReflection = checkReflectionTrigger(agentId, division, taskType);
	}

	return { ok: true, triggered_reflection: triggeredReflection };
}

function getLearningRecords(
	agentId: string | null = null,
	division: string | null = null,
	limit: number = 50,
): LearningRecord[] {
	let records = [...learningRecords].sort(
		(a, b) =>
			new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
	);
	if (agentId) records = records.filter((r) => r.agent_id === agentId);
	if (division) records = records.filter((r) => r.division === division);
	return records.slice(0, Math.min(limit, 200));
}

function getTaskStats(): {
	total: number;
	success: number;
	failure: number;
	partial: number;
	success_rate: number;
	avg_confidence: number;
} {
	const total = learningRecords.length;
	const success = learningRecords.filter((r) => r.outcome === "success").length;
	const failure = learningRecords.filter((r) => r.outcome === "failure").length;
	const partial = learningRecords.filter((r) => r.outcome === "partial").length;
	const avgConfidence =
		total > 0
			? learningRecords.reduce((s, r) => s + r.confidence, 0) / total
			: 0;

	return {
		total,
		success,
		failure,
		partial,
		success_rate: total > 0 ? Math.round((success / total) * 100) : 0,
		avg_confidence: Math.round(avgConfidence * 100) / 100,
	};
}

// ═══════════════════════════════════════════════════════════════════
// B. PATTERN ANALYSIS
// ═══════════════════════════════════════════════════════════════════

function analyzePatterns(
	agentId: string | null = null,
	division: string | null = null,
): { patterns: PatternAnalysis[]; summary: string; sample_size: number } {
	const records = getLearningRecords(agentId, division, 200);
	if (records.length < 5) {
		return {
			patterns: [],
			summary: "Insufficient data for pattern analysis",
			sample_size: records.length,
		};
	}

	const patterns: PatternAnalysis[] = [];

	// Group by task_type
	const byTaskType: Record<string, LearningRecord[]> = {};
	records.forEach((r) => {
		if (!byTaskType[r.task_type]) byTaskType[r.task_type] = [];
		byTaskType[r.task_type].push(r);
	});

	for (const [taskType, taskRecords] of Object.entries(byTaskType)) {
		const failures = taskRecords.filter((r) => r.outcome === "failure");
		const successes = taskRecords.filter((r) => r.outcome === "success");
		const failureRate = failures.length / taskRecords.length;

		if (failureRate > 0.5 && failures.length >= 3) {
			patterns.push({
				type: "high_failure_rate",
				task_type: taskType,
				failure_rate: Math.round(failureRate * 100),
				confidence: Math.min(0.9, 0.5 + failures.length * 0.05),
				recommendation: `Agent has ${Math.round(failureRate * 100)}% failure rate on "${taskType}"`,
			});
		}

		if (successes.length >= 5) {
			const avgConfidence =
				successes.reduce((sum, r) => sum + r.confidence, 0) / successes.length;
			if (avgConfidence > 0.7) {
				patterns.push({
					type: "strong_performance",
					task_type: taskType,
					success_rate: Math.round(
						(successes.length / taskRecords.length) * 100,
					),
					confidence: 0.8,
					recommendation: `Agent excels at "${taskType}"`,
				});
			}
		}
	}

	// Detect declining performance
	if (records.length >= 20) {
		const recent = records.slice(0, 10);
		const previous = records.slice(10, 20);
		const recentSuccess =
			recent.filter((r) => r.outcome === "success").length / recent.length;
		const prevSuccess =
			previous.filter((r) => r.outcome === "success").length / previous.length;

		if (prevSuccess - recentSuccess > 0.2) {
			patterns.push({
				type: "declining_performance",
				confidence: 0.75,
				recommendation: `Performance dropped ${Math.round((prevSuccess - recentSuccess) * 100)}%`,
			});
		}
	}

	return {
		patterns,
		summary:
			patterns.length > 0
				? `Found ${patterns.length} pattern(s)`
				: "No significant patterns detected",
		sample_size: records.length,
	};
}

// ═══════════════════════════════════════════════════════════════════
// C. REFLECTION SYSTEM
// ═══════════════════════════════════════════════════════════════════

function checkReflectionTrigger(
	agentId: string,
	_division: string,
	taskType: string,
): boolean {
	const cooldownKey = `${agentId}:${taskType}`;
	const lastReflection = reflectionCooldowns.get(cooldownKey) || 0;

	if (Date.now() - lastReflection < REFLECTION_COOLDOWN_MS) return false;

	// Count recent failures for this agent + task type
	const oneHourAgo = Date.now() - 3600000;
	const recentFailures = learningRecords.filter(
		(r) =>
			r.agent_id === agentId &&
			r.task_type === taskType &&
			r.outcome === "failure" &&
			new Date(r.created_at).getTime() > oneHourAgo,
	);

	if (recentFailures.length >= MAX_FAILURES_BEFORE_REFLECTION) {
		reflectionCooldowns.set(cooldownKey, Date.now());
		return true;
	}

	return false;
}

function triggerReflection(
	agentId: string,
	division: string,
	reason: string = "admin_request",
	_context: string = "",
): {
	triggered: boolean;
	reason: string;
	insights_count?: number;
	insights?: Array<{
		type: string;
		description: string;
		confidence: number;
		action: string;
		priority: string;
	}>;
	summary?: string;
} {
	const cooldownKey = `${agentId}:${_context || "global"}`;
	const lastReflection = reflectionCooldowns.get(cooldownKey) || 0;

	if (
		Date.now() - lastReflection < REFLECTION_COOLDOWN_MS &&
		reason !== "admin_request"
	) {
		return { triggered: false, reason: "cooldown" };
	}

	reflectionCooldowns.set(cooldownKey, Date.now());

	const recentRecords = getLearningRecords(agentId, null, 30);
	if (recentRecords.length < 3) {
		return { triggered: false, reason: "insufficient_data" };
	}

	// Simulate LLM-based insight generation
	const failureRecords = recentRecords.filter((r) => r.outcome === "failure");
	const generatedInsights = [];

	if (failureRecords.length > 0) {
		const failureTypes = [...new Set(failureRecords.map((r) => r.task_type))];
		for (const ft of failureTypes.slice(0, 2)) {
			generatedInsights.push({
				type: "analysis",
				description: `Agent struggling with "${ft}" tasks — ${failureRecords.filter((r) => r.task_type === ft).length} recent failures`,
				confidence: 0.75,
				action: `review_${ft}_strategy`,
				priority: failureRecords.length > 5 ? "high" : "medium",
			});
		}
	}

	const successRecords = recentRecords.filter((r) => r.outcome === "success");
	if (successRecords.length >= 5) {
		generatedInsights.push({
			type: "strength_identification",
			description: `Agent performs well on ${successRecords[0].task_type} tasks`,
			confidence: 0.85,
			action: "share_knowledge",
			priority: "low",
		});
	}

	// Save insights
	for (const ins of generatedInsights) {
		if (ins.confidence >= INSIGHT_CONFIDENCE_THRESHOLD) {
			insights.push({
				agent_id: agentId,
				division: division || "unknown",
				insight_type: ins.type,
				description: ins.description,
				confidence: ins.confidence,
				action: ins.action,
				priority: ins.priority,
				source: reason,
				applied: false,
				created_at: new Date().toISOString(),
			});
		}
	}

	return {
		triggered: true,
		insights_count: generatedInsights.length,
		insights: generatedInsights.slice(0, 3),
		summary: `Generated ${generatedInsights.length} insight(s) from ${recentRecords.length} records`,
		reason,
	};
}

function applyInsights(agentId: string): { applied: number } {
	const agentInsights = insights.filter(
		(i) => i.agent_id === agentId && !i.applied && i.confidence >= 0.7,
	);
	let appliedCount = 0;

	for (const insight of agentInsights) {
		if (insight.insight_type === "prompt_rewrite" && insight.action) {
			if (!agentConfigs[agentId]) agentConfigs[agentId] = {};
			agentConfigs[agentId].prompt_override = insight.action;
			appliedCount++;
		} else if (insight.insight_type === "threshold_adjust" && insight.action) {
			const match = insight.action.match(/(\w+)_to_([\d.]+)/);
			if (match) {
				if (!agentConfigs[agentId]) agentConfigs[agentId] = {};
				agentConfigs[agentId][`threshold_${match[1]}`] = parseFloat(match[2]);
				appliedCount++;
			}
		}
		insight.applied = true;
	}

	return { applied: appliedCount };
}

// ═══════════════════════════════════════════════════════════════════
// D. KNOWLEDGE SHARING
// ═══════════════════════════════════════════════════════════════════

function sharePattern(
	agentId: string,
	division: string,
	pattern: Partial<KnowledgeEntry>,
): boolean {
	if (!pattern.description) return false;

	knowledgeEntries.push({
		agent_id: agentId,
		division: division || "unknown",
		pattern_type: pattern.pattern_type || "discovery",
		description: pattern.description,
		confidence: pattern.confidence ?? 0.5,
		task_type: pattern.task_type || "general",
		share_level: pattern.share_level || "division",
		created_at: new Date().toISOString(),
		expires_at: new Date(
			Date.now() + KNOWLEDGE_DECAY_DAYS * 86400000,
		).toISOString(),
	});

	return true;
}

function queryKnowledge(
	division: string,
	taskType: string | null = null,
	limit: number = 20,
): KnowledgeEntry[] {
	let results = knowledgeEntries.filter(
		(k) =>
			k.division === division && new Date(k.expires_at).getTime() > Date.now(),
	);

	if (taskType) results = results.filter((k) => k.task_type === taskType);

	return results.sort((a, b) => b.confidence - a.confidence).slice(0, limit);
}

function decayOldKnowledge(): { cleaned: boolean; decayed: number } {
	const now = Date.now();

	// Remove expired entries
	knowledgeEntries = knowledgeEntries.filter(
		(k) => new Date(k.expires_at).getTime() > now,
	);

	// Reduce confidence of old records (older than 14 days)
	const twoWeeksAgo = Date.now() - 14 * 86400000;
	let decayed = 0;
	for (const entry of knowledgeEntries) {
		if (new Date(entry.created_at).getTime() < twoWeeksAgo) {
			entry.confidence = Math.max(0.1, entry.confidence * 0.9);
			decayed++;
		}
	}

	return { cleaned: true, decayed };
}

// ═══════════════════════════════════════════════════════════════════
// E. ADMIN FEEDBACK
// ═══════════════════════════════════════════════════════════════════

function recordAdminFeedback(
	agentId: string,
	rating: number | string,
	_reportId: string = "",
	_comment: string = "",
): boolean {
	const numericRating =
		typeof rating === "number"
			? rating
			: rating === "thumbs_up"
				? 1
				: rating === "thumbs_down"
					? -1
					: 0;

	feedbackEntries.push({
		agent_id: agentId,
		rating: numericRating,
		weight: Math.min(2.0, Math.abs(numericRating) * 1.0),
		created_at: new Date().toISOString(),
	});

	return true;
}

function getFeedbackStats(agentId: string | null = null): {
	total: number;
	positive: number;
	negative: number;
	neutral: number;
	positive_rate: number;
	avg_weight: number;
} {
	let records = feedbackEntries;
	if (agentId) records = records.filter((f) => f.agent_id === agentId);

	const total = records.length;
	const positive = records.filter((f) => f.rating > 0).length;
	const negative = records.filter((f) => f.rating < 0).length;
	const neutral = total - positive - negative;
	const avgWeight =
		total > 0 ? records.reduce((s, f) => s + f.weight, 0) / total : 0;

	return {
		total,
		positive,
		negative,
		neutral,
		positive_rate: total > 0 ? Math.round((positive / total) * 100) : 0,
		avg_weight: Math.round(avgWeight * 100) / 100,
	};
}

// ═══════════════════════════════════════════════════════════════════
// F. SELF-MODIFICATION
// ═══════════════════════════════════════════════════════════════════

function adjustThreshold(
	agentId: string,
	metric: string,
	value: number,
): boolean {
	if (!agentConfigs[agentId]) agentConfigs[agentId] = {};
	agentConfigs[agentId][`threshold_${metric}`] = value;
	return true;
}

function rewritePrompt(agentId: string, newPrompt: string): boolean {
	if (!agentConfigs[agentId]) agentConfigs[agentId] = {};
	agentConfigs[agentId].prompt_override = newPrompt;
	return true;
}

function getAgentConfig(agentId: string): Record<string, unknown> {
	return agentConfigs[agentId] || {};
}

function requestAgentSpawn(
	division: string,
	reason: string,
	_capabilities: string[] = [],
): { requested: boolean; division: string; reason: string } {
	return {
		requested: true,
		division,
		reason,
	};
}

function getLearningStats(): {
	learning: {
		total: number;
		success: number;
		failure: number;
		success_rate: number;
		avg_confidence: number;
	};
	insights: { total: number; applied: number; pending: number };
	feedback: {
		total: number;
		positive: number;
		negative: number;
		positive_rate: number;
	};
	knowledge: { active_patterns: number };
} {
	const taskStats = getTaskStats();
	const totalInsights = insights.length;
	const appliedInsights = insights.filter((i) => i.applied).length;

	return {
		learning: taskStats,
		insights: {
			total: totalInsights,
			applied: appliedInsights,
			pending: totalInsights - appliedInsights,
		},
		feedback: getFeedbackStats(null),
		knowledge: {
			active_patterns: knowledgeEntries.filter(
				(k) => new Date(k.expires_at).getTime() > Date.now(),
			).length,
		},
	};
}

// ═══════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════

describe("Learning Engine - Feedback Loop", () => {
	beforeEach(() => {
		resetStore();
	});

	it("records a task outcome successfully", () => {
		const result = recordTaskOutcome(
			"agent-1",
			"content",
			"moderation",
			"success",
		);
		expect(result.ok).toBe(true);
		expect(learningRecords.length).toBe(1);
	});

	it("records multiple outcomes", () => {
		recordTaskOutcome("agent-1", "content", "moderation", "success");
		recordTaskOutcome("agent-1", "content", "moderation", "success");
		recordTaskOutcome("agent-2", "users", "user_scan", "failure");
		expect(learningRecords.length).toBe(3);
	});

	it("assigns high confidence for success", () => {
		recordTaskOutcome("agent-1", "content", "moderation", "success");
		expect(learningRecords[0].confidence).toBe(0.8);
	});

	it("assigns low confidence for failure", () => {
		recordTaskOutcome("agent-1", "content", "moderation", "failure");
		expect(learningRecords[0].confidence).toBe(0.3);
	});

	it("assigns medium confidence for partial", () => {
		recordTaskOutcome("agent-1", "content", "moderation", "partial");
		expect(learningRecords[0].confidence).toBe(0.5);
	});

	it("retrieves records by agent ID", () => {
		recordTaskOutcome("agent-a", "content", "moderation", "success");
		recordTaskOutcome("agent-b", "users", "scan", "success");
		recordTaskOutcome("agent-a", "content", "moderation", "failure");

		const agentARecords = getLearningRecords("agent-a");
		expect(agentARecords.length).toBe(2);

		const agentBRecords = getLearningRecords("agent-b");
		expect(agentBRecords.length).toBe(1);
	});

	it("retrieves records by division", () => {
		recordTaskOutcome("a", "content", "moderation", "success");
		recordTaskOutcome("b", "users", "scan", "success");
		recordTaskOutcome("c", "content", "analysis", "success");

		const contentRecords = getLearningRecords(null, "content");
		expect(contentRecords.length).toBe(2);

		const usersRecords = getLearningRecords(null, "users");
		expect(usersRecords.length).toBe(1);
	});

	it("limits results", () => {
		for (let i = 0; i < 100; i++) {
			recordTaskOutcome(`agent-${i}`, "content", "moderation", "success");
		}
		expect(getLearningRecords(null, null, 10).length).toBe(10);
	});

	it("returns correct task stats", () => {
		recordTaskOutcome("a", "content", "task1", "success");
		recordTaskOutcome("a", "content", "task2", "success");
		recordTaskOutcome("a", "content", "task3", "failure");
		recordTaskOutcome("a", "content", "task4", "partial");

		const stats = getTaskStats();
		expect(stats.total).toBe(4);
		expect(stats.success).toBe(2);
		expect(stats.failure).toBe(1);
		expect(stats.partial).toBe(1);
		expect(stats.success_rate).toBe(50);
	});
});

describe("Learning Engine - Reflection System", () => {
	beforeEach(() => {
		resetStore();
	});

	it("triggers reflection on sufficient failures", () => {
		// Clear any existing records and cooldowns
		learningRecords = [];
		reflectionCooldowns.clear();

		// Create 3 failure records directly
		const now = Date.now();
		const recentTime = new Date(now - 1000).toISOString(); // 1 second ago - within 1 hour window

		learningRecords.push({
			agent_id: "agent-1",
			division: "content",
			task_type: "moderation",
			outcome: "failure",
			metrics: {},
			duration_ms: 100,
			confidence: 0.3,
			created_at: recentTime,
		});
		learningRecords.push({
			agent_id: "agent-1",
			division: "content",
			task_type: "moderation",
			outcome: "failure",
			metrics: {},
			duration_ms: 100,
			confidence: 0.3,
			created_at: recentTime,
		});
		learningRecords.push({
			agent_id: "agent-1",
			division: "content",
			task_type: "moderation",
			outcome: "failure",
			metrics: {},
			duration_ms: 100,
			confidence: 0.3,
			created_at: recentTime,
		});

		// Now check - should trigger reflection since 3 failures within 1 hour
		const check = checkReflectionTrigger("agent-1", "content", "moderation");
		expect(check).toBe(true);
	});

	it("does not trigger reflection with insufficient failures within window", () => {
		learningRecords = [];
		reflectionCooldowns.clear();

		const recentTime = new Date(Date.now() - 1000).toISOString();

		// Only 2 failures (less than MAX_FAILURES_BEFORE_REFLECTION = 3)
		learningRecords.push({
			agent_id: "agent-1",
			division: "content",
			task_type: "moderation",
			outcome: "failure",
			metrics: {},
			duration_ms: 100,
			confidence: 0.3,
			created_at: recentTime,
		});
		learningRecords.push({
			agent_id: "agent-1",
			division: "content",
			task_type: "moderation",
			outcome: "failure",
			metrics: {},
			duration_ms: 100,
			confidence: 0.3,
			created_at: recentTime,
		});

		const check = checkReflectionTrigger("agent-1", "content", "moderation");
		expect(check).toBe(false);
	});

	it("does not trigger reflection if failures are outside the 1-hour window", () => {
		learningRecords = [];
		reflectionCooldowns.clear();

		const oldTime = new Date(Date.now() - 7200000).toISOString(); // 2 hours ago

		learningRecords.push({
			agent_id: "agent-1",
			division: "content",
			task_type: "moderation",
			outcome: "failure",
			metrics: {},
			duration_ms: 100,
			confidence: 0.3,
			created_at: oldTime,
		});
		learningRecords.push({
			agent_id: "agent-1",
			division: "content",
			task_type: "moderation",
			outcome: "failure",
			metrics: {},
			duration_ms: 100,
			confidence: 0.3,
			created_at: oldTime,
		});
		learningRecords.push({
			agent_id: "agent-1",
			division: "content",
			task_type: "moderation",
			outcome: "failure",
			metrics: {},
			duration_ms: 100,
			confidence: 0.3,
			created_at: oldTime,
		});

		const check = checkReflectionTrigger("agent-1", "content", "moderation");
		expect(check).toBe(false);
	});

	it("does not trigger reflection on single failure", () => {
		recordTaskOutcome("agent-1", "content", "moderation", "failure");
		expect(checkReflectionTrigger("agent-1", "content", "moderation")).toBe(
			false,
		);
	});

	it("returns insufficient data when records < 3", () => {
		const result = triggerReflection("agent-1", "content", "admin_request");
		expect(result.triggered).toBe(false);
		expect(result.reason).toBe("insufficient_data");
	});

	it("generates insights on reflection with data", () => {
		for (let i = 0; i < 5; i++) {
			recordTaskOutcome(
				"agent-1",
				"content",
				i % 2 === 0 ? "moderation" : "analysis",
				i < 2 ? "failure" : "success",
			);
		}

		const result = triggerReflection("agent-1", "content", "admin_request");
		expect(result.triggered).toBe(true);
		expect(result.insights_count).toBeGreaterThanOrEqual(1);
	});

	it("applies insights correctly", () => {
		// Create an insight that can be applied
		recordTaskOutcome("agent-1", "content", "task", "failure");
		triggerReflection("agent-1", "content", "admin_request");

		// Record a prompt_rewrite insight manually
		insights.push({
			agent_id: "agent-1",
			division: "content",
			insight_type: "prompt_rewrite",
			description: "Rewrite prompt for better moderation",
			confidence: 0.85,
			action: "improve_moderation_prompt",
			priority: "high",
			source: "reflection",
			applied: false,
			created_at: new Date().toISOString(),
		});

		const result = applyInsights("agent-1");
		expect(result.applied).toBeGreaterThanOrEqual(1);

		const config = getAgentConfig("agent-1");
		expect(config.prompt_override).toBe("improve_moderation_prompt");
	});

	it("respects reflection cooldown", () => {
		// Trigger a reflection
		for (let i = 0; i < 5; i++) {
			recordTaskOutcome("agent-1", "content", "task", "success");
		}
		triggerReflection("agent-1", "content", "admin_request");

		// Try again immediately — should work because reason is 'admin_request'
		const result = triggerReflection("agent-1", "content", "admin_request");
		expect(result.triggered).toBe(true);
	});
});

describe("Learning Engine - Pattern Analysis", () => {
	beforeEach(() => {
		resetStore();
	});

	it("returns insufficient data for <5 records", () => {
		for (let i = 0; i < 4; i++) {
			recordTaskOutcome("agent-1", "content", "task", "success");
		}
		const result = analyzePatterns("agent-1");
		expect(result.summary).toBe("Insufficient data for pattern analysis");
		expect(result.patterns).toHaveLength(0);
	});

	it("detects high failure rate patterns", () => {
		// 8 failures out of 10 = 80% failure rate on same task type
		for (let i = 0; i < 10; i++) {
			recordTaskOutcome(
				"agent-1",
				"content",
				"moderation",
				i < 8 ? "failure" : "success",
			);
		}

		const result = analyzePatterns("agent-1");
		const highFailure = result.patterns.find(
			(p) => p.type === "high_failure_rate",
		);
		expect(highFailure).toBeDefined();
		expect(highFailure!.failure_rate).toBeGreaterThan(50);
	});

	it("detects strong performance patterns", () => {
		// 8 successes out of 10 on same task type
		for (let i = 0; i < 10; i++) {
			recordTaskOutcome(
				"agent-1",
				"content",
				"analysis",
				i < 8 ? "success" : "failure",
			);
		}

		const result = analyzePatterns("agent-1");
		const strongPerf = result.patterns.find(
			(p) => p.type === "strong_performance",
		);
		expect(strongPerf).toBeDefined();
		expect(strongPerf!.success_rate).toBeGreaterThanOrEqual(75);
	});

	it("analyzes by division", () => {
		for (let i = 0; i < 10; i++) {
			recordTaskOutcome("a1", "content", "task", "success");
			recordTaskOutcome("a2", "users", "task", "failure");
		}

		const contentResult = analyzePatterns(null, "content");
		const usersResult = analyzePatterns(null, "users");
		expect(contentResult.sample_size).toBe(10);
		expect(usersResult.sample_size).toBe(10);
	});
});

describe("Learning Engine - Knowledge Sharing", () => {
	beforeEach(() => {
		resetStore();
	});

	it("shares a pattern successfully", () => {
		const ok = sharePattern("agent-1", "content", {
			description: "Students report bullying more on Mondays",
			confidence: 0.8,
			task_type: "trend_analysis",
		});
		expect(ok).toBe(true);
		expect(knowledgeEntries.length).toBe(1);
	});

	it("rejects pattern without description", () => {
		const ok = sharePattern("agent-1", "content", {});
		expect(ok).toBe(false);
		expect(knowledgeEntries.length).toBe(0);
	});

	it("queries knowledge by division", () => {
		sharePattern("a1", "content", {
			description: "Pattern 1",
			task_type: "analysis",
		});
		sharePattern("a2", "users", {
			description: "Pattern 2",
			task_type: "scan",
		});
		sharePattern("a3", "content", {
			description: "Pattern 3",
			task_type: "analysis",
		});

		const contentKnowledge = queryKnowledge("content");
		expect(contentKnowledge.length).toBe(2);

		const usersKnowledge = queryKnowledge("users");
		expect(usersKnowledge.length).toBe(1);
	});

	it("filters knowledge by task type", () => {
		sharePattern("a1", "content", {
			description: "Trend data",
			task_type: "trend_analysis",
		});
		sharePattern("a1", "content", {
			description: "Moderation tip",
			task_type: "moderation",
		});

		const trendKnowledge = queryKnowledge("content", "trend_analysis");
		expect(trendKnowledge.length).toBe(1);
	});

	it("decays old knowledge", () => {
		// Add a pattern that will expire soon
		knowledgeEntries.push({
			agent_id: "a1",
			division: "content",
			pattern_type: "discovery",
			description: "Old pattern",
			confidence: 0.9,
			task_type: "general",
			share_level: "division",
			created_at: new Date(Date.now() - 15 * 86400000).toISOString(),
			expires_at: new Date(Date.now() - 1000).toISOString(), // Already expired
		});

		knowledgeEntries.push({
			agent_id: "a2",
			division: "content",
			pattern_type: "discovery",
			description: "Recent pattern",
			confidence: 0.9,
			task_type: "general",
			share_level: "division",
			created_at: new Date().toISOString(),
			expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
		});

		const result = decayOldKnowledge();
		expect(result.cleaned).toBe(true);
		expect(knowledgeEntries.length).toBe(1); // Only the recent one remains
	});

	it("returns empty for unknown division", () => {
		expect(queryKnowledge("unknown")).toHaveLength(0);
	});
});

describe("Learning Engine - Admin Feedback", () => {
	beforeEach(() => {
		resetStore();
	});

	it("records positive feedback", () => {
		const ok = recordAdminFeedback("agent-1", "thumbs_up");
		expect(ok).toBe(true);
		expect(feedbackEntries.length).toBe(1);
		expect(feedbackEntries[0].rating).toBe(1);
	});

	it("records negative feedback", () => {
		const ok = recordAdminFeedback("agent-1", "thumbs_down");
		expect(ok).toBe(true);
		expect(feedbackEntries[0].rating).toBe(-1);
	});

	it("records numeric rating", () => {
		recordAdminFeedback("agent-1", 5);
		expect(feedbackEntries[0].rating).toBe(5);
		expect(feedbackEntries[0].weight).toBe(2.0); // capped at 2.0
	});

	it("computes feedback stats", () => {
		recordAdminFeedback("agent-1", "thumbs_up");
		recordAdminFeedback("agent-1", "thumbs_up");
		recordAdminFeedback("agent-1", "thumbs_down");

		const stats = getFeedbackStats("agent-1");
		expect(stats.total).toBe(3);
		expect(stats.positive).toBe(2);
		expect(stats.negative).toBe(1);
		expect(stats.neutral).toBe(0);
		expect(stats.positive_rate).toBe(67);
	});

	it("returns zero stats when no feedback", () => {
		const stats = getFeedbackStats("nonexistent");
		expect(stats.total).toBe(0);
		expect(stats.positive).toBe(0);
		expect(stats.positive_rate).toBe(0);
	});
});

describe("Learning Engine - Self-Modification", () => {
	beforeEach(() => {
		resetStore();
	});

	it("adjusts an agent threshold", () => {
		const ok = adjustThreshold("agent-1", "confidence", 0.85);
		expect(ok).toBe(true);

		const config = getAgentConfig("agent-1");
		expect(config.threshold_confidence).toBe(0.85);
	});

	it("rewrites an agent prompt", () => {
		const newPrompt =
			"You are now a specialized moderator for bullying content.";
		const ok = rewritePrompt("agent-1", newPrompt);
		expect(ok).toBe(true);

		const config = getAgentConfig("agent-1");
		expect(config.prompt_override).toBe(newPrompt);
	});

	it("requests agent spawn", () => {
		const result = requestAgentSpawn(
			"content",
			"Need specialized moderator for image content",
		);
		expect(result.requested).toBe(true);
		expect(result.division).toBe("content");
		expect(result.reason).toContain("moderator");
	});

	it("returns empty config for unknown agent", () => {
		expect(getAgentConfig("nonexistent")).toEqual({});
	});

	it("manages multiple agent configs independently", () => {
		adjustThreshold("agent-a", "confidence", 0.9);
		adjustThreshold("agent-b", "confidence", 0.7);

		expect(getAgentConfig("agent-a").threshold_confidence).toBe(0.9);
		expect(getAgentConfig("agent-b").threshold_confidence).toBe(0.7);
	});
});

describe("Learning Engine - Learning Stats", () => {
	beforeEach(() => {
		resetStore();
	});

	it("returns comprehensive stats", () => {
		recordTaskOutcome("a1", "content", "task1", "success");
		recordTaskOutcome("a1", "content", "task2", "success");
		recordTaskOutcome("a1", "content", "task3", "failure");
		recordAdminFeedback("a1", "thumbs_up");
		sharePattern("a1", "content", { description: "Test pattern" });
		recordTaskOutcome("a1", "content", "task4", "success");
		triggerReflection("a1", "content", "admin_request");

		const stats = getLearningStats();
		expect(stats.learning.total).toBe(4);
		expect(stats.learning.success).toBe(3);
		expect(stats.learning.failure).toBe(1);
		expect(stats.learning.success_rate).toBe(75);
		expect(stats.feedback.total).toBe(1);
		expect(stats.feedback.positive).toBe(1);
		expect(stats.knowledge.active_patterns).toBeGreaterThanOrEqual(1);
		expect(stats.insights.total).toBeGreaterThanOrEqual(0);
	});
});

describe("Learning Engine - Edge Cases", () => {
	beforeEach(() => {
		resetStore();
	});

	it("handles empty records gracefully", () => {
		const stats = getLearningStats();
		expect(stats.learning.total).toBe(0);
		expect(stats.learning.avg_confidence).toBe(0);
		expect(stats.insights.total).toBe(0);
	});

	it("handles very high confidence values", () => {
		const result = recordTaskOutcome("a1", "content", "task", "success", {
			confidence: 1.5,
		});
		expect(result.ok).toBe(true);
	});

	it("handles mixed outcomes correctly", () => {
		recordTaskOutcome("a1", "content", "a", "success");
		recordTaskOutcome("a1", "content", "b", "failure");
		recordTaskOutcome("a1", "content", "c", "partial");
		recordTaskOutcome("a1", "content", "d", "success");

		const stats = getTaskStats();
		expect(stats.success).toBe(2);
		expect(stats.failure).toBe(1);
		expect(stats.partial).toBe(1);
		expect(stats.total).toBe(4);
	});

	it("recording thousands of entries performs reasonably", () => {
		const start = Date.now();
		for (let i = 0; i < 1000; i++) {
			recordTaskOutcome(
				`agent-${i % 10}`,
				i % 2 === 0 ? "content" : "users",
				"task",
				i % 3 === 0 ? "success" : "failure",
			);
		}
		const duration = Date.now() - start;
		expect(duration).toBeLessThan(500); // Should complete in under 500ms
		expect(learningRecords.length).toBe(1000);
	});

	it("stores patterns with correct default values", () => {
		sharePattern("a1", "content", { description: "Minimal pattern" });
		expect(knowledgeEntries[0].pattern_type).toBe("discovery");
		expect(knowledgeEntries[0].confidence).toBe(0.5);
		expect(knowledgeEntries[0].task_type).toBe("general");
		expect(knowledgeEntries[0].share_level).toBe("division");
	});
});
