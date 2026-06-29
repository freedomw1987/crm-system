/**
 * Auth context — extract userId from JWT token
 * Used by protected routes via .use(authContext)
 *
 * 2026-06-29 fix: `.derive({ as: 'scoped' }, ...)`. The uns-scoped
 * form silently stopped injecting `userId` into route handlers in
 * Elysia 1.4.x (we're on 1.4.29; the API package.json still says
 * `^1.2.0` but the bun.lock + installed version disagree). Symptom:
 * route handlers using `{ userId }` saw `undefined`, the auth check
 * at `if (!userId)` returned 401, and the web client's request()
 * helper on seeing 401 cleared the token + redirected to /login
 * (apps/web/src/lib/api.ts:53-59) — which is the "system logged
 * me out when I submitted a quotation" the user reported on
 * 2026-06-29. Switching to `as: 'scoped'` makes the derive run
 * for every route mounted after `.use(authContext)` again.
 *
 * The `{ as: 'scoped' }` pattern matches what `requirePermission`
 * already uses on `onBeforeHandle` (see middleware/rbac.ts:103),
 * so the scoping semantics are consistent across the two plugins.
 */

import { Elysia } from 'elysia';

export const authContext = new Elysia({ name: 'auth-context' })
  .derive({ as: 'scoped' }, async ({ request, jwt, set }) => {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      // No token = anonymous user
      return { userId: null as string | null, userRole: null as string | null };
    }
    const token = authHeader.slice(7);
    const payload = await jwt.verify(token);
    if (!payload || typeof payload !== 'object') {
      return { userId: null as string | null, userRole: null as string | null };
    }
    return {
      userId: (payload as { sub?: string }).sub ?? null,
      userRole: (payload as { role?: string }).role ?? null,
    };
  });
