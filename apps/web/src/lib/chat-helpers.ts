/**
 * Pure helpers extracted from the AI chat UI for testability.
 *
 * Why: `isToolMarker` lives inside `ai-chat.tsx` and is a key
 * correctness signal — if it returns `false` for a backend-persisted
 * "I called this tool" row, the user sees an empty assistant
 * bubble (the bug this file was extracted to prevent). Keeping it
 * in a dedicated module lets us test it without spinning up the
 * whole React tree.
 */
import type { ChatMessage } from './api';

/**
 * A persisted message is a "tool marker" if it represents the
 * agent's "I'm about to invoke this tool" record rather than a
 * real reply. The backend (`packages/ai/src/index.ts`) writes:
 *
 *   role: 'assistant', content: '🔧 {toolName}', toolName: 'foo'
 *
 * The frontend must not render this row as a bubble — it should
 * render it as an inline metadata pill (same treatment as a
 * `role: 'tool'` row).
 *
 * Sentinel expansion: we accept any content that starts with `🔧`,
 * which gives us room to add e.g. `🔧 foo (failed)` later without
 * breaking the contract. Empty content (legacy persisted rows from
 * before 2026-06-08) is also accepted so old conversations render
 * correctly after the deploy.
 */
export function isToolMarker(message: ChatMessage): boolean {
  if (message.role !== 'assistant') return false;
  if (!message.toolName) return false;
  if (!message.content) return true;
  return /^🔧/.test(message.content);
}
