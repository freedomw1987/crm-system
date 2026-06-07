import { Elysia } from 'elysia';
import { prisma } from '@crm/db';
import { runAgent, AiNotConfiguredError } from '@crm/ai';
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
    // AiConfig @id(1) comment). We still catch AiNotConfiguredError
    // below as a defence in case the row is deleted between this check
    // and the runAgent() call (race window on a singleton).
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
    try {
      const result = await runAgent({ userId, message, conversationId });
      return result;
    } catch (err) {
      if (err instanceof AiNotConfiguredError) {
        set.status = 503;
        return { error: 'AI Assistant is not configured', message: err.message };
      }
      console.error('[chat] Agent error:', err);
      set.status = 500;
      return { error: 'Agent failed', message: (err as Error).message };
    }
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
