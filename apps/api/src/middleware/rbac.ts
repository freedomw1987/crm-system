/**
 * Role-based access control helper
 *
 * Usage in a route:
 *   .use(requirePermission('quotation:create'))
 *
 * The plugin depends on `authContext` (must be applied earlier in the chain
 * so `userId` and `userRole` are in the derive context).
 *
 * Elysia 1.2 doesn't infer derive'd context across plugins, so we cast
 * `userId` / `userRole` via `(ctx as any)` at the call site.
 */

import { Elysia } from 'elysia';
import { can, type Permission } from '@crm/shared';

export function requirePermission(permission: Permission) {
  return new Elysia({ name: `rbac-${permission}` }).onBeforeHandle(
    async (ctx) => {
      const { userId, userRole, set } = ctx as typeof ctx & {
        userId: string | null;
        userRole: string | null;
      };
      if (!userId) {
        set.status = 401;
        return { error: 'Unauthorized' };
      }
      if (!can(userRole, permission)) {
        set.status = 403;
        return { error: `Forbidden: missing permission ${permission}` };
      }
    }
  );
}
