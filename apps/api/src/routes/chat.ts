import { Elysia } from 'elysia';
import { prisma } from '@crm/db';
import { runAgent } from '@crm/ai';
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
    if (!process.env.OPENAI_API_KEY) {
      set.status = 503;
      return { error: 'AI Agent not configured (OPENAI_API_KEY missing)' };
    }
    try {
      const result = await runAgent({ userId, message, conversationId });
      return result;
    } catch (err) {
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
