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
  );
