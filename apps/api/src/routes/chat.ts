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
  AiAbortError,
  createConfirmationController,
} from '@crm/ai';
import { authContext } from '../lib/context';
import { requirePermission, getUserIdFromRequest } from '../middleware/rbac';
import {
  buildSseFrame,
  buildChatHeaders,
  buildChatPrecheckError,
  CHAT_SSE_EVENT_TYPES,
  makeSafeStreamController,
} from '../lib/chat-sse';
import { tApi } from '../lib/i18n';

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
 * Implemented in `lib/chat-sse.ts` so tests can assert the wire
 * format directly without spinning up a ReadableStream.
 */
const sseFrame = buildSseFrame;

export const chatRoutes = new Elysia({ prefix: '/chat', tags: ['ai-chat'] })
  .use(authContext)
  .use(requirePermission('chat:use'))
  .get('/conversations', async ({ request, set, locale }) => {
    const userId = await getUserIdFromRequest(request);
    if (!userId) { set.status = 401; return { error: tApi(locale, 'UNAUTHORIZED') }; }
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

  .get('/conversations/:id', async ({ params, request, set, locale }) => {
    const userId = await getUserIdFromRequest(request);
    if (!userId) { set.status = 401; return { error: tApi(locale, 'UNAUTHORIZED') }; }
    const conv = await prisma.conversation.findUnique({
      where: { id: params.id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!conv || conv.userId !== userId) {
      set.status = 404;
      return { error: tApi(locale, 'NOT_FOUND') };
    }
    return conv;
  })

  .post('/send', async ({ request, body, set, locale }) => {
    const userId = await getUserIdFromRequest(request);
    if (!userId) { set.status = 401; return { error: tApi(locale, 'UNAUTHORIZED') }; }
    const { message, conversationId } = body as { message: string; conversationId?: string };
    if (!message || typeof message !== 'string') {
      set.status = 400;
      return { error: tApi(locale, 'CHAT_MESSAGE_REQUIRED') };
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
      // RG-002 + RG-003: surface 503 with a friendly message, not 500.
      // Body shape comes from `lib/chat-sse.ts` so the contract is in
      // one place (and testable directly).
      const precheck = buildChatPrecheckError();
      set.status = precheck.status;
      return precheck.body;
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
        // Wrap the controller so we survive mid-stream client disconnects.
        // When the client closes the tab / network drops / AbortController
        // fires, Bun's runtime auto-closes the underlying controller.
        // Calling `controller.enqueue(...)` after that throws
        // `TypeError: Invalid state: Controller is already closed`, which
        // would propagate as an unhandled error and abort the stream.
        // The wrapper tracks closed-state and short-circuits subsequent
        // calls so the agent loop can break out cleanly without crashing.
        const safe = makeSafeStreamController(controller);
        try {
          for await (const event of runAgentStream({
            userId,
            message,
            conversationId,
            confirmationController: wrappedController,
            // Pass the request's abort signal so the agent loop can bail
            // out between tool iterations when the client disconnects,
            // rather than continuing to spend LLM tokens on a stream
            // no one is listening to.
            signal: request.signal,
          })) {
            const r = safe.enqueue(encoder.encode(sseFrame(event)));
            if (!r.ok) {
              // Client gone — break out of the loop and stop yielding.
              break;
            }
          }
        } catch (err) {
          // AbortError: client disconnected (request.signal fired) or
          // the safe-enqueue short-circuited. There is no one to send
          // an error event to — just close silently. This branch is
          // the expected exit path when the user closes their tab
          // mid-stream.
          if (err instanceof AiAbortError) {
            // intentionally empty — silent close
          } else if (safe.isClosed()) {
            // Stream already torn down; nothing to do.
          } else if (err instanceof AiNotConfiguredError) {
            safe.enqueue(encoder.encode(sseFrame({
              type: CHAT_SSE_EVENT_TYPES.ERROR,
              message: err.message,
            })));
          } else {
            console.error('[chat] Agent error:', err);
            safe.enqueue(encoder.encode(sseFrame({
              type: CHAT_SSE_EVENT_TYPES.ERROR,
              message: (err as Error).message,
            })));
          }
        } finally {
          safe.close();
        }
      },
    });

    return new Response(stream, {
      // RG-005: SSE-streaming headers consolidated in
      // `lib/chat-sse.ts` so the wire format is testable in one place.
      headers: buildChatHeaders(),
    });
  })

  // US-C5: frontend posts the user's decision back here. Idempotent
  // — if no pending confirmation matches, returns 404. Verifies
  // the caller's userId matches the one that opened the chat
  // session, so a confirmation can't be hijacked by another user
  // (e.g. by guessing the nonce).
  .post('/confirm/:id', async ({ params, request, body, set, locale }) => {
    const userId = await getUserIdFromRequest(request);
    if (!userId) { set.status = 401; return { error: tApi(locale, 'UNAUTHORIZED') }; }
    const { approved, reason } = body as { approved: boolean; reason?: string };
    if (typeof approved !== 'boolean') {
      set.status = 400;
      return { error: tApi(locale, 'CHAT_APPROVED_BOOLEAN') };
    }
    const entry = pendingConfirmations.get(params.id);
    if (!entry) {
      set.status = 404;
      return { error: tApi(locale, 'CHAT_NO_PENDING_CONFIRMATION') };
    }
    if (entry.userId !== userId) {
      set.status = 403;
      return { error: tApi(locale, 'CHAT_CONFIRMATION_NOT_OWNER') };
    }
    const ok = entry.controller.respond(params.id, approved, reason);
    if (!ok) {
      set.status = 409;
      return { error: tApi(locale, 'CHAT_CONFIRMATION_RESOLVED') };
    }
    return { ok: true };
  })

  .delete('/conversations/:id', async ({ params, request, set, locale }) => {
    const userId = await getUserIdFromRequest(request);
    if (!userId) { set.status = 401; return { error: tApi(locale, 'UNAUTHORIZED') }; }
    const conv = await prisma.conversation.findUnique({ where: { id: params.id } });
    if (!conv || conv.userId !== userId) {
      set.status = 404;
      return { error: tApi(locale, 'NOT_FOUND') };
    }
    await prisma.conversation.delete({ where: { id: params.id } });
    return { success: true };
  });
