/**
 * Shared helpers for ServiceManDay snapshot + lookup.
 *
 * 2026-07-01 (US-IMPORT-MD): extracted from `apps/api/src/routes/service.ts`
 * so the new AI Excel import executor (`apps/api/src/lib/excel-import.ts`)
 * can reuse the same logic when persisting man-day breakdowns for newly
 * imported services.
 *
 * Why accept `prisma` as a parameter? Two callers need this helper:
 *   1. `apps/api/src/routes/service.ts` (uses the real Prisma client
 *      imported at the top of the file).
 *   2. `apps/api/src/lib/excel-import.ts` (tested with a mock Prisma
 *      client; the executor's `ImportContext.prisma` is what tests
 *      pass in). If this helper imported `prisma` from `@crm/db`
 *      directly, the tests could never exercise the catalogue-FK
 *      resolve path because the mock wouldn't be used.
 *
 * Same pattern for `snapshotManDayLine` — pure function, no prisma
 * coupling; its caller's prisma is only used inside `buildRoleLookup`.
 */
import type { PrismaClient } from '@crm/db';

/**
 * Turn a wire-format man-day line into a row ready to insert into
 * `ServiceManDay`. Behaviour:
 *   - If a `manDayRoleId` was provided AND the role still exists in
 *     the catalogue, snapshot the latest `name`/`price`/`cost` from
 *     the catalogue into the row.
 *   - If the FK points to a now-deleted role (or none was given),
 *     fall back to free-form: the row carries the literal
 *     `role`/`dayRate`/`costRate` the user typed.
 *
 * The returned object has the exact shape Prisma needs for
 * `prisma.serviceManDay.create({ data })` or a `createMany` batch.
 */
export function snapshotManDayLine(
  line: {
    manDayRoleId?: string | null;
    role?: string;
    dayRate?: number;
    costRate?: number;
    days: number;
    sortOrder?: number;
  },
  roleLookup: Map<string, { name: string; price: number; cost: number }>,
) {
  if (line.manDayRoleId) {
    const r = roleLookup.get(line.manDayRoleId);
    if (r) {
      return {
        manDayRoleId: line.manDayRoleId,
        role: r.name,
        dayRate: r.price,
        costRate: r.cost,
        days: line.days,
        subtotal: Number(r.price) * Number(line.days),
        sortOrder: line.sortOrder ?? 0,
      };
    }
    // FK points to a missing role — fall through to free-form with the
    // roleId nulled (avoids FK violation)
  }
  return {
    manDayRoleId: null,
    role: line.role ?? '',
    dayRate: line.dayRate ?? 0,
    costRate: line.costRate ?? 0,
    days: line.days,
    subtotal: Number(line.dayRate ?? 0) * Number(line.days),
    sortOrder: line.sortOrder ?? 0,
  };
}

/**
 * Pre-load the ManDayRoles referenced in an incoming payload so we
 * can snapshot them in one round-trip. If the payload doesn't
 * reference any roles (legacy free-form), this returns an empty map.
 *
 * Always returns a Map keyed by id so the caller can do
 * `roleLookup.get(line.manDayRoleId)` for O(1) lookups during the
 * fan-out (an AI Excel import can have dozens of SERVICE lines,
 * each with multiple man-day rows).
 *
 * The `prisma` is passed in so callers (production code or unit
 * tests) can inject their own client — tests use a mock; production
 * code uses the real Prisma instance from @crm/db.
 */
export async function buildRoleLookup(
  prisma: PrismaClient,
  roleIds: string[],
): Promise<Map<string, { name: string; price: number; cost: number }>> {
  const map = new Map<string, { name: string; price: number; cost: number }>();
  if (roleIds.length === 0) return map;
  const roles = await prisma.manDayRole.findMany({
    where: { id: { in: roleIds } },
    select: { id: true, name: true, price: true, cost: true },
  });
  for (const r of roles) {
    map.set(r.id, { name: r.name, price: Number(r.price), cost: Number(r.cost) });
  }
  return map;
}
