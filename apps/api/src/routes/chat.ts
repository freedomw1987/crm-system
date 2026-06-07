// P0-3 (2026-06-07 review): chat routes were anonymous-reachable. Now
// gated with .use(authContext) + .use(requirePermission('chat:use')).
//
// The route still re-extracts userId from the request via
// `getUserIdFromRequest` for downstream use (the AI agent loop keys
// audit + conversation ownership on userId). The requirePermission
// guard runs *before* the handler, so the token has already been
// verified upstream — re-verification here is a no-op on the hot path.

import { Elysia } from 'elysia';
import { prisma } from '@crm/db';
import { runAgentStream, AiNotConfiguredError, type StreamEvent } from '@crm/ai';
import { authContext } from '../lib/context';
import { requirePermission, getUserIdFromRequest } from '../middleware/rbac';

/**
 * Wrap a `StreamEvent` in a Server-Sent Events (SSE) frame.
 *
 * Format per the SSE spec: each event is `data: <json>\n\n`. The
 * frontend reads chunks, splits on `\n\n`, and parses each frame's
 * `data:` line as JSON.
 */
function sseFrame(event: StreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export const chatRoutes = new Elysia({ prefix: '/chat', tags: ['ai-chat'] })
  .use(authContext)
  .use(requirePermission('chat:use'))
  .get('/conversations', async ({ request, set }) => {
    const userId = await getUserIdFromRequest(request);
    if (!userId) { set.status = 401; return { error: 'Unauthorized' }; }
    return prisma.conversation.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        title: true,
        updatedAt: true,
        createdAt: true,
        _count: { select: { messages: true } },
      },
    });
  })

  .get('/conversations/:id', async ({ params, request, set }) => {
    const userId = await getUserIdFromRequest(request);
    if (!userId) { set.status = 401; return { error: 'Unauthorized' }; }
    const conv = await prisma.conversation.findUnique({
      where: { id: params.id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!conv || conv.userId !== userId) {
      set.status = 404;
      return { error: 'Not found' };
    }
    return conv;
  })

  .post('/send', async ({ request, body, set }) => {
    const userId = await getUserIdFromRequest(request);
    if (!userId) { set.status = 401; return { error: 'Unauthorized' }; }
    const { message, conversationId } = body as { message: string; conversationId?: string };
    if (!message || typeof message !== 'string') {
      set.status = 400;
      return { error: 'Message is required' };
    }
    // Pre-check AiConfig to short-circuit with a friendly 503 (instead of
    // letting runAgent() throw AiNotConfiguredError and us translate to
    // 500). The DB check here is cheap (one row by PK) and matches the
    // schema design (no env-var fallback — see prisma/schema.prisma
    // AiConfig @id(1) comment).
    const aiConfig = await prisma.aiConfig.findUnique({
      where: { id: 1 },
      select: { id: true },
    });
    if (!aiConfig) {
      set.status = 503;
      return {
        error: 'AI Assistant is not configured',
        message: 'Ask an admin to set up the AI Assistant at /admin/ai-config.',
      };
    }

    // Build an SSE response. We construct the ReadableStream here
    // instead of returning a plain JSON object so the connection
    // stays open and the frontend can read tokens as they're emitted.
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of runAgentStream({ userId, message, conversationId })) {
            controller.enqueue(encoder.encode(sseFrame(event)));
          }
        } catch (err) {
          if (err instanceof AiNotConfiguredError) {
            controller.enqueue(encoder.encode(sseFrame({ type: 'error', message: err.message })));
          } else {
            console.error('[chat] Agent error:', err);
            controller.enqueue(encoder.encode(sseFrame({
              type: 'error',
              message: (err as Error).message,
            })));
          }
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        // Disable nginx response buffering so chunks flow to the
        // browser immediately (see RG-005 + nginx sse fix in
        // docker-compose / nginx.conf).
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
        'Connection': 'keep-alive',
      },
    });
  })

  .delete('/conversations/:id', async ({ params, request, set }) => {
    const userId = await getUserIdFromRequest(request);
    if (!userId) { set.status = 401; return { error: 'Unauthorized' }; }
    const conv = await prisma.conversation.findUnique({ where: { id: params.id } });
    if (!conv || conv.userId !== userId) {
      set.status = 404;
      return { error: 'Not found' };
    }
    await prisma.conversation.delete({ where: { id: params.id } });
    return { success: true };
  });
