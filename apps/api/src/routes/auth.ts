import { Elysia, t } from 'elysia';
import { prisma } from '@crm/db';
import { authContext } from '../lib/context';
import { logEvent } from '../middleware/audit';
import { requirePermission } from '../middleware/rbac';
import { validateStrongPassword } from '../lib/password-policy';

// P1-5 (2026-06-08): see lib/password-policy.ts for validateStrongPassword.
// Imported at the top of this file. Login intentionally does not use it
// — see TECH-DEBT.md P1-5 for the rationale (existing user passwords
// below 12 chars are grandfathered; see RG-006 for the migration plan).

export const authRoutes = new Elysia({ prefix: '/auth', tags: ['auth'] })
  .use(authContext)
  .post(
    '/login',
    async ({ body, jwt, set, request }) => {
      const { email, password } = body as { email: string; password: string };
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user || !user.isActive) {
        await logEvent({
          actorId: user?.id ?? null,
          action: 'USER_LOGIN_FAILED',
          description: `Login failed for ${email}: user not found or inactive`,
          request,
        });
        set.status = 401;
        return { error: 'Invalid credentials' };
      }
      const valid = await Bun.password.verify(password, user.passwordHash);
      if (!valid) {
        await logEvent({
          actorId: user.id,
          action: 'USER_LOGIN_FAILED',
          description: `Login failed for ${email}: wrong password`,
          request,
        });
        set.status = 401;
        return { error: 'Invalid credentials' };
      }
      const token = await jwt.sign({
        sub: user.id,
        email: user.email,
        role: user.role,
      });
      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });
      await logEvent({
        actorId: user.id,
        action: 'USER_LOGIN',
        resourceType: 'user',
        resourceId: user.id,
        description: `${user.email} signed in`,
        request,
      });
      return {
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
      };
    },
    {
      body: t.Object({
        email: t.String({ format: 'email' }),
        password: t.String({ minLength: 6 }),
      }),
    }
  )
  // P0-1 (2026-06-07 review): self-registration was public and accepted a
  // client-supplied `role` field, letting any unauthenticated caller
  // self-register as ADMIN. Now gated by `user:create` permission (only
  // admins have this) and the `role` field is removed from the body —
  // new users default to SALES. Admins promote via PATCH /users/:id.
  // We re-extract actorId from the request via the same helper rbac.ts
  // uses, since `requirePermission` consumed the token before this
  // handler ran.
  .use(requirePermission('user:create'))
  .post(
    '/register',
    async ({ body, set, request }) => {
      const { email, password, name } = body as {
        email: string;
        password: string;
        name: string;
      };
      // P1-5: enforce strong password policy server-side.
      const pwError = validateStrongPassword(password);
      if (pwError) {
        set.status = 422;
        return { error: pwError };
      }
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        set.status = 409;
        return { error: 'Email already registered' };
      }
      const passwordHash = await Bun.password.hash(password);
      const user = await prisma.user.create({
        data: { email, name, passwordHash, role: 'SALES' },
      });
      // Re-extract actorId for the audit log (the route ran after
      // requirePermission, so the token was already verified upstream).
      const { getUserIdFromRequest } = await import('../middleware/rbac');
      const actorId = await getUserIdFromRequest(request);
      await logEvent({
        actorId,
        action: 'USER_CREATED',
        resourceType: 'user',
        resourceId: user.id,
        description: `Created user ${user.email} (SALES)`,
        request,
      });
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      };
    },
    {
      body: t.Object({
        email: t.String({ format: 'email' }),
        // P1-5: server-side complexity check via validateStrongPassword
        // below. Elysia 1.2 String doesn't take a regex param, so we
        // keep schema minLength at 12 (the first rule of the policy)
        // and let the handler reject on missing digit/special.
        password: t.String({ minLength: 12 }),
        name: t.String({ minLength: 1 }),
      }),
    }
  )
  .get('/me', async ({ request, jwt, set }) => {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      set.status = 401;
      return { error: 'Unauthorized' };
    }
    const token = authHeader.slice(7);
    const payload = await jwt.verify(token);
    if (!payload || typeof payload !== 'object') {
      set.status = 401;
      return { error: 'Invalid token' };
    }
    const userId = (payload as { sub?: string }).sub;
    if (!userId) {
      set.status = 401;
      return { error: 'Invalid token' };
    }
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      set.status = 404;
      return { error: 'User not found' };
    }
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      avatarUrl: user.avatarUrl,
    };
  })
  // Self-service password change
  .post('/change-password', async ({ body, request, jwt, userId, set }) => {
    if (!userId) { set.status = 401; return { error: 'Unauthorized' }; }
    const { currentPassword, newPassword } = body as { currentPassword: string; newPassword: string };
    // P1-5: enforce strong password policy server-side.
    const pwError = validateStrongPassword(newPassword);
    if (pwError) {
      set.status = 422;
      return { error: pwError };
    }
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) { set.status = 404; return { error: 'User not found' }; }
    const valid = await Bun.password.verify(currentPassword, user.passwordHash);
    if (!valid) { set.status = 400; return { error: 'Current password is wrong' }; }
    const newHash = await Bun.password.hash(newPassword);
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: newHash } });
    await logEvent({
      actorId: userId,
      action: 'PASSWORD_CHANGED',
      resourceType: 'user',
      resourceId: userId,
      description: `${user.email} changed their own password`,
      request,
    });
    return { success: true };
  }, {
    body: t.Object({
      currentPassword: t.String({ minLength: 1 }),
      // P1-5: server-side complexity check via validateStrongPassword
      // in the handler. Elysia schema keeps minLength 12 here.
      newPassword: t.String({ minLength: 12 }),
    }),
  });
