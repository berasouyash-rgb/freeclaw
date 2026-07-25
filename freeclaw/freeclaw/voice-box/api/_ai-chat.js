// AI Admin Chat with SSE Streaming — multi-iteration tool loop.
// Ported from Ada-SI's run_agent_stream pattern. Backend-only, no UI changes.
//
// Architecture:
//   1. Build system prompt with persona + tool definitions
//   2. Loop up to MAX_TOOL_ITERATIONS times:
//      a. Call LLM with working messages
//      b. If LLM returns tool calls → execute them, append results, loop
//      c. If LLM returns text only → done (final answer)
//   3. Stream all responses as SSE events
import supabase from './_db-client.js';
import { cors, isAdmin, auditLog } from './_auth.js';
import { callLLMChain, callProviderStream } from './_providers.js';
import { sanitizeError } from './_error.js';
import { loadPersona, buildPersonaSystemPrompt } from './_persona.js';
import { listForgedTools } from './_tool-forge.js';
import { getToolsForRole, executeTool as registryExecuteTool, buildToolSystemPrompt } from './_tool-registry.js';
import { detectPromptInjection } from './_security.js';

// ─── Constants ────────────────────────────────────────────────────
const MAX_TOOL_ITERATIONS = 5;
const CANCEL_FLAGS = new Set();
const MAX_TOOL_RESULT_CHARS = 4000; // Truncate tool results larger than this
const MAX_TOOL_RESULT_LOG_CHARS = 200; // Truncate tool args in log messages

// ─── Context Compression (hermes-agent port) ──────────────────────
// When conversation history exceeds a token threshold, compress older
// messages into a summary to stay within LLM context limits.
// Keeps recent messages intact for continuity.
const CONTEXT_TOKEN_THRESHOLD = 6000; // ~24K chars — compress if over this
const CONTEXT_KEEP_RECENT = 4;        // Always keep last N messages intact
const CHARS_PER_TOKEN = 4;            // Rough estimate

function estimateTokens(text) {
  return Math.ceil((text || '').length / CHARS_PER_TOKEN);
}

function estimateMessagesTokens(messages) {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content) + 4, 0); // +4 for role/tokens overhead
}

async function summarizeConversation(oldMessages) {
  const conversationText = oldMessages.map(m =>
    `${m.role === 'user' ? 'User' : 'Assistant'}: ${(m.content || '').slice(0, 500)}`
  ).join('\n');

  const result = await callLLMChain(
    'You are a conversation summarizer. Summarize the following conversation into a concise context block. ' +
    'Preserve key facts, decisions, tool results, and user preferences. ' +
    'Output ONLY the summary — no preamble, no markdown headers.',
    `Summarize this conversation:\n\n${conversationText}`
  );
  return result ? result.text : `[Previous conversation: ${oldMessages.length} messages]`;
}

async function compressContext(messages, runId) {
  const totalTokens = estimateMessagesTokens(messages);

  if (totalTokens <= CONTEXT_TOKEN_THRESHOLD) {
    return messages; // No compression needed
  }

  log(runId, 'COMPRESS', `Context too large (${totalTokens} tokens, ${messages.length} msgs) — compressing`);

  // Keep the system message (index 0) + last N messages intact
  const systemMsg = messages[0]; // system prompt
  const recentMessages = messages.slice(-CONTEXT_KEEP_RECENT);
  const oldMessages = messages.slice(1, -CONTEXT_KEEP_RECENT); // everything between system and recent

  if (oldMessages.length === 0) {
    return messages; // Nothing to compress
  }

  // Summarize old messages
  const summary = await summarizeConversation(oldMessages);

  const compressed = [
    systemMsg,
    { role: 'system', content: `[Conversation Summary]\n${summary}\n[End Summary — recent messages below]` },
    ...recentMessages,
  ];

  const newTokens = estimateMessagesTokens(compressed);
  log(runId, 'COMPRESS', `Compressed ${oldMessages.length} messages → summary (${totalTokens} → ${newTokens} tokens)`);

  return compressed;
}

// ─── SSE Helpers ──────────────────────────────────────────────────
function sseData(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}
function sseDone() {
  return 'data: [DONE]\n\n';
}
function processStep(runId, stepId, label, status, detail = '', model = '') {
  return sseData({
    ada_event: 'process_step',
    run_id: runId, step_id: stepId,
    label, status, detail, model,
  });
}

// ─── ThinkStreamParser ────────────────────────────────────────────
// Buffers streaming tokens and detects <thinking>...</thinking> blocks.
// Emits reasoning as thinking_delta events and strips it from content_delta.
//
// Usage:
//   parser.onToken(token) → { isThinking, isContent, isDone }
//   parser.flush() → any remaining content tokens
class ThinkStreamParser {
  constructor() {
    this._buf = '';
    this._inThinking = false;
    this._thinkingBuf = '';
  }

  /** Feed a token. Returns { isThinking, isContent } booleans. */
  onToken(token) {
    this._buf += token;
    const result = { isThinking: false, isContent: false };

    while (this._buf.length > 0) {
      if (this._inThinking) {
        // Inside <thinking> block — look for </thinking>
        const endIdx = this._buf.indexOf('</thinking>');
        if (endIdx === -1) {
          // Entire buffer is thinking content
          this._thinkingBuf += this._buf;
          result.isThinking = true;
          this._buf = '';
        } else {
          // Found end tag — extract thinking content up to it
          this._thinkingBuf += this._buf.slice(0, endIdx);
          result.isThinking = true;
          this._buf = this._buf.slice(endIdx + 11); // skip </thinking>
          this._inThinking = false;
        }
      } else {
        // Outside <thinking> — look for <thinking> or content
        const thinkIdx = this._buf.indexOf('<thinking>');
        if (thinkIdx === -1) {
          // No thinking tag found yet — emit everything as content
          // (but keep a small trailing buffer to catch partial tags)
          if (this._buf.length > 12) {
            const safe = this._buf.slice(0, -12);
            result.isContent = true;
            this._buf = this._buf.slice(-12);
          }
          break; // wait for more tokens
        } else {
          // Found <thinking> tag — emit content before it, then switch mode
          if (thinkIdx > 0) {
            result.isContent = true;
            // We'll emit this content below
          }
          this._buf = this._buf.slice(thinkIdx + 10); // skip <thinking>
          this._inThinking = true;
          // Continue loop to process remaining buffer as thinking
        }
      }
    }

    return result;
  }

  /** Get accumulated thinking text */
  getThinking() {
    return this._thinkingBuf;
  }

  /** Flush any remaining buffer as content */
  flush() {
    const remaining = this._buf;
    this._buf = '';
    return remaining;
  }
}

// ─── Structured Logger (with timestamps + run timing) ─────────────
// Ported from Ada-SI's debug_log.py pattern: run_id-scoped, timestamped,
// category-tagged. Track per-run timing so we can log total duration.
const _runStartTimes = new Map(); // runId → Date

function log(runId, category, msg) {
  const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  console.log(`[AI-CHAT][${ts}][${runId}][${category}] ${msg}`);
}
function logError(runId, category, msg) {
  const ts = new Date().toISOString().slice(11, 23);
  console.error(`[AI-CHAT][${ts}][${runId}][${category}] ${msg}`);
}
function startRunTimer(runId) {
  _runStartTimes.set(runId, Date.now());
}
function endRunTimer(runId) {
  const start = _runStartTimes.get(runId);
  _runStartTimes.delete(runId);
  if (start) return Date.now() - start;
  return 0;
}

// ─── Run Cancellation ─────────────────────────────────────────────
function isCancelled(runId) {
  return CANCEL_FLAGS.has(runId);
}
function markCancelled(runId) {
  if (runId) CANCEL_FLAGS.add(runId);
}
function clearCancelled(runId) {
  CANCEL_FLAGS.delete(runId);
}

// ─── Tool Output Truncation ───────────────────────────────────────
// Prevents token overflow from large query results.
function truncateToolResult(resultStr) {
  if (resultStr.length <= MAX_TOOL_RESULT_CHARS) return resultStr;
  return resultStr.slice(0, MAX_TOOL_RESULT_CHARS) + `\n... [truncated — ${resultStr.length} chars total, limit ${MAX_TOOL_RESULT_CHARS}]`;
}

// ─── Registry Adapter ─────────────────────────────────────────────
// Wraps the centralized registry's executeTool to match the local
// { result, error } format expected by the existing tool loop.
async function executeTool(name, args) {
  const outcome = await registryExecuteTool(name, args, { role: 'admin' });
  if (outcome.error) return { result: null, error: outcome.error };
  const { latency_ms, _cached, _truncated, _original_size, ...result } = outcome;
  return { result, error: null };
}

// ─── System Prompt Builder ────────────────────────────────────────
async function buildSystemPrompt() {
  const persona = await loadPersona();
  const personaPrompt = buildPersonaSystemPrompt(persona);
  const forgedTools = await listForgedTools();
  const forgedToolList = forgedTools.map(t => `- ${t.name}: ${t.description}`).join('\n');

  return buildToolSystemPrompt('admin', personaPrompt) +
    `\n\n## FORGED TOOLS\nYou have custom tools available:\n${forgedToolList || '(No custom tools forged yet — use forge_tool to create one.)'}\n`;
}

// ─── Tool Call Parser ─────────────────────────────────────────────
// Parses LLM text output into tool calls or text reply.
// Returns { reply: string, actions: [{tool, args}] }
function parseToolCalls(text) {
  const trimmed = text.trim();

  // 1. Raw JSON array: [{"name":"...", "arguments":{...}}]
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr) && arr.length > 0 && arr[0].name) {
        return { reply: '', actions: arr.map(item => ({
          tool: item.name,
          args: item.arguments || item.args || {},
        }))};
      }
    } catch { /* fall through */ }
  }

  // 2. JSON code block: ```json\n[...]\n```
  const codeBlockMatch = trimmed.match(/```json\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim());
      if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].name) {
        return { reply: '', actions: parsed.map(item => ({
          tool: item.name,
          args: item.arguments || item.args || {},
        }))};
      }
    } catch { /* fall through */ }
  }

  // 3. JSON object with "actions" key: {"actions":[...], "reply":"..."}
  const actionsMatch = trimmed.match(/\{[\s\S]*"actions"[\s\S]*\}/);
  if (actionsMatch) {
    try {
      const json = JSON.parse(actionsMatch[0]);
      if (json.actions && Array.isArray(json.actions)) {
        return { reply: json.reply || '', actions: json.actions };
      }
    } catch { /* fall through */ }
  }

  // 4. Single JSON object: {"name":"...", "arguments":{...}}
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const obj = JSON.parse(trimmed);
      if (obj.name && (obj.arguments || obj.args)) {
        return { reply: '', actions: [{ tool: obj.name, args: obj.arguments || obj.args }] };
      }
    } catch { /* fall through */ }
  }

  // 5. No tool calls found — return as text
  return { reply: text, actions: [] };
}

// ─── Detect Tool-Call JSON in Streaming Text ───────────────────────
// Returns true if the accumulated text looks like it's a tool call
// (raw JSON array/object) rather than natural language content.
function looksLikeToolCall(text) {
  if (!text) return false;
  const trimmed = text.trim();
  // Raw JSON array: [{"name":"...", ...}]
  if (trimmed.startsWith('[') && (trimmed.includes('"name"') || trimmed.includes('"tool"'))) return true;
  // JSON code block with tool array: ```json\n[{...}]\n```
  if (/^```json\s*\[/.test(trimmed)) return true;
  // JSON object with "actions": {"actions":[...]}
  if (trimmed.startsWith('{') && trimmed.includes('"actions"') && /\[/.test(trimmed)) return true;
  // Single tool object: {"name":"...", "arguments":{...}}
  if (trimmed.startsWith('{') && trimmed.includes('"name"') && (trimmed.includes('"arguments"') || trimmed.includes('"args"'))) return true;
  return false;
}

// Detect tool-call JSON from partial streaming tokens (no leading bracket needed).
// Checks for JSON key-value patterns that don't appear in natural language.
function looksLikeToolCallPartial(text) {
  if (!text || text.length < 6) return false;
  // JSON key-value separator pattern: "word": — very rare in natural language
  if (/\"\w+\"\s*:/.test(text)) return true;
  // Nested JSON braces with keys: {"word": or [{"word":
  if (/[\[{]\s*"\w+"\s*:/.test(text)) return true;
  return false;
}

// ─── Execute Tool + Return Result as String ───────────────────────
async function executeToolSafe(name, args) {
  try {
    const result = await executeTool(name, args);
    return { result, error: null };
  } catch (err) {
    return { result: null, error: err.message };
  }
}

// ─── Multi-Iteration Tool Loop (Ada-SI Pattern) ──────────────────
// This is the core loop from Ada-SI's run_agent_stream, adapted for
// Nemotron (which doesn't support native function calling).
//
// Flow:
//   1. Call LLM with working messages
//   2. Parse response for tool calls
//   3. If tool calls found → execute, append results, loop
//   4. If no tool calls → final text answer, done
async function runToolLoop({
  runId, systemPrompt, userMessage, messages,
  writeSse, isStreamMode,
}) {
  clearCancelled(runId);
  startRunTimer(runId);
  log(runId, 'LOOP', `Starting tool loop (max ${MAX_TOOL_ITERATIONS} iterations, stream=${isStreamMode})`);

  try {
    return await _runToolLoopInner({ runId, systemPrompt, userMessage, messages, writeSse, isStreamMode });
  } finally {
    const elapsed = endRunTimer(runId);
    clearCancelled(runId); // Prevent memory leak — always clean up
    log(runId, 'LOOP', `Run finished (${elapsed}ms)`);
  }
}

async function _runToolLoopInner({
  runId, systemPrompt, userMessage, messages,
  writeSse, isStreamMode,
}) {

  // Build working messages (conversation history)
  // Apply context compression if history is too long (hermes-agent pattern)
  const historyMessages = messages.slice(0, -1).map(m => ({ role: m.role || 'user', content: m.content }));
  const allMessages = [
    { role: 'system', content: systemPrompt },
    ...historyMessages,
    { role: 'user', content: userMessage },
  ];
  const workingMessages = await compressContext(allMessages, runId);

  const allToolResults = [];
  let finalText = '';
  let thinkingText = '';
  let suppressContentDelta = false; // Suppress streaming when LLM outputs tool-call JSON

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    if (isCancelled(runId)) {
      log(runId, 'LOOP', 'Run cancelled by user');
      return { text: 'Operation cancelled.', toolResults: allToolResults, iterations: iteration };
    }

    // Signal new iteration to frontend (so it can reset streaming state)
    if (iteration > 0 && isStreamMode) {
      writeSse(sseData({
        ada_event: 'iteration_start',
        run_id: runId,
        iteration: iteration + 1,
        message: 'Processing tool results...',
      }));
    }

    log(runId, 'LOOP', `Iteration ${iteration + 1}/${MAX_TOOL_ITERATIONS}`);
    writeSse(processStep(runId, 'thinking', `Processing (step ${iteration + 1})`, 'active'));

    // ── Call LLM ──────────────────────────────────────────────
    let llmText = '';

    // Stream only on first iteration; use batch for tool-result summaries
    // (NIM rate-limits rapid sequential streaming calls)
    if (isStreamMode && iteration === 0) {
      // Streaming: collect tokens, detect <thinking> blocks, route to correct event.
      // During tool-call iterations, suppress content_delta so raw JSON isn't shown.
      let streamingBuffer = '';
      let nonThinkingBuffer = ''; // Tracks non-thinking content for early tool-call detection
      const thinkParser = new ThinkStreamParser();
      let earlyToolDetect = false; // Set true if we detect tool-call JSON during streaming
      try {
        const streamResult = await callProviderStream(workingMessages, {
          onToken: (token) => {
            streamingBuffer += token;
            const result = thinkParser.onToken(token);

            if (result.isThinking) {
              // Emit thinking reasoning as a separate event
              writeSse(sseData({
                ada_event: 'thinking_delta',
                run_id: runId,
                delta: token,
              }));
            }

            if (result.isContent) {
              // Early tool-call detection: accumulate first ~50 non-thinking chars
              // and check if they look like JSON tool-call syntax.
              if (!suppressContentDelta && !earlyToolDetect) {
                nonThinkingBuffer += token;
                // Check as soon as we have 6+ chars
                if (nonThinkingBuffer.length >= 6) {
                  if (looksLikeToolCall(nonThinkingBuffer) || looksLikeToolCallPartial(nonThinkingBuffer)) {
                    earlyToolDetect = true;
                    log(runId, 'LOOP', `Early tool-call detected (${nonThinkingBuffer.slice(0,30)}…) — suppressing content_delta`);
                  } else if (nonThinkingBuffer.length > 50) {
                    // After 50 chars with no JSON pattern, it's probably natural language — stop checking
                    nonThinkingBuffer = '';
                  }
                }
              }

              // Stream content only if no tool call detected
              if (!suppressContentDelta && !earlyToolDetect) {
                writeSse(sseData({
                  ada_event: 'content_delta',
                  run_id: runId,
                  delta: token,
                }));
              }
            }
          },
          onDone: () => {},
          onError: (err) => {
            logError(runId, 'LLM', `Stream error: ${err.message}`);
          },
        });
        // Flush any remaining buffered content
        const remaining = thinkParser.flush();
        if (remaining && !suppressContentDelta && !earlyToolDetect) {
          writeSse(sseData({
            ada_event: 'content_delta',
            run_id: runId,
            delta: remaining,
          }));
        }
        thinkingText = thinkParser.getThinking();
        if (streamResult && streamResult.ok) {
          llmText = streamResult.text || streamingBuffer;
        } else {
          llmText = streamingBuffer;
        }
      } catch (streamErr) {
        logError(runId, 'LLM', `Stream failed: ${streamErr.message}`);
        // Fallback to batch — use workingMessages (may be compressed)
        const sysMsg = workingMessages.find(m => m.role === 'system')?.content || systemPrompt;
        const usrMsg = workingMessages.filter(m => m.role === 'user').pop()?.content || userMessage;
        const result = await callLLMChain(sysMsg, usrMsg);
        llmText = result ? result.text : '';
      }
    } else {
      // Non-streaming (or streaming fallback on iteration 2+): callLLMChain with full context
      // Include tool results from previous iterations in the message history.
      // Convert role:'tool' to role:'user' since Nemotron doesn't support the tool role.
      const sysMsg = workingMessages.find(m => m.role === 'system')?.content || systemPrompt;
      const usrMsg = workingMessages.filter(m => m.role === 'user').pop()?.content || userMessage;
      const extraMsgs = workingMessages
        .filter(m => m.role === 'assistant' || m.role === 'tool')
        .map(m => m.role === 'tool'
          ? { role: 'user', content: `[Tool Result]: ${m.content}` }
          : m
        );
      const result = await callLLMChain(sysMsg, usrMsg, extraMsgs);
      llmText = result ? result.text : '';
    }

    if (!llmText) {
      logError(runId, 'LLM', 'Empty response from LLM');
      finalText = 'All LLM providers are currently unavailable. Please try again.';
      break;
    }

    log(runId, 'LLM', `Response (${llmText.length} chars)`);

    // ── Parse Tool Calls ─────────────────────────────────────
    const parsed = parseToolCalls(llmText);

    if (!parsed.actions || parsed.actions.length === 0) {
      // No tool calls → this is the final answer
      finalText = parsed.reply || llmText;
      suppressContentDelta = false; // Ensure final answer is streamed
      log(runId, 'LOOP', `Final answer at iteration ${iteration + 1}`);
      break;
    }

    // Tool calls detected → suppress content_delta for the next streaming iteration
    // (the current iteration's tokens are already collected but not emitted if suppressed)
    suppressContentDelta = true;
    log(runId, 'TOOLS', `Tool calls detected — suppressing content_delta, executing ${parsed.actions.length} tool(s)`);

    // After 2+ tool iterations, inject a nudge to force a text answer
    if (iteration >= 1) {
      workingMessages.push({
        role: 'system',
        content: 'IMPORTANT: You have already executed tools. You MUST now respond with a natural language answer summarizing the results. Do NOT return more JSON tool calls.',
      });
    }
    writeSse(processStep(runId, 'tools', `Executing ${parsed.actions.length} tool(s)`, 'active'));

    // Append assistant message to working messages (simulates OpenAI tool_calls format)
    const assistantMsg = { role: 'assistant', content: llmText };
    workingMessages.push(assistantMsg);

    for (const action of parsed.actions) {
      if (isCancelled(runId)) break;

      const toolName = action.tool;
      const toolArgs = action.args || {};
      log(runId, 'TOOL', `Running ${toolName}(${JSON.stringify(toolArgs).slice(0, MAX_TOOL_RESULT_LOG_CHARS)})`);
      writeSse(processStep(runId, 'tool', `Running ${toolName}`, 'active', '', toolName));

      const { result, error } = await executeToolSafe(toolName, toolArgs);

      const toolResult = error
        ? { tool: toolName, args: toolArgs, error }
        : { tool: toolName, args: toolArgs, result };
      allToolResults.push(toolResult);

      writeSse(processStep(runId, 'tool', error ? `Failed ${toolName}` : `Completed ${toolName}`,
        error ? 'error' : 'done', error || '', toolName));
      writeSse(sseData({
        ada_event: 'tool_result',
        run_id: runId,
        tool: toolName,
        args: toolArgs,
        result: error ? { error } : result,
      }));

      // Append tool result to working messages (role: "tool")
      // Truncate large results to prevent token overflow
      const resultStr = truncateToolResult(
        error ? JSON.stringify({ error }) : JSON.stringify(result)
      );
      workingMessages.push({
        role: 'tool',
        content: resultStr,
      });
    }

    // Loop continues → LLM will see tool results and decide next action
    log(runId, 'LOOP', `Iteration ${iteration + 1} complete, tools executed. Continuing...`);
    // Small delay to avoid NIM rate-limiting on rapid sequential streaming calls
    await new Promise(resolve => setTimeout(resolve, 800));
  }

  // If we exhausted all iterations without a final answer
  if (!finalText && allToolResults.length > 0) {
    // Generate a summary of what was done
    log(runId, 'LOOP', `Max iterations reached. Generating summary.`);
    const toolContext = allToolResults.map(r => {
      if (r.error) return `Tool ${r.tool} failed: ${r.error}`;
      return `Tool ${r.tool} result: ${JSON.stringify(r.result).slice(0, 2000)}`;
    }).join('\n\n');

    // Use a dedicated summary prompt that explicitly forbids tool calls
    const summaryResult = await callLLMChain(
      'You are a helpful admin assistant. Below are the results from database tool executions. ' +
      'Summarize the findings in clear, friendly markdown. ' +
      'CRITICAL: Do NOT output JSON. Do NOT output tool calls. Just describe the data in plain language. ' +
      'Format your answer as a readable summary with bullet points or a table if appropriate.',
      `Tool execution results:\n${toolContext}\n\n` +
      'Summarize what was found. Be specific with numbers and details from the data above.'
    );
    const summaryText = summaryResult ? summaryResult.text : '';

    // Safety: if the summary LLM also returned tool calls, build a manual fallback
    if (summaryText && looksLikeToolCall(summaryText)) {
      log(runId, 'LOOP', 'Summary LLM returned tool calls — using manual fallback');
      const errorTools = allToolResults.filter(r => r.error);
      const successTools = allToolResults.filter(r => !r.error);
      const parts = [];
      if (successTools.length > 0) {
        parts.push(`Successfully executed: ${successTools.map(r => r.tool).join(', ')}`);
        for (const r of successTools) {
          parts.push(`**${r.tool}**: ${JSON.stringify(r.result).slice(0, 500)}`);
        }
      }
      if (errorTools.length > 0) {
        parts.push(`Failed: ${errorTools.map(r => `${r.tool} (${r.error})`).join(', ')}`);
      }
      finalText = parts.join('\n') || 'Tool execution complete — see results above.';
    } else {
      finalText = summaryText || 'Tool execution complete.';
    }
  }

  return { text: finalText, toolResults: allToolResults, iterations: MAX_TOOL_ITERATIONS, thinkingText };
}

// ─── Cancel Endpoint ──────────────────────────────────────────────
export async function cancelRun(runId) {
  markCancelled(runId);
}

// ─── Main Handler ─────────────────────────────────────────────────
export default async function handler(req, res) {
  cors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await isAdmin(req))) return res.status(403).json({ error: 'Admin only' });

  // Handle cancel requests
  if (req.body?.action === 'cancel' && req.body?.run_id) {
    cancelRun(req.body.run_id);
    return res.status(200).json({ ok: true, cancelled: req.body.run_id });
  }

  try {
    const body = req.body || {};

    // ── Handle history/sessions requests ─────────────────────────
    if (body.action === 'history') {
      const sid = (body.session_id || 'ai-chat-main').slice(0, 60);
      const { data } = await supabase.from('agent_conversations')
        .select('*')
        .eq('session_id', sid)
        .order('created_at', { ascending: true })
        .limit(200);
      return res.status(200).json(data || []);
    }
    if (body.action === 'sessions') {
      const { data: rows } = await supabase.from('agent_conversations')
        .select('session_id, created_at')
        .order('created_at', { ascending: false })
        .limit(200);
      const sessions = {};
      (rows || []).forEach((r) => {
        if (!sessions[r.session_id]) sessions[r.session_id] = { session_id: r.session_id, last_message: r.created_at };
      });
      return res.status(200).json(Object.values(sessions).slice(0, 20));
    }

    // ── Chat: process messages ───────────────────────────────────
    const messages = body.messages || [];
    const runId = body.run_id || `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // Use consistent session_id for history persistence (default: 'ai-chat-main')
    const sessionId = (body.session_id || 'ai-chat-main').slice(0, 60);
    const stream = body.stream !== false;

    if (!messages.length) return res.status(400).json({ error: 'No messages provided' });

    const systemPrompt = await buildSystemPrompt();
    const userMessage = messages[messages.length - 1]?.content || '';
    if (!userMessage) return res.status(400).json({ error: 'Empty message' });

    // Security: Detect prompt injection attempts (log but don't block — school platform)
    const injectionCheck = detectPromptInjection(userMessage);
    if (!injectionCheck.safe) {
      console.warn(`[security] Prompt injection detected: ${injectionCheck.reason} (confidence: ${injectionCheck.confidence})`);
      auditLog('system', 'prompt_injection_detected', {
        message: userMessage.slice(0, 200),
        reason: injectionCheck.reason,
        confidence: injectionCheck.confidence,
      });
    }

    // Store user message with consistent session_id
    const { error: convErr } = await supabase.from('agent_conversations').insert({
      session_id: sessionId, role: 'user', content: userMessage,
    });
    if (convErr) logError(runId, 'DB', `Failed to store conversation: ${convErr.message}`);

    if (stream) {
      // ── SSE Streaming Response ──────────────────────────────
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.status(200);

      const writeSse = (data) => { try { res.write(data); } catch { /* stream closed */ } };

      // Run the multi-iteration tool loop
      const { text, toolResults, iterations, thinkingText } = await runToolLoop({
        runId, systemPrompt, userMessage, messages,
        writeSse, isStreamMode: true,
      });

      // Store final response with consistent session_id
      await supabase.from('agent_conversations').insert({
        session_id: sessionId,
        role: 'assistant',
        content: text,
        actions: toolResults.length > 0 ? JSON.stringify(toolResults) : null,
      });

      // Send done (include thinking text and final answer for frontend display)
      writeSse(processStep(runId, 'done', `Complete (${iterations} iterations)`, 'done'));
      writeSse(sseData({
        ada_event: 'done',
        run_id: runId,
        iterations,
        thinking: thinkingText || undefined,
        text: text || undefined, // Final answer — frontend uses this when streaming was suppressed
      }));
      writeSse(sseDone());
      res.end();

    } else {
      // ── Non-streaming (batch) Response ──────────────────────
      const { text, toolResults, iterations } = await runToolLoop({
        runId, systemPrompt, userMessage, messages,
        writeSse: () => {}, isStreamMode: false,
      });

      // Store response with consistent session_id
      await supabase.from('agent_conversations').insert({
        session_id: sessionId,
        role: 'assistant',
        content: text,
        actions: toolResults.length > 0 ? JSON.stringify(toolResults) : null,
      });

      return res.status(200).json({
        reply: text,
        tool_results: toolResults,
        iterations,
        run_id: runId,
      });
    }
  } catch (err) {
    logError(runId || 'unknown', 'ERROR', err.message);
    if (!res.headersSent) {
      return sanitizeError(res, err, 'ai-chat');
    }
    try {
      res.write(sseData({ ada_event: 'error', message: err.message }));
      res.write(sseDone());
      res.end();
    } catch { /* ignore */ }
  }
}
