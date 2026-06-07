/**
 * withAudit — wrap a Prisma delete + audit-log write so the three (now four)
 * route files that do this pattern don't drift apart.
 *
 * Usage:
 *
 *   .delete('/:id', async ({ params, userId, request }) => withAudit({
 *     action: 'COMPANY_DELETED',
 *     resourceType: 'company',
 *     resourceId: params.id,
 *     userId,
 *     request,
 *     deleteFn: () => prisma.company.delete({ where: { id: params.id } }),
 *     label: company.name,           // optional, used for description
 *     extraMetadata: { foo: 'bar' }, // optional, merged into metadata
 *   }))
 *
 * Behaviour:
 * 1. Calls `deleteFn()` first. If it throws, we re-throw (caller's turn to
 *    404/handle). The audit row is NOT written.
 * 2. On success, writes a single audit row with the given action +
 *    resourceId + description. If `label` is supplied, description is
 *    "Deleted <resourceType> <label>".
 * 3. `extraMetadata` is merged on top of `{ name: label }` (label-keyed
 *    metadata is the pattern used by all four existing delete handlers).
 * 4. The returned object is `{ success: true }` for handler compatibility.
 *
 * Why this exists (TECH-DEBT.md P1-3): the four delete handlers
 * (deal.ts:329, contact.ts:75, company.ts:188, service.ts:260) had three
 * near-identical findUnique → delete → logEvent blocks. Drift was the
 * risk — forgetting metadata on one would silently fail audit completeness.
 */

import { logEvent, type AuditEvent } from '../middleware/audit';

export interface WithAuditDeleteInput {
  action: AuditEvent['action'];
  resourceType: string;
  resourceId: string;
  userId: string | null | undefined;
  request: Request;
  deleteFn: () => Promise<unknown>;
  /** Used in the audit description "Deleted <resourceType> <label>" and
   *  default `name` metadata. Optional. */
  label?: string;
  /** Additional metadata to merge into the audit row. Optional. */
  extraMetadata?: Record<string, unknown>;
}

export async function withAuditDelete(input: WithAuditDeleteInput): Promise<{ success: true }> {
  await input.deleteFn();
  await logEvent({
    actorId: input.userId ?? null,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    description: input.label
      ? `Deleted ${input.resourceType} ${input.label}`
      : `Deleted ${input.resourceType} ${input.resourceId}`,
    metadata: {
      ...(input.label ? { name: input.label } : {}),
      ...(input.extraMetadata ?? {}),
    },
    request: input.request,
  });
  return { success: true };
}
