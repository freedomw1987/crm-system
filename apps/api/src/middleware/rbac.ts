// @ts-nocheck — Elysia 1.2 d.ts and TS 5.x type inference fight each other on
// `set.status` (typed as `number | "Unauthorized" | ...` literal union) and
// on derive context across plugins. Day 1 trade-off: Dockerfile uses
// `bun run` (no typecheck), so runtime is fine. Re-enable when Elysia 1.3 ships.

// ----------------------------------------------------------------------------
// Pinned permission exports (RG-004, Day 18 audit + t3 regression ports)
// ----------------------------------------------------------------------------
//
// The PERMISSIONS map + ROLE_PERMISSIONS matrix live in
// `packages/shared/src/permissions.ts` so both api + web can import them
// (the frontend needs to render the role-permission matrix in the admin
// UI). rbac.ts re-exports the canonical matrix + derives a single
// `ADMIN_PERMISSIONS` set so tests can assert "ADMIN can do EVERY
// current permission" without coupling to the implementation detail of
// how the matrix is built.
//
// Invariants pinned by these exports:
//   1. `ROLE_PERMISSIONS` matches `PERMISSIONS` keys exactly — adding
//      a new permission key without a corresponding role default
//      surfaces here as a type error in callers (e.g. the role UI).
//   2. `ADMIN_PERMISSIONS` is exactly `Object.keys(PERMISSIONS)` — the
//      admin role has every current permission, no exceptions.
//   3. The non-ADMIN roles have an explicit subset (SALES / VIEWER).
//      If a new permission is added but no role lists it, that's a
//      configuration gap that this matrix exposes.
// ----------------------------------------------------------------------------
export {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  type Permission,
  type UserRole,
} from '@crm/shared';

/** The set of every permission key currently declared in PERMISSIONS. */
import { PERMISSIONS as _PERMISSIONS } from '@crm/shared';
export const ADMIN_PERMISSIONS: ReadonlySet<string> = new Set(
  Object.keys(_PERMISSIONS),
);

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
import { parseAcceptLanguage, tApi } from '../lib/i18n';

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
      // P3-i18n (2026-07-02): resolve the locale from the Accept-Language
      // header directly — we're inside onBeforeHandle (pre-route), so
      // localeContext hasn't populated ctx yet for unauthenticated probes.
      // Mirrors the priority in middleware/locale.ts but skips the DB
      // step (we don't know the user yet at the 401 site).
      const locale = parseAcceptLanguage(request.headers.get('accept-language'));
      const userId = await getUserIdFromRequest(request);
      if (!userId) {
        set.status = 401;
        return { error: tApi(locale, 'UNAUTHORIZED') };
      }
      const allowed = await userHasPermission(userId, permission);
      if (!allowed) {
        set.status = 403;
        // The permission key reads cleanly to admins in en; for zh
        // the catalog wraps it: "權限不足: 缺少「<perm>」權限".
        return { error: tApi(locale, 'FORBIDDEN', { permission }) };
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
      const locale = parseAcceptLanguage(request.headers.get('accept-language'));
      const userId = await getUserIdFromRequest(request);
      if (!userId) {
        set.status = 401;
        return { error: tApi(locale, 'UNAUTHORIZED') };
      }
      for (const perm of permissions) {
        if (await userHasPermission(userId, perm)) return;
      }
      set.status = 403;
      return {
        error: tApi(locale, 'FORBIDDEN_ANY', { permissions: permissions.join(', ') }),
      };
    }
  );
}
