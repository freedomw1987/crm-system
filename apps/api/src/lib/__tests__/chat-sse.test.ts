/**
 * Regression tests for `chat-sse.ts` (Day 30, t3).
 *
 * Pinned invariants:
 *
 *   RG-002 (Day 10): `AiNotConfiguredError` from `runAgent()` must
 *     surface as a friendly 503 (not 500) with a clear message.
 *     The precheck 503 response shape is locked in
 *     `buildChatPrecheckError`.
 *
 *   RG-003: the `done` event's `usage` field (prompt / completion /
 *     total tokens) is part of the contract — used for cost
 *     monitoring. We pin the event-type set includes 'done'.
 *
 *   RG-005 (Day 10.1): the streaming response must carry
 *     `Content-Type: text/event-stream; charset=utf-8`,
 *     `Cache-Control: no-cache, no-transform`, and
 *     `X-Accel-Buffering: no` so nginx doesn't buffer the chunks.
 *     Pinned by `buildChatHeaders` returning these.
 *
 *   RG-CHAT-002 (Day 17, US-C5): when a tool flagged
 *     `requiresConfirmation: true` is about to execute, the agent
 *     loop yields a `confirmation_required` SSE event. The
 *     `CHAT_SSE_EVENT_TYPES.CONFIRMATION_REQUIRED === 'confirmation_required'`
 *     pins the wire string so a refactor in
 *     `packages/ai/src/index.ts:42` doesn't silently rename the
 *     event type and break the frontend's `if (event.type === '...')`
 *     branches.
 */

import { describe, expect, it } from 'bun:test';
import {
  buildChatHeaders,
  buildChatPrecheckError,
  buildSseFrame,
  CHAT_SSE_EVENT_TYPES,
  isChatSseEventType,
} from '../chat-sse';

// ============================================================================
// CHAT_SSE_EVENT_TYPES — the canonical event-type string set (RG-002/003/CHAT-002)
// ============================================================================

describe('CHAT_SSE_EVENT_TYPES (RG-002/003/CHAT-002)', () => {
  it('contains exactly the 6 documented event types', () => {
    expect(new Set(Object.values(CHAT_SSE_EVENT_TYPES))).toEqual(
      new Set(['token', 'tool_start', 'tool_end', 'confirmation_required', 'done', 'error']),
    );
  });

  it('CONFIRMATION_REQUIRED is the literal "confirmation_required" (RG-CHAT-002)', () => {
    // The frontend has `if (event.type === 'confirmation_required')` branches
    // that depend on this exact string. A rename here without a
    // coordinated frontend refactor silently breaks the
    // human-in-the-loop flow.
    expect(CHAT_SSE_EVENT_TYPES.CONFIRMATION_REQUIRED).toBe('confirmation_required');
  });

  it('ERROR is "error" (the early-exit failure path)', () => {
    expect(CHAT_SSE_EVENT_TYPES.ERROR).toBe('error');
  });
});

// ============================================================================
// isChatSseEventType — type guard helper
// ============================================================================

describe('isChatSseEventType', () => {
  it('returns true for every canonical event type', () => {
    for (const t of Object.values(CHAT_SSE_EVENT_TYPES)) {
      expect(isChatSseEventType(t)).toBe(true);
    }
  });

  it('returns false for unknown event types', () => {
    expect(isChatSseEventType('foo')).toBe(false);
    expect(isChatSseEventType('tool_done')).toBe(false);
    expect(isChatSseEventType('Confirmation_Required')).toBe(false); // case-sensitive
  });

  it('rejects empty string', () => {
    expect(isChatSseEventType('')).toBe(false);
  });
});

// ============================================================================
// buildSseFrame — the data: <json>\\n\\n format
// ============================================================================

describe('buildSseFrame (RG-005)', () => {
  it('wraps a token event in `data: <json>\\n\\n`', () => {
    const frame = buildSseFrame({ type: 'token', delta: 'hello' });
    expect(frame).toBe('data: {"type":"token","delta":"hello"}\n\n');
  });

  it('wraps a tool_start event correctly', () => {
    const frame = buildSseFrame({ type: 'tool_start', name: 'get_company', args: { id: 'c1' } });
    expect(frame.startsWith('data: ')).toBe(true);
    expect(frame.endsWith('\n\n')).toBe(true);
    const body = JSON.parse(frame.slice('data: '.length, -2));
    expect(body).toEqual({ type: 'tool_start', name: 'get_company', args: { id: 'c1' } });
  });

  it('preserves all fields on a complex event (confirmation_required)', () => {
    // The frontend uses every field here. Test the round-trip.
    const event = {
      type: 'confirmation_required' as const,
      id: 'cfm_abc123',
      toolName: 'draftQuotation',
      args: { companyId: 'c1', items: [{ name: 'X', quantity: 1, unitPrice: 100 }] },
      sideEffectSummary: 'Will create a new draft quotation',
    };
    const frame = buildSseFrame(event);
    const body = JSON.parse(frame.slice('data: '.length, -2));
    expect(body).toEqual(event);
  });

  it('always ends with double newline (SSE frame terminator)', () => {
    // Pinning this prevents a future refactor that accidentally
    // uses single \n which would break the frontend's
    // `event.data.split("\n\n")` parser.
    const events = [
      { type: 'token' as const, delta: 'a' },
      { type: 'done' as const, conversationId: 'c1', usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 } },
      { type: 'error' as const, message: 'oops' },
    ];
    for (const e of events) {
      expect(buildSseFrame(e).endsWith('\n\n')).toBe(true);
    }
  });
});

// ============================================================================
// buildChatHeaders — RG-005 streaming response headers
// ============================================================================

describe('buildChatHeaders (RG-005)', () => {
  it('sets Content-Type: text/event-stream; charset=utf-8', () => {
    const h = buildChatHeaders();
    expect(h.get('Content-Type')).toBe('text/event-stream; charset=utf-8');
  });

  it('sets Cache-Control: no-cache, no-transform (disables HTTP cache)', () => {
    // nginx + Cloudflare will buffer responses with default
    // cache headers. We need explicit no-cache.
    const h = buildChatHeaders();
    expect(h.get('Cache-Control')).toBe('no-cache, no-transform');
  });

  it('sets X-Accel-Buffering: no (nginx-specific)', () => {
    // Pinning this so a future nginx refactor that re-enables
    // proxy_buffering has a regression test that surfaces.
    const h = buildChatHeaders();
    expect(h.get('X-Accel-Buffering')).toBe('no');
  });

  it('sets Connection: keep-alive for long streams', () => {
    const h = buildChatHeaders();
    expect(h.get('Connection')).toBe('keep-alive');
  });

  it('returns a Headers instance (not a plain object)', () => {
    // The route uses `new Response(stream, { headers: buildChatHeaders() })`.
    // The fetch / Response constructor accepts both `Headers` instances
    // and plain objects, but using `Headers` makes the headers
    // case-insensitive lookup (`.get('content-type')` works) — which
    // is what nginx needs when the response is forwarded.
    const h = buildChatHeaders();
    expect(h).toBeInstanceOf(Headers);
  });

  it('returns a fresh Headers on each call (no shared mutation)', () => {
    // Defensive: the lib should not reuse a singleton Headers,
    // because callers may want to set additional headers (e.g. a
    // request-id) without clobbering each other.
    const h1 = buildChatHeaders();
    const h2 = buildChatHeaders();
    expect(h1).not.toBe(h2);
    h1.set('X-Custom', 'a');
    expect(h2.get('X-Custom')).toBeNull();
  });
});

// ============================================================================
// buildChatPrecheckError — RG-002 503 response shape
// ============================================================================

describe('buildChatPrecheckError (RG-002)', () => {
  it('returns status 503', () => {
    const e = buildChatPrecheckError();
    expect(e.status).toBe(503);
  });

  it('body has the canonical "error" string', () => {
    const e = buildChatPrecheckError();
    expect(e.body.error).toBe('AI Assistant is not configured');
  });

  it('body message directs the user to /admin/ai-config', () => {
    const e = buildChatPrecheckError();
    expect(e.body.message).toContain('/admin/ai-config');
  });

  it('returns a fresh object on each call (callers may inspect / log)', () => {
    const e1 = buildChatPrecheckError();
    const e2 = buildChatPrecheckError();
    expect(e1).not.toBe(e2);
    expect(e1.body).not.toBe(e2.body);
  });
});
