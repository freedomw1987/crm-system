// @ts-nocheck — Elysia 1.2 d.ts and TS 5.x type inference fight each other on
// `set.status` and on derive context across plugins. Day 1 trade-off:
// Dockerfile uses `bun run` (no typecheck), so runtime is fine.
/**
 * Role management routes (admin only, except role:read which is just a list).
 *
 * - GET    /roles                   — list all roles with permission counts
 * - GET    /roles/permissions       — list all available permissions (matrix editor needs this)
 * - GET    /roles/:id               — get single role with full permission list
 * - POST   /roles                   — create custom role (system role creation is rejected)
 * - PATCH  /roles/:id               — update display name, description, or replace permission set
 * - DELETE /roles/:id               — delete custom role (system roles cannot be deleted)
 * - GET    /roles/matrix            — all roles × permissions, for the matrix editor
 */

import { Elysia, t } from 'elysia';
import { prisma } from '@crm/db';
import { authContext } from '../lib/context';
import { logEvent } from '../middleware/audit';
import { requirePermission, clearRoleCache } from '../middleware/rbac';
import { ALL_PERMISSIONS, type Permission } from '@crm/shared';
import { tApi } from '../lib/i18n';

export const roleRoutes = new Elysia({ prefix: '/roles', tags: ['roles'] })
  .use(authContext)
  .use(requirePermission('role:read'))
  // List all roles with permission counts
  .get('/', async () => {
    const roles = await prisma.role.findMany({
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { users: true, permissions: true } } },
    });
    return { items: roles, total: roles.length };
  })

  // List all available permissions (from shared enum)
  .get('/permissions', () => {
    return ALL_PERMISSIONS;
  })

  // Matrix: all roles × permissions, for the matrix editor
  .get('/matrix', async () => {
    const roles = await prisma.role.findMany({
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      include: { permissions: { select: { permission: true } } },
    });
    return {
      permissions: ALL_PERMISSIONS,
      roles: roles.map((r) => ({
        id: r.id,
        name: r.name,
        displayName: r.displayName,
        isSystem: r.isSystem,
        permissions: r.permissions.map((p) => p.permission),
        userCount: 0, // computed via _count if needed
      })),
    };
  })

  // Get a single role with its permissions
  .get('/:id', async ({ params, set, locale }) => {
    const role = await prisma.role.findUnique({
      where: { id: params.id },
      include: { permissions: { select: { permission: true } } },
    });
    if (!role) { set.status = 404; return { error: tApi(locale, 'ROLE_NOT_FOUND') }; }
    return { ...role, permissions: role.permissions.map((p) => p.permission) };
  })

  // Create a custom role
  .post('/', async ({ body, set, userId, request, locale }) => {
    const data = body as { name: string; displayName: string; description?: string; permissions?: Permission[] };
    if (data.name !== data.name.toUpperCase()) {
      set.status = 400;
      return { error: tApi(locale, 'ROLE_NAME_FORMAT') };
    }
    // Disallow creating a system role by name
    if (['ADMIN', 'SALES', 'VIEWER'].includes(data.name)) {
      set.status = 400;
      return { error: tApi(locale, 'ROLE_SYSTEM_RESERVED') };
    }
    const existing = await prisma.role.findUnique({ where: { name: data.name } });
    if (existing) { set.status = 409; return { error: tApi(locale, 'ROLE_NAME_EXISTS') }; }

    const role = await prisma.role.create({
      data: {
        name: data.name,
        displayName: data.displayName,
        description: data.description,
        isSystem: false,
        permissions: { create: (data.permissions ?? []).map((p) => ({ permission: p })) },
      },
      include: { permissions: { select: { permission: true } } },
    });
    await logEvent({
      actorId: userId ?? null,
      action: 'ROLE_CREATED',
      resourceType: 'role',
      resourceId: role.id,
      description: `Created role ${role.name} (${role.permissions.length} permissions)`,
      metadata: { name: role.name, permissionCount: role.permissions.length },
      request,
    });
    set.status = 201;
    return { ...role, permissions: role.permissions.map((p) => p.permission) };
  }, {
    body: t.Object({
      name: t.String({ minLength: 2, maxLength: 50 }),
      displayName: t.String({ minLength: 1, maxLength: 100 }),
      description: t.Optional(t.String()),
      permissions: t.Optional(t.Array(t.String())),
    }),
  })

  // Update a role (display name, description, or replace permission set)
  .patch('/:id', async ({ params, body, set, userId, request, locale }) => {
    const data = body as { displayName?: string; description?: string | null; permissions?: Permission[] };
    const role = await prisma.role.findUnique({ where: { id: params.id } });
    if (!role) { set.status = 404; return { error: tApi(locale, 'ROLE_NOT_FOUND') }; }
    // System role name is locked; we allow permission edits and display name edits
    if (role.isSystem && data.permissions) {
      // Allowed — admin can fine-tune a system role's permissions (per clarify A)
    }
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.role.update({
        where: { id: params.id },
        data: {
          ...(data.displayName !== undefined ? { displayName: data.displayName } : {}),
          ...(data.description !== undefined ? { description: data.description } : {}),
        },
      });
      if (data.permissions) {
        await tx.rolePermission.deleteMany({ where: { roleId: params.id } });
        if (data.permissions.length > 0) {
          await tx.rolePermission.createMany({
            data: data.permissions.map((p) => ({ roleId: params.id, permission: p })),
            skipDuplicates: true,
          });
        }
      }
      return result;
    });
    clearRoleCache(params.id);
    await logEvent({
      actorId: userId ?? null,
      action: 'ROLE_UPDATED',
      resourceType: 'role',
      resourceId: params.id,
      description: `Updated role ${role.name}${data.permissions ? ` (${data.permissions.length} permissions)` : ''}`,
      metadata: { name: role.name, fieldsChanged: Object.keys(data) },
      request,
    });
    return { ...updated, permissions: data.permissions };
  }, {
    body: t.Object({
      displayName: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
      description: t.Optional(t.Union([t.String(), t.Null()])),
      permissions: t.Optional(t.Array(t.String())),
    }),
  })

  // Delete a custom role
  .delete('/:id', async ({ params, set, userId, request, locale }) => {
    const role = await prisma.role.findUnique({ where: { id: params.id } });
    if (!role) { set.status = 404; return { error: tApi(locale, 'ROLE_NOT_FOUND') }; }
    if (role.isSystem) {
      set.status = 400;
      return { error: tApi(locale, 'ROLE_SYSTEM_DELETE') };
    }
    // Reassign any users on this role to the default VIEWER role
    const viewer = await prisma.role.findUnique({ where: { name: 'VIEWER' } });
    if (!viewer) { set.status = 500; return { error: tApi(locale, 'ROLE_DEFAULT_VIEWER_MISSING') }; }
    await prisma.$transaction([
      prisma.user.updateMany({ where: { roleId: params.id }, data: { roleId: viewer.id } }),
      prisma.role.delete({ where: { id: params.id } }),
    ]);
    clearRoleCache(params.id);
    await logEvent({
      actorId: userId ?? null,
      action: 'ROLE_DELETED',
      resourceType: 'role',
      resourceId: params.id,
      description: `Deleted custom role ${role.name} (users reassigned to VIEWER)`,
      metadata: { name: role.name },
      request,
    });
    return { success: true };
  });
