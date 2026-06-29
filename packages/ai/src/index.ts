/**
 * AI Agent core — lightweight function-calling loop with streaming.
 *
 * Stack: OpenAI Chat Completions (streaming function calling) + tool
 * registry + Postgres memory. Zero-dependency (only `openai` SDK), no
 * LangGraph/Mastra — fully under our control.
 *
 * Streaming: `runAgentStream` is an async generator that yields
 * `StreamEvent` objects as the agent works. The HTTP route wraps this
 * in a Server-Sent Events response so the frontend can render tokens
 * and tool calls incrementally.
 */

import OpenAI from 'openai';
import { createHash } from 'node:crypto';
import { prisma } from '@crm/db';
import { Prisma } from '@crm/db';
import { toolRegistry, WRITE_TOOLS, type ToolContext } from './tools';
import { SYSTEM_PROMPT } from './prompts';
import { getAiConfig } from './config';

export interface AgentRunInput {
  userId: string;
  conversationId?: string;
  message: string;
  /**
   * US-C5: optional confirmation controller. If the run is for a
   * synchronous user session (e.g. a real chat through `/chat/send`),
   * the caller passes a controller so confirmation-required tool
   * calls can pause and ask the user. If absent (e.g. background
   * re-summarisation, eval harness), confirmation-required tools
   * are auto-denied with a synthetic result so the run still
   * completes.
   */
  confirmationController?: ConfirmationController;
}

/**
 * Events emitted by `runAgentStream` over the course of one agent run.
 * The frontend renders these incrementally as they arrive.
 */
export type StreamEvent =
  | { type: 'token'; delta: string }
  | { type: 'tool_start'; name: string; args: unknown }
  | { type: 'tool_end'; name: string; result: unknown; error?: string }
  // US-C5 (Day 17, 2026-06-08): when a tool flagged
  // `requiresConfirmation: true` is about to execute, the agent
  // pauses and yields a `confirmation_required` event. The
  // frontend shows a Radix Dialog with the proposed args, and the
  // user replies by calling `respondToConfirmation(id, approved,
  // reason?)` on the controller returned by `/chat/send`.
  //
  // The `id` is a per-run unique nonce so the frontend can
  // correlate the response back even if multiple tool calls are
  // queued (we don't currently queue more than one at a time, but
  // the design accommodates it).
  | {
      type: 'confirmation_required';
      id: string;
      toolName: string;
      args: unknown;
      sideEffectSummary?: string;
    }
  | { type: 'done'; conversationId: string; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }
  | { type: 'error'; message: string };

/**
 * Controller returned by `/chat/send` (alongside the SSE response)
 * to let the HTTP layer post user responses back to the in-flight
 * agent run. Each pending confirmation registers a resolver with
 * a unique id; the response from the frontend resolves that
 * promise and the agent loop continues.
 *
 * The controller is transport-agnostic — `/chat/send` could plumb
 * it through a WebSocket, a second HTTP request, or a queue. For
 * now we expose it via a small admin endpoint, but the agent
 * loop doesn't care.
 */
export interface ConfirmationController {
  /**
   * Register a pending confirmation and return a promise that
   * resolves when the user responds (or rejects on timeout /
   * disconnect).
   */
  awaitResponse: (
    id: string,
    toolName: string,
  ) => Promise<{ approved: boolean; reason?: string }>;
  /**
   * Submit a user response to a pending confirmation. Idempotent —
   * if no pending confirmation matches the id, the call is a no-op.
   */
  respond: (id: string, approved: boolean, reason?: string) => boolean;
}

/**
 * Errors thrown from runAgent() that the chat route should translate to
 * specific HTTP status codes (so the frontend can show a meaningful
 * message instead of a generic 500).
 */
export class AiNotConfiguredError extends Error {
  constructor() {
    super('AI Assistant is not configured. Please ask an admin to set it up at /admin/ai-config.');
  }
}

/**
 * Streaming agent run. Yields events as the LLM produces tokens and as
 * tool calls start and finish. The conversation row + user message are
 * created up front; the final assistant reply is persisted when the
 * stream ends.
 */
export async function* runAgentStream(input: AgentRunInput): AsyncGenerator<StreamEvent> {
  // 0. Load LLM config from DB (no env-var fallback, by design)
  const aiConfig = await getAiConfig();
  if (!aiConfig) throw new AiNotConfiguredError();

  const client = new OpenAI({
    apiKey: aiConfig.apiKey,
    baseURL: aiConfig.endpointUrl,
  });
  const MODEL = aiConfig.modelName;
  const MAX_TOOL_ITERATIONS = 6;
  // Per-conversation system prompt override (admin can tune it in the UI)
  const systemPrompt = aiConfig.systemPrompt?.trim() || SYSTEM_PROMPT;

  // 1. Get or create conversation
  let conversationId = input.conversationId;
  if (!conversationId) {
    const conv = await prisma.conversation.create({
      data: { userId: input.userId, title: input.message.slice(0, 60) },
    });
    conversationId = conv.id;
  } else {
    // Verify ownership
    const conv = await prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conv || conv.userId !== input.userId) {
      throw new Error('Conversation not found or not owned by user');
    }
  }

  // 2. Save user message
  await prisma.conversationMessage.create({
    data: { conversationId, role: 'user', content: input.message },
  });

  // 3. Load history (last 20 messages)
  const history = await prisma.conversationMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    take: 20,
  });

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...history.map((m) => {
      if (m.role === 'tool') {
        return {
          role: 'tool' as const,
          content: typeof m.toolResult === 'string' ? m.toolResult : JSON.stringify(m.toolResult ?? {}),
          tool_call_id: m.toolName ?? 'unknown',
        };
      }
      if (m.role === 'assistant' && m.toolName) {
        // Tool call message. The marker rows we persist have a
        // 🔧-prefixed sentinel `content` so the frontend can hide
        // them as metadata. OpenAI's chat-completions API requires
        // `content: null` for an assistant message that only carries
        // `tool_calls`, so we coerce both empty and sentinel values
        // to null here.
        return {
          role: 'assistant' as const,
          content: null,
          tool_calls: [
            {
              id: m.toolName,
              type: 'function' as const,
              function: {
                name: m.toolName,
                arguments: JSON.stringify(m.toolArgs ?? {}),
              },
            },
          ],
        };
      }
      return { role: m.role as 'user' | 'assistant', content: m.content };
    }),
  ];

  // 4. Streaming function-calling loop
  const tools = toolRegistry.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));

  let totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let finalReply = '';
  const ctx: ToolContext = { userId: input.userId };

  outer: for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    // OpenAI's `stream: true` for chat.completions returns an async
    // iterable of chunks. We accumulate the assistant message as we go
    // and yield each content delta so the frontend can render it
    // token-by-token.
    const stream = await client.chat.completions.create({
      model: MODEL,
      messages,
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: tools.length > 0 ? 'auto' : undefined,
      stream: true,
      // stream_options is required by some providers (e.g. OpenAI) to
      // get usage in the final chunk. We set it if the SDK type allows;
      // providers that don't support it ignore the option.
      stream_options: { include_usage: true },
    } as Parameters<typeof client.chat.completions.create>[0]);

    // Accumulated assistant message we're building from chunks
    // (cast through unknown because OpenAI's ChatCompletionMessage
    // type in some SDK versions expects a `refusal` field we don't
    // need for our accumulator).
    const assistantMsg = {
      role: 'assistant' as const,
      content: null as string | null,
      tool_calls: [] as Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>,
    };
    const toolCallAccumulators = new Map<
      number,
      { id: string; name: string; args: string }
    >();
    let streamUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    for await (const chunk of stream as AsyncIterable<OpenAI.Chat.ChatCompletionChunk>) {
      // Usage chunks (last chunk when stream_options.include_usage = true)
      if ((chunk as { usage?: OpenAI.CompletionUsage }).usage) {
        const u = (chunk as { usage: OpenAI.CompletionUsage }).usage;
        streamUsage = {
          promptTokens: u.prompt_tokens ?? 0,
          completionTokens: u.completion_tokens ?? 0,
          totalTokens: u.total_tokens ?? 0,
        };
        totalUsage = {
          promptTokens: totalUsage.promptTokens + streamUsage.promptTokens,
          completionTokens: totalUsage.completionTokens + streamUsage.completionTokens,
          totalTokens: totalUsage.totalTokens + streamUsage.totalTokens,
        };
      }
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;

      // Text token — yield to the stream
      if (delta.content) {
        if (!assistantMsg.content) assistantMsg.content = '';
        assistantMsg.content += delta.content;
        yield { type: 'token', delta: delta.content };
      }

      // Tool call deltas — accumulate then yield tool_start when complete
      if (delta.tool_calls) {
        for (const tcDelta of delta.tool_calls) {
          const idx = tcDelta.index;
          let acc = toolCallAccumulators.get(idx);
          if (!acc) {
            acc = { id: '', name: '', args: '' };
            toolCallAccumulators.set(idx, acc);
          }
          if (tcDelta.id) acc.id = tcDelta.id;
          if (tcDelta.function?.name) acc.name += tcDelta.function.name;
          if (tcDelta.function?.arguments) acc.args += tcDelta.function.arguments;
        }
      }
    }

    // Build the final tool_calls array from accumulators
    const finalToolCalls = Array.from(toolCallAccumulators.entries())
      .sort(([a], [b]) => a - b)
      .map(([, acc]) => {
        let parsedArgs: unknown = {};
        try {
          parsedArgs = JSON.parse(acc.args);
        } catch {
          parsedArgs = {};
        }
        return {
          id: acc.id,
          type: 'function' as const,
          function: { name: acc.name, arguments: acc.args },
          _parsedArgs: parsedArgs,
        };
      });

    if (finalToolCalls.length === 0) {
      // No tool calls — we have the final reply in assistantMsg.content
      finalReply = assistantMsg.content ?? '';
      // Push the assistant message into history (with content)
      messages.push({
        role: 'assistant' as const,
        content: finalReply || null,
      });
      break outer;
    }

    // We have tool calls. Push the assistant message with tool_calls into history.
    // Cast through `unknown` to keep the local object literal concise;
    // OpenAI's ChatCompletionMessageParam type requires a `refusal` field
    // on its output-side ChatCompletionMessage sibling which we don't need
    // when reconstructing the request.
    messages.push({
      role: 'assistant',
      content: assistantMsg.content || null,
      tool_calls: finalToolCalls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.function.name, arguments: tc.function.arguments },
      })),
    } as OpenAI.Chat.ChatCompletionMessageParam);

    // Execute each tool call, yielding tool_start / tool_end
    for (const tc of finalToolCalls) {
      const toolName = tc.function.name;
      const parsedArgs = tc._parsedArgs;

      yield { type: 'tool_start', name: toolName, args: parsedArgs };

      const tool = toolRegistry.find((t) => t.name === toolName);
      let result: unknown;
      let toolError: string | undefined;
      // US-C5 (Day 17, 2026-06-08): confirmation-required tools
      // pause before executing and yield a `confirmation_required`
      // event. The frontend collects user input and resolves back
      // via the ConfirmationController. If no controller is
      // supplied (background / eval runs), we auto-deny with a
      // synthetic result — the LLM can then gracefully explain the
      // refusal to the user.
      //
      // Day-30 (RG-CHAT-002 follow-up): the gate is now sourced from
      // the exported `WRITE_TOOLS` set rather than the per-tool
      // `requiresConfirmation` flag. The two are kept in sync by
      // construction (WRITE_TOOLS is derived from the flag) so the
      // behaviour is identical, but a single grep against
      // `WRITE_TOOLS` now answers "which tools require human
      // confirmation?" without walking every tool definition.
      //
      // Both `tool` and `WRITE_TOOLS` must agree — if the tool is in
      // WRITE_TOOLS but missing from the registry (or vice versa),
      // skip the confirmation flow and let the execute-time error
      // surface (which is more debuggable than a silent
      // confirmation_required event for a phantom tool).
      let confirmedHash: string | null = null;
      if (tool && WRITE_TOOLS.has(toolName)) {
        const confirmationId = `cfm_${Date.now().toString(36)}_${Math.random()
          .toString(36)
          .slice(2, 8)}`;
        yield {
          type: 'confirmation_required',
          id: confirmationId,
          toolName,
          args: parsedArgs,
          sideEffectSummary: tool.sideEffectSummary,
        };

        let userResponse: { approved: boolean; reason?: string };
        if (input.confirmationController) {
          try {
            userResponse = await input.confirmationController.awaitResponse(
              confirmationId,
              toolName,
            );
          } catch (err) {
            // Disconnect / timeout: auto-deny so the run completes.
            userResponse = { approved: false, reason: 'controller error' };
          }
        } else {
          userResponse = { approved: false, reason: 'no controller (background run)' };
        }

        if (!userResponse.approved) {
          result = {
            error: 'denied by user',
            denied: true,
            reason: userResponse.reason ?? 'user clicked Cancel',
          };
          toolError = 'denied';
          // Audit log: AI_TOOL_DENIED
          confirmedHash = hashArgs(parsedArgs);
          await writeAiToolAudit({
            userId: input.userId,
            toolName,
            hash: confirmedHash,
            approved: false,
            reason: userResponse.reason,
          }).catch((e) => console.error('[ai] audit log failed:', e));
          yield { type: 'tool_end', name: toolName, result, error: toolError };
          // Persist the synthetic denial result and feed back to
          // the LLM so it can explain to the user.
          await persistToolPair({
            conversationId,
            toolName,
            parsedArgs,
            result,
            hash: confirmedHash,
          });
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify(result),
          });
          continue;
        }
        // Approved — fall through to normal execute path below.
        // Hash and audit BEFORE running so we can correlate the
        // audit row with the tool_call row in the conversation
        // (the hash is persisted on both).
        confirmedHash = hashArgs(parsedArgs);
        await writeAiToolAudit({
          userId: input.userId,
          toolName,
          hash: confirmedHash,
          approved: true,
        }).catch((e) => console.error('[ai] audit log failed:', e));
      }
      if (!tool) {
        const msg = `Unknown tool: ${toolName}`;
        toolError = msg;
        result = { error: msg };
      } else {
        try {
          result = await tool.execute(parsedArgs, ctx);
        } catch (err) {
          toolError = (err as Error).message;
          result = { error: toolError };
        }
      }

      yield { type: 'tool_end', name: toolName, result, error: toolError };

      // Persist tool call + tool result as separate messages.
      // The first row (role: 'assistant' + toolName) is the LLM's
      // "I invoked this tool" marker. The second (role: 'tool') is
      // the actual result. We tag the marker's `content` with a
      // 🔧-prefixed sentinel string so the frontend can distinguish
      // it from a real reply (which would have prose). See
      // apps/web/src/pages/ai-chat.tsx `isToolMarker` helper — the
      // two pieces of code share an implicit contract.
      // US-C5: if this was a confirmation-required tool, we also
      // store the confirmation hash so the conversation row can
      // be joined to the audit log row at replay / debugging time.
      await persistToolPair({
        conversationId,
        toolName,
        parsedArgs,
        result,
        hash: confirmedHash,
      });

      // Feed result back to the LLM on the next iteration
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(result),
      });
    }
  }

  // 5. Save final assistant reply
  if (finalReply) {
    await prisma.conversationMessage.create({
      data: {
        conversationId,
        role: 'assistant',
        content: finalReply,
        promptTokens: totalUsage.promptTokens,
        completionTokens: totalUsage.completionTokens,
      },
    });
  }

  // Touch conversation updatedAt
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
  });

  yield { type: 'done', conversationId, usage: totalUsage };
}

// Re-exports
export { toolRegistry } from './tools';
export { SYSTEM_PROMPT } from './prompts';
export { getAiConfig, invalidateAiConfigCache } from './config';
export { encryptSecret, decryptSecret, maskApiKey } from './encryption';
export type { Tool, ToolContext } from './tools';

// =============================================================================
// US-C5 (Day 17, 2026-06-08) helpers
// =============================================================================

/**
 * Stable, short hash of a tool's proposed args. Used to correlate
 * a `ConversationMessage` row with the matching `AI_TOOL_CONFIRMED`
 * / `AI_TOOL_DENIED` audit log entry without storing PII in the
 * audit log itself.
 *
 * Format: 16-char hex of SHA-256(JSON.stringify(args)).
 */
export function hashArgs(args: unknown): string {
  const json = JSON.stringify(args ?? null, Object.keys(args as object || {}).sort());
  return createHash('sha256').update(json).digest('hex').slice(0, 16);
}

/**
 * Persist the (assistant tool-call marker, tool result) pair that
 * the chat UI uses to render the inline tool pill. US-C5 also
 * stores the confirmation hash on both rows for audit
 * traceability.
 */
async function persistToolPair({
  conversationId,
  toolName,
  parsedArgs,
  result,
  hash,
}: {
  conversationId: string;
  toolName: string;
  parsedArgs: unknown;
  result: unknown;
  hash: string | null;
}): Promise<void> {
  await prisma.conversationMessage.create({
    data: {
      conversationId,
      role: 'assistant',
      content: `🔧 ${toolName}`,
      toolName,
      toolArgs: parsedArgs as Prisma.InputJsonValue,
      ...(hash ? { aiToolConfirmationHash: hash } : {}),
    },
  });
  await prisma.conversationMessage.create({
    data: {
      conversationId,
      role: 'tool',
      content: typeof result === 'string' ? result : JSON.stringify(result),
      toolName,
      toolResult: result as Prisma.InputJsonValue,
      ...(hash ? { aiToolConfirmationHash: hash } : {}),
    },
  });
}

/**
 * Write a single row to the audit log capturing the user's
 * decision on a confirmation-required tool call. We use the
 * `description` field to carry the tool name + a short marker
 * (`#<hash>`) that the user can grep against the conversation
 * row's `aiToolConfirmationHash` column.
 *
 * Audit log row shape is the same as any other CRM action
 * (actorId, action, entityType, entityId, description, metadata).
 * We deliberately do NOT put the full proposed args in `metadata`
 * to keep the audit log PII-light — the conversation row holds
 * the args, the audit row holds the hash + decision.
 */
async function writeAiToolAudit({
  userId,
  toolName,
  hash,
  approved,
  reason,
}: {
  userId: string;
  toolName: string;
  hash: string;
  approved: boolean;
  reason?: string;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorId: userId,
      action: approved ? 'AI_TOOL_CONFIRMED' : 'AI_TOOL_DENIED',
      resourceType: 'AiTool',
      resourceId: toolName,
      description: `${approved ? 'CONFIRMED' : 'DENIED'} ${toolName} #${hash}${reason ? ` (${reason})` : ''}`,
      metadata: { toolName, confirmationHash: hash } as Prisma.InputJsonValue,
    },
  });
}

/**
 * Build an in-memory confirmation controller. Each call returns a
 * fresh controller scoped to one agent run — resolvers are kept on
 * the closure so responses from the HTTP route can find them.
 *
 * The 5-minute timeout matches typical human reaction time for a
 * confirm dialog; if the user walks away, we auto-deny rather than
 * holding the connection open indefinitely.
 */
export function createConfirmationController(timeoutMs = 5 * 60 * 1000): ConfirmationController {
  const pending = new Map<string, (r: { approved: boolean; reason?: string }) => void>();
  return {
    awaitResponse(id, _toolName) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            reject(new Error(`confirmation ${id} timed out after ${timeoutMs}ms`));
          }
        }, timeoutMs);
        pending.set(id, (r) => {
          clearTimeout(timer);
          resolve(r);
        });
      });
    },
    respond(id, approved, reason) {
      const resolver = pending.get(id);
      if (!resolver) return false;
      pending.delete(id);
      resolver({ approved, reason });
      return true;
    },
  };
}
