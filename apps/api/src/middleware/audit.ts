/**
 * Audit logger
 *
 * `logEvent()` writes a row to the `audit_logs` table capturing who did what
 * to which resource, with request context (IP, user agent). It never throws —
 * audit failures are logged to stderr but do not break the user-facing request.
 */

import { prisma } from '@crm/db';
import { AuditAction } from '@prisma/client';

export interface AuditEvent {
  actorId: string | null;
  action: AuditAction;
  resourceType?: string;
  resourceId?: string;
  description?: string;
  metadata?: unknown;
  request?: Request;
}

export async function logEvent(evt: AuditEvent): Promise<void> {
  const ipAddress = evt.request?.headers.get('x-forwarded-for')?.split(',')[0].trim()
    ?? evt.request?.headers.get('x-real-ip')
    ?? undefined;
  const userAgent = evt.request?.headers.get('user-agent') ?? undefined;

  try {
    await prisma.auditLog.create({
      data: {
        actorId: evt.actorId,
        action: evt.action,
        resourceType: evt.resourceType,
        resourceId: evt.resourceId,
        description: evt.description,
        metadata: evt.metadata === undefined ? undefined : (evt.metadata as object),
        ipAddress: ipAddress ?? null,
        userAgent: userAgent ?? null,
      },
    });
  } catch (err) {
    // Audit must never break the user-facing request
    console.error('[audit] failed to log event:', evt.action, err);
  }
}
