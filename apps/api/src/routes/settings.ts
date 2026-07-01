import { Elysia, t } from 'elysia';
import { prisma } from '@crm/db';
import { getCurrencyConfig } from '@crm/db';
import { getUserIdFromRequest, requirePermission } from '../middleware/rbac';
import { logEvent } from '../middleware/audit';

// ===================================================================
// P2 multi-currency (2026-06-29): Default currency + exchange rates
// ===================================================================
// Mirrors the /settings/tax pattern. The system_config row holds a
// JSON object:
//
//   { default: 'RMB' | 'HKD' | 'MOP',
//     rates:   { 'RMB->HKD': number, 'RMB->MOP': number } }
//
// The two rates are multipliers (1 RMB = X foreign). MOP→HKD is
// derived at save time as (RMB->HKD / RMB->MOP) so the admin only
// sets two rates. See packages/db/prisma/seed.ts for the seeded
// defaults.
//
// Helpers `getCurrencyConfig` / `hkdRateFor` / `resolveCurrencySnapshot`
// live in @crm/db (see packages/db/src/currency.ts) so the Quotation
// route + the AI agent's draft_quotation tool share one source of
// truth. We re-export them here for any older import sites that
// already pull from this module.
// v1 reads from the DB on every call (saves are not hot-path). If
// rate lookups ever become hot, swap the body of `getCurrencyConfig`
// for a process-level cache with TTL + bust-on-write — callers don't
// need to change.

export {
  getCurrencyConfig,
  hkdRateFor,
  resolveCurrencySnapshot,
  type CurrencyCode,
  type CurrencyConfig,
} from '@crm/db';

/**
 * Settings — Day 11
 *
 * Phase 1: Pipeline settings (read all users, update admin only).
 *
 * Routes:
 *   GET    /settings/pipelines          — list pipelines + stages (settings:read)
 *   POST   /settings/pipelines/stages   — create stage in default pipeline (settings:update, admin)
 *   PATCH  /settings/pipelines/stages/:id — update stage (settings:update, admin)
 *   DELETE /settings/pipelines/stages/:id — delete stage (settings:update, admin) — blocked if any active deal
 *
 * Phase 2 (deferred): /settings/system-configs for global tax rate etc.
 *
 * P2 multi-currency (2026-06-29) added:
 *   GET    /settings/currency          — any authed user (mirrors /tax)
 *   PUT    /settings/currency          — admin (settings:update)
 */

export const settingsRoutes = new Elysia({ prefix: '/settings', tags: ['settings'] })
  // GET /settings/pipelines — list all pipelines + their stages, ordered by stage position
  // Used by the AI assistant tool `list_pipelines` and the Settings page Pipeline tab.
  .get(
    '/pipelines',
    async () => {
      const pipelines = await prisma.pipeline.findMany({
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        include: {
          stages: {
            orderBy: { position: 'asc' },
            include: {
              _count: { select: { deals: true } },
            },
          },
        },
      });
      return pipelines;
    },
    { detail: { summary: 'List pipelines with stages' } }
  )

  // POST /settings/pipelines/stages — create a new stage in the default pipeline
  // Admin only. Position is auto-assigned as max(position) + 1 within the pipeline.
  .use(requirePermission('settings:update'))
  .post(
    '/pipelines/stages',
    async ({ body, set, request }) => {
      const userId = await getUserIdFromRequest(request);
      if (!userId) {
        set.status = 401;
        return { error: 'Unauthorized' };
      }

      const { name, probability, color, pipelineId } = body as {
        name: string;
        probability?: number;
        color?: string;
        pipelineId?: string;
      };

      // 1) Resolve target pipeline (default if not specified)
      const pipeline = pipelineId
        ? await prisma.pipeline.findUnique({ where: { id: pipelineId } })
        : await prisma.pipeline.findFirst({ where: { isDefault: true } });
      if (!pipeline) {
        set.status = 404;
        return { error: 'Pipeline not found' };
      }

      // 2) Compute next position
      const lastStage = await prisma.pipelineStage.findFirst({
        where: { pipelineId: pipeline.id },
        orderBy: { position: 'desc' },
        select: { position: true },
      });
      const nextPosition = (lastStage?.position ?? -1) + 1;

      const stage = await prisma.pipelineStage.create({
        data: {
          pipelineId: pipeline.id,
          name,
          position: nextPosition,
          probability: probability ?? 0,
          color: color ?? null,
        },
      });

      await logEvent({
        userId,
        action: 'CREATE',
        entity: 'PipelineStage',
        entityId: stage.id,
        description: `Created stage "${name}" in pipeline "${pipeline.name}" (position ${nextPosition})`,
        request,
      });

      return stage;
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 100 }),
        probability: t.Optional(t.Number({ minimum: 0, maximum: 100 })),
        color: t.Optional(t.String({ maxLength: 20 })),
        pipelineId: t.Optional(t.String()),
      }),
    }
  )

  // PATCH /settings/pipelines/stages/:id — update name / probability / color / position
  // Admin only. Position reorders must be unique within a pipeline (DB constraint).
  .patch(
    '/pipelines/stages/:id',
    async ({ params, body, set, request }) => {
      const userId = await getUserIdFromRequest(request);
      if (!userId) {
        set.status = 401;
        return { error: 'Unauthorized' };
      }

      const { id } = params;
      const existing = await prisma.pipelineStage.findUnique({ where: { id } });
      if (!existing) {
        set.status = 404;
        return { error: 'Stage not found' };
      }

      const updates = body as {
        name?: string;
        probability?: number;
        color?: string | null;
        position?: number;
      };

      // If position changed, swap with the stage currently at that position
      // (DB has @@unique([pipelineId, position]) so naive update would clash).
      if (
        typeof updates.position === 'number' &&
        updates.position !== existing.position
      ) {
        const occupant = await prisma.pipelineStage.findUnique({
          where: {
            pipelineId_position: {
              pipelineId: existing.pipelineId,
              position: updates.position,
            },
          },
        });
        if (occupant) {
          await prisma.pipelineStage.update({
            where: { id: occupant.id },
            data: { position: existing.position },
          });
        }
      }

      const stage = await prisma.pipelineStage.update({
        where: { id },
        data: {
          ...(updates.name !== undefined && { name: updates.name }),
          ...(updates.probability !== undefined && { probability: updates.probability }),
          ...(updates.color !== undefined && { color: updates.color }),
          ...(updates.position !== undefined && { position: updates.position }),
        },
      });

      await logEvent({
        userId,
        action: 'UPDATE',
        entity: 'PipelineStage',
        entityId: stage.id,
        description: `Updated stage "${stage.name}" (position ${stage.position}, probability ${stage.probability}%)`,
        request,
      });

      return stage;
    },
    {
      body: t.Partial(
        t.Object({
          name: t.String({ minLength: 1, maxLength: 100 }),
          probability: t.Number({ minimum: 0, maximum: 100 }),
          color: t.Union([t.String({ maxLength: 20 }), t.Null()]),
          position: t.Number({ minimum: 0 }),
        })
      ),
    }
  )

  // DELETE /settings/pipelines/stages/:id — delete a stage
  // Admin only. Blocked if any deal currently uses this stage (must reassign first).
  .delete(
    '/pipelines/stages/:id',
    async ({ params, set, request }) => {
      const userId = await getUserIdFromRequest(request);
      if (!userId) {
        set.status = 401;
        return { error: 'Unauthorized' };
      }

      const { id } = params;
      const existing = await prisma.pipelineStage.findUnique({
        where: { id },
        include: { _count: { select: { deals: true } } },
      });
      if (!existing) {
        set.status = 404;
        return { error: 'Stage not found' };
      }

      if (existing._count.deals > 0) {
        set.status = 409;
        return {
          error: 'Stage has active deals',
          dealCount: existing._count.deals,
          message: `Stage "${existing.name}" has ${existing._count.deals} active deal(s). Reassign them to another stage before deleting.`,
        };
      }

      await prisma.pipelineStage.delete({ where: { id } });

      await logEvent({
        userId,
        action: 'DELETE',
        entity: 'PipelineStage',
        entityId: id,
        description: `Deleted stage "${existing.name}"`,
        request,
      });

      return { ok: true };
    }
  )

  // ===================================================================
  // Day 14: System Configuration — Tax Rate
  // ===================================================================
  // Phase 2 of the Settings page. We use a generic key-value SystemConfig
  // table (model added in migration 20260607000000_day14_system_config) so
  // future settings (default currency, default pipeline colour, etc.) can
  // reuse the same endpoints.
  //
  // Quotation builder reads GET /settings/tax at open time to pre-fill the
  // tax rate input. Per-quotation override remains available (existing
  // snapshot pattern); changing the system value does NOT rewrite historical
  // quotations (per David 2026-06-07 plan, option A).
  //
  // GET   /settings/tax     — read current default tax rate (any authed user)
  // PUT   /settings/tax     — admin sets a new rate (settings:update)

  // GET /settings/tax — available to any logged-in user so the quotation
  // builder can pre-fill. We do NOT require settings:read here on purpose;
  // a SALES rep who can already see /quotations obviously needs to know
  // the default tax rate for new quotes.
  .get(
    '/tax',
    async ({ set }) => {
      const row = await prisma.systemConfig.findUnique({
        where: { key: 'default_tax_rate' },
        include: { updatedBy: { select: { id: true, name: true, email: true } } },
      });
      if (!row) {
        // Seed should have created it; if missing, treat as 0 and 200
        // (graceful degradation — admin will see the seeded default on
        // first visit anyway).
        return { key: 'default_tax_rate', rate: 0, updatedAt: null, updatedBy: null };
      }
      // value is a JSON number (seed = 0). Normalise to number.
      const rate = typeof row.value === 'number'
        ? row.value
        : Number((row.value as unknown) ?? 0);
      return {
        key: row.key,
        rate,
        description: row.description,
        updatedAt: row.updatedAt,
        updatedBy: row.updatedBy,
      };
    },
    { detail: { summary: 'Get default tax rate' } }
  )

  // PUT /settings/tax — admin only. Audit logs the before/after diff.
  .use(requirePermission('settings:update'))
  .put(
    '/tax',
    async ({ body, set, request }) => {
      const userId = await getUserIdFromRequest(request);
      if (!userId) {
        set.status = 401;
        return { error: 'Unauthorized' };
      }

      const { rate } = body as { rate: number };
      const oldRow = await prisma.systemConfig.findUnique({
        where: { key: 'default_tax_rate' },
        select: { value: true },
      });
      const oldRate = oldRow ? Number((oldRow.value as unknown) ?? 0) : 0;

      const updated = await prisma.systemConfig.upsert({
        where: { key: 'default_tax_rate' },
        update: { value: rate, updatedById: userId },
        create: {
          key: 'default_tax_rate',
          value: rate,
          updatedById: userId,
          description: 'Default tax rate (%) applied to NEW quotations. Per-quotation override available; existing quotations keep their snapshot.',
        },
        include: { updatedBy: { select: { id: true, name: true, email: true } } },
      });

      await logEvent({
        actorId: userId,
        action: 'SYSTEM_CONFIG_UPDATED',
        resourceType: 'system_config',
        resourceId: 'default_tax_rate',
        description: `Updated default tax rate: ${oldRate}% → ${rate}%`,
        metadata: { key: 'default_tax_rate', oldValue: oldRate, newValue: rate },
        request,
      });

      return {
        key: updated.key,
        rate: Number((updated.value as unknown) ?? 0),
        description: updated.description,
        updatedAt: updated.updatedAt,
        updatedBy: updated.updatedBy,
      };
    },
    {
      body: t.Object({
        rate: t.Number({ minimum: 0, maximum: 100 }),
      }),
    }
  )

  // ===================================================================
  // 2026-07-01 (US-MAINT-1): GET /settings/maintenance-fee
  // ===================================================================
  // Mirrors /settings/tax: any authed user can read the rate so the
  // Quotation builder can pre-fill the "+ 維護費用" button without
  // a permission roundtrip. Rate is stored as a JSON number in
  // [0, 1] (e.g. 0.20 = 20%); the PUT handler enforces the range.
  .get(
    '/maintenance-fee',
    async ({ set }) => {
      const row = await prisma.systemConfig.findUnique({
        where: { key: 'maintenance_fee_rate' },
        include: { updatedBy: { select: { id: true, name: true, email: true } } },
      });
      if (!row) {
        // Seed should have created it. Graceful degrade to the
        // documented default (20%) so the UI doesn't 500 on first
        // visit before the seed runs.
        return {
          key: 'maintenance_fee_rate',
          rate: 20,
          description: 'Maintenance Service rate as a percentage (project subtotal × rate / 100). Default 20 = 20%.',
          updatedAt: null,
          updatedBy: null,
        };
      }
      const rate = typeof row.value === 'number'
        ? row.value
        : Number((row.value as unknown) ?? 20);
      return {
        key: row.key,
        rate,
        description: row.description,
        updatedAt: row.updatedAt,
        updatedBy: row.updatedBy,
      };
    },
    { detail: { summary: 'Get Maintenance Service rate' } }
  )

  // PUT /settings/maintenance-fee — admin only. Range 0..100 (0% to
  // 100%); rejected outside this range. Audit logs the before/after
  // diff so admins can trace historical rate changes (e.g. a
  // Quotation that was created at 0.20 then changed to 0.25 still
  // shows the original 0.20 because each Quotation snapshots its
  // maintenance-service line at "+ 維護費用" button press time).
  .use(requirePermission('settings:update'))
  .put(
    '/maintenance-fee',
    async ({ body, set, request }) => {
      const userId = await getUserIdFromRequest(request);
      if (!userId) {
        set.status = 401;
        return { error: 'Unauthorized' };
      }

      const { rate } = body as { rate: number };
      const oldRow = await prisma.systemConfig.findUnique({
        where: { key: 'maintenance_fee_rate' },
        select: { value: true },
      });
      const oldRate = oldRow ? Number((oldRow.value as unknown) ?? 20) : 20;

      const updated = await prisma.systemConfig.upsert({
        where: { key: 'maintenance_fee_rate' },
        update: {
          value: rate,
          updatedById: userId,
          // 2026-07-01: include `description` in the update
          // clause so existing rows get the new wording (e.g.
          // after a rename). Without this, the description
          // would be permanently frozen at the value the seed
          // wrote at first run.
          description: 'Maintenance Service rate as a percentage (project subtotal × rate / 100). Default 20 = 20%.',
        },
        create: {
          key: 'maintenance_fee_rate',
          value: rate,
          updatedById: userId,
          description: 'Maintenance Service rate as a percentage (project subtotal × rate / 100). Default 20 = 20%.',
        },
        include: { updatedBy: { select: { id: true, name: true, email: true } } },
      });

      await logEvent({
        actorId: userId,
        action: 'SYSTEM_CONFIG_UPDATED',
        resourceType: 'system_config',
        resourceId: 'maintenance_fee_rate',
        // 2026-07-01 rename: 維修費用 → 維護費用 (Maintenance Fee →
        // Maintenance Service) per user request. The SystemConfig
        // key `maintenance_fee_rate` keeps its legacy identifier
        // so we don't break the stored DB row.
        description: `Updated Maintenance Service rate: ${oldRate.toFixed(2)}% → ${rate.toFixed(2)}%`,
        metadata: { key: 'maintenance_fee_rate', oldValue: oldRate, newValue: rate },
        request,
      });

      return {
        key: updated.key,
        rate: Number((updated.value as unknown) ?? 0),
        description: updated.description,
        updatedAt: updated.updatedAt,
        updatedBy: updated.updatedBy,
      };
    },
    {
      body: t.Object({
        // Stored as a percentage number (0..100) so the admin input
        // is intuitive ("20" = 20%); the Quotation builder divides
        // by 100 when computing the line item amount
        // (`subtotal * rate / 100`). Mirrors the default_tax_rate
        // pattern.
        rate: t.Number({ minimum: 0, maximum: 100 }),
      }),
    }
  )

  // ===================================================================
  // P2 multi-currency: GET /settings/currency
  // ===================================================================
  // Any authed user (no permission gate), mirrors getTax so the
  // quotation builder can pre-fill without a separate permission
  // roundtrip. Returns the full SystemConfig row (default, rates,
  // description, updatedAt, updatedBy) so the UI can show the
  // "last updated by" footer like the tax page does.
  .get(
    '/currency',
    async ({ set }) => {
      const row = await prisma.systemConfig.findUnique({
        where: { key: 'currency_config' },
        include: { updatedBy: { select: { id: true, name: true, email: true } } },
      });
      const cfg = await getCurrencyConfig();
      if (!row) {
        // Seed should have created it. Graceful degrade: return
        // the hard-coded defaults so the UI doesn't blow up.
        return {
          key: 'currency_config',
          default: cfg.default,
          rates: cfg.rates,
          description: null,
          updatedAt: null,
          updatedBy: null,
        };
      }
      return {
        key: row.key,
        default: cfg.default,
        rates: cfg.rates,
        description: row.description,
        updatedAt: row.updatedAt,
        updatedBy: row.updatedBy,
      };
    },
    { detail: { summary: 'Get default currency + exchange rates' } }
  )

  // ===================================================================
  // P2 multi-currency: PUT /settings/currency
  // ===================================================================
  // Admin only. Mirrors putTax. Audit row includes the before/after
  // diff in metadata so the audit-log page can show what changed.
  // The currency config is a single object, so we store both old
  // and new as the whole JSON payload (matches the default_tax_rate
  // pattern of { key, oldValue, newValue }).
  .use(requirePermission('settings:update'))
  .put(
    '/currency',
    async ({ body, set, request }) => {
      const userId = await getUserIdFromRequest(request);
      if (!userId) {
        set.status = 401;
        return { error: 'Unauthorized' };
      }

      const { default: newDefault, rates: newRates } = body as {
        default: 'RMB' | 'HKD' | 'MOP';
        rates: { 'RMB->HKD': number; 'RMB->MOP': number };
      };

      const oldCfg = await getCurrencyConfig();

      const updated = await prisma.systemConfig.upsert({
        where: { key: 'currency_config' },
        update: {
          // Store as a plain JSON object — Prisma's Json column
          // serializes native objects.
          value: { default: newDefault, rates: newRates },
          updatedById: userId,
        },
        create: {
          key: 'currency_config',
          value: { default: newDefault, rates: newRates },
          updatedById: userId,
          description: 'Default currency + RMB-anchored exchange rates used by Quotation. RMB→HKD and RMB→MOP are required; non-RMB currencies derive their HKD rate as RMB→HKD / RMB→<that>.',
        },
        include: { updatedBy: { select: { id: true, name: true, email: true } } },
      });

      await logEvent({
        actorId: userId,
        action: 'SYSTEM_CONFIG_UPDATED',
        resourceType: 'system_config',
        resourceId: 'currency_config',
        description: `Updated currency config: default ${oldCfg.default} → ${newDefault}; rates RMB→HKD ${oldCfg.rates['RMB->HKD']} → ${newRates['RMB->HKD']}, RMB→MOP ${oldCfg.rates['RMB->MOP']} → ${newRates['RMB->MOP']}`,
        metadata: {
          key: 'currency_config',
          oldValue: { default: oldCfg.default, rates: oldCfg.rates },
          newValue: { default: newDefault, rates: newRates },
        },
        request,
      });

      return {
        key: updated.key,
        default: newDefault,
        rates: newRates,
        description: updated.description,
        updatedAt: updated.updatedAt,
        updatedBy: updated.updatedBy,
      };
    },
    {
      body: t.Object({
        default: t.UnionEnum(['RMB', 'HKD', 'MOP']),
        rates: t.Object({
          // exclusiveMinimum: 0 = "value must be > 0" (TypeBox
          // treats it as a numeric bound, not a boolean).
          'RMB->HKD': t.Number({ minimum: 0, exclusiveMinimum: 0 }),
          'RMB->MOP': t.Number({ minimum: 0, exclusiveMinimum: 0 }),
        }),
      }),
    }
  );
