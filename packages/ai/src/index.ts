/**
 * AI Agent core — lightweight function-calling loop
 *
 * Stack: OpenAI Chat Completions (function calling) + tool registry + Postgres memory
 * Zero-dependency (only `openai` SDK), no LangGraph/Mastra — fully under our control.
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

export interface AgentRunResult {
  conversationId: string;
  reply: string;
  toolCalls: Array<{ name: string; args: unknown; result: unknown }>;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
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

export async function runAgent(input: AgentRunInput): Promise<AgentRunResult> {
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
        // Tool call message
        return {
          role: 'assistant' as const,
          content: m.content || null,
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

  // 4. Function-calling loop
  const toolCallRecords: AgentRunResult['toolCalls'] = [];
  let totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let finalReply = '';
  const ctx: ToolContext = { userId: input.userId };

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    const tools = toolRegistry.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const resp = await client.chat.completions.create({
      model: MODEL,
      messages,
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: tools.length > 0 ? 'auto' : undefined,
    });

    const choice = resp.choices[0];
    if (!choice) break;
    totalUsage = {
      promptTokens: totalUsage.promptTokens + (resp.usage?.prompt_tokens ?? 0),
      completionTokens: totalUsage.completionTokens + (resp.usage?.completion_tokens ?? 0),
      totalTokens: totalUsage.totalTokens + (resp.usage?.total_tokens ?? 0),
    };

    const msg = choice.message;
    messages.push(msg);

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      finalReply = msg.content ?? '';
      break;
    }

    // Execute each tool call
    for (const tc of msg.tool_calls) {
      const toolName = tc.function.name;
      const rawArgs = tc.function.arguments;
      let parsedArgs: unknown = {};
      try {
        parsedArgs = JSON.parse(rawArgs);
      } catch {
        parsedArgs = {};
      }
      const tool = toolRegistry.find((t) => t.name === toolName);

      let result: unknown;
      let toolError: string | null = null;
      if (!tool) {
        toolError = `Unknown tool: ${toolName}`;
        result = { error: toolError };
      } else {
        try {
          result = await tool.execute(parsedArgs, ctx);
        } catch (err) {
          toolError = (err as Error).message;
          result = { error: toolError };
        }
      }

      toolCallRecords.push({ name: toolName, args: parsedArgs, result });

      // Save assistant tool call + tool result to history
      await prisma.conversationMessage.create({
        data: {
          conversationId,
          role: 'assistant',
          content: '',
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

      // Add tool result to messages
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

  return {
    conversationId,
    reply: finalReply,
    toolCalls: toolCallRecords,
    usage: totalUsage,
  };
}

// Re-exports
export { toolRegistry } from './tools';
export { SYSTEM_PROMPT } from './prompts';
export { getAiConfig, invalidateAiConfigCache } from './config';
export { encryptSecret, decryptSecret, maskApiKey } from './encryption';
export type { Tool, ToolContext } from './tools';
