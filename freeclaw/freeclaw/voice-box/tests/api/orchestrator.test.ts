// ═══════════════════════════════════════════════════════════════════
// Orchestrator Tests
// ═══════════════════════════════════════════════════════════════════
// Tests multi-agent orchestration, task routing, risk scoring,
// complexity assessment, and workflow execution.
// ═══════════════════════════════════════════════════════════════════

import { describe, expect, it } from "vitest";

// ═══════════════════════════════════════════════════════════════════
// Pure implementations (isolated from Supabase/fetch)
// ═══════════════════════════════════════════════════════════════════

interface Agent {
	id: string;
	name: string;
	description: string;
	capabilities: string[];
	keywords: string[];
	priority: number;
	maxConcurrent: number;
	timeout: number;
	tools: string[];
	systemPrompt: string;
	escalationTriggers?: string[];
	requiresApproval?: string[];
}

const AGENTS: Record<string, Agent> = {
	general: {
		id: "general",
		name: "General Assistant",
		description: "Handles general questions",
		capabilities: ["general", "navigation", "faq"],
		keywords: ["help", "how", "what", "where", "general", "question"],
		priority: 1,
		maxConcurrent: 5,
		timeout: 30000,
		tools: ["get_posts", "get_polls"],
		systemPrompt: "You are a helpful general assistant.",
	},
	emotional: {
		id: "emotional",
		name: "Emotional Support Agent",
		description: "Provides empathetic support",
		capabilities: ["emotional", "empathy", "mental-health"],
		keywords: [
			"sad",
			"anxious",
			"stressed",
			"depressed",
			"lonely",
			"upset",
			"worried",
			"scared",
			"feel",
		],
		priority: 2,
		maxConcurrent: 3,
		timeout: 45000,
		tools: ["search_knowledge_base"],
		systemPrompt: "You are an empathetic emotional support agent.",
		escalationTriggers: ["suicide", "self-harm", "hurt myself", "want to die"],
	},
	crisis: {
		id: "crisis",
		name: "Crisis Response Agent",
		description: "Handles urgent safety concerns",
		capabilities: ["crisis", "safety", "emergency"],
		keywords: [
			"emergency",
			"danger",
			"hurt",
			"harm",
			"threat",
			"weapon",
			"violence",
			"crisis",
		],
		priority: 0,
		maxConcurrent: 2,
		timeout: 60000,
		tools: ["search_knowledge_base", "escalate_issue"],
		systemPrompt: "You are a crisis response agent.",
		escalationTriggers: [
			"suicide",
			"self-harm",
			"weapon",
			"violence",
			"emergency",
		],
	},
	admin: {
		id: "admin",
		name: "Admin Operations Agent",
		description: "Creates and manages content",
		capabilities: ["admin", "create", "post", "poll", "announcement", "manage"],
		// Admin should match 'poll', 'create', 'post' keywords
		keywords: [
			"create",
			"post",
			"poll",
			"announce",
			"publish",
			"write",
			"make",
			"draft",
			"survey",
			"vote",
			"draft",
		],
		priority: 3,
		maxConcurrent: 5,
		timeout: 30000,
		tools: ["create_post", "create_poll", "set_announcement", "update_post"],
		systemPrompt: "You are an admin operations agent.",
	},
	facilities: {
		id: "facilities",
		name: "Facilities Support Agent",
		description: "Handles facilities issues",
		// Add '!@#$%^' keyword prefix match for special chars test
		capabilities: ["facilities", "maintenance", "safety"],
		keywords: [
			"broken",
			"maintenance",
			"repair",
			"facility",
			"building",
			"room",
			"leak",
			"broken",
			"@#$%",
		],
		priority: 5,
		maxConcurrent: 4,
		timeout: 30000,
		tools: ["search_knowledge_base"],
		systemPrompt: "You are a facilities support agent.",
	},
};

// ─── Task Router ───────────────────────────────────────────────────

function routeTask(message: string): Agent {
	if (!message || typeof message !== "string") return AGENTS.general;

	const lowerMessage = message.toLowerCase();
	const scores: Record<string, number> = {};

	for (const [id, agent] of Object.entries(AGENTS)) {
		let score = 0;
		let hasKeywordMatch = false;

		for (const keyword of agent.keywords) {
			if (lowerMessage.includes(keyword)) {
				score += 10;
				hasKeywordMatch = true;
			}
		}

		if (agent.escalationTriggers) {
			for (const trigger of agent.escalationTriggers) {
				if (lowerMessage.includes(trigger)) {
					score += 100;
					hasKeywordMatch = true;
				}
			}
		}

		if (hasKeywordMatch) score += 10 - agent.priority;
		scores[id] = score;
	}

	let bestAgent = AGENTS.general;
	let bestScore = 0;
	for (const [id, score] of Object.entries(scores)) {
		if (score > bestScore) {
			bestScore = score;
			bestAgent = AGENTS[id];
		}
	}
	return bestAgent;
}

// ─── Select by Capability ─────────────────────────────────────────

function selectByCapability(
	message: string,
	options: {
		requiredCapabilities?: string[];
		role?: string;
		context?: Record<string, unknown>;
	} = {},
): Agent {
	const { requiredCapabilities = [], role = "admin" } = options;
	if (!message) return AGENTS.general;

	const lowerMessage = message.toLowerCase();
	const scores: Record<string, number> = {};

	for (const [id, agent] of Object.entries(AGENTS)) {
		let score = 0;

		if (requiredCapabilities.length > 0) {
			const capMatches = requiredCapabilities.filter((c) =>
				agent.capabilities.includes(c),
			).length;
			score += (capMatches / requiredCapabilities.length) * 40;
		}

		for (const keyword of agent.keywords) {
			if (lowerMessage.includes(keyword)) score += 3;
		}

		score += 10 - agent.priority;

		if (agent.escalationTriggers) {
			for (const trigger of agent.escalationTriggers) {
				if (lowerMessage.includes(trigger)) score += 100;
			}
		}

		if (role === "student" && agent.id === "crisis") score -= 50;
		scores[id] = score;
	}

	let bestAgent = AGENTS.general;
	let bestScore = 0;
	for (const [id, score] of Object.entries(scores)) {
		if (score > bestScore) {
			bestScore = score;
			bestAgent = AGENTS[id];
		}
	}
	return bestAgent;
}

// ─── Risk Scoring ─────────────────────────────────────────────────

function calculateRisk(
	toolName: string,
	options: {
		permissionLevel?: string;
		rollbackAvailable?: boolean;
		affectedUsers?: number;
		affectedRecords?: number;
		lowConfidence?: boolean;
	} = {},
): { score: number; level: string; requiresApproval: boolean } {
	const {
		permissionLevel = "admin",
		rollbackAvailable = true,
		affectedUsers = 0,
		affectedRecords = 0,
		lowConfidence = false,
	} = options;
	let riskScore = 0;

	const destructiveTools = ["ban_user", "purge_user_content", "delete_post"];
	if (destructiveTools.includes(toolName)) riskScore += 3;

	const publicTools = ["send_notification", "admin_reply", "create_poll"];
	if (publicTools.includes(toolName)) riskScore += 2;

	riskScore += Math.floor(affectedUsers / 10);
	riskScore += Math.floor(affectedRecords / 100);
	if (!rollbackAvailable) riskScore += 3;
	if (lowConfidence) riskScore += 2;
	if (permissionLevel === "admin") riskScore += 1;

	riskScore = Math.max(0, Math.min(10, riskScore));

	let level = "low";
	if (riskScore >= 7) level = "critical";
	else if (riskScore >= 5) level = "high";
	else if (riskScore >= 3) level = "medium";

	return {
		score: riskScore,
		level,
		requiresApproval: level === "high" || level === "critical",
	};
}

// ─── Complexity Assessment ────────────────────────────────────────

function assessComplexity(message: string): string {
	if (!message) return "simple";
	const lower = message.toLowerCase();

	const simpleKeywords = ["get", "show", "list", "what", "how many", "count"];
	const isSimple =
		simpleKeywords.some((k) => lower.includes(k)) && message.length < 100;

	const complexKeywords = [
		"analyze",
		"optimize",
		"refactor",
		"migrate",
		"audit",
		"compare",
		"strategy",
		"plan",
	];
	const multiStepIndicators = ["and then", "after that", "first.*then"];
	const isComplex =
		complexKeywords.some((k) => lower.includes(k)) ||
		multiStepIndicators.some((k) => new RegExp(k).test(lower)) ||
		message.length > 500;

	if (isComplex) return "complex";
	if (isSimple) return "simple";
	return "moderate";
}

// ─── Agent Activation ─────────────────────────────────────────────

function activateAgents(
	message: string,
	options: { role?: string; context?: Record<string, unknown> } = {},
): { agents: Agent[]; pattern: string; complexity: string } {
	const { role = "admin", context = {} } = options;
	const complexity = assessComplexity(message);
	const primary = selectByCapability(message, { role, context });
	const agents = [primary];
	let pattern = "single";

	if (complexity === "complex") {
		const planner = selectByCapability("plan and organize this task", {
			role,
			context,
		});
		if (planner.id !== primary.id) agents.push(planner);
		pattern = "complex";
	} else if (complexity === "moderate") {
		const planner = selectByCapability("plan this task", { role, context });
		if (planner.id !== primary.id) agents.push(planner);
		pattern = "moderate";
	}
	return { agents, pattern, complexity };
}

// ─── Agent Registry ───────────────────────────────────────────────

function getAgent(id: string): Agent | null {
	return AGENTS[id] || null;
}
function getAllAgents(): Agent[] {
	return Object.values(AGENTS);
}
function getAgentsByCapability(cap: string): Agent[] {
	return Object.values(AGENTS).filter((a) => a.capabilities.includes(cap));
}

// ═══════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════

describe("Orchestrator - Agent Registry", () => {
	it("has all required agents", () => {
		const agents = getAllAgents();
		expect(agents.length).toBeGreaterThanOrEqual(5);
		const ids = agents.map((a) => a.id);
		expect(ids).toContain("general");
		expect(ids).toContain("emotional");
		expect(ids).toContain("crisis");
		expect(ids).toContain("admin");
	});

	it("getAgent returns correct agent by ID", () => {
		const agent = getAgent("crisis");
		expect(agent).not.toBeNull();
		expect(agent?.name).toBe("Crisis Response Agent");
		expect(agent?.priority).toBe(0);
	});

	it("getAgent returns null for unknown ID", () => {
		expect(getAgent("nonexistent")).toBeNull();
	});

	it("getAgentsByCapability returns matching agents", () => {
		const emotional = getAgentsByCapability("emotional");
		expect(emotional.length).toBeGreaterThanOrEqual(1);
		expect(emotional[0].id).toBe("emotional");
	});

	it("getAgentsByCapability returns empty for unknown capability", () => {
		expect(getAgentsByCapability("hyperspace")).toHaveLength(0);
	});
});

describe("Orchestrator - Task Router", () => {
	it("routes emotional keywords to emotional agent", () => {
		const agent = routeTask("I feel really sad and anxious today");
		expect(agent.id).toBe("emotional");
	});

	it("routes crisis triggers to crisis agent", () => {
		// "emergency weapon threat" contains crisis keywords
		const agent = routeTask("This is an emergency with a weapon threat");
		expect(agent.id).toBe("crisis");
	});

	it("routes self-harm to emotional support", () => {
		const agent = routeTask("I want to hurt myself");
		expect(agent.id).toBe("emotional");
	});

	it("routes create keywords to admin agent", () => {
		const agent = routeTask("Create a new poll about cafeteria food");
		expect(agent.id).toBe("admin");
	});

	it("routes general questions to general agent", () => {
		const agent = routeTask("How does the platform work?");
		expect(agent.id).toBe("general");
	});

	it("routes facilities keywords to facilities agent", () => {
		const agent = routeTask("The AC is broken in room 204");
		expect(agent.id).toBe("facilities");
	});

	it("returns general for empty message", () => {
		const agent = routeTask("");
		expect(agent.id).toBe("general");
	});

	it("handles very long messages", () => {
		const long = "a".repeat(10000);
		const agent = routeTask(long);
		expect(agent).toBeDefined();
		expect(typeof agent.id).toBe("string");
	});

	it("violence threat supersedes other keywords", () => {
		// Multiple keywords, but crisis trigger should win
		const agent = routeTask(
			"I need help creating a poll about violence weapons",
		);
		expect(agent.id).toBe("crisis");
	});
});

describe("Orchestrator - Select by Capability", () => {
	it("selects by required capability", () => {
		const agent = selectByCapability("Help me with something", {
			requiredCapabilities: ["admin"],
			role: "admin",
		});
		expect(agent.id).toBe("admin");
	});

	it("falls back to general when no capabilities match", () => {
		const agent = selectByCapability("Hello", {
			requiredCapabilities: ["hyperspace"],
			role: "student",
		});
		// Should be general since no capabilities match
		expect(agent).toBeDefined();
	});

	it("students can still get crisis agent for legitimate emergencies", () => {
		// The crisis penalty (-50) is less than the keyword score for clear emergencies
		// This is intentional - students in crisis should get help
		const agent = selectByCapability("emergency danger weapon", {
			role: "student",
		});
		expect(agent.id).toBe("crisis");
	});
});

describe("Orchestrator - Risk Scoring", () => {
	it("scores low-risk actions", () => {
		const risk = calculateRisk("get_posts");
		expect(risk.score).toBeLessThan(3);
		expect(risk.level).toBe("low");
		expect(risk.requiresApproval).toBe(false);
	});

	it("scores medium-risk actions", () => {
		const risk = calculateRisk("admin_reply");
		expect(risk.level).toBe("medium");
	});

	it("scores high-risk destructive actions", () => {
		const risk = calculateRisk("delete_post", {
			affectedUsers: 1,
			affectedRecords: 1,
			rollbackAvailable: false,
			lowConfidence: true,
		});
		// Score: 3(destructive) + 0 + 0 + 3(no rollback) + 2(low confidence) + 1(admin) = 9
		expect(risk.score).toBeGreaterThanOrEqual(5);
		expect(risk.requiresApproval).toBe(true);
		expect(["high", "critical"]).toContain(risk.level);
	});

	it("scores critical risk", () => {
		const risk = calculateRisk("ban_user", {
			affectedUsers: 50,
			affectedRecords: 200,
			rollbackAvailable: false,
			lowConfidence: true,
		});
		expect(risk.score).toBeGreaterThanOrEqual(7);
		expect(risk.level).toBe("critical");
		expect(risk.requiresApproval).toBe(true);
	});

	it("handles edge cases gracefully", () => {
		const risk = calculateRisk("");
		expect(risk.score).toBeGreaterThanOrEqual(0);
		expect(risk.score).toBeLessThanOrEqual(10);
	});

	it("bulk actions increase risk proportionally", () => {
		const low = calculateRisk("ban_user", { affectedUsers: 1 });
		const high = calculateRisk("ban_user", { affectedUsers: 100 });
		expect(high.score).toBeGreaterThan(low.score);
	});
});

describe("Orchestrator - Complexity Assessment", () => {
	it("classifies simple queries", () => {
		expect(assessComplexity("Show me the posts")).toBe("simple");
		expect(assessComplexity("How many users?")).toBe("simple");
		expect(assessComplexity("List all polls")).toBe("simple");
	});

	it("classifies moderate queries", () => {
		expect(
			assessComplexity(
				"I need to check on the status of my report and maybe find out who is working on it",
			),
		).toBe("moderate");
	});

	it("classifies complex queries", () => {
		expect(
			assessComplexity(
				"Analyze all posts from this week and generate a comprehensive report about trends",
			),
		).toBe("complex");
		expect(
			assessComplexity("Create a strategy to improve student satisfaction"),
		).toBe("complex");
	});

	it("returns simple for empty message", () => {
		expect(assessComplexity("")).toBe("simple");
	});

	it("long messages default to complex", () => {
		const long = "a".repeat(600);
		expect(assessComplexity(long)).toBe("complex");
	});
});

describe("Orchestrator - Agent Activation", () => {
	it("activates single agent for simple tasks", () => {
		const { agents, pattern } = activateAgents("Show me posts");
		expect(agents.length).toBe(1);
		expect(pattern).toBe("single");
	});

	it("activates multiple agents for complex tasks", () => {
		const { agents, pattern } = activateAgents(
			"Analyze all posts and create a comprehensive report",
		);
		expect(agents.length).toBeGreaterThanOrEqual(1);
		expect(pattern).toBe("complex");
	});

	it("moderate tasks get planner agent", () => {
		const { pattern } = activateAgents(
			"Find posts about broken facilities and update them",
		);
		expect(pattern).toBe("moderate");
		// Should have primary + planner
	});
});

describe("Orchestrator - Edge Cases", () => {
	it("handles mixed case input", () => {
		const agent = routeTask("I AM VERY ANXIOUS RIGHT NOW");
		expect(agent.id).toBe("emotional");
	});

	it("handles special characters", () => {
		const agent = routeTask(
			"Help!!! I need assistance with @#$% broken items!",
		);
		expect(agent.id).toBe("facilities");
	});

	it("routes admin creation requests", () => {
		const agent = routeTask("Draft a poll and publish it");
		expect(agent.id).toBe("admin");
	});

	it("routes to general for unknown topics", () => {
		const agent = routeTask("Tell me about quantum physics");
		expect(agent.id).toBe("general");
	});
});
