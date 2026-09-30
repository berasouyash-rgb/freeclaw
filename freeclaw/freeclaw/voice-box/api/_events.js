// Lightweight event trigger bus for event-driven agent activation.
// Emits events when platform actions occur (new post, comment, message, reaction).
// Stores events in settings.event_log for event-triggered agents to consume.
// Also triggers immediate agent processing for critical events.
import supabase from "./_db-client.js";
import { logger } from "./_observability.js";

const MAX_EVENTS = 200;
const EVENT_TYPES = {
	POST_CREATED: "post.created",
	POST_UPDATED: "post.updated",
	POST_STATUS_CHANGED: "post.status_changed",
	COMMENT_CREATED: "comment.created",
	INBOX_MESSAGE: "inbox.message",
	REACTION_ADDED: "reaction.added",
	USER_REPORTED: "user.reported",
	MODERATION_FLAG: "moderation.flagged",
	AGENT_COMPLETED: "agent.completed",
	SYSTEM_ALERT: "system.alert",
	// ── Workforce task lifecycle (persistent task queue) ──
	TASK_CREATED: "task.created",
	TASK_ASSIGNED: "task.assigned",
	TASK_COMPLETED: "task.completed",
	TASK_FAILED: "task.failed",
};

// Event → agent mapping: which agents should wake on each event type
const EVENT_AGENT_MAP = {
	[EVENT_TYPES.POST_CREATED]: [
		"problem-intelligence", // Analyze post for patterns
		"duplicate-detector", // Check for duplicates
		"content-moderator", // Content review
		"sentiment-engine", // Sentiment analysis
		"trend-spotter", // Trend detection
	],
	[EVENT_TYPES.POST_UPDATED]: ["trend-spotter", "problem-intelligence"],
	[EVENT_TYPES.POST_STATUS_CHANGED]: ["trend-spotter", "analytics-aggregator"],
	[EVENT_TYPES.COMMENT_CREATED]: ["sentiment-engine", "content-moderator"],
	[EVENT_TYPES.INBOX_MESSAGE]: ["problem-intelligence", "sentiment-engine"],
	[EVENT_TYPES.REACTION_ADDED]: ["trend-spotter", "analytics-aggregator"],
	[EVENT_TYPES.USER_REPORTED]: ["risk-assessor", "escalation-protocol"],
	[EVENT_TYPES.MODERATION_FLAG]: [
		"content-moderator",
		"risk-assessor",
		"escalation-protocol",
	],
	[EVENT_TYPES.SYSTEM_ALERT]: ["ops-monitor", "error-pattern-detector"],
};

/**
 * Emit an event to the event bus.
 * Stores the event and triggers relevant agents.
 */
/**
 * Generate a dedup key from event type and data.
 * Prevents duplicate events within the same second.
 */
function dedupKey(type, data) {
	const dataStr = JSON.stringify(data);
	const hash = dataStr.length > 100 ? dataStr.slice(0, 100) : dataStr;
	return `${type}:${hash}`;
}

// In-memory dedup cache (resets on cold start — acceptable for event dedup)
const _recentEvents = new Map();
const DEDUP_WINDOW_MS = 5000; // 5-second dedup window

export async function emitEvent(type, data = {}) {
	try {
		// Dedup: skip if same event was emitted within the dedup window
		const dk = dedupKey(type, data);
		const now = Date.now();
		const lastSeen = _recentEvents.get(dk);
		if (lastSeen && (now - lastSeen) < DEDUP_WINDOW_MS) {
			return null; // duplicate suppressed
		}
		_recentEvents.set(dk, now);

		// Cleanup old dedup entries periodically
		if (_recentEvents.size > 500) {
			for (const [key, ts] of _recentEvents) {
				if (now - ts > DEDUP_WINDOW_MS * 2) _recentEvents.delete(key);
			}
		}

		const event = {
			type,
			data,
			timestamp: new Date().toISOString(),
			processed: false,
		};

		// 1. Store event in settings.event_log (rotating)
		const { data: existing } = await supabase
			.from("settings")
			.select("value")
			.eq("key", "event_log")
			.maybeSingle();

		const events = existing?.value?.events || [];
		events.unshift(event);
		const trimmed = events.slice(0, MAX_EVENTS);

		if (existing) {
			await supabase
				.from("settings")
				.update({ value: { events: trimmed } })
				.eq("key", "event_log");
		} else {
			await supabase
				.from("settings")
				.insert({ key: "event_log", value: { events: trimmed } });
		}

		// 2. Trigger relevant agents for critical events (non-blocking)
		const agentIds = EVENT_AGENT_MAP[type] || [];
		if (agentIds.length > 0) {
			triggerAgents(agentIds, event).catch((err) =>
				logger.warn("events", `Agent trigger failed for ${type}`, { error: err.message }),
			);
		}

		// 3. Check for incident-worthy events (non-blocking)
		if (["system.alert", "security.event"].includes(type)) {
			import("./_incidents.js").then(({ correlateEvent }) =>
				correlateEvent(type, data).catch(() => {}),
			).catch(() => {});
		}

		return event;
	} catch (err) {
		console.warn(`Event emit failed for ${type}:`, err.message);
		return null;
	}
}

/**
 * Trigger a set of agents for an event (non-blocking, fire-and-forget).
 * Instead of directly running agents (which would cause circular imports),
 * we store pending events that agents consume on their next cron tick.
 */
async function triggerAgents(agentIds, event) {
	try {
		// Store pending agent triggers in settings
		const { data: existing } = await supabase
			.from("settings")
			.select("value")
			.eq("key", "pending_agent_events")
			.maybeSingle();

		const pending = existing?.value?.triggers || [];

		for (const agentId of agentIds) {
			pending.push({
				agent_id: agentId,
				event_type: event.type,
				event_data: event.data,
				timestamp: event.timestamp,
				consumed: false,
			});
		}

		// Keep only last 100 pending triggers
		const trimmed = pending.slice(-100);

		if (existing) {
			await supabase
				.from("settings")
				.update({ value: { triggers: trimmed } })
				.eq("key", "pending_agent_events");
		} else {
			await supabase
				.from("settings")
				.insert({ key: "pending_agent_events", value: { triggers: trimmed } });
		}

		logger.info("events", `Queued ${agentIds.length} agent triggers`, { event_type: event.type });
	} catch (err) {
		console.warn(`Failed to queue agent triggers:`, err.message);
	}
}

/**
 * Get unconsumed events for a specific agent (called by agents-cron).
 */
export async function consumeAgentEvents(agentId, limit = 10) {
	try {
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", "pending_agent_events")
			.maybeSingle();

		const all = data?.value?.triggers || [];
		const unconsumed = all
			.filter((t) => t.agent_id === agentId && !t.consumed)
			.slice(-limit);

		// Mark as consumed
		if (unconsumed.length > 0) {
			const ids = new Set(
				unconsumed.map((t) => `${t.agent_id}:${t.timestamp}`),
			);
			const updated = all.map((t) => {
				if (ids.has(`${t.agent_id}:${t.timestamp}`)) {
					return { ...t, consumed: true };
				}
				return t;
			});
			await supabase
				.from("settings")
				.update({ value: { triggers: updated.slice(-100) } })
				.eq("key", "pending_agent_events");
		}

		return unconsumed;
	} catch (e) {
		console.warn("[events] consumeAgentEvents failed:", e.message);
		return [];
	}
}

/**
 * Get recent events (for dashboard and agent consumption).
 */
export async function getRecentEvents(limit = 50, typeFilter = null) {
	try {
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", "event_log")
			.maybeSingle();

		let events = data?.value?.events || [];
		if (typeFilter) {
			events = events.filter((e) => e.type === typeFilter);
		}
		return events.slice(0, limit);
	} catch (e) {
		console.warn("[events] getRecentEvents failed:", e.message);
		return [];
	}
}

/**
 * Get event stats for dashboard.
 */
export async function getEventStats() {
	try {
		const { data } = await supabase
			.from("settings")
			.select("value")
			.eq("key", "event_log")
			.maybeSingle();

		const events = data?.value?.events || [];
		const byType = {};
		const last24h = Date.now() - 86400000;

		for (const e of events) {
			byType[e.type] = (byType[e.type] || 0) + 1;
		}

		const recent = events.filter(
			(e) => new Date(e.timestamp).getTime() > last24h,
		);

		return {
			total: events.length,
			last24h: recent.length,
			byType,
			lastEvent: events[0]?.timestamp || null,
		};
	} catch (e) {
		console.warn("[events] getEventStats failed:", e.message);
		return { total: 0, last24h: 0, byType: {}, lastEvent: null };
	}
}

// ─── Python Workforce Bridge ──────────────────────────────────────
// Pushes events to the Python workforce SSE endpoint when available.
// This is fire-and-forget: if the workforce is down, events are not lost
// because they're already persisted in the Node.js event_log.

const WORKFORCE_URL = (
	process.env.WORKFORCE_URL ||
	process.env.WORKFORCE_BASE_URL ||
	""
).trim();
let _workforceAvailable = null; // null = unknown, true/false = cached

/**
 * Push an event to the Python workforce event bus.
 * Non-blocking, fails silently if workforce is down.
 * The bridge is opt-in: when no URL is configured nothing is probed —
 * events stay persisted in the Node.js event_log.
 */
async function pushToWorkforce(type, data = {}) {
	if (!WORKFORCE_URL) return;
	try {
		// Quick connectivity check (cached for 60s)
		if (_workforceAvailable === false) return;

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 3000);

		// FIX #4 (AUDIT): workforce API now requires an admin token.
		// Build headers conditionally — a fetch header with value
		// `undefined` throws before the request is even sent.
		const wfHeaders = { "Content-Type": "application/json" };
		if (process.env.ADMIN_TOKEN)
			wfHeaders["X-Admin-Token"] = process.env.ADMIN_TOKEN;

		const res = await fetch(`${WORKFORCE_URL}/api/workforce/events`, {
			method: "POST",
			headers: wfHeaders,
			body: JSON.stringify({
				event_type: type,
				data: { ...data, source: "nodejs_api" },
				source: "nodejs_api",
			}),
			signal: controller.signal,
		});

		clearTimeout(timer);
		if (res.ok) {
			_workforceAvailable = true;
		} else {
			// Cache failures briefly
			if (_workforceAvailable === true) {
				setTimeout(() => { _workforceAvailable = null; }, 60000);
			}
		}
	} catch {
		// Workforce unavailable — silently degrade
		if (_workforceAvailable === null) _workforceAvailable = false;
	}
}

/**
 * Emit an event AND push to Python workforce.
 * Enhanced version of the original emitEvent that also bridges to the workforce.
 */
export async function emitEventAndBridge(type, data = {}) {
	const event = await emitEvent(type, data);
	if (event) {
		// Map Node.js event types to Python workforce event types
		const typeMap = {
			"post.created": "POST_CREATED",
			"post.updated": "POST_UPDATED",
			"post.status_changed": "POST_STATUS_CHANGED",
			"comment.created": "COMMENT_CREATED",
			"inbox.message": "MESSAGE_SENT",
			"reaction.added": "POLL_VOTED",
			"user.reported": "REPORT_CREATED",
			"moderation.flagged": "SPAM_DETECTED",
			"system.alert": "SERVICE_DEGRADED",
		};
		const workforceType = typeMap[type] || type;
		pushToWorkforce(workforceType, data).catch(() => {});
	}
	return event;
}

export { EVENT_AGENT_MAP, EVENT_TYPES };
export default {
	emitEvent,
	emitEventAndBridge,
	getRecentEvents,
	getEventStats,
	consumeAgentEvents,
	pushToWorkforce,
	EVENT_TYPES,
	EVENT_AGENT_MAP,
};
