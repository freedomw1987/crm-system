/**
 * User management routes (admin only)
 *
 * Endpoints:
 *   GET    /users          - list users (with search, role, isActive filters)
 *   GET    /users/:id      - get single user
 *   POST   /users          - create user
 *   PATCH  /users/:id      - update name, role, isActive
 *   DELETE /users/:id      - delete user (fails if last admin)
 *   POST   /users/:id/reset-password - admin sets a new password
 *
 * All routes require `user:read` (or stronger) — only ADMIN passes.
 * Admin cannot deactivate or delete their own account to prevent lockout.
 */

import { Elysia, t } from 'elysia';
import { prisma } from '@crm/db';
import { USER_ROLES, type UserRole } from '@crm/shared';
import { authContext } from '../lib/context';
import { requirePermission } from '../middleware/rbac';
import { logEvent } from '../middleware/audit';

export const userRoutes = new Elysia({ prefix: '/users', tags: ['users'] })
  .use(authContext)
  .use(requirePermission('user:read'))
  .get('/', async ({ query }) => {
    const { search, role, isActive, limit = '50', offset = '0' } = query as {
      search?: string;
      role?: string;
      isActive?: string;
      limit?: string;
      offset?: string;
    };
    const where: Record<string, unknown> = {};
    if (role) where.role = role;
    if (isActive !== undefined) where.isActive = isActive === 'true';
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }
    const [items, total] = await Promise.all([
      prisma.user.findMany({
        where,
        take: Number(limit),
        skip: Number(offset),
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
          lastLoginAt: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.user.count({ where }),
    ]);
    return { items, total, limit: Number(limit), offset: Number(offset) };
  })
  .get('/:id', async ({ params, set }) => {
    const u = await prisma.user.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!u) { set.status = 404; return { error: 'User not found' }; }
    return u;
  })
  .post('/', async ({ body, set, request, userId }) => {
    const { email, name, role, password } = body as {
      email: string;
      name: string;
      role: UserRole;
      password: string;
    };
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) { set.status = 409; return { error: 'Email already exists' }; }
    if (!USER_ROLES.includes(role)) { set.status = 400; return { error: 'Invalid role' }; }
    const passwordHash = await Bun.password.hash(password);
    const user = await prisma.user.create({
      data: { email, name, role, passwordHash },
      select: {
        id: true, email: true, name: true, role: true, isActive: true, createdAt: true,
      },
    });
    await logEvent({
      actorId: userId,
      action: 'USER_CREATED',
      resourceType: 'user',
      resourceId: user.id,
      description: `Created user ${user.email} (${user.role})`,
      request,
    });
    set.status = 201;
    return user;
  }, {
    body: t.Object({
      email: t.String({ format: 'email' }),
      name: t.String({ minLength: 1 }),
      role: t.Union([t.Literal('ADMIN'), t.Literal('SALES'), t.Literal('VIEWER')]),
      password: t.String({ minLength: 8 }),
    }),
  })
  .patch('/:id', async ({ params, body, set, request, userId }) => {
    const data = body as { name?: string; role?: UserRole; isActive?: boolean };
    const target = await prisma.user.findUnique({ where: { id: params.id } });
    if (!target) { set.status = 404; return { error: 'User not found' }; }

    // Prevent admin from deactivating themselves
    if (data.isActive === false && target.id === userId) {
      set.status = 400;
      return { error: 'Cannot deactivate your own account' };
    }
    // Prevent admin from demoting themselves if they are the last admin
    if (data.role && data.role !== 'ADMIN' && target.id === userId) {
      const adminCount = await prisma.user.count({ where: { role: 'ADMIN', isActive: true } });
      if (adminCount <= 1) {
        set.status = 400;
        return { error: 'Cannot demote the last admin' };
      }
    }
    if (data.role && !USER_ROLES.includes(data.role)) {
      set.status = 400; return { error: 'Invalid role' };
    }

    const before = { name: target.name, role: target.role, isActive: target.isActive };
    const updated = await prisma.user.update({
      where: { id: params.id },
      data: data as never,
      select: {
        id: true, email: true, name: true, role: true, isActive: true, updatedAt: true,
      },
    });

    // Determine specific action
    let action: 'USER_UPDATED' | 'USER_DEACTIVATED' | 'USER_REACTIVATED' = 'USER_UPDATED';
    if (data.isActive === false && before.isActive === true) action = 'USER_DEACTIVATED';
    else if (data.isActive === true && before.isActive === false) action = 'USER_REACTIVATED';

    await logEvent({
      actorId: userId,
      action,
      resourceType: 'user',
      resourceId: updated.id,
      description: `Updated user ${updated.email}`,
      metadata: { before, after: { name: updated.name, role: updated.role, isActive: updated.isActive } },
      request,
    });
    return updated;
  })
  .delete('/:id', async ({ params, set, request, userId }) => {
    const target = await prisma.user.findUnique({ where: { id: params.id } });
    if (!target) { set.status = 404; return { error: 'User not found' }; }
    if (target.id === userId) {
      set.status = 400;
      return { error: 'Cannot delete your own account' };
    }
    if (target.role === 'ADMIN') {
      const adminCount = await prisma.user.count({ where: { role: 'ADMIN' } });
      if (adminCount <= 1) {
        set.status = 400;
        return { error: 'Cannot delete the last admin' };
      }
    }
    await prisma.user.delete({ where: { id: params.id } });
    await logEvent({
      actorId: userId,
      action: 'USER_DELETED',
      resourceType: 'user',
      resourceId: params.id,
      description: `Deleted user ${target.email} (${target.role})`,
      request,
    });
    return { success: true };
  })
  .post('/:id/reset-password', async ({ params, body, set, request, userId }) => {
    const { newPassword } = body as { newPassword: string };
    const target = await prisma.user.findUnique({ where: { id: params.id } });
    if (!target) { set.status = 404; return { error: 'User not found' }; }
    const newHash = await Bun.password.hash(newPassword);
    await prisma.user.update({ where: { id: params.id }, data: { passwordHash: newHash } });
    await logEvent({
      actorId: userId,
      action: 'PASSWORD_RESET',
      resourceType: 'user',
      resourceId: params.id,
      description: `Admin reset password for ${target.email}`,
      request,
    });
    return { success: true };
  }, {
    body: t.Object({
      newPassword: t.String({ minLength: 8 }),
    }),
  });
