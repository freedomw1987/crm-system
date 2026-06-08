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
import {
  runAgentStream,
  AiNotConfiguredError,
  createConfirmationController,
  type StreamEvent,
} from '@crm/ai';
import { authContext } from '../lib/context';
import { requirePermission, getUserIdFromRequest } from '../middleware/rbac';

// =============================================================================
// US-C5 (Day 17, 2026-06-08): pending confirmation registry
// =============================================================================
//
// The /chat/send handler creates a fresh ConfirmationController for each
// run and stores it in this map. The `POST /chat/confirm/:id` endpoint
// looks it up and resolves the pending promise. We key by confirmation
// id (a per-run nonce) rather than by user id because a single user
// could have multiple in-flight confirmations across tabs.
//
// Cleanup: when a /chat/send stream ends, the controller is removed
// from the map (in a `finally` block) so we don't leak. Timeouts on
// the controller side also remove themselves.
const pendingConfirmations = new Map<
  string,
  { controller: ReturnType<typeof createConfirmationController>; userId: string }
>();

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
    // US-C5: build a per-run confirmation controller and register
    // it BEFORE we start the agent. The /chat/confirm/:id endpoint
    // resolves promises on this controller. The map key is the
    // confirmation id (set by the agent loop when it yields a
    // `confirmation_required` event), so the frontend posts back to
    // the same id it just received.
    const confirmationCtl = createConfirmationController();
    // Forward registrations: when the agent loop calls
    // `awaitResponse(id)`, we look it up; we don't pre-register
    // anything here. The map's value is `{controller, userId}` so
    // /chat/confirm/:id can verify the caller's identity matches.
    // We wrap `awaitResponse` so every call also stores the entry
    // in the map for the duration of the wait.
    const wrappedController = {
      awaitResponse: async (id: string, toolName: string) => {
        pendingConfirmations.set(id, { controller: confirmationCtl, userId });
        try {
          return await confirmationCtl.awaitResponse(id, toolName);
        } finally {
          pendingConfirmations.delete(id);
        }
      },
      respond: confirmationCtl.respond,
    };

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of runAgentStream({
            userId,
            message,
            conversationId,
            confirmationController: wrappedController,
          })) {
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

  // US-C5: frontend posts the user's decision back here. Idempotent
  // — if no pending confirmation matches, returns 404. Verifies
  // the caller's userId matches the one that opened the chat
  // session, so a confirmation can't be hijacked by another user
  // (e.g. by guessing the nonce).
  .post('/confirm/:id', async ({ params, request, body, set }) => {
    const userId = await getUserIdFromRequest(request);
    if (!userId) { set.status = 401; return { error: 'Unauthorized' }; }
    const { approved, reason } = body as { approved: boolean; reason?: string };
    if (typeof approved !== 'boolean') {
      set.status = 400;
      return { error: '`approved` must be a boolean' };
    }
    const entry = pendingConfirmations.get(params.id);
    if (!entry) {
      set.status = 404;
      return { error: 'No pending confirmation with that id (may have timed out or already been answered)' };
    }
    if (entry.userId !== userId) {
      set.status = 403;
      return { error: 'Confirmation does not belong to this user' };
    }
    const ok = entry.controller.respond(params.id, approved, reason);
    if (!ok) {
      set.status = 409;
      return { error: 'Confirmation already resolved' };
    }
    return { ok: true };
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
