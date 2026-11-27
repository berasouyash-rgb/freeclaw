// ═══════════════════════════════════════════════════════════════════
// Action Center — Real human-required tasks only
// ═══════════════════════════════════════════════════════════════════
// Filters out routine automation. Shows only genuine human tasks:
//   - Security incidents requiring human decision
//   - Critical moderation requiring human judgment
//   - Failed autonomous recovery needing human intervention
//   - Protected operations requiring human approval
//   - Major performance regressions
//   - Data integrity problems
//
// Does NOT show:
//   - Routine cache cleanup
//   - Normal worker execution
//   - Automated health checks
//   - Background analytics refresh
//   - Standard notification delivery
// ═══════════════════════════════════════════════════════════════════

import { cors, isAdmin } from "./_auth.js";
import supabase from "./_db-client.js";
import { sanitizeError } from "./_error.js";
import { logger } from "./_observability.js";

const ACTION_CENTER_KEY = "action_center_tasks";
const MAX_TASKS = 200;

// ─── Task categories that require human attention ──────────────
const HUMAN_REQUIRED = {
  SECURITY_INCIDENT: {
    priority: 1,
    icon: "Shield",
    label: "Security Incident",
    requires_response: true,
  },
  CRITICAL_MODERATION: {
    priority: 2,
    icon: "Flag",
    label: "Critical Moderation",
    requires_response: true,
  },
  FAILED_RECOVERY: {
    priority: 3,
    icon: "RotateCcw",
    label: "Failed Autonomous Recovery",
    requires_response: true,
  },
  PROTECTED_OPERATION: {
    priority: 4,
    icon: "Lock",
    label: "Protected Operation",
    requires_response: true,
  },
  PERFORMANCE_REGRESSION: {
    priority: 5,
    icon: "TrendingDown",
    label: "Performance Regression",
    requires_response: true,
  },
  DATA_INTEGRITY: {
    priority: 6,
    icon: "Database",
    label: "Data Integrity Problem",
    requires_response: true,
  },
  DEPLOYMENT_REVIEW: {
    priority: 7,
    icon: "Rocket",
    label: "Deployment Review",
    requires_response: true,
  },
  COST_ANOMALY: {
    priority: 8,
    icon: "DollarSign",
    label: "Cost Anomaly",
    requires_response: false,
  },
};

/**
 * Generate a unique task ID
 */
function generateTaskId() {
  return `ACT-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Load action center tasks
 */
async function loadTasks() {
  const { data, error } = await supabase
    .from("settings")
    .select("value")
    .eq("key", ACTION_CENTER_KEY)
    .maybeSingle();
  if (error) throw error;
  const tasks = data?.value?.tasks;
  if (tasks !== undefined && !Array.isArray(tasks)) {
    throw new Error("Invalid Action Center task store");
  }
  return tasks || [];
}

/**
 * Save action center tasks
 */
async function saveTasks(tasks) {
  const trimmed = tasks.slice(0, MAX_TASKS);
  const { data: existing, error: readError } = await supabase
    .from("settings")
    .select("value")
    .eq("key", ACTION_CENTER_KEY)
    .maybeSingle();
  if (readError) throw readError;

  if (existing) {
    const { error } = await supabase
      .from("settings")
      .update({ value: { tasks: trimmed, updated_at: new Date().toISOString() } })
      .eq("key", ACTION_CENTER_KEY);
    if (error) throw error;
    return;
  }

  const { error } = await supabase
    .from("settings")
    .insert({ key: ACTION_CENTER_KEY, value: { tasks: trimmed } });
  if (error) throw error;
}

/**
 * Add a human-required task to the action center
 */
export async function addActionTask({ category, title, description, severity, source, context }) {
  const cat = HUMAN_REQUIRED[category];
  if (!cat) {
    logger.warn("action-center", `Unknown category: ${category}`);
    return null;
  }

  const tasks = await loadTasks();

  // Dedup: don't create duplicate open tasks for same category+title
  const existing = tasks.find(
    (t) => t.status === "OPEN" && t.category === category && t.title === title,
  );
  if (existing) {
    existing.occurrences = (existing.occurrences || 1) + 1;
    existing.last_seen = new Date().toISOString();
    await saveTasks(tasks);
    return null;
  }

  const task = {
    id: generateTaskId(),
    status: "OPEN",
    category,
    priority: cat.priority,
    title,
    description: description || "",
    severity: severity || "medium",
    source: source || "system",
    context: context || {},
    created_at: new Date().toISOString(),
    acknowledged_at: null,
    resolved_at: null,
    resolution: null,
    occurrences: 1,
  };

  tasks.unshift(task);
  await saveTasks(tasks);

  logger.warn("action-center", `Human task created: ${task.id}`, { category, severity });

  return task;
}

/**
 * Get action center summary — only human-required items
 */
export async function getActionSummary() {
  const tasks = await loadTasks();
  const open = tasks.filter((t) => t.status === "OPEN");
  const critical = open.filter((t) => t.severity === "critical" || t.priority <= 2);

  return {
    generated_at: new Date().toISOString(),
    total: tasks.length,
    open: open.length,
    critical: critical.length,
    by_category: Object.keys(HUMAN_REQUIRED).map((cat) => ({
      category: cat,
      label: HUMAN_REQUIRED[cat].label,
      count: open.filter((t) => t.category === cat).length,
    })),
    recent: tasks.slice(0, 20),
  };
}

/**
 * HTTP handler
 */
export default async function handler(req, res) {
  cors(res, req);
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    if (!(await isAdmin(req))) {
      return res.status(403).json({ error: "Admin only" });
    }

    if (req.method === "GET") {
      const { action } = req.query;

      if (action === "summary") {
        const summary = await getActionSummary();
        return res.status(200).json(summary);
      }

      const tasks = await loadTasks();
      const { status, category } = req.query;
      let filtered = tasks;
      if (status) filtered = filtered.filter((t) => t.status === status);
      if (category) filtered = filtered.filter((t) => t.category === category);

      return res.status(200).json({ tasks: filtered, total: filtered.length });
    }

    if (req.method === "POST") {
      const b = req.body || {};

      if (b.action === "create") {
        const task = await addActionTask({
          category: b.category,
          title: b.title,
          description: b.description,
          severity: b.severity,
          source: "admin",
          context: b.context,
        });
        return res.status(201).json(task || { message: "Duplicate suppressed" });
      }

      if (b.action === "acknowledge") {
        const tasks = await loadTasks();
        const task = tasks.find((t) => t.id === b.task_id);
        if (!task) return res.status(404).json({ error: "Task not found" });
        task.status = "ACKNOWLEDGED";
        task.acknowledged_at = new Date().toISOString();
        await saveTasks(tasks);
        return res.status(200).json(task);
      }

      if (b.action === "resolve") {
        const tasks = await loadTasks();
        const task = tasks.find((t) => t.id === b.task_id);
        if (!task) return res.status(404).json({ error: "Task not found" });
        task.status = "RESOLVED";
        task.resolved_at = new Date().toISOString();
        task.resolution = b.resolution || "Resolved by admin";
        await saveTasks(tasks);
        return res.status(200).json(task);
      }

      if (b.action === "dismiss") {
        const tasks = await loadTasks();
        const task = tasks.find((t) => t.id === b.task_id);
        if (!task) return res.status(404).json({ error: "Task not found" });
        task.status = "DISMISSED";
        task.resolved_at = new Date().toISOString();
        task.resolution = "Dismissed by admin";
        await saveTasks(tasks);
        return res.status(200).json(task);
      }

      return res.status(400).json({ error: "Unknown action" });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return sanitizeError(res, err, "action-center");
  }
}
