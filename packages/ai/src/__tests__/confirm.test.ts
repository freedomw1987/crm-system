/**
 * US-C5 regression tests — AI tool confirmation guardrail (2026-06-08).
 *
 * Background: PRD US-C5 mandates that the 3 write tools
 * (draftQuotation, updateDealStage, logActivity) must NEVER execute
 * without explicit human confirmation. The guardrail is implemented
 * via:
 *   - `requiresConfirmation: true` flag on the tool definition
 *   - `createConfirmationController()` returning a transport-agnostic
 *     await/respond pair
 *   - `runAgentStream` checking the flag, yielding a
 *     `confirmation_required` SSE event, and waiting for the user's
 *     response
 *   - `hashArgs()` producing a stable 16-char hash for audit logging
 *     (so the audit row can be correlated with the tool_call row in
 *     the conversation)
 *
 * These tests pin down the controller + hash behaviour. The full
 * `runAgentStream` flow (with the OpenAI SDK + Prisma + DB) is
 * covered separately by integration tests in the API route — those
 * need a live DB and SSE consumer, so they're outside the scope of
 * this unit suite.
 */
import { describe, it, expect } from 'bun:test';
import {
  createConfirmationController,
  hashArgs,
  type ConfirmationController,
} from '../index';

describe('hashArgs (US-C5 / RG-CHAT-002)', () => {
  it('returns a 16-char hex string', () => {
    const h = hashArgs({ foo: 'bar' });
    expect(h).toHaveLength(16);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is stable for the same input across calls', () => {
    const a = hashArgs({ a: 1, b: 2 });
    const b = hashArgs({ a: 1, b: 2 });
    expect(a).toBe(b);
  });

  it('is order-independent for object keys (audit-log correlation invariant)', () => {
    // The route uses this hash to correlate the AI_TOOL_CONFIRMED
    // audit row with the ConversationMessage row. If the hash
    // changed with key order, two requests that conceptually have
    // the same args would not be correlatable. The implementation
    // sorts keys before stringify; this test pins that.
    const h1 = hashArgs({ a: 1, b: 2, c: 3 });
    const h2 = hashArgs({ c: 3, a: 1, b: 2 });
    expect(h1).toBe(h2);
  });

  it('produces different hashes for different inputs', () => {
    expect(hashArgs({ a: 1 })).not.toBe(hashArgs({ a: 2 }));
    expect(hashArgs({ a: 1 })).not.toBe(hashArgs({ a: '1' }));
  });

  it('handles null / undefined gracefully (returns a 16-char hex)', () => {
    // Defensive: the route calls hashArgs(parsedArgs) where
    // parsedArgs can theoretically be undefined for a malformed
    // tool call. Must not throw.
    expect(hashArgs(null)).toMatch(/^[0-9a-f]{16}$/);
    expect(hashArgs(undefined)).toMatch(/^[0-9a-f]{16}$/);
  });

  it('handles arrays (key order is irrelevant for arrays, but values matter)', () => {
    expect(hashArgs([1, 2, 3])).toBe(hashArgs([1, 2, 3]));
    expect(hashArgs([1, 2, 3])).not.toBe(hashArgs([3, 2, 1]));
  });

  it('handles nested objects with mixed key order', () => {
    const a = hashArgs({ outer: { x: 1, y: 2 }, meta: { name: 'foo', version: 1 } });
    const b = hashArgs({ meta: { version: 1, name: 'foo' }, outer: { y: 2, x: 1 } });
    expect(a).toBe(b);
  });
});

describe('createConfirmationController (US-C5 / RG-CHAT-002)', () => {
  it('awaits respond() and resolves with the user response', async () => {
    const ctl: ConfirmationController = createConfirmationController(5_000);
    const promise = ctl.awaitResponse('cfm_1', 'draftQuotation');
    // Respond before the await has a chance to throw.
    expect(ctl.respond('cfm_1', true)).toBe(true);
    const r = await promise;
    expect(r.approved).toBe(true);
  });

  it('passes the user reason through to the resolved value', async () => {
    const ctl = createConfirmationController(5_000);
    const promise = ctl.awaitResponse('cfm_2', 'logActivity');
    ctl.respond('cfm_2', false, 'user cancelled the dialog');
    const r = await promise;
    expect(r.approved).toBe(false);
    expect(r.reason).toBe('user cancelled the dialog');
  });

  it('respond() is a no-op for an unknown id (idempotent)', () => {
    const ctl = createConfirmationController(5_000);
    // No pending confirmation for this id; respond returns false
    // (per the contract: "if no pending confirmation matches the
    // id, the call is a no-op").
    expect(ctl.respond('cfm_never_registered', true)).toBe(false);
  });

  it('reject on timeout — the awaiter promise rejects, freeing the loop', async () => {
    // 50ms timeout so the test is fast.
    const ctl = createConfirmationController(50);
    const promise = ctl.awaitResponse('cfm_timeout', 'draftQuotation');
    let caught: Error | null = null;
    try {
      await promise;
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught!.message).toMatch(/timed out/);
    // After timeout, respond() with the same id is a no-op.
    expect(ctl.respond('cfm_timeout', true)).toBe(false);
  });

  it('supports multiple concurrent pending confirmations', async () => {
    const ctl = createConfirmationController(5_000);
    const p1 = ctl.awaitResponse('cfm_a', 'draftQuotation');
    const p2 = ctl.awaitResponse('cfm_b', 'updateDealStage');
    // Respond out of order: B first, then A.
    expect(ctl.respond('cfm_b', true)).toBe(true);
    expect(ctl.respond('cfm_a', false, 'changed my mind')).toBe(true);
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.approved).toBe(false);
    expect(r1.reason).toBe('changed my mind');
    expect(r2.approved).toBe(true);
  });

  it('clears the timer when respond() arrives before timeout (no late rejection)', async () => {
    const ctl = createConfirmationController(100);
    const promise = ctl.awaitResponse('cfm_fast', 'logActivity');
    setTimeout(() => ctl.respond('cfm_fast', true), 5);
    const r = await promise;
    expect(r.approved).toBe(true);
    // Wait past the 100ms timeout to make sure the timer was
    // cleared and we don't get a late rejection.
    await new Promise((res) => setTimeout(res, 150));
  });
});
