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

  // Service catalogue (admin-managed)
  'service:read':   'View services',
  'service:create': 'Create services',
  'service:update': 'Edit services',
  'service:delete': 'Delete services',

  // Man-day role pricing catalogue (admin-managed; Day 19)
  // These drive the `costSnapshot` per line in a ServiceManDay,
  // and feed into QuotationItem GP%. SALES can read so the
  // builder can show the live price next to the snapshot.
  'man-day-role:read':   'View man-day role catalogue',
  'man-day-role:create': 'Create new man-day roles',
  'man-day-role:update': 'Edit man-day role name / price / cost',
  'man-day-role:delete': 'Delete man-day roles (blocked if referenced)',

  // Region catalogue (admin-managed; HK / MO / CN / OTHER).
  // Region CRUD is admin-only; reads are public so the company
  // form's region picker doesn't require a permissions check.
  'region:read':   'View regions (also served publicly)',
  'region:create': 'Create regions',
  'region:update': 'Edit regions',
  'region:delete': 'Delete regions',

  // Activity log + attachments (Day 18-E; see ADR 0018).
  // Reads are open; PATCH/DELETE enforce author-only at the
  // route level (NOT at this permission layer — the rule is
  // data-driven, not role-driven).
  'activity:read':   'View activity feed',
  'activity:create': 'Create activity log entries',
  'activity:update': 'Edit any activity (admin-style override; default route is author-only)',
  'activity:delete': 'Delete any activity (admin-style override; default route is author-only)',
  'attachment:read':   'View attachments',
  'attachment:create': 'Upload attachments',
  'attachment:update': 'Edit any attachment (admin-style override; default route is uploader-only)',
  'attachment:delete': 'Delete any attachment (admin-style override; default route is uploader-only)',

  // Role management (admin-only)
  'role:read':   'View roles and the permission matrix',
  'role:create': 'Create custom roles',
  'role:update': 'Edit role permissions',
  'role:delete': 'Delete custom roles',

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

  // System Configuration (Day 14+)
  'settings:read':   'View system configuration (tax rate, future defaults)',
  'settings:update': 'Edit system configuration',
} as const;

export type Permission = keyof typeof PERMISSIONS;

/** Role -> set of permissions */
export const ROLE_PERMISSIONS: Record<UserRole, ReadonlySet<Permission>> = {
  ADMIN: new Set<Permission>(Object.keys(PERMISSIONS) as Permission[]),
  SALES: new Set<Permission>([
    'company:read', 'company:create', 'company:update', 'company:delete',
    'contact:read', 'contact:create', 'contact:update', 'contact:delete',
    'product:read',
    'quotation:read', 'quotation:create', 'quotation:update', 'quotation:delete', 'quotation:send',
    'deal:read', 'deal:create', 'deal:update', 'deal:delete',
    'service:read',
    'man-day-role:read',
    'region:read',
    'activity:read', 'activity:create',
    'attachment:read', 'attachment:create',
    'chat:use',
  ]),
  VIEWER: new Set<Permission>([
    'company:read',
    'contact:read',
    'product:read',
    'quotation:read',
    'deal:read',
    'service:read',
    'man-day-role:read',
    'region:read',
    'activity:read',
    'attachment:read',
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
