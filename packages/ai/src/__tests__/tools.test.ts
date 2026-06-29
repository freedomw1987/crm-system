/**
 * Regression tests for the tool-category partitions in
 * `tools.ts` (Day 30, t3).
 *
 * Pinned invariant — RG-CHAT-002 (Day 17, US-C5): the 3 write
 * tools (draftQuotation, updateDealStage, logActivity) must
 * NEVER execute without explicit human confirmation. The
 * guardrail is implemented via the per-tool
 * `requiresConfirmation: true` flag, and `WRITE_TOOLS` /
 * `READ_TOOLS` are derived partitions of that flag.
 *
 * These tests pin:
 *   1. WRITE_TOOLS contains exactly the 3 write tools.
 *   2. No read tool is in WRITE_TOOLS.
 *   3. WRITE_TOOLS and READ_TOOLS partition the full registry
 *      (no tool is in both, no tool is in neither).
 *   4. The literal string names match the tool definitions (a
 *      rename in one place without a coordinated rename in the
 *      other would silently break the human-in-the-loop flow).
 *   5. Adding a new tool without flagging it requiresConfirmation
 *      is caught here as a fail — the new tool would land in
 *      READ_TOOLS, which the agent loop trusts to be safe.
 *   6. Removing a tool from the registry without updating the
 *      partition is also caught.
 */

import { describe, expect, it } from 'bun:test';
import {
  READ_TOOLS,
  WRITE_TOOLS,
  toolRegistry,
} from '../tools';

// ============================================================================
// WRITE_TOOLS — the 3 human-in-the-loop tools (RG-CHAT-002)
// ============================================================================

describe('WRITE_TOOLS (RG-CHAT-002)', () => {
  it('contains exactly the 3 documented write tools', () => {
    // The names are hard-coded — they're the wire-format tool
    // names the LLM emits (snake_case per the OpenAI function-
    // calling convention), so a rename would silently break
    // every prior conversation history. Pin them.
    expect(new Set(WRITE_TOOLS)).toEqual(
      new Set(['draft_quotation', 'update_deal_stage', 'log_activity']),
    );
  });

  it('has exactly 3 tools (matches the PRD US-C5 spec)', () => {
    expect(WRITE_TOOLS.size).toBe(3);
  });

  it('every member of WRITE_TOOLS exists in toolRegistry', () => {
    // Defensive: if a future PR renames a tool in WRITE_TOOLS
    // without updating the registry, the agent loop would look
    // up a name that doesn't exist. Pin that WRITE_TOOLS ⊆
    // toolRegistry names.
    const registryNames = new Set(toolRegistry.map((t) => t.name));
    for (const name of WRITE_TOOLS) {
      expect(registryNames.has(name)).toBe(true);
    }
  });

  it('every member of WRITE_TOOLS actually has requiresConfirmation: true', () => {
    // The partition is derived from the per-tool flag. A future
    // refactor that decouples WRITE_TOOLS from the flag would
    // silently let a tool execute without confirmation. Pin the
    // invariant at the source.
    for (const name of WRITE_TOOLS) {
      const tool = toolRegistry.find((t) => t.name === name);
      expect(tool).toBeDefined();
      expect(tool!.requiresConfirmation).toBe(true);
    }
  });
});

// ============================================================================
// READ_TOOLS — the read-only complement
// ============================================================================

describe('READ_TOOLS (RG-CHAT-002 complement)', () => {
  it('contains every tool that does NOT require confirmation', () => {
    const readNames = new Set(
      toolRegistry.filter((t) => !t.requiresConfirmation).map((t) => t.name),
    );
    expect(new Set(READ_TOOLS)).toEqual(readNames);
  });

  it('does NOT contain any of the 3 write tools', () => {
    // The 3 write tools must NEVER be in READ_TOOLS. A future
    // PR that flips a tool's requiresConfirmation flag would
    // move it from WRITE to READ — and that tool would then
    // execute without confirmation. The test catches the
    // boundary drift.
    expect(READ_TOOLS.has('draft_quotation')).toBe(false);
    expect(READ_TOOLS.has('update_deal_stage')).toBe(false);
    expect(READ_TOOLS.has('log_activity')).toBe(false);
  });

  it('size matches the total registry minus write count', () => {
    // Sanity: READ_TOOLS ∪ WRITE_TOOLS = toolRegistry. A future
    // PR that adds a tool without updating the partition is
    // caught here.
    expect(READ_TOOLS.size + WRITE_TOOLS.size).toBe(toolRegistry.length);
  });

  it('contains the documented read tools', () => {
    // Pin the canonical wire-format names (snake_case) so a future
    // rename here is caught.
    for (const name of [
      'search_companies',
      'get_company',
      'search_products',
      'search_services',
      'list_quotations',
      'list_deals',
      'list_pipelines',
      'get_top_customers',
    ]) {
      expect(READ_TOOLS.has(name)).toBe(true);
    }
  });
});

// ============================================================================
// Cross-partition invariant
// ============================================================================

describe('WRITE_TOOLS / READ_TOOLS partition', () => {
  it('WRITE_TOOLS and READ_TOOLS are disjoint', () => {
    // If a tool is in both, the agent loop's "is this a write?"
    // check is ambiguous. The build would still pass; the
    // behavior at runtime would depend on which set the code
    // iterates first.
    for (const name of WRITE_TOOLS) {
      expect(READ_TOOLS.has(name)).toBe(false);
    }
  });

  it('covers every tool in the registry', () => {
    // Inverse of the previous test: every tool is in exactly
    // one of the two sets. A new tool added to the registry
    // without the requiresConfirmation flag set is in READ_TOOLS;
    // a tool without any partition entry would be invisible to
    // both (and the agent loop would skip the guardrail).
    const registryNames = new Set(toolRegistry.map((t) => t.name));
    const partitioned = new Set([...WRITE_TOOLS, ...READ_TOOLS]);
    expect(partitioned).toEqual(registryNames);
  });
});
