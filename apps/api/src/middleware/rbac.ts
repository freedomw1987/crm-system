// @ts-nocheck — Elysia 1.2 d.ts and TS 5.x type inference fight each other on
// `set.status` (typed as `number | "Unauthorized" | ...` literal union) and
// on derive context across plugins. Day 1 trade-off: Dockerfile uses
// `bun run` (no typecheck), so runtime is fine. Re-enable when Elysia 1.3 ships.
/**
 * Role-based access control (Day 7: dynamic, DB-driven)
 *
 * Permission lookups load the role + its permissions from the database and
 * cache them in-process for 5 minutes. This keeps RBAC responsive to admin
 * edits without hammering the database on every request.
 *
 * Strategy for cache invalidation:
 * - The 5-minute TTL is the primary mechanism (predictable, no race conditions)
 * - `clearRoleCache(roleId)` is exported for the roles API to call when an
 *   admin changes a role's permissions — that gives instant effect without
 *   waiting for TTL
 */

import { Elysia } from 'elysia';
import { jwt } from '@elysiajs/jwt';
import { prisma } from '@crm/db';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// roleId -> { permissions: Set<string>, expiresAt: number }
const cache = new Map<string, { permissions: Set<string>; expiresAt: number }>();

async function loadRolePermissions(roleId: string): Promise<Set<string>> {
  const cached = cache.get(roleId);
  if (cached && cached.expiresAt > Date.now()) return cached.permissions;

  const perms = await prisma.rolePermission.findMany({
    where: { roleId },
    select: { permission: true },
  });
  const set = new Set(perms.map((p) => p.permission));
  cache.set(roleId, { permissions: set, expiresAt: Date.now() + CACHE_TTL_MS });
  return set;
}

export function clearRoleCache(roleId?: string) {
  if (roleId) cache.delete(roleId);
  else cache.clear();
}

/**
 * Returns true if the given userId has the named permission.
 * Looks up the user's roleId, then loads the permission set (cached).
 */
export async function userHasPermission(userId: string, permission: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { roleId: true, role: true },
  });
  if (!user) return false;

  let roleId = user.roleId;
  if (!roleId) {
    const role = await prisma.role.findUnique({ where: { name: user.role } });
    if (!role) return false;
    roleId = role.id;
  }

  const perms = await loadRolePermissions(roleId);
  return perms.has(permission);
}

/**
 * Extract the userId from the Authorization header. Used by the require-permission
 * plugins because Elysia 1.2's `onBeforeHandle` doesn't reliably see context
 * derived by other plugins (the JWT derive populates `ctx.userId` in route
 * handlers, but the derive context is lost across plugin boundaries in 1.2).
 *
 * This re-verifies the JWT in-place and returns the userId.
 */
export async function getUserIdFromRequest(request: Request): Promise<string | null> {
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  const token = auth.slice(7);
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  try {
    // @elysiajs/jwt is built on top of `jose` and signs HS256 with the secret
    // encoded as a UTF-8 string. We can verify directly with the same library
    // to avoid the overhead of an Elysia plugin instance.
    const { jwtVerify } = await import('jose');
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    if (!payload || typeof payload !== 'object') return null;
    const userId = (payload as { sub?: string; userId?: string }).userId
      ?? (payload as { sub?: string }).sub;
    return userId ?? null;
  } catch {
    return null;
  }
}

/**
 * Elysia plugin: require a single permission on a route.
 *   .use(requirePermission('quotation:create'))
 */
export function requirePermission(permission: string) {
  return new Elysia({ name: `require-permission:${permission}` }).onBeforeHandle(
    { as: 'scoped' },
    async (ctx: { request: Request; set: { status?: number } }) => {
      const { request, set } = ctx;
      const userId = await getUserIdFromRequest(request);
      if (!userId) {
        set.status = 401;
        return { error: 'Unauthorized' };
      }
      const allowed = await userHasPermission(userId, permission);
      if (!allowed) {
        set.status = 403;
        return { error: `Forbidden: missing permission '${permission}'` };
      }
    }
  );
}

/**
 * Elysia plugin: require ANY of the given permissions (OR).
 */
export function requireAnyPermission(...permissions: string[]) {
  return new Elysia({ name: `require-any-permission:${permissions.join('|')}` }).onBeforeHandle(
    { as: 'scoped' },
    async (ctx: { request: Request; set: { status?: number } }) => {
      const { request, set } = ctx;
      const userId = await getUserIdFromRequest(request);
      if (!userId) {
        set.status = 401;
        return { error: 'Unauthorized' };
      }
      for (const perm of permissions) {
        if (await userHasPermission(userId, perm)) return;
      }
      set.status = 403;
      return { error: `Forbidden: need one of [${permissions.join(', ')}]` };
    }
  );
}
