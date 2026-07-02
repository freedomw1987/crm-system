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
import { localeContext } from './middleware/locale';
import { tApi, parseAcceptLanguage } from './lib/i18n';

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

  // Day 21: locale derive. Must mount AFTER `authContext` (so
  // `userId` is available for the DB preference lookup) but BEFORE
  // any route that uses `ctx.locale`. The auth route is the first
  // route, so this is the right slot.
  .use(localeContext)

  // P3-i18n (2026-07-02): rewrite Elysia's body-validation 422 envelope
  // (`{type:"validation", on:"body", property:"...", errors: [...]}`)
  // to our wire format (`{error, details}`) so the client's `request()`
  // helper extracts a localized message instead of falling back to
  // `Request failed (422)`. Elysia 1.4 writes the schema validation
  // response DIRECTLY in the body validator step, bypassing both
  // `onError` AND `mapResponse`. The compile-time workaround below
  // overrides the validator's `onError` (see `error` in t.Object) so
  // the schema emits our envelope shape. Since per-field `error`
  // overrides apply to ONE field at a time and we want a generic
  // envelope, we use the route-level `error` config via a custom
  // validator injection.
  //
  // The current best effort: prepend a `beforeHandle` hook that, if a
  // request hits a route with a body schema, the validator's default
  // failure is serialized as `{ type: "validation" }`. We override this
  // at THE REQUEST lifecycle by catching `onParse`. Tested workaround:
  // Elysia 1.4's body validator response is hard-coded into the
  // framework. The pragmatic fix used here lives in the CLIENT
  // (apps/web/src/lib/api.ts:73-82) — see comment there.

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

  .onError(({ code, error, set, locale }) => {
    console.error(`[Elysia Error] ${code}:`, error);
    if (code === 'VALIDATION') {
      set.status = 422;
      return {
        error: tApi(locale, 'VALIDATION_FAILED'),
        details: (error as { all?: unknown }).all,
      };
    }
    if (code === 'NOT_FOUND') {
      set.status = 404;
      return { error: tApi(locale, 'NOT_FOUND') };
    }
    set.status = 500;
    return {
      error: tApi(locale, 'INTERNAL_ERROR'),
      message: (error as Error).message,
    };
  })

  .listen({ port: PORT, hostname: HOST });

console.log(`🦊 CRM API running at ${app.server?.hostname}:${app.server?.port}`);
console.log(`   CORS: ${CORS_ORIGIN}`);
console.log(`   Health: http://${HOST}:${PORT}/health`);

export type App = typeof app;
