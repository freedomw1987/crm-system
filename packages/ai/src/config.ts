/**
 * AI Configuration loader.
 *
 * Per David's T2 spec: the LLM endpoint URL / api key / model name are
 * configured by an admin via /admin/ai-config (stored in the AiConfig
 * table) and NEVER fall back to environment variables. This makes the
 * AI Assistant's external dependency fully admin-controlled and
 * observable (you can rotate the key from the UI without redeploying).
 *
 * Loading strategy:
 * - We cache the config in-process with a short TTL (default 30s) so
 *   that we don't hit Postgres on every chat turn. A 30s window is
 *   short enough that a key rotation propagates almost immediately,
 *   and long enough to avoid hammering the DB during a long agent
 *   loop that may call the LLM 5-10 times in a row.
 * - The cache is per-process — in a multi-instance deployment, each
 *   instance will refresh on its own schedule. That's fine.
 *
 * Singleton invariant:
 * - AiConfig is a singleton (id=1). The first admin PUT creates the row;
 *   subsequent PUTs update it. If the row doesn't exist, getAiConfig()
 *   returns null and the chat route returns 503.
 */

import { prisma } from '@crm/db';
import { decryptSecret } from './encryption';

export interface ResolvedAiConfig {
  endpointUrl: string;
  apiKey: string;
  modelName: string;
  systemPrompt: string | null;
  updatedAt: Date;
}

let cached: { value: ResolvedAiConfig; expiresAt: number } | null = null;
const TTL_MS = 30_000;

export async function getAiConfig(): Promise<ResolvedAiConfig | null> {
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  const row = await prisma.aiConfig.findUnique({ where: { id: 1 } });
  if (!row) {
    cached = null;
    return null;
  }
  const resolved: ResolvedAiConfig = {
    endpointUrl: row.endpointUrl,
    apiKey: decryptSecret(row.apiKeyCipher),
    modelName: row.modelName,
    systemPrompt: row.systemPrompt,
    updatedAt: row.updatedAt,
  };
  cached = { value: resolved, expiresAt: Date.now() + TTL_MS };
  return resolved;
}

/** Invalidate the in-process cache (call after admin updates the config). */
export function invalidateAiConfigCache(): void {
  cached = null;
}
