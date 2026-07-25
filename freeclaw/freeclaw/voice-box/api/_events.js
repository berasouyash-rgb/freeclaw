// Lightweight event trigger bus for event-driven agent activation.
// Emits events when platform actions occur (new post, comment, message, reaction).
// Stores events in settings.event_log for event-triggered agents to consume.
// Also triggers immediate agent processing for critical events.
import supabase from './_db-client.js';

const MAX_EVENTS = 200;
const EVENT_TYPES = {
  POST_CREATED: 'post.created',
  POST_UPDATED: 'post.updated',
  POST_STATUS_CHANGED: 'post.status_changed',
  COMMENT_CREATED: 'comment.created',
  INBOX_MESSAGE: 'inbox.message',
  REACTION_ADDED: 'reaction.added',
  USER_REPORTED: 'user.reported',
  MODERATION_FLAG: 'moderation.flagged',
  AGENT_COMPLETED: 'agent.completed',
  SYSTEM_ALERT: 'system.alert',
};

// Event → agent mapping: which agents should wake on each event type
const EVENT_AGENT_MAP = {
  [EVENT_TYPES.POST_CREATED]: [
    'problem-intelligence',    // Analyze post for patterns
    'duplicate-detector',      // Check for duplicates
    'content-moderator',       // Content review
    'sentiment-engine',        // Sentiment analysis
    'trend-spotter',           // Trend detection
  ],
  [EVENT_TYPES.POST_UPDATED]: [
    'trend-spotter',
    'problem-intelligence',
  ],
  [EVENT_TYPES.POST_STATUS_CHANGED]: [
    'trend-spotter',
    'analytics-aggregator',
  ],
  [EVENT_TYPES.COMMENT_CREATED]: [
    'sentiment-engine',
    'content-moderator',
  ],
  [EVENT_TYPES.INBOX_MESSAGE]: [
    'problem-intelligence',
    'sentiment-engine',
  ],
  [EVENT_TYPES.REACTION_ADDED]: [
    'trend-spotter',
    'analytics-aggregator',
  ],
  [EVENT_TYPES.USER_REPORTED]: [
    'risk-assessor',
    'escalation-protocol',
  ],
  [EVENT_TYPES.MODERATION_FLAG]: [
    'content-moderator',
    'risk-assessor',
    'escalation-protocol',
  ],
  [EVENT_TYPES.SYSTEM_ALERT]: [
    'ops-monitor',
    'error-pattern-detector',
  ],
};

/**
 * Emit an event to the event bus.
 * Stores the event and triggers relevant agents.
 */
export async function emitEvent(type, data = {}) {
  try {
    const event = {
      type,
      data,
      timestamp: new Date().toISOString(),
      processed: false,
    };

    // 1. Store event in settings.event_log (rotating)
    const { data: existing } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'event_log')
      .maybeSingle();

    const events = existing?.value?.events || [];
    events.unshift(event);
    const trimmed = events.slice(0, MAX_EVENTS);

    if (existing) {
      await supabase
        .from('settings')
        .update({ value: { events: trimmed } })
        .eq('key', 'event_log');
    } else {
      await supabase
        .from('settings')
        .insert({ key: 'event_log', value: { events: trimmed } });
    }

    // 2. Trigger relevant agents for critical events (non-blocking)
    const agentIds = EVENT_AGENT_MAP[type] || [];
    if (agentIds.length > 0) {
      triggerAgents(agentIds, event).catch((err) =>
        console.warn(`Event agent trigger failed for ${type}:`, err.message)
      );
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
      .from('settings')
      .select('value')
      .eq('key', 'pending_agent_events')
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
        .from('settings')
        .update({ value: { triggers: trimmed } })
        .eq('key', 'pending_agent_events');
    } else {
      await supabase
        .from('settings')
        .insert({ key: 'pending_agent_events', value: { triggers: trimmed } });
    }

    console.log(
      `Event ${event.type}: queued ${agentIds.length} agent triggers for consumption`
    );
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
      .from('settings')
      .select('value')
      .eq('key', 'pending_agent_events')
      .maybeSingle();

    const all = data?.value?.triggers || [];
    const unconsumed = all
      .filter(t => t.agent_id === agentId && !t.consumed)
      .slice(-limit);

    // Mark as consumed
    if (unconsumed.length > 0) {
      const ids = new Set(unconsumed.map(t => `${t.agent_id}:${t.timestamp}`));
      const updated = all.map(t => {
        if (ids.has(`${t.agent_id}:${t.timestamp}`)) {
          return { ...t, consumed: true };
        }
        return t;
      });
      await supabase
        .from('settings')
        .update({ value: { triggers: updated.slice(-100) } })
        .eq('key', 'pending_agent_events');
    }

    return unconsumed;
  } catch (e) {
    console.warn('[events] consumeAgentEvents failed:', e.message);
    return [];
  }
}

/**
 * Get recent events (for dashboard and agent consumption).
 */
export async function getRecentEvents(limit = 50, typeFilter = null) {
  try {
    const { data } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'event_log')
      .maybeSingle();

    let events = data?.value?.events || [];
    if (typeFilter) {
      events = events.filter((e) => e.type === typeFilter);
    }
    return events.slice(0, limit);
  } catch (e) {
    console.warn('[events] getRecentEvents failed:', e.message);
    return [];
  }
}

/**
 * Get event stats for dashboard.
 */
export async function getEventStats() {
  try {
    const { data } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'event_log')
      .maybeSingle();

    const events = data?.value?.events || [];
    const byType = {};
    const last24h = Date.now() - 86400000;

    for (const e of events) {
      byType[e.type] = (byType[e.type] || 0) + 1;
    }

    const recent = events.filter(
      (e) => new Date(e.timestamp).getTime() > last24h
    );

    return {
      total: events.length,
      last24h: recent.length,
      byType,
      lastEvent: events[0]?.timestamp || null,
    };
  } catch (e) {
    console.warn('[events] getEventStats failed:', e.message);
    return { total: 0, last24h: 0, byType: {}, lastEvent: null };
  }
}

export { EVENT_TYPES, EVENT_AGENT_MAP };
export default { emitEvent, getRecentEvents, getEventStats, consumeAgentEvents, EVENT_TYPES, EVENT_AGENT_MAP };
