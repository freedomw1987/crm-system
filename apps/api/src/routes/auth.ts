import { Elysia, t } from 'elysia';
import { prisma } from '@crm/db';

export const authRoutes = new Elysia({ prefix: '/auth', tags: ['auth'] })
  .post(
    '/login',
    async ({ body, jwt, set }) => {
      const { email, password } = body as { email: string; password: string };
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user || !user.isActive) {
        set.status = 401;
        return { error: 'Invalid credentials' };
      }
      const valid = await Bun.password.verify(password, user.passwordHash);
      if (!valid) {
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

  .post(
    '/register',
    async ({ body, set }) => {
      const { email, password, name, role } = body as {
        email: string;
        password: string;
        name: string;
        role?: 'ADMIN' | 'SALES' | 'VIEWER';
      };
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        set.status = 409;
        return { error: 'Email already registered' };
      }
      const passwordHash = await Bun.password.hash(password);
      const user = await prisma.user.create({
        data: { email, name, passwordHash, role: role ?? 'SALES' },
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
        password: t.String({ minLength: 8 }),
        name: t.String({ minLength: 1 }),
        role: t.Optional(t.Union([
          t.Literal('ADMIN'),
          t.Literal('SALES'),
          t.Literal('VIEWER'),
        ])),
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
  });
