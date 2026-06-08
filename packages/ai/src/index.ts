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
import { prisma } from '@crm/db';
import { toolRegistry, type ToolContext } from './tools';
import { SYSTEM_PROMPT } from './prompts';
import { getAiConfig } from './config';

export interface AgentRunInput {
  userId: string;
  conversationId?: string;
  message: string;
}

/**
 * Events emitted by `runAgentStream` over the course of one agent run.
 * The frontend renders these incrementally as they arrive.
 */
export type StreamEvent =
  | { type: 'token'; delta: string }
  | { type: 'tool_start'; name: string; args: unknown }
  | { type: 'tool_end'; name: string; result: unknown; error?: string }
  | { type: 'done'; conversationId: string; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }
  | { type: 'error'; message: string };

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
      await prisma.conversationMessage.create({
        data: {
          conversationId,
          role: 'assistant',
          content: `🔧 ${toolName}`,
          toolName,
          toolArgs: parsedArgs as never,
        },
      });
      await prisma.conversationMessage.create({
        data: {
          conversationId,
          role: 'tool',
          content: typeof result === 'string' ? result : JSON.stringify(result),
          toolName,
          toolResult: result as never,
        },
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
