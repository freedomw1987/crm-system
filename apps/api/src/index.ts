/**
 * CRM System API Entry Point
 *
 * Stack: Bun + Elysia + Prisma
 * Day 1-5: Health, Auth, AI chat, Companies, Contacts, Products,
 *          Quotations, Deals, Users, Audit
 */

import { Elysia, t } from 'elysia';
import { cors } from '@elysiajs/cors';
import { jwt } from '@elysiajs/jwt';
import { prisma } from '@crm/db';
import { authRoutes } from './routes/auth';
import { companyRoutes } from './routes/company';
import { contactRoutes } from './routes/contact';
import { productRoutes } from './routes/product';
import { serviceRoutes } from './routes/service';
import { quotationRoutes } from './routes/quotation';
import { dealRoutes } from './routes/deal';
import { chatRoutes } from './routes/chat';
import { userRoutes } from './routes/users';
import { auditRoutes } from './routes/audit';
import { roleRoutes } from './routes/roles';
import { regionRoutes } from './routes/region';
import { manDayRoleRoutes } from './routes/man-day-role';
import { activityRoutes } from './routes/activity';
import { aiConfigRoutes } from './routes/ai-config';
import { settingsRoutes } from './routes/settings';
import { logEvent } from './middleware/audit';

const PORT = Number(process.env.API_PORT ?? 3001);
const HOST = process.env.API_HOST ?? '0.0.0.0';
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:5173';

// P0-4 (2026-06-07 review): the previous code used
//   `process.env.JWT_SECRET ?? 'dev-only-secret-please-change'`
// which silently booted with a known weak secret if the env var was
// missing. In production this would let anyone forge tokens (the
// dev-only string is in the public source tree).
//
// Hard-fail at boot when:
//   1. JWT_SECRET is missing
//   2. JWT_SECRET is shorter than 32 chars
//   3. JWT_SECRET is the dev-only fallback string in production
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required. Refusing to boot.');
}
if (JWT_SECRET.length < 32) {
  throw new Error(`JWT_SECRET must be at least 32 characters (got ${JWT_SECRET.length}). Generate one with: openssl rand -hex 32`);
}
if (process.env.NODE_ENV === 'production' && JWT_SECRET === 'dev-only-secret-please-change') {
  throw new Error('Refusing to boot: JWT_SECRET is set to the dev-only fallback in production.');
}

const app = new Elysia()
  .use(
    cors({
      origin: CORS_ORIGIN.split(',').map((s) => s.trim()),
      credentials: true,
    })
  )

  .use(
    jwt({
      name: 'jwt',
      secret: JWT_SECRET,
    })
  )

  .get('/health', async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return {
        status: 'ok',
        db: 'connected',
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      return {
        status: 'error',
        db: 'disconnected',
        error: (err as Error).message,
      };
    }
  })

  .use(authRoutes)
  .use(companyRoutes)
  .use(contactRoutes)
  .use(productRoutes)
  .use(serviceRoutes)
  .use(quotationRoutes)
  .use(dealRoutes)
  .use(chatRoutes)
  .use(userRoutes)
  .use(roleRoutes)
  .use(regionRoutes)
  .use(manDayRoleRoutes)
  .use(activityRoutes)
  .use(aiConfigRoutes)
  .use(auditRoutes)
  .use(settingsRoutes)

  .onError(({ code, error, set }) => {
    console.error(`[Elysia Error] ${code}:`, error);
    if (code === 'VALIDATION') {
      set.status = 422;
      return { error: 'Validation failed', details: error.all };
    }
    if (code === 'NOT_FOUND') {
      set.status = 404;
      return { error: 'Not found' };
    }
    set.status = 500;
    return { error: 'Internal server error', message: (error as Error).message };
  })

  .listen({ port: PORT, hostname: HOST });

console.log(`🦊 CRM API running at ${app.server?.hostname}:${app.server?.port}`);
console.log(`   CORS: ${CORS_ORIGIN}`);
console.log(`   Health: http://${HOST}:${PORT}/health`);

export type App = typeof app;
