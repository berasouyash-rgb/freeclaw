// ─── V3 Streaming Endpoint ───────────────────────────────────────
// Enterprise-grade SSE streaming with authentication, tool calls, audit,
// RAG context retrieval, multi-agent orchestration, and long-term memory.
import { cors, isAdmin } from '../_auth.js';
import { sanitizeError } from '../_error.js';
import { callLLMChain } from '../_providers.js';
import {
  createSSEWriter,
  startHeartbeat,
  streamLLMResponse,
  detectToolCall,
  streamToolEvent,
  getConversationHistory,
  storeConversation,
  logStreamingEvent,
  validateStreamRequest,
} from '../_streaming.js';
import supabase from '../_db-client.js';
import { getToolsForRole, executeTool as registryExecuteTool, buildToolSystemPrompt } from '../_tool-registry.js';
import { routeTask } from '../_orchestrator.js';
import { retrieveContext, buildRAGPrompt } from '../_rag.js';
import { storeMemory, buildMemoryContext } from '../_memory.js';
import { detectPromptInjection } from '../_security.js';

// ─── Constants ────────────────────────────────────────────────────
const MAX_TOOL_ITERATIONS = 3;
const DEFAULT_AGENT_ID = 'v3-stream';

// ─── Tool Execution via Registry ─────────────────────────────────
// Uses the centralized tool registry instead of inline tool definitions.
async function executeToolLoop(toolName, toolInput, role) {
  const outcome = await registryExecuteTool(toolName, toolInput, { role });
  if (outcome.error) return { tool: toolName, error: outcome.error };
  const { latency_ms, _cached, _truncated, _original_size, ...result } = outcome;
  return { tool: toolName, result };
}

// ─── Main Handler ────────────────────────────────────────────────
export default async function handler(req, res) {
  cors(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();

  // Only POST allowed
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let writer = null;
  let stopHeartbeat = null;

  try {
    const body = req.body || {};

    // Validate request
    const validationErrors = validateStreamRequest(body);
    if (validationErrors.length > 0) {
      return res.status(400).json({ error: 'Validation failed', details: validationErrors });
    }

    const { messages, session_id = 'default', stream = true, is_admin = false, page_context = null } = body;
    const sessionId = session_id.slice(0, 60);

    // Check authentication for admin tools
    const adminMode = is_admin && isAdmin(req);
    const role = adminMode ? 'admin' : 'student';

    // Initialize SSE writer if streaming
    if (stream) {
      writer = createSSEWriter(res);
      stopHeartbeat = startHeartbeat(res, 15000);

      // Send initial connection event
      const toolsForRole = getToolsForRole(role);
      writer.write('connected', {
        session_id: sessionId,
        admin_mode: adminMode,
        tools_available: toolsForRole.length,
      });
    }

    // Get conversation history for context
    const history = await getConversationHistory(sessionId, 10);

    // Get the last user message
    const lastUserMessage = messages[messages.length - 1]?.content || '';
    if (!lastUserMessage) {
      if (writer) return writer.error('Empty message');
      return res.status(400).json({ error: 'Empty message' });
    }

    // Security: Detect prompt injection attempts (log but don't block)
    const injectionCheck = detectPromptInjection(lastUserMessage);
    if (!injectionCheck.safe) {
      console.warn(`[V3-STREAM] Prompt injection detected: ${injectionCheck.reason}`);
      await logStreamingEvent(sessionId, 'security_injection_detected', {
        message: lastUserMessage.slice(0, 200),
        reason: injectionCheck.reason,
        confidence: injectionCheck.confidence,
      });
    }

    // ── Orchestrator: Route task to best agent ────────────────────
    const agent = routeTask(lastUserMessage);
    const routedAgent = agent?.id || 'general';
    await logStreamingEvent(sessionId, 'agent_routed', {
      agent: routedAgent,
      message: lastUserMessage.slice(0, 100),
      pageContext: page_context?.page || null,
    });
    // Emit agent_routed SSE event so frontend can display routing info
    if (writer) {
      writer.writeData({ type: 'agent_routed', agent: routedAgent, confidence: agent?.confidence || 0.8 });
    }

    // ── RAG: Retrieve relevant knowledge base context ─────────────
    let ragContext = '';
    try {
      const kbResults = await retrieveContext(lastUserMessage);
      if (kbResults && kbResults.length > 0) {
        ragContext = buildRAGPrompt(lastUserMessage, kbResults);
        await logStreamingEvent(sessionId, 'rag_context', {
          results: kbResults.length,
          query: lastUserMessage.slice(0, 100),
        });
      }
    } catch (ragErr) {
      console.warn('[V3-STREAM] RAG retrieval failed:', ragErr.message);
    }

    // ── Memory: Retrieve relevant memories ────────────────────────
    let memoryContext = '';
    try {
      memoryContext = await buildMemoryContext(DEFAULT_AGENT_ID, { maxTokens: 1000 });
    } catch (memErr) {
      console.warn('[V3-STREAM] Memory retrieval failed:', memErr.message);
    }

    // ── Build system prompt with registry tools + agent persona ───
    const agentPrompt = agent?.systemPrompt || '';
    const basePrompt = buildToolSystemPrompt(role, agentPrompt);
    const systemPrompt = [
      basePrompt,
      ragContext ? `\n\n## RELEVANT KNOWLEDGE BASE\n${ragContext}` : '',
      memoryContext ? `\n\n## CONVERSATION MEMORY\n${memoryContext}` : '',
      adminMode ? '\n\nYou have ADMIN privileges and can access student data, create tickets, and send notifications.' : '',
      // Page context passthrough — tells the AI what page the admin is viewing
      page_context ? `\n\n## CURRENT ADMIN PAGE\nThe admin is currently viewing: ${page_context.page || 'unknown'}\n${page_context.filters ? `Active filters: ${JSON.stringify(page_context.filters)}` : ''}\n${page_context.selectedItems ? `Selected items: ${page_context.selectedItems.length} item(s)` : ''}\nUse this context to provide relevant suggestions and anticipate the admin's needs.` : '',
      '\nAfter receiving tool results, provide a helpful response to the user.',
      '\nBe helpful, concise, and professional. If you don\'t know the answer, say so honestly.',
    ].join('');

    // Store user message
    await storeConversation(sessionId, 'user', lastUserMessage);
    await logStreamingEvent(sessionId, 'user_message', { length: lastUserMessage.length });

    // Build messages for LLM
    const llmMessages = [
      { role: 'system', content: systemPrompt },
      ...history.map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: lastUserMessage },
    ];

    // Streaming mode
    if (stream && writer) {
      // Run tool loop with streaming
      let finalText = '';
      let iterations = 0;

      while (iterations < MAX_TOOL_ITERATIONS) {
        iterations++;

        // Stream LLM response
        const result = await streamLLMResponse(llmMessages, writer, {
          onToken: (token) => {
            // Token already emitted by streamLLMResponse
          },
        });

        if (!result.ok) {
          await logStreamingEvent(sessionId, 'llm_error', { error: result.error });
          writer.error(`LLM failed: ${result.error}`);
          break;
        }

        finalText = result.fullText;

        // Check for tool call
        const toolCall = detectToolCall(finalText);
        if (toolCall) {
          // Execute tool via registry
          streamToolEvent(writer, 'executing', { tool: toolCall.tool, status: 'executing' });
          await logStreamingEvent(sessionId, 'tool_call', toolCall);

          const toolResult = await executeToolLoop(toolCall.tool, toolCall.input, role);
          streamToolEvent(writer, 'result', { ...toolResult, status: 'result' });

          // After successful tool execution, force LLM to summarize
          if (toolResult.status === 'success') {
            llmMessages.push({ role: 'assistant', content: finalText });
            llmMessages.push({
              role: 'user',
              content: `The tool "${toolCall.tool}" executed successfully. Here is the result:\n${JSON.stringify(toolResult.outputs, null, 2)}\n\nIMPORTANT: Respond to the user with a natural language summary of what was done. Do NOT output more tool calls. Do NOT output JSON. Just describe what happened in plain English.`,
            });
            // Run one more LLM call to get the summary
            const summaryResult = await streamLLMResponse(llmMessages, writer, { onToken: () => {} });
            if (summaryResult.ok) finalText = summaryResult.fullText;
            break;
          }

          // Tool failed — add result to context and loop again
          llmMessages.push({ role: 'assistant', content: finalText });
          llmMessages.push({ role: 'user', content: `Tool result: ${JSON.stringify(toolResult)}\n\nPlease provide a helpful response based on this information.` });

          continue;
        }

        // No tool call — we have the final answer
        break;
      }

      // Store final response
      await storeConversation(sessionId, 'assistant', finalText);
      await logStreamingEvent(sessionId, 'response_complete', {
        length: finalText.length,
        iterations,
        agent: routedAgent,
      });

      // ── Memory: Store conversation context ──────────────────────
      try {
        await storeMemory(DEFAULT_AGENT_ID, 'conversation_context', {
          session_id: sessionId,
          user_message: lastUserMessage.slice(0, 500),
          ai_response: finalText.slice(0, 500),
          agent: routedAgent,
          tools_used: iterations > 1 ? 'tool_loop' : 'direct',
        }, { source: 'v3-stream' });
      } catch (memErr) {
        console.warn('[V3-STREAM] Memory storage failed:', memErr.message);
      }

      // Send done event
      writer.writeData({
        type: 'done',
        run_id: `stream-${Date.now()}`,
        iterations,
        agent: routedAgent,
        text: finalText,
      });
      writer.close();

    } else {
      // Non-streaming mode
      const result = await callLLMChain(systemPrompt, lastUserMessage, [
        ...history.map(h => ({ role: h.role, content: h.content })),
      ]);

      const responseText = result?.text || 'I could not generate a response.';

      // Check for tool call
      const toolCall = detectToolCall(responseText);
      if (toolCall) {
        const toolResult = await executeToolLoop(toolCall.tool, toolCall.input, role);
        // Re-run with tool result
        const followUp = await callLLMChain(
          systemPrompt,
          `Tool result: ${JSON.stringify(toolResult)}\n\nPlease provide a helpful response.`,
          [...llmMessages, { role: 'assistant', content: responseText }]
        );
        const finalText = followUp?.text || responseText;
        await storeConversation(sessionId, 'assistant', finalText);

        // Store memory
        try {
          await storeMemory(DEFAULT_AGENT_ID, 'conversation_context', {
            session_id: sessionId,
            user_message: lastUserMessage.slice(0, 500),
            ai_response: finalText.slice(0, 500),
            agent: routedAgent,
            tools_used: toolCall.tool,
          }, { source: 'v3-stream' });
        } catch { /* ignore */ }

        return res.status(200).json({
          reply: finalText,
          tool_used: toolCall.tool,
          tool_result: toolResult,
          agent: routedAgent,
          iterations: 2,
        });
      }

      await storeConversation(sessionId, 'assistant', responseText);

      // Store memory
      try {
        await storeMemory(DEFAULT_AGENT_ID, 'conversation_context', {
          session_id: sessionId,
          user_message: lastUserMessage.slice(0, 500),
          ai_response: responseText.slice(0, 500),
          agent: routedAgent,
        }, { source: 'v3-stream' });
      } catch { /* ignore */ }

      return res.status(200).json({
        reply: responseText,
        agent: routedAgent,
        iterations: 1,
      });
    }

  } catch (err) {
    console.error('[V3-STREAM] Error:', err.message);
    if (writer) {
      writer.error(err.message);
    } else if (!res.headersSent) {
      sanitizeError(res, err, 'v3-stream');
    }
  } finally {
    if (stopHeartbeat) stopHeartbeat();
  }
}
