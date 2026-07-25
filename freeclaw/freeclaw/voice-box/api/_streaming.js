// ─── V3 Enterprise Streaming (SSE) ───────────────────────────────
// Reusable SSE streaming utilities for real-time AI responses.
// Supports authentication, heartbeat, reconnection hints, and error recovery.
import supabase from './_db-client.js';
import { callProviderStream, callLLMChain } from './_providers.js';

// ─── SSE Helpers ─────────────────────────────────────────────────
export function createSSEWriter(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200);

  const write = (event, data) => {
    try {
      const payload = typeof data === 'string' ? data : JSON.stringify(data);
      res.write(`event: ${event}\ndata: ${payload}\n\n`);
    } catch { /* stream closed */ }
  };

  const writeData = (obj) => {
    try {
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
    } catch { /* stream closed */ }
  };

  const heartbeat = () => {
    try {
      res.write(': heartbeat\n\n');
    } catch { /* stream closed */ }
  };

  const close = () => {
    try {
      res.write(`event: done\ndata: {"done":true}\n\n`);
      res.end();
    } catch { /* ignore */ }
  };

  const error = (msg, code = 'STREAM_ERROR') => {
    try {
      write('error', { code, message: msg });
      res.end();
    } catch { /* ignore */ }
  };

  return { write, writeData, heartbeat, close, error };
}

// ─── Heartbeat Interval ──────────────────────────────────────────
// Keeps connection alive during long tool loops (Vercel 60s timeout).
export function startHeartbeat(res, intervalMs = 15000) {
  const timer = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(timer);
    }
  }, intervalMs);
  return () => clearInterval(timer);
}

// ─── Streaming LLM Call with Events ──────────────────────────────
// Wraps callProviderStream with SSE event emission.
export async function streamLLMResponse(messages, writer, { onToken, onDone } = {}) {
  let fullText = '';
  const result = await callProviderStream(messages, {
    onToken: (token) => {
      fullText += token;
      writer.writeData({ type: 'token', token });
      if (onToken) onToken(token);
    },
    onDone: () => {
      writer.writeData({ type: 'stream_done', text: fullText });
      if (onDone) onDone();
    },
    onError: (err) => {
      writer.writeData({ type: 'stream_error', error: err.message });
    },
  });

  return { ...result, fullText };
}

// ─── Tool Call Detection ─────────────────────────────────────────
// Detects tool-call JSON in partial streaming tokens.
// Handles both formats:
//   {"tool": "name", "input": {...}}          (legacy)
//   [{"name": "name", "arguments": {...}}]    (OpenAI-style / system prompt format)
//   {"name": "name", "arguments": {...}}      (single object)
export function detectToolCall(buffer) {
  const trimmed = buffer.trim();

  // 1. Array format: [{"name":"...", "arguments":{...}}]
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr) && arr.length > 0 && arr[0].name) {
        return { tool: arr[0].name, input: arr[0].arguments || arr[0].args || {}, all: arr };
      }
    } catch { /* partial JSON */ }
  }

  // 2. Single object with "name": {"name":"...", "arguments":{...}}
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const obj = JSON.parse(trimmed);
      if (obj.name && (obj.arguments || obj.args)) {
        return { tool: obj.name, input: obj.arguments || obj.args || {} };
      }
      // Legacy format: {"tool":"...", "input":{...}}
      if (obj.tool && obj.input) {
        return { tool: obj.tool, input: obj.input };
      }
    } catch { /* partial JSON */ }
  }

  // 3. Legacy format embedded in text: {"tool": "...", "input": {...}}
  if (trimmed.includes('"tool"') && trimmed.includes('"input"')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.tool && parsed.input) {
        return { tool: parsed.tool, input: parsed.input };
      }
    } catch { /* partial JSON */ }
  }

  return null;
}

// ─── Stream Tool Execution Events ────────────────────────────────
export function streamToolEvent(writer, event, data) {
  writer.writeData({ type: 'tool_event', event, ...data });
}

// ─── Conversation History (for context) ──────────────────────────
export async function getConversationHistory(sessionId, limit = 10) {
  const { data, error } = await supabase
    .from('agent_conversations')
    .select('role, content')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.warn('[STREAMING] Failed to fetch history:', error.message);
    return [];
  }
  return (data || []).reverse();
}

// ─── Store Conversation Turn ─────────────────────────────────────
export async function storeConversation(sessionId, role, content, actions = null) {
  const { error } = await supabase.from('agent_conversations').insert({
    session_id: sessionId,
    role,
    content,
    actions: actions ? JSON.stringify(actions) : null,
  });
  if (error) console.warn('[STREAMING] Failed to store:', error.message);
}

// ─── Audit Log (streaming events) ────────────────────────────────
export async function logStreamingEvent(sessionId, event, metadata = {}) {
  try {
    await supabase.from('audit_logs').insert({
      action: `stream.${event}`,
      resource_type: 'conversation',
      resource_id: sessionId,
      details: metadata,
    });
  } catch { /* non-critical */ }
}

// ─── Validate Streaming Request ──────────────────────────────────
export function validateStreamRequest(body) {
  const errors = [];
  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    errors.push('messages array is required and must not be empty');
  }
  if (body.messages?.length > 50) {
    errors.push('Maximum 50 messages per request');
  }
  if (body.session_id && typeof body.session_id !== 'string') {
    errors.push('session_id must be a string');
  }
  return errors;
}

// ─── SSE Response Wrapper ────────────────────────────────────────
// Standard event format for frontend consumption.
export function sseEvent(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// ─── SSE Done Signal ─────────────────────────────────────────────
export function sseDone() {
  return `event: done\ndata: {"done":true}\n\n`;
}

export default {
  createSSEWriter,
  startHeartbeat,
  streamLLMResponse,
  detectToolCall,
  streamToolEvent,
  getConversationHistory,
  storeConversation,
  logStreamingEvent,
  validateStreamRequest,
  sseEvent,
  sseDone,
};
