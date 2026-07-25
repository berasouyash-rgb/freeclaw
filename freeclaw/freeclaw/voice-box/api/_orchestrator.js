// ─── Multi-Agent Orchestrator ─────────────────────────────────────
// Coordinates specialized AI agents for complex workflows.
// Handles agent selection, task delegation, handoffs, and result synthesis.
//
// Architecture:
//   1. Agent Registry: defines specialized agents with capabilities
//   2. Task Router: selects the best agent(s) for a task
//   3. Workflow Engine: orchestrates multi-agent workflows
//   4. Handoff Protocol: transfers context between agents
//   5. Result Synthesis: combines outputs from multiple agents
//
// Usage:
//   import { routeTask, orchestrateWorkflow, getAgent } from './_orchestrator.js';
//   const agent = routeTask('I need help with bullying concerns');
//   const result = await orchestrateWorkflow(workflow, context);

import supabase from './_db-client.js';
import { executeTool } from './_tool-registry.js';

// ─── Agent Definitions ────────────────────────────────────────────
const AGENTS = {
  general: {
    id: 'general',
    name: 'General Assistant',
    description: 'Handles general questions, platform navigation, and basic support',
    capabilities: ['general', 'navigation', 'faq', 'platform'],
    keywords: ['help', 'how', 'what', 'where', 'general', 'question'],
    priority: 1,
    maxConcurrent: 5,
    timeout: 30000,
    tools: ['get_posts', 'get_polls', 'get_comments', 'search_knowledge_base'],
    systemPrompt: `You are a helpful general assistant for Voice Box, a school communication platform.
Be friendly, clear, and concise. Help users navigate the platform and find information.
If you don't know something, say so honestly and offer to help find the right resource.`,
  },

  emotional: {
    id: 'emotional',
    name: 'Emotional Support Agent',
    description: 'Provides empathetic support for emotional concerns and mental health',
    capabilities: ['emotional', 'empathy', 'mental-health', 'counseling'],
    keywords: ['sad', 'anxious', 'stressed', 'depressed', 'lonely', 'upset', 'worried', 'scared', 'feel', 'emotion'],
    priority: 2,
    maxConcurrent: 3,
    timeout: 45000,
    tools: ['search_knowledge_base', 'get_posts'],
    systemPrompt: `You are an empathetic emotional support agent for Voice Box.
Listen actively, validate feelings, and provide gentle guidance.
Never diagnose or provide medical advice. Encourage seeking professional help when appropriate.
If someone is in crisis, immediately suggest contacting a trusted adult or crisis hotline.
Be warm, patient, and non-judgmental.`,
    escalationTriggers: ['suicide', 'self-harm', 'hurt myself', 'end my life', 'want to die'],
  },

  academic: {
    id: 'academic',
    name: 'Academic Support Agent',
    description: 'Helps with academic questions, study tips, and educational resources',
    capabilities: ['academic', 'study', 'homework', 'grades', 'college'],
    keywords: ['homework', 'study', 'grade', 'test', 'exam', 'class', 'teacher', 'academic', 'college', 'assignment'],
    priority: 3,
    maxConcurrent: 4,
    timeout: 30000,
    tools: ['search_knowledge_base', 'get_posts', 'get_polls'],
    systemPrompt: `You are an academic support agent for Voice Box.
Help students with study strategies, time management, and academic concerns.
Encourage positive learning habits and seek help when needed.
Be encouraging and supportive. Never do homework for students—teach them how to learn.`,
  },

  behavioral: {
    id: 'behavioral',
    name: 'Behavioral Support Agent',
    description: 'Addresses behavioral concerns, conflicts, and social dynamics',
    capabilities: ['behavioral', 'conflict', 'social', 'bullying', 'discipline'],
    keywords: ['bully', 'conflict', 'fight', 'mean', 'tease', 'harass', 'behavior', 'discipline', 'rule'],
    priority: 4,
    maxConcurrent: 3,
    timeout: 35000,
    tools: ['search_knowledge_base', 'get_posts', 'get_reports', 'warn_user'],
    systemPrompt: `You are a behavioral support agent for Voice Box.
Address behavioral concerns professionally and fairly.
Encourage conflict resolution and positive behavior.
For serious issues (bullying, harassment), escalate immediately to appropriate staff.
Be neutral, fair, and focused on solutions.`,
    requiresApproval: ['warn_user', 'ban_user'],
  },

  facilities: {
    id: 'facilities',
    name: 'Facilities Support Agent',
    description: 'Handles facilities issues, maintenance requests, and campus safety',
    capabilities: ['facilities', 'maintenance', 'safety', 'campus', 'building'],
    keywords: ['broken', 'maintenance', 'repair', 'facility', 'building', 'room', 'heat', 'ac', 'light', 'leak'],
    priority: 5,
    maxConcurrent: 4,
    timeout: 30000,
    tools: ['search_knowledge_base', 'get_posts', 'create_comment'],
    systemPrompt: `You are a facilities support agent for Voice Box.
Help users report and track facility issues.
Be specific about locations and urgency. Escalate safety concerns immediately.
Provide updates when possible and set realistic expectations for resolution.`,
  },

  crisis: {
    id: 'crisis',
    name: 'Crisis Response Agent',
    description: 'Handles urgent safety concerns and crisis situations',
    capabilities: ['crisis', 'safety', 'emergency', 'urgency'],
    keywords: ['emergency', 'danger', 'hurt', 'harm', 'threat', 'weapon', 'violence', 'crisis', 'urgent'],
    priority: 0, // Highest priority
    maxConcurrent: 2,
    timeout: 60000,
    tools: ['search_knowledge_base', 'get_posts', 'escalate_issue'],
    systemPrompt: `You are a crisis response agent for Voice Box.
Handle urgent safety situations with calm professionalism.
IMMEDIATELY escalate any threat to life or safety.
Provide clear instructions for staying safe.
Document everything for follow-up.
Never attempt to handle serious crises alone—always involve human staff.`,
    requiresApproval: [],
    escalationTriggers: ['suicide', 'self-harm', 'weapon', 'violence', 'threat', 'emergency', 'danger'],
  },

  admin: {
    id: 'admin',
    name: 'Admin Operations Agent',
    description: 'Creates posts, polls, announcements, manages content and platform operations',
    capabilities: ['admin', 'create', 'post', 'poll', 'announcement', 'manage', 'content'],
    keywords: ['create', 'post', 'poll', 'announce', 'publish', 'article', 'write', 'compose', 'make', 'draft', 'banner', 'survey', 'vote'],
    priority: 3,
    maxConcurrent: 5,
    timeout: 30000,
    tools: ['create_post', 'create_poll', 'create_comment', 'set_announcement', 'update_post', 'get_posts', 'get_polls'],
    systemPrompt: `You are an admin operations agent for Voice Box.
You can CREATE content: posts, polls, announcements, and comments.
When asked to create something, DO IT — use the appropriate tool immediately.
For polls: use create_poll with a title and options array.
For posts: use create_post with title, description, type, and category.
For announcements: use set_announcement with text.
Always confirm what you created with a link or ID.`,
  },
};

// ─── Agent Registry ───────────────────────────────────────────────
const AGENT_MAP = new Map(Object.entries(AGENTS));

export function getAgent(agentId) {
  return AGENT_MAP.get(agentId) || null;
}

export function getAllAgents() {
  return Object.values(AGENTS);
}

export function getAgentsByCapability(capability) {
  return Object.values(AGENTS).filter(a => a.capabilities.includes(capability));
}

// ─── Task Router ──────────────────────────────────────────────────
// Selects the best agent for a task based on keywords and capabilities.
export function routeTask(message) {
  if (!message || typeof message !== 'string') {
    return AGENTS.general;
  }

  const lowerMessage = message.toLowerCase();
  const scores = {};

  // Score each agent based on keyword matches
  for (const [id, agent] of Object.entries(AGENTS)) {
    let score = 0;
    let hasKeywordMatch = false;

    // Check keywords
    for (const keyword of agent.keywords) {
      if (lowerMessage.includes(keyword)) {
        score += 10;
        hasKeywordMatch = true;
      }
    }

    // Check escalation triggers (highest priority)
    let hasTriggerMatch = false;
    if (agent.escalationTriggers) {
      for (const trigger of agent.escalationTriggers) {
        if (lowerMessage.includes(trigger)) {
          score += 100; // Overwhelming priority for crisis triggers
          hasTriggerMatch = true;
        }
      }
    }

    // Priority bonus only applies if agent has keyword/trigger matches
    // Prevents crisis agent from winning every task by default
    if (hasKeywordMatch || hasTriggerMatch) {
      score += (10 - agent.priority);
    }

    scores[id] = score;
  }

  // Find the highest scoring agent
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

// ─── Workflow Engine ──────────────────────────────────────────────
// Orchestrates multi-agent workflows with task delegation and handoffs.
export async function orchestrateWorkflow(workflow, context = {}) {
  const { query, sessionId, userId } = context;
  const results = [];
  const visited = new Set();

  // Execute workflow steps
  for (const step of workflow.steps) {
    if (visited.has(step.agentId)) continue;
    visited.add(step.agentId);

    const agent = AGENT_MAP.get(step.agentId);
    if (!agent) {
      results.push({ step: step.agentId, error: `Agent '${step.agentId}' not found` });
      continue;
    }

    try {
      // Execute the step
      const result = await executeAgentTask(agent, step.task || query, {
        sessionId,
        userId,
        previousResults: results,
      });

      results.push({
        step: step.agentId,
        agent: agent.name,
        result,
      });

      // Check for handoff
      if (result.handoff) {
        const nextAgent = AGENT_MAP.get(result.handoff);
        if (nextAgent && !visited.has(result.handoff)) {
          workflow.steps.push({ agentId: result.handoff, task: result.handoffTask || query });
        }
      }
    } catch (err) {
      results.push({
        step: step.agentId,
        agent: agent.name,
        error: err.message,
      });
    }
  }

  return {
    workflow: workflow.name || 'unnamed',
    steps: results.length,
    results,
    completedAt: new Date().toISOString(),
  };
}

// ─── Agent Task Execution ─────────────────────────────────────────
export async function executeAgentTask(agent, task, context = {}) {
  const { sessionId, userId, previousResults = [] } = context;
  const startTime = Date.now();

  // Build system prompt with context
  const contextPrompt = previousResults.length > 0
    ? `\n\nPrevious agent results:\n${previousResults.map(r => `- ${r.agent || r.step}: ${JSON.stringify(r.result || r.error)}`).join('\n')}`
    : '';

  const systemPrompt = agent.systemPrompt + contextPrompt;

  // Execute agent's tools
  const toolResults = [];
  for (const toolName of agent.tools) {
    try {
      const result = await executeTool(toolName, { query: task }, { role: 'admin' });
      if (!result.error) {
        toolResults.push({ tool: toolName, result });
      }
    } catch (err) {
      // Non-critical: continue without tool
    }
  }

  // Build response (in production, this would call the LLM)
  // For now, return a structured response
  const response = {
    agentId: agent.id,
    agentName: agent.name,
    task,
    toolResults,
    latency_ms: Date.now() - startTime,
    timestamp: new Date().toISOString(),
  };

  // Log execution
  try {
    await supabase.from('tool_calls').insert({
      tool_name: `agent:${agent.id}`,
      parameters: { task: task.slice(0, 200) },
      result: response,
      status: 'completed',
      latency_ms: response.latency_ms,
    });
  } catch { /* non-critical */ }

  return response;
}

// ─── Multi-Agent Orchestration ────────────────────────────────────
// Routes a query to multiple agents and synthesizes results.
export async function orchestrateQuery(query, options = {}) {
  const { sessionId, userId, maxAgents = 3 } = options;

  // Route to primary agent
  const primaryAgent = routeTask(query);

  // Find secondary agents if needed
  const secondaryAgents = [];
  if (primaryAgent.id !== 'crisis') {
    // Add relevant secondary agents based on query
    for (const agent of Object.values(AGENTS)) {
      if (agent.id !== primaryAgent.id && agent.id !== 'general') {
        const lowerQuery = query.toLowerCase();
        const hasKeyword = agent.keywords.some(k => lowerQuery.includes(k));
        if (hasKeyword && secondaryAgents.length < maxAgents - 1) {
          secondaryAgents.push(agent);
        }
      }
    }
  }

  // Execute primary agent
  const primaryResult = await executeAgentTask(primaryAgent, query, { sessionId, userId });

  // Execute secondary agents
  const secondaryResults = [];
  for (const agent of secondaryAgents) {
    const result = await executeAgentTask(agent, query, { sessionId, userId });
    secondaryResults.push(result);
  }

  // Synthesize results
  return synthesizeResults(primaryResult, secondaryResults);
}

// ─── Result Synthesis ─────────────────────────────────────────────
function synthesizeResults(primary, secondary) {
  return {
    primary: {
      agent: primary.agentName,
      response: primary,
    },
    secondary: secondary.map(s => ({
      agent: s.agentName,
      response: s,
    })),
    synthesizedAt: new Date().toISOString(),
  };
}

// ─── Capability-Based Agent Selection ────────────────────────────
// Enhanced routing that considers:
// 1. Capability match (what the agent CAN do)
// 2. Keyword match (what the agent recognizes)
// 3. Tool availability (what tools the agent has)
// 4. Workload (current concurrency vs maxConcurrent)
// 5. Permission level (admin vs student)
export function selectByCapability(message, options = {}) {
  const { requiredCapabilities = [], role = 'admin', context = {} } = options;
  if (!message || typeof message !== 'string') return AGENTS.general;

  const lowerMessage = message.toLowerCase();
  const scores = {};

  for (const [id, agent] of Object.entries(AGENTS)) {
    let score = 0;

    // 1. Capability match (40% weight)
    if (requiredCapabilities.length > 0) {
      const capMatches = requiredCapabilities.filter(c => agent.capabilities.includes(c)).length;
      score += (capMatches / requiredCapabilities.length) * 40;
    }

    // 2. Keyword match (30% weight)
    for (const keyword of agent.keywords) {
      if (lowerMessage.includes(keyword)) score += 3;
    }

    // 3. Tool availability (10% weight)
    if (context.requiredTools && agent.tools) {
      const toolMatches = context.requiredTools.filter(t => agent.tools.includes(t)).length;
      score += (toolMatches / context.requiredTools.length) * 10;
    }

    // 4. Workload penalty (10% weight)
    // Agents near maxConcurrent get penalized
    if (context.activeTasks && agent.maxConcurrent) {
      const active = context.activeTasks[id] || 0;
      const load = active / agent.maxConcurrent;
      score += (1 - load) * 10; // Less loaded = higher score
    }

    // 5. Priority bonus (10% weight)
    score += (10 - agent.priority);

    // 6. Escalation triggers (always highest priority)
    if (agent.escalationTriggers) {
      for (const trigger of agent.escalationTriggers) {
        if (lowerMessage.includes(trigger)) score += 100;
      }
    }

    // 6. Permission check
    if (role === 'student' && agent.id === 'crisis') {
      score -= 50; // Students shouldn't directly access crisis agent
    }

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
// Calculates risk level for a proposed action based on:
// - Tool name (destructive tools are higher risk)
// - Affected users (more users = higher risk)
// - Affected records (more records = higher risk)
// - Permission level (admin vs student)
// - Rollback availability
export function calculateRisk(toolName, params = {}, options = {}) {
  const { permissionLevel = 'admin', rollbackAvailable = true, affectedUsers = 0, affectedRecords = 0 } = options;

  let riskScore = 0;

  // Destructive tools (+3)
  const destructiveTools = ['ban_user', 'purge_user_content', 'delete_post'];
  if (destructiveTools.includes(toolName)) riskScore += 3;

  // Public-facing actions (+2)
  const publicTools = ['send_notification', 'admin_reply', 'create_poll'];
  if (publicTools.includes(toolName)) riskScore += 2;

  // Per-user impact (+1 per 10 users)
  riskScore += Math.floor(affectedUsers / 10);

  // Per-record impact (+1 per 100 records)
  riskScore += Math.floor(affectedRecords / 100);

  // No rollback available (+3)
  if (!rollbackAvailable) riskScore += 3;

  // Low-confidence context (+2)
  if (options.lowConfidence) riskScore += 2;

  // Admin permission required (+1)
  if (permissionLevel === 'admin') riskScore += 1;

  // Clamp to 0-10
  riskScore = Math.max(0, Math.min(10, riskScore));

  // Determine level
  let level = 'low';
  if (riskScore >= 7) level = 'critical';
  else if (riskScore >= 5) level = 'high';
  else if (riskScore >= 3) level = 'medium';

  // Determine approval requirement
  const requiresApproval = level === 'high' || level === 'critical';

  return {
    score: riskScore,
    level,
    requiresApproval,
    factors: {
      toolName,
      destructive: destructiveTools.includes(toolName),
      public: publicTools.includes(toolName),
      affectedUsers,
      affectedRecords,
      rollbackAvailable,
      permissionLevel,
    },
  };
}

// ─── Adaptive Agent Activation ────────────────────────────────────
// Selects agent team based on query complexity.
// Simple: single agent | Moderate: planner+executor+verifier | Complex: full team
export function activateAgents(message, options = {}) {
  const { role = 'admin', context = {} } = options;

  // Determine complexity
  const complexity = assessComplexity(message);

  // Route primary agent
  const primary = selectByCapability(message, { role, context });

  let agents = [primary];
  let pattern = 'single';

  if (complexity === 'complex') {
    // Complex: planner + specialist + merge + verifier
    const planner = selectByCapability('plan and organize this task', { role, context });
    const specialist = selectByCapability(message, { role, context, requiredCapabilities: primary.capabilities });
    if (planner.id !== primary.id) agents.push(planner);
    if (specialist.id !== primary.id && specialist.id !== planner.id) agents.push(specialist);
    pattern = 'complex';
  } else if (complexity === 'moderate') {
    // Moderate: planner + executor + verifier
    const planner = selectByCapability('plan this task', { role, context });
    if (planner.id !== primary.id) agents.push(planner);
    pattern = 'moderate';
  }

  return { agents, pattern, complexity };
}

// ─── Assess Complexity ────────────────────────────────────────────
function assessComplexity(message) {
  if (!message) return 'simple';
  const lower = message.toLowerCase();

  // Simple keywords
  const simpleKeywords = ['get', 'show', 'list', 'what', 'how many', 'count'];
  const isSimple = simpleKeywords.some(k => lower.includes(k)) && message.length < 100;

  // Complex keywords
  const complexKeywords = ['analyze', 'optimize', 'refactor', 'migrate', 'audit', 'compare', 'strategy', 'plan'];
  const multiStepIndicators = ['and then', 'after that', 'first.*then', 'step 1', 'step 2'];
  const isComplex = complexKeywords.some(k => lower.includes(k)) ||
    multiStepIndicators.some(k => new RegExp(k).test(lower)) ||
    message.length > 500;

  if (isComplex) return 'complex';
  if (isSimple) return 'simple';
  return 'moderate';
}

// ─── Export for Tests ─────────────────────────────────────────────
export {
  AGENTS,
  routeTask as _routeTask,
  synthesizeResults as _synthesizeResults,
  assessComplexity as _assessComplexity,
};

export default {
  getAgent,
  getAllAgents,
  getAgentsByCapability,
  routeTask,
  selectByCapability,
  calculateRisk,
  activateAgents,
  orchestrateWorkflow,
  orchestrateQuery,
  executeAgentTask,
  AGENTS,
};
