/**
 * Auth context — extract userId from JWT token
 * Used by protected routes via .use(authContext)
 */

import { Elysia } from 'elysia';

export const authContext = new Elysia({ name: 'auth-context' }).derive(
  async ({ request, jwt, set }) => {
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
  }
);
