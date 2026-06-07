import { Elysia } from 'elysia';
import { prisma } from '@crm/db';
import { runAgentStream, AiNotConfiguredError, type StreamEvent } from '@crm/ai';
import { jwtVerify } from 'jose';

const SECRET = process.env.JWT_SECRET ?? 'dev-only-secret-please-change';
const secretKey = new TextEncoder().encode(SECRET);

async function verifyToken(authHeader: string | null): Promise<string | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  try {
    const { payload } = await jwtVerify(token, secretKey);
    if (!payload || typeof payload !== 'object') return null;
    const sub = (payload as Record<string, unknown>).sub;
    return typeof sub === 'string' ? sub : null;
  } catch {
    return null;
  }
}

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
  .get('/conversations', async ({ request, set }) => {
    const userId = await verifyToken(request.headers.get('authorization'));
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
    const userId = await verifyToken(request.headers.get('authorization'));
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
    const userId = await verifyToken(request.headers.get('authorization'));
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
    const userId = await verifyToken(request.headers.get('authorization'));
    if (!userId) { set.status = 401; return { error: 'Unauthorized' }; }
    const conv = await prisma.conversation.findUnique({ where: { id: params.id } });
    if (!conv || conv.userId !== userId) {
      set.status = 404;
      return { error: 'Not found' };
    }
    await prisma.conversation.delete({ where: { id: params.id } });
    return { success: true };
  });
