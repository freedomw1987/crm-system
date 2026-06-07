import { Elysia, t } from 'elysia';
import { prisma } from '@crm/db';
import { getUserIdFromRequest, requirePermission } from '../middleware/rbac';
import { logEvent } from '../middleware/audit';

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
  );
