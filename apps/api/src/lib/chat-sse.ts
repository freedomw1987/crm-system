/**
 * Server-Sent Events (SSE) helpers for the AI chat endpoint.
 *
 * Pinned by:
 *   - RG-002 (Day 10): `AiNotConfiguredError` must surface as a
 *     503 (not a 500) with a helpful message. The error event shape
 *     here is what the frontend uses to render the friendly UI.
 *   - RG-003: the `done` event's `usage` field (prompt /
 *     completion / total tokens) is required for cost monitoring.
 *   - RG-005 (Day 10.1): the streaming response must carry
 *     `Cache-Control: no-cache, no-transform` and
 *     `X-Accel-Buffering: no` so nginx (and any reverse proxy
 *     between the client and Bun) doesn't buffer the chunks.
 *   - RG-CHAT-002 (Day 17, US-C5): the `confirmation_required`
 *     event carries a stable `id` (per-run nonce) so the frontend
 *     can correlate `respondToConfirmation` back to the right
 *     pending tool call.
 *
 * Why a lib file: chat.ts was a 218-line route file with the
 * SSE frame formatter + header map inline. Extracting them
 * gives tests a single import to assert against (without spinning
 * up an SSE ReadableStream).
 */

import type { StreamEvent } from '@crm/ai';

/**
 * Stable event-type constants. Pin the wire format so a
 * refactor in `packages/ai/src/index.ts` doesn't silently rename
 * an event type and break the frontend.
 */
export const CHAT_SSE_EVENT_TYPES = {
  TOKEN: 'token',
  TOOL_START: 'tool_start',
  TOOL_END: 'tool_end',
  CONFIRMATION_REQUIRED: 'confirmation_required',
  DONE: 'done',
  ERROR: 'error',
} as const;

export type ChatSseEventType = typeof CHAT_SSE_EVENT_TYPES[keyof typeof CHAT_SSE_EVENT_TYPES];

/**
 * Wrap a `StreamEvent` in a Server-Sent Events frame.
 *
 * Format per the SSE spec: each event is `data: <json>\n\n`. The
 * frontend reads chunks, splits on `\n\n`, and parses each frame's
 * `data:` line as JSON.
 *
 * This is a re-export of the inline `sseFrame` in chat.ts so tests
 * can assert the wire format directly. The route still uses the
 * same function via the import below.
 */
export function buildSseFrame(event: StreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * Headers required for a streaming response to actually stream.
 *
 * Pinned by RG-005:
 *   - `Content-Type: text/event-stream; charset=utf-8` (per SSE spec;
 *     the `charset=utf-8` is required by some browsers, optional
 *     per the spec)
 *   - `Cache-Control: no-cache, no-transform` — disables HTTP
 *     cache + the proxy-specific "transform" flag (Cloudflare /
 *     nginx default-on)
 *   - `X-Accel-Buffering: no` — nginx-specific directive that
 *     disables response buffering in nginx (the standard
 *     `proxy_buffering off;` only works at the server level; the
 *     response header is the per-route override)
 *   - `Connection: keep-alive` — keep the connection open for
 *     long-running LLM streams
 */
export function buildChatHeaders(): Headers {
  return new Headers({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
    'Connection': 'keep-alive',
  });
}

/**
 * The response that `/chat/send` returns. Pinned by RG-002/003 so
 * the pre-check error (no `AiConfig` row → 503) is consistent
 * with the stream-time error (e.g. invalid LLM API key → SSE
 * `error` event).
 */
export interface ChatSendPrecheckError {
  status: 503;
  body: {
    error: 'AI Assistant is not configured';
    message: string;
  };
}

/**
 * Result returned by `safeEnqueue`. Callers should check `ok` and
 * bail out of the stream loop if `false` — the controller is gone
 * (client disconnect, runtime teardown, etc.) and any further
 * `enqueue` / `close` calls would throw `Invalid state: Controller
 * is already closed`.
 */
export interface SafeEnqueueResult {
  ok: boolean;
  /** True when the underlying controller has been torn down. */
  closed: boolean;
}

/**
 * Wraps a ReadableStreamDefaultController so the route can survive
 * mid-stream client disconnects without throwing
 * `TypeError: Invalid state: Controller is already closed`.
 *
 * Bun's runtime auto-closes the controller when the response stream
 * is torn down (client tab close, network drop, AbortController
 * cancel). The agent loop's `for await` may still be yielding
 * events after that point; calling `controller.enqueue(...)` on a
 * closed controller throws. This wrapper tracks the closed state
 * via the `closed` flag and returns a non-throwing result so the
 * route handler can break out cleanly.
 *
 * Why not just try/catch around `enqueue`: the catch block in the
 * route would also try to `enqueue` (to surface the error), which
 * would throw again and propagate up — the runtime logs it as an
 * unhandled error in the stream. The wrapper short-circuits all
 * downstream calls so the `finally { close() }` is also safe.
 */
export function makeSafeStreamController(controller: ReadableStreamDefaultController<Uint8Array>): {
  enqueue: (chunk: Uint8Array) => SafeEnqueueResult;
  close: () => void;
  isClosed: () => boolean;
} {
  let closed = false;
  return {
    enqueue(chunk: Uint8Array): SafeEnqueueResult {
      if (closed) return { ok: false, closed: true };
      try {
        controller.enqueue(chunk);
        return { ok: true, closed: false };
      } catch {
        // Most likely "Invalid state: Controller is already closed".
        // Mark closed so subsequent calls short-circuit; the stream
        // is gone, nothing useful can be written to it.
        closed = true;
        return { ok: false, closed: true };
      }
    },
    close(): void {
      if (closed) return;
      closed = true;
      try {
        controller.close();
      } catch {
        // Double-close guard. The runtime may have already torn down
        // the controller between our `enqueue` and `close`.
      }
    },
    isClosed: () => closed,
  };
}

export function buildChatPrecheckError(): ChatSendPrecheckError {
  return {
    status: 503,
    body: {
      error: 'AI Assistant is not configured',
      message:
        'Ask an admin to set up the AI Assistant at /admin/ai-config.',
    },
  };
}

/**
 * Assert a string is a known event type. Throws if not. Used by
 * tests that want to compare event.type against the canonical
 * set without depending on the exact string from a snapshot.
 */
export function isChatSseEventType(t: string): t is ChatSseEventType {
  return (Object.values(CHAT_SSE_EVENT_TYPES) as string[]).includes(t);
}
