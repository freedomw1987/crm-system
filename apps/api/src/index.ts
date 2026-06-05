/**
 * CRM System API Entry Point
 *
 * Stack: Bun + Elysia + Prisma
 * Day 1: Health check + AI Agent chat endpoint
 */

import { Elysia, t } from 'elysia';
import { cors } from '@elysiajs/cors';
import { jwt } from '@elysiajs/jwt';
import { prisma } from '@crm/db';
import { runAgent } from '@crm/ai';
import { getUserContext } from './lib/context';
import { authRoutes } from './routes/auth';
import { companyRoutes } from './routes/company';
import { contactRoutes } from './routes/contact';
import { productRoutes } from './routes/product';
import { quotationRoutes } from './routes/quotation';
import { dealRoutes } from './routes/deal';
import { chatRoutes } from './routes/chat';

const PORT = Number(process.env.API_PORT ?? 3001);
const HOST = process.env.API_HOST ?? '0.0.0.0';
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:5173';

const app = new Elysia()
  // CORS for frontend
  .use(
    cors({
      origin: CORS_ORIGIN.split(',').map((s) => s.trim()),
      credentials: true,
    })
  )

  // JWT auth
  .use(
    jwt({
      name: 'jwt',
      secret: process.env.JWT_SECRET ?? 'dev-only-secret-please-change',
    })
  )

  // Health check
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

  // Routes
  .use(authRoutes)
  .use(companyRoutes)
  .use(contactRoutes)
  .use(productRoutes)
  .use(quotationRoutes)
  .use(dealRoutes)
  .use(chatRoutes)

  // Error handler
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
