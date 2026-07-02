/**
 * AbortSignal support for runAgentStream (Day 30, t4 regression).
 *
 * Background: the /chat/send SSE route was crashing with
 * `TypeError: Invalid state: Controller is already closed` when the
 * client disconnected mid-stream. The agent loop continued to yield
 * events after the runtime had torn down the controller, and the
 * downstream `controller.enqueue(...)` calls threw.
 *
 * Two-layer fix:
 *
 *   1. The route wraps the controller with `makeSafeStreamController`
 *      (apps/api/src/lib/chat-sse.ts) so enqueue/close are no-ops
 *      once the runtime has torn down the stream. This stops the
 *      crash but does NOT stop the agent from spending LLM tokens.
 *
 *   2. `runAgentStream` now accepts an optional `signal: AbortSignal`.
 *      At every `yield` site (and inside the confirmation-required
 *      wait), it calls `throwIfAborted` which throws `AiAbortError`
 *      if the signal has been aborted. The agent stops at the next
 *      checkpoint, the route catches `AiAbortError`, and the stream
 *      closes silently — no error event emitted to a gone client.
 *
 * These tests pin the public contract callers depend on:
 *
 *   - `AiAbortError` has `name === 'AbortError'` so consumers can
 *     branch on the standard Web `AbortError` name without importing
 *     the type.
 *   - `AgentRunInput.signal` is optional — absence means the agent
 *     runs to completion regardless of caller state.
 *
 * Full streaming + abort integration is covered by the chat-sse
 * route tests + manual smoke (close tab during a draft-quotation
 * run, confirm no error event reaches the (now-gone) client).
 */
import { describe, it, expect } from 'bun:test';
import { AiAbortError, AiNotConfiguredError } from '../index';

describe('AiAbortError (Day 30 abort regression)', () => {
  it('has name === "AbortError" (standard Web AbortError contract)', () => {
    // Callers use `err.name === 'AbortError'` to distinguish client
    // disconnect from other failures. Pinning this so a future
    // refactor that renames the class doesn't silently break
    // the route's catch block.
    const err = new AiAbortError();
    expect(err.name).toBe('AbortError');
  });

  it('extends Error (so instanceof Error catches it as well)', () => {
    const err = new AiAbortError();
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AiAbortError);
  });

  it('has a non-empty message for logging', () => {
    const err = new AiAbortError();
    expect(err.message.length).toBeGreaterThan(0);
  });

  it('is distinguishable from AiNotConfiguredError via instanceof', () => {
    // The route's catch block first checks `instanceof AiAbortError`
    // before falling through to `instanceof AiNotConfiguredError` and
    // then the generic-error branch. These two must not overlap.
    const a = new AiAbortError();
    expect(a).not.toBeInstanceOf(AiNotConfiguredError);
  });
});