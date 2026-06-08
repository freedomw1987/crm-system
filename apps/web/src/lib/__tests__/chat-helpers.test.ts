/**
 * Regression tests for RG-CHAT-001 (2026-06-08).
 *
 * Bug: when the AI agent invoked a tool, the persisted
 * ConversationMessage row (role: 'assistant', toolName: 'foo',
 * content: '') was rendered as a fully styled but completely
 * empty assistant bubble in the chat UI. The user saw a row of
 * grey box with nothing in it between their question and the
 * agent's actual reply.
 *
 * Fix: the backend now writes the marker row with a 🔧-prefixed
 * sentinel content (`🔧 {toolName}`). The frontend detects this
 * with `isToolMarker()` and renders the row as an inline
 * metadata pill instead of a bubble.
 *
 * These tests pin down the contract on both sides:
 *   - empty legacy rows from before the fix → still detected
 *   - sentinel rows from after the fix → detected
 *   - normal assistant messages with content → NOT detected
 *   - user messages, even with toolName, → NOT detected
 */
import { describe, it, expect } from 'vitest';
import { isToolMarker } from '../chat-helpers';
import type { ChatMessage } from '../api';

function mk(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'm1',
    role: 'assistant',
    content: '',
    createdAt: '2026-06-08T00:00:00Z',
    ...overrides,
  } as ChatMessage;
}

describe('isToolMarker (RG-CHAT-001)', () => {
  it('returns true for the new sentinel content "🔧 foo"', () => {
    expect(isToolMarker(mk({ toolName: 'foo', content: '🔧 foo' }))).toBe(true);
  });

  it('returns true for the new sentinel content "🔧 foo (failed)" (future-proofing)', () => {
    expect(isToolMarker(mk({ toolName: 'foo', content: '🔧 foo (failed)' }))).toBe(true);
  });

  it('returns true for legacy rows with empty content + toolName (pre-fix DB rows)', () => {
    // Pre-2026-06-08 backend wrote `content: ''`. Existing
    // conversations in PG should still render correctly after the
    // deploy, so this case MUST be detected.
    expect(isToolMarker(mk({ toolName: 'foo', content: '' }))).toBe(true);
  });

  it('returns false for a normal assistant reply with prose', () => {
    expect(
      isToolMarker(mk({ toolName: null, content: 'Here are the top 5 customers...' })),
    ).toBe(false);
  });

  it('returns false for an assistant message with toolName but real text (defensive)', () => {
    // Defensive: a future bug where the backend writes both
    // toolName AND real content (e.g. the model commented on a
    // tool result). We want the prose to win — render as a bubble.
    expect(
      isToolMarker(mk({ toolName: 'foo', content: 'I found 3 matches' })),
    ).toBe(false);
  });

  it('returns false for a user message even if toolName is somehow set', () => {
    expect(isToolMarker(mk({ role: 'user', toolName: 'foo', content: '🔧 foo' }))).toBe(
      false,
    );
  });

  it('returns false for a tool-result message (role: tool)', () => {
    // role: 'tool' rows are already handled separately — they
    // should never match the marker predicate.
    expect(isToolMarker(mk({ role: 'tool', toolName: 'foo', content: '{"ok":true}' }))).toBe(
      false,
    );
  });
});
