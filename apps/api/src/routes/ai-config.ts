/**
 * AI Configuration API (Day 10+)
 *
 * Exposes a single singleton row (AiConfig, id=1) so an admin can
 * configure the external LLM provider (endpoint URL, API key, model
 * name) from the UI. The api key is stored encrypted at rest using
 * AES-256-GCM keyed off `AI_CONFIG_ENCRYPTION_KEY`.
 *
 * Endpoints:
 *   GET  /ai/config        — return config (api key masked). Admin only.
 *   PUT  /ai/config        — create or update config. Admin only.
 *   POST /ai/config/test   — verify connectivity. Admin only.
 *   GET  /ai/config/status — return "configured" / "not-configured" so the
 *                            chat page can show a "go set it up" banner
 *                            even before the user has read permission.
 *
 * Security notes:
 * - The api key is NEVER returned in plaintext. The GET endpoint returns
 *   a masked version (`sk-...1234`) and a `hasApiKey: boolean` flag.
 * - When the admin edits the config, they must re-enter the api key
 *   (the field is always presented as a password input and never
 *   pre-filled) to avoid accidental key leakage through dev tools.
 * - All config changes are written to the audit log with the actor and
 *   a redacted description ("endpoint updated", "model changed", etc.).
 * - The /test endpoint probes the LLM with a 1-token completion
 *   request via plain fetch (no OpenAI SDK import here — we don't want
 *   the api package to pull in the OpenAI SDK as a transitive dep;
 *   the SDK is bundled with @crm/ai).
 */

import { Elysia, t } from 'elysia';
import { prisma } from '@crm/db';
import { encryptSecret, maskApiKey, invalidateAiConfigCache, decryptSecret } from '@crm/ai';
import { getUserIdFromRequest, requirePermission } from '../middleware/rbac';
import { logEvent } from '../middleware/audit';

// Validate that a URL is at least well-formed. We don't enforce
// https here because dev/test deployments may use http://localhost.
function isValidEndpointUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export const aiConfigRoutes = new Elysia({ prefix: '/ai/config', tags: ['ai-config'] })
  // ----------------------------------------------------------------
  // GET /ai/config/status — lightweight check (any authenticated user)
  // Used by the chat page to decide whether to show a "go configure"
  // banner. Intentionally does NOT require ai-config:read permission.
  // ----------------------------------------------------------------
  .get('/status', async ({ request }) => {
    const userId = await getUserIdFromRequest(request);
    if (!userId) return { configured: false, reason: 'unauthenticated' };
    const row = await prisma.aiConfig.findUnique({
      where: { id: 1 },
      select: { endpointUrl: true, modelName: true, updatedAt: true },
    });
    if (!row) return { configured: false };
    return { configured: true, modelName: row.modelName, updatedAt: row.updatedAt };
  })

  // ----------------------------------------------------------------
  // GET /ai/config — full read (admin only)
  // ----------------------------------------------------------------
  .get(
    '/',
    async ({ request, set }) => {
      const userId = await getUserIdFromRequest(request);
      if (!userId) {
        set.status = 401;
        return { error: 'Unauthorized' };
      }
      const allowed = await import('../middleware/rbac').then((m) =>
        m.userHasPermission(userId, 'ai-config:read')
      );
      if (!allowed) {
        set.status = 403;
        return { error: "Forbidden: missing permission 'ai-config:read'" };
      }

      const row = await prisma.aiConfig.findUnique({ where: { id: 1 } });
      if (!row) {
        // Not configured — return an empty shape so the admin form has
        // sensible defaults to render (model name = 'gpt-4o' is a
        // common OpenAI default; admin will overwrite it anyway).
        return {
          configured: false,
          endpointUrl: '',
          apiKeyMasked: '',
          hasApiKey: false,
          modelName: '',
          systemPrompt: '',
          updatedAt: null,
          updatedByName: null,
        };
      }
      // Decrypt just to compute the mask — we never return the cipher
      // OR the plaintext over the wire.
      const { decryptSecret } = await import('@crm/ai');
      let masked = '';
      try {
        masked = maskApiKey(decryptSecret(row.apiKeyCipher));
      } catch {
        masked = '(decryption failed)';
      }
      const updater = row.updatedById
        ? await prisma.user.findUnique({
            where: { id: row.updatedById },
            select: { name: true, email: true },
          })
        : null;
      return {
        configured: true,
        endpointUrl: row.endpointUrl,
        apiKeyMasked: masked,
        hasApiKey: true,
        modelName: row.modelName,
        systemPrompt: row.systemPrompt ?? '',
        updatedAt: row.updatedAt,
        updatedByName: updater?.name ?? null,
      };
    },
  )

  // ----------------------------------------------------------------
  // PUT /ai/config — upsert (admin only)
  // Body: { endpointUrl, apiKey, modelName, systemPrompt? }
  // apiKey is required on every PUT — we never persist the existing
  // key on partial updates (avoids accidental key loss through
  // "I just changed the model name" requests).
  // ----------------------------------------------------------------
  .put(
    '/',
    async ({ request, body, set }) => {
      const userId = await getUserIdFromRequest(request);
      if (!userId) {
        set.status = 401;
        return { error: 'Unauthorized' };
      }
      const allowed = await import('../middleware/rbac').then((m) =>
        m.userHasPermission(userId, 'ai-config:update')
      );
      if (!allowed) {
        set.status = 403;
        return { error: "Forbidden: missing permission 'ai-config:update'" };
      }

      const { endpointUrl, apiKey, modelName, systemPrompt } = body as {
        endpointUrl: string;
        apiKey: string;
        modelName: string;
        systemPrompt?: string | null;
      };

      if (!endpointUrl || !isValidEndpointUrl(endpointUrl)) {
        set.status = 422;
        return { error: 'endpointUrl must be a valid http(s) URL' };
      }
      if (!apiKey || apiKey.length < 8) {
        set.status = 422;
        return { error: 'apiKey must be at least 8 characters' };
      }
      if (!modelName || !modelName.trim()) {
        set.status = 422;
        return { error: 'modelName is required' };
      }

      const apiKeyCipher = encryptSecret(apiKey);

      const updated = await prisma.aiConfig.upsert({
        where: { id: 1 },
        create: {
          id: 1,
          endpointUrl,
          apiKeyCipher,
          modelName: modelName.trim(),
          systemPrompt: systemPrompt?.trim() || null,
          updatedById: userId,
        },
        update: {
          endpointUrl,
          apiKeyCipher,
          modelName: modelName.trim(),
          systemPrompt: systemPrompt?.trim() || null,
          updatedById: userId,
        },
      });

      // Drop the in-process cache so the next chat turn picks up the
      // new key/model/endpoint immediately.
      invalidateAiConfigCache();

      // Audit log
      await logEvent({
        actorId: userId,
        action: 'AI_CONFIG_UPDATED',
        resourceType: 'ai_config',
        resourceId: String(updated.id),
        description: `endpoint=${endpointUrl}, model=${modelName}`,
      });

      return { success: true, updatedAt: updated.updatedAt };
    },
    {
      body: t.Object({
        endpointUrl: t.String(),
        apiKey: t.String(),
        modelName: t.String(),
        systemPrompt: t.Optional(t.Union([t.String(), t.Null()])),
      }),
    },
  )

  // ----------------------------------------------------------------
  // POST /ai/config/test — verify connectivity to the LLM endpoint
  // Body: { endpointUrl, modelName, apiKey? }
  // If apiKey is omitted (or '__use_saved__'), we read the saved key
  // from the singleton row. This lets the admin test the live config
  // without re-typing the key, and lets them test a candidate config
  // before saving by typing a new key.
  // ----------------------------------------------------------------
  .post(
    '/test',
    async ({ request, body, set }) => {
      const userId = await getUserIdFromRequest(request);
      if (!userId) {
        set.status = 401;
        return { error: 'Unauthorized' };
      }
      const allowed = await import('../middleware/rbac').then((m) =>
        m.userHasPermission(userId, 'ai-config:update')
      );
      if (!allowed) {
        set.status = 403;
        return { error: "Forbidden: missing permission 'ai-config:update'" };
      }

      const { endpointUrl, modelName, apiKey } = body as {
        endpointUrl: string;
        modelName: string;
        apiKey?: string;
      };

      if (!endpointUrl || !isValidEndpointUrl(endpointUrl)) {
        set.status = 422;
        return { error: 'endpointUrl must be a valid http(s) URL' };
      }
      if (!modelName?.trim()) {
        set.status = 422;
        return { error: 'modelName is required' };
      }

      let keyToUse = apiKey;
      if (!keyToUse || keyToUse === '__use_saved__') {
        const row = await prisma.aiConfig.findUnique({ where: { id: 1 } });
        if (!row) {
          return { ok: false, error: 'No saved config and no apiKey provided' };
        }
        keyToUse = decryptSecret(row.apiKeyCipher);
      }

      try {
        // Minimal probe: 1 token completion via plain fetch. We don't
        // import the OpenAI SDK here — keeping the api package lean —
        // and any OpenAI-compatible endpoint accepts this shape.
        const url = endpointUrl.replace(/\/+$/, '') + '/chat/completions';
        const r = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${keyToUse}`,
          },
          body: JSON.stringify({
            model: modelName,
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: 1,
          }),
        });
        if (!r.ok) {
          const body = await r.text();
          return { ok: false, error: `HTTP ${r.status}: ${body.slice(0, 200)}` };
        }
        const body = (await r.json()) as { model?: string };
        return { ok: true, message: `Endpoint reachable. model=${body.model ?? modelName}` };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
    {
      body: t.Object({
        endpointUrl: t.String(),
        modelName: t.String(),
        apiKey: t.Optional(t.String()),
      }),
    },
  );
