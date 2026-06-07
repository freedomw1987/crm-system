/**
 * Role-Based Access Control (RBAC) — single source of truth
 *
 * Strategy: 3 hard-coded roles (ADMIN / SALES / VIEWER) with a permission
 * map centralised here. Each route calls `requirePermission('quotation:delete')`
 * from middleware/rbac.ts. To add a new role or change permissions, edit
 * only this file.
 *
 * Permission naming: `<resource>:<action>` where action is one of:
 *   - read   — list / detail
 *   - create — create new
 *   - update — modify existing
 *   - delete — remove
 *   - *      — wildcard, includes all actions
 */

export type UserRole = 'ADMIN' | 'SALES' | 'VIEWER';

export const USER_ROLES: UserRole[] = ['ADMIN', 'SALES', 'VIEWER'];

/** All known permissions, used by the audit / UI to show "missing permission" hints. */
export const PERMISSIONS = {
  // User & system admin
  'user:read':   'View user list and details',
  'user:create': 'Create new user accounts',
  'user:update': 'Edit user name, role, or active status',
  'user:delete': 'Delete user accounts',
  'audit:read':  'View audit log',

  // AI Assistant configuration (admin-only)
  'ai-config:read':   'View AI Assistant endpoint and model settings',
  'ai-config:update': 'Edit AI Assistant endpoint URL, API key, and model name',

  // CRM resources
  'company:read':   'View companies',
  'company:create': 'Create companies',
  'company:update': 'Edit companies',
  'company:delete': 'Delete companies',

  'contact:read':   'View contacts',
  'contact:create': 'Create contacts',
  'contact:update': 'Edit contacts',
  'contact:delete': 'Delete contacts',

  'product:read':   'View products',
  'product:create': 'Create products',
  'product:update': 'Edit products',
  'product:delete': 'Delete products',

  'quotation:read':   'View quotations',
  'quotation:create': 'Create quotations',
  'quotation:update': 'Edit quotations',
  'quotation:delete': 'Delete quotations',
  'quotation:send':   'Send a quotation (DRAFT -> SENT)',

  'deal:read':   'View deals',
  'deal:create': 'Create deals',
  'deal:update': 'Edit deals',
  'deal:delete': 'Delete deals',

  // AI agent — anyone authenticated can use
  'chat:use': 'Use the AI assistant',
} as const;

export type Permission = keyof typeof PERMISSIONS;

/** Role -> set of permissions */
const ROLE_PERMISSIONS: Record<UserRole, ReadonlySet<Permission>> = {
  ADMIN: new Set<Permission>(Object.keys(PERMISSIONS) as Permission[]),
  SALES: new Set<Permission>([
    'company:read', 'company:create', 'company:update', 'company:delete',
    'contact:read', 'contact:create', 'contact:update', 'contact:delete',
    'product:read',
    'quotation:read', 'quotation:create', 'quotation:update', 'quotation:delete', 'quotation:send',
    'deal:read', 'deal:create', 'deal:update', 'deal:delete',
    'chat:use',
  ]),
  VIEWER: new Set<Permission>([
    'company:read',
    'contact:read',
    'product:read',
    'quotation:read',
    'deal:read',
  ]),
};

/** Returns true if the given role has the given permission. */
export function can(role: UserRole | string | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  const perms = ROLE_PERMISSIONS[role as UserRole];
  if (!perms) return false;
  return perms.has(permission);
}

/** Returns the list of permissions a role has. */
export function permissionsFor(role: UserRole): Permission[] {
  return Array.from(ROLE_PERMISSIONS[role] ?? []);
}

/** Human-readable role label */
export function roleLabel(role: UserRole): string {
  switch (role) {
    case 'ADMIN':  return '管理員';
    case 'SALES':  return '銷售';
    case 'VIEWER': return '檢視者';
  }
}
