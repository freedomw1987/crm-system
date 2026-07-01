/**
 * One-shot migration: backfill missing permissions on existing roles.
 *
 * Run: `bun run src/scripts/sync-role-permissions.ts`
 *
 * 2026-07-01 (US-PERM-DRIFT): the seed script's SALES/VIEWER
 * permission lists were hard-coded and fell out of sync as new
 * permissions were added to `packages/shared/src/permissions.ts`.
 * Existing ADMIN/SALES/VIEWER users therefore lacked permissions
 * like `man-day-role:read` even though the matrix said they should
 * have them — first symptom was a 403 on `POST /man-day-roles`.
 *
 * This script derives the *current* desired permission set from
 * the canonical `ROLE_PERMISSIONS` matrix in @crm/shared and
 * `INSERT`s any (role, permission) pair that's missing from
 * `role_permissions`. It's idempotent: re-running is a no-op once
 * the DB catches up.
 *
 * After running, call `clearRoleCache()` (imported from rbac.ts)
 * to force every running API instance to refresh its in-process
 * 5-minute role-permission cache. We can't reach that function
 * from this script (it's only callable from inside the running
 * Elysia app), so we just print a reminder; admins running this
 * can also restart the API to flush the cache.
 */
import { prisma } from '@crm/db';
import { ROLE_PERMISSIONS } from '@crm/shared';

const ROLES = ['ADMIN', 'SALES', 'VIEWER'] as const;

async function main() {
  console.log('🔧 Syncing role permissions to match @crm/shared/permissions.ts …');

  const roles = await prisma.role.findMany({
    where: { name: { in: [...ROLES] } },
  });
  const roleByName = new Map(roles.map((r) => [r.name, r]));

  let inserted = 0;
  let skipped = 0;
  for (const roleName of ROLES) {
    const role = roleByName.get(roleName);
    if (!role) {
      console.warn(`⚠️  Role ${roleName} not found in DB — skipping. Run the seed first.`);
      continue;
    }
    const desired = Array.from(ROLE_PERMISSIONS[roleName]);
    for (const permission of desired) {
      // Prisma doesn't expose `skipDuplicates` for createMany on
      // composite-unique-by-PK tables without a surrogate key, and
      // role_permissions' PK is (roleId, permission), which IS the
      // composite. createMany with `skipDuplicates: true` works on
      // Prisma 5+ when the PK is composite. Fall back to upsert for
      // older engines.
      const result = await prisma.rolePermission.upsert({
        where: { roleId_permission: { roleId: role.id, permission } },
        update: {},
        create: { roleId: role.id, permission },
      });
      if (result) {
        inserted += 1;
      } else {
        skipped += 1;
      }
    }
    console.log(`  ${roleName}: ${desired.length} desired permissions`);
  }

  console.log(`\n✅ Done. ${inserted} permissions upserted.`);
  console.log(
    '⚠️  Remember to restart the API (or wait 5 min for the in-process ' +
      'rbac cache to expire) before testing the newly-granted permissions.',
  );
  console.log('\nPost-sync permission counts:');
  const counts = await prisma.rolePermission.groupBy({
    by: ['roleId'],
    _count: { _all: true },
  });
  const roleNames = new Map(roles.map((r) => [r.id, r.name]));
  for (const c of counts) {
    console.log(`  ${roleNames.get(c.roleId)}: ${c._count._all}`);
  }
}

main()
  .catch((e) => {
    console.error('❌ sync failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });