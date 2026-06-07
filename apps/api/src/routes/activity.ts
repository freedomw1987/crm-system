// @ts-nocheck — see rbac.ts for the Elysia 1.2 + TS 5.x d.ts trade-off
/**
 * Activity + Attachment routes (Day N)
 *
 * Endpoints:
 *   GET    /activities?companyId=&dealId=&limit=
 *   POST   /activities                    (body: { companyId|dealId, type, content })
 *   DELETE /activities/:id
 *   GET    /companies/:id/attachments     (flat list across all activities)
 *   GET    /activities/:id/attachments    (single activity's attachments)
 *   POST   /activities/:id/attachments    (multipart file upload, multer-style)
 *   GET    /attachments/:id/download      (stream file, Content-Disposition: attachment)
 *   DELETE /attachments/:id
 *
 * Storage:
 *   Files land under DATA_DIR (default /app/data/uploads), keyed by a
 *   uuid + original extension. The on-disk path is NOT stored in the DB —
 *   we store the relative key and join DATA_DIR at download time so the
 *   container host can be swapped without rewriting rows.
 *
 * Authorization:
 *   Reads are open to any logged-in user (similar to /companies).
 *   Writes are also open — sales reps are expected to log their own
 *   follow-ups. Editing/deleting someone else's activity is allowed (we
 *   don't enforce "only the author" in v1; a future perms cleanup can
 *   tighten this).
 *
 * Day N hard rule: 50MB max per file. We enforce this in the multipart
 * stream AND in the nginx client_max_body_size (see infra config).
 *
 * Elysia 1.2 caveat: the authContext plugin's userId/userRole derive does
 * not reach the route handler scope (only onBeforeHandle/onAfterHandle).
 * We re-derive userId inline via getUserIdFromRequest(request) so handlers
 * can use it. The same pattern is used in middleware/rbac.ts.
 */

import { Elysia, t } from 'elysia';
import { createReadStream, existsSync } from 'fs';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { join, extname } from 'path';
import { randomUUID } from 'crypto';
import { prisma } from '@crm/db';
import { authContext } from '../lib/context';
import { logEvent } from '../middleware/audit';
import { getUserIdFromRequest } from '../middleware/rbac';

const DATA_DIR = process.env.DATA_DIR ?? '/app/data/uploads';
const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB

// Ensure DATA_DIR exists at module load. This is safe to call repeatedly;
// the mkdir with recursive:true is idempotent. We do it here (not in a
// startup hook) so the directory is ready before the first request.
mkdir(DATA_DIR, { recursive: true }).catch((err) => {
  console.error('[activity] Failed to create DATA_DIR', DATA_DIR, err);
});

/**
 * Parse a multipart/form-data request body into files + fields using a
 * hand-rolled parser. We don't depend on busboy to keep the dep list
 * short — the format is well-defined and our needs are small.
 */
async function parseMultipart(request: Request, boundary: string): Promise<{
  files: Array<{ fieldName: string; fileName: string; mimeType: string; buffer: Buffer }>;
  fields: Record<string, string>;
}> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('No body');
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_FILE_BYTES * 2) {
      throw new Error('Upload too large');
    }
    chunks.push(value);
  }
  const raw = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  const delim = Buffer.from(`--${boundary}`);
  const files: Array<{ fieldName: string; fileName: string; mimeType: string; buffer: Buffer }> = [];
  const fields: Record<string, string> = {};
  let pos = 0;
  while (pos < raw.length) {
    const partStart = raw.indexOf(delim, pos);
    if (partStart === -1) break;
    pos = partStart + delim.length;
    if (raw[pos] === 0x2d && raw[pos + 1] === 0x2d) break;
    if (raw[pos] === 0x0d && raw[pos + 1] === 0x0a) pos += 2;
    const headerEnd = raw.indexOf(Buffer.from('\r\n\r\n'), pos);
    if (headerEnd === -1) break;
    const headerText = raw.subarray(pos, headerEnd).toString('utf-8');
    pos = headerEnd + 4;
    const nextBoundary = raw.indexOf(delim, pos);
    if (nextBoundary === -1) break;
    let partEnd = nextBoundary;
    if (raw[partEnd - 2] === 0x0d && raw[partEnd - 1] === 0x0a) partEnd -= 2;
    const partBody = raw.subarray(pos, partEnd);
    const disposition = headerText.match(/Content-Disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]*)")?/i);
    const ctype = headerText.match(/Content-Type:\s*([^\r\n]+)/i);
    if (!disposition) {
      pos = nextBoundary;
      continue;
    }
    const fieldName = disposition[1];
    const fileName = disposition[2] ?? '';
    const mimeType = ctype ? ctype[1].trim() : 'application/octet-stream';
    if (fileName) {
      if (partBody.byteLength > MAX_FILE_BYTES) {
        throw new Error(`File "${fileName}" exceeds 50 MB limit`);
      }
      files.push({
        fieldName,
        fileName,
        mimeType,
        buffer: Buffer.from(partBody),
      });
    } else {
      fields[fieldName] = partBody.toString('utf-8').trim();
    }
    pos = nextBoundary;
  }
  return { files, fields };
}

export const activityRoutes = new Elysia({ prefix: '', tags: ['activities', 'attachments'] })
  .use(authContext)

  // ============================================================
  // ACTIVITY CRUD
  // ============================================================
  .get('/activities', async ({ query, set, request }) => {
    const userId = await getUserIdFromRequest(request);
    if (!userId) { set.status = 401; return { error: 'Unauthorized' }; }
    const { companyId, dealId, limit = '50', offset = '0', type } = query as {
      companyId?: string;
      dealId?: string;
      type?: string;
      limit?: string;
      offset?: string;
    };
    if (!companyId && !dealId) {
      set.status = 400;
      return { error: 'Either companyId or dealId is required' };
    }
    const where: Record<string, unknown> = {};
    if (companyId) where.companyId = companyId;
    if (dealId) where.dealId = dealId;
    if (type) where.type = type;
    const items = await prisma.activity.findMany({
      where,
      take: Number(limit),
      skip: Number(offset),
      orderBy: { createdAt: 'desc' },
      include: {
        author: { select: { id: true, name: true, email: true } },
        attachments: { select: { id: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true } },
      },
    });
    return { items, total: items.length };
  })

  .get('/activities/recent', async ({ query, set, request }) => {
    const userId = await getUserIdFromRequest(request);
    if (!userId) { set.status = 401; return { error: 'Unauthorized' }; }
    const { limit: limitRaw, authorId, since } = query as {
      limit?: string;
      /** Day N+1: filter to a single sales rep (used by the Deal Kanban
       *  pipeline-meeting view). Empty/undefined = no filter. */
      authorId?: string;
      /** Day N+1: ISO timestamp; only return activities at-or-after this
       *  instant. Lets the Kanban view limit the list to "this week" /
       *  "this month" without paging through old notes. */
      since?: string;
    };
    const limit = Math.min(Number(limitRaw ?? '10'), 50);
    // Build the where clause incrementally so undefined filters don't
    // accidentally match everything.
    const where: Record<string, unknown> = {};
    if (authorId) where.authorId = authorId;
    if (since) where.createdAt = { gte: new Date(since) };
    const items = await prisma.activity.findMany({
      where,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        author: { select: { id: true, name: true, email: true } },
        company: { select: { id: true, name: true } },
        deal: { select: { id: true, title: true } },
        attachments: { select: { id: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true } },
      },
    });
    return { items, total: items.length };
  })

  .post('/activities', async ({ body, set, request }) => {
    const userId = await getUserIdFromRequest(request);
    if (!userId) { set.status = 401; return { error: 'Unauthorized' }; }
    const data = body as {
      companyId?: string;
      dealId?: string;
      type?: 'NOTE' | 'CALL' | 'EMAIL' | 'MEETING';
      content: string;
    };
    if ((!data.companyId && !data.dealId) || (data.companyId && data.dealId)) {
      set.status = 400;
      return { error: 'Exactly one of companyId or dealId must be set' };
    }
    if (!data.content || data.content.trim().length === 0) {
      set.status = 400;
      return { error: 'content is required' };
    }
    if (data.companyId) {
      const exists = await prisma.company.findUnique({ where: { id: data.companyId }, select: { id: true } });
      if (!exists) { set.status = 404; return { error: 'Company not found' }; }
    }
    if (data.dealId) {
      const exists = await prisma.deal.findUnique({ where: { id: data.dealId }, select: { id: true } });
      if (!exists) { set.status = 404; return { error: 'Deal not found' }; }
    }
    const activity = await prisma.activity.create({
      data: {
        companyId: data.companyId ?? null,
        dealId: data.dealId ?? null,
        authorId: userId,
        type: data.type ?? 'NOTE',
        content: data.content.trim(),
      },
      include: {
        author: { select: { id: true, name: true, email: true } },
        attachments: true,
      },
    });
    await logEvent({
      actorId: userId,
      action: 'ACTIVITY_CREATED',
      resourceType: 'activity',
      resourceId: activity.id,
      description: `Logged ${activity.type} activity (${data.content.length} chars)`,
      request,
    });
    set.status = 201;
    return activity;
  }, {
    body: t.Object({
      companyId: t.Optional(t.String()),
      dealId: t.Optional(t.String()),
      type: t.Optional(t.Union([t.Literal('NOTE'), t.Literal('CALL'), t.Literal('EMAIL'), t.Literal('MEETING')])),
      content: t.String({ minLength: 1 }),
    }),
  })

  .delete('/activities/:id', async ({ params, set, request }) => {
    const userId = await getUserIdFromRequest(request);
    if (!userId) { set.status = 401; return { error: 'Unauthorized' }; }
    const before = await prisma.activity.findUnique({
      where: { id: params.id },
      include: { attachments: true },
    });
    if (!before) { set.status = 404; return { error: 'Activity not found' }; }
    await prisma.activity.delete({ where: { id: params.id } });
    for (const att of before.attachments) {
      const path = join(DATA_DIR, att.storageKey);
      try { await unlink(path); } catch { /* missing file is fine */ }
    }
    await logEvent({
      actorId: userId,
      action: 'ACTIVITY_DELETED',
      resourceType: 'activity',
      resourceId: params.id,
      description: `Deleted activity ${params.id} (and ${before.attachments.length} attachment(s))`,
      request,
    });
    return { success: true };
  })

  // ============================================================
  // ATTACHMENT: flat list per company
  // ============================================================
  .get('/companies/:id/attachments', async ({ params, query, set, request }) => {
    const userId = await getUserIdFromRequest(request);
    if (!userId) { set.status = 401; return { error: 'Unauthorized' }; }
    const limit = Math.min(Number((query as { limit?: string }).limit ?? '100'), 500);
    const activities = await prisma.activity.findMany({
      where: { companyId: params.id },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        attachments: {
          include: { uploadedBy: { select: { id: true, name: true } } },
        },
        author: { select: { id: true, name: true } },
      },
    });
    const items = activities
      .flatMap((a) => a.attachments.map((att) => ({
        id: att.id,
        fileName: att.fileName,
        mimeType: att.mimeType,
        sizeBytes: att.sizeBytes,
        createdAt: att.createdAt,
        uploadedBy: att.uploadedBy,
        activity: { id: a.id, type: a.type, content: a.content.slice(0, 120), createdAt: a.createdAt },
      })))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return { items, total: items.length };
  })

  // ============================================================
  // ATTACHMENT: per-activity list + upload
  // ============================================================
  .get('/activities/:id/attachments', async ({ params, set, request }) => {
    const userId = await getUserIdFromRequest(request);
    if (!userId) { set.status = 401; return { error: 'Unauthorized' }; }
    const items = await prisma.attachment.findMany({
      where: { activityId: params.id },
      orderBy: { createdAt: 'desc' },
      include: { uploadedBy: { select: { id: true, name: true } } },
    });
    return { items, total: items.length };
  })

  .post('/activities/:id/attachments', async ({ params, set, request }) => {
    const userId = await getUserIdFromRequest(request);
    if (!userId) { set.status = 401; return { error: 'Unauthorized' }; }
    const activity = await prisma.activity.findUnique({ where: { id: params.id } });
    if (!activity) { set.status = 404; return { error: 'Activity not found' }; }
    const ctype = request.headers.get('content-type') ?? '';
    const m = ctype.match(/^multipart\/form-data;\s*boundary=(.+)$/i);
    if (!m) {
      set.status = 400;
      return { error: 'Content-Type must be multipart/form-data with a boundary' };
    }
    const boundary = m[1].replace(/^"|"$/g, '');
    let parsed;
    try {
      parsed = await parseMultipart(request, boundary);
    } catch (err) {
      set.status = 413;
      return { error: (err as Error).message };
    }
    if (parsed.files.length === 0) {
      set.status = 400;
      return { error: 'No file provided' };
    }
    const created: unknown[] = [];
    for (const f of parsed.files) {
      const ext = extname(f.fileName) || '';
      const key = `${randomUUID()}${ext}`;
      const dest = join(DATA_DIR, key);
      await writeFile(dest, f.buffer);
      const row = await prisma.attachment.create({
        data: {
          activityId: params.id,
          fileName: f.fileName,
          mimeType: f.mimeType,
          sizeBytes: f.buffer.byteLength,
          storageKey: key,
          uploadedById: userId,
        },
      });
      await logEvent({
        actorId: userId,
        action: 'ATTACHMENT_UPLOADED',
        resourceType: 'attachment',
        resourceId: row.id,
        description: `Uploaded ${f.fileName} (${f.buffer.byteLength} bytes) to activity ${params.id}`,
        request,
      });
      created.push(row);
    }
    set.status = 201;
    return { items: created, total: created.length };
  })

  // ============================================================
  // ATTACHMENT: download + delete
  // ============================================================
  .get('/attachments/:id/download', async ({ params, set, request }) => {
    const userId = await getUserIdFromRequest(request);
    if (!userId) { set.status = 401; return { error: 'Unauthorized' }; }
    const att = await prisma.attachment.findUnique({ where: { id: params.id } });
    if (!att) { set.status = 404; return { error: 'Attachment not found' }; }
    const path = join(DATA_DIR, att.storageKey);
    if (!existsSync(path)) {
      set.status = 410;
      return { error: 'File no longer exists on disk' };
    }
    const { readFile } = await import('fs/promises');
    const buf = await readFile(path);
    set.headers = {
      'Content-Type': att.mimeType,
      'Content-Disposition': `attachment; filename="${att.fileName.replace(/"/g, '')}"`,
      'Content-Length': String(att.sizeBytes),
    };
    return new Response(buf, { status: 200 });
  })

  .delete('/attachments/:id', async ({ params, set, request }) => {
    const userId = await getUserIdFromRequest(request);
    if (!userId) { set.status = 401; return { error: 'Unauthorized' }; }
    const before = await prisma.attachment.findUnique({ where: { id: params.id } });
    if (!before) { set.status = 404; return { error: 'Attachment not found' }; }
    await prisma.attachment.delete({ where: { id: params.id } });
    const path = join(DATA_DIR, before.storageKey);
    try { await unlink(path); } catch { /* missing file is fine */ }
    await logEvent({
      actorId: userId,
      action: 'ATTACHMENT_DELETED',
      resourceType: 'attachment',
      resourceId: params.id,
      description: `Deleted attachment ${before.fileName}`,
      request,
    });
    return { success: true };
  });
