/**
 * `<StatusBadge>` — single source of truth for status chips across the
 * UI. Replaces the four near-identical `QuotationStatusBadge` /
 * `StatusBadge` helpers that previously lived in `pages/quotations.tsx`,
 * `pages/dashboard.tsx`, `pages/deal-detail.tsx`, and the deal pages.
 *
 * Why one place:
 *   - All four had the same `Record<STATUS, BadgeVariant>` map; drift
 *     between them meant the same DRAFT had visually different chips
 *     on different pages.
 *   - Localized label lookup is centralised. `{t('status.quotation.DRAFT')}`
 *     flows through every chip without per-call boilerplate.
 *   - Adding a new status (e.g. a new deal stage) becomes a single
 *     edit in `apps/web/src/locales/<lng>/status.json` plus the
 *     union in the props — no JSX changes elsewhere.
 *
 * Usage:
 *   <StatusBadge kind="quotation" value={q.status} />
 *   <StatusBadge kind="deal"      value={d.status} />
 */

import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';

/**
 * The `kind` namespaces the i18n key (`status.<kind>.<value>`) AND
 * the variant map. Adding a new kind only requires:
 *   1. a new variant map block below
 *   2. a status.<kind>.* block in en/zh-TW/zh-CN
 *   3. an entry in the `Kind` union type below
 */
export type StatusKind = 'quotation' | 'deal' | 'activity' | 'service';
export type StatusVariant =
  | 'default'
  | 'secondary'
  | 'info'
  | 'success'
  | 'warning'
  | 'destructive';

// Mirrors the local helpers that used to live inline in each page.
// Keep the keys uppercase to match the Prisma enum strings we receive
// over the wire (no case-insensitivity here — DB is canonical).
const QUOTATION_VARIANTS: Record<string, StatusVariant> = {
  DRAFT: 'secondary',
  SENT: 'info',
  VIEWED: 'info',
  ACCEPTED: 'success',
  REJECTED: 'destructive',
  EXPIRED: 'warning',
  INVOICED: 'success',
};
const DEAL_VARIANTS: Record<string, StatusVariant> = {
  OPEN: 'info',
  WON: 'success',
  LOST: 'destructive',
};
const ACTIVITY_VARIANTS: Record<string, StatusVariant> = {
  NOTE: 'secondary',
  CALL: 'info',
  EMAIL: 'info',
  MEETING: 'success',
};
const SERVICE_VARIANTS: Record<string, StatusVariant> = {
  ACTIVE: 'success',
  ARCHIVED: 'secondary',
  DRAFT: 'secondary',
};

const VARIANT_MAPS: Record<StatusKind, Record<string, StatusVariant>> = {
  quotation: QUOTATION_VARIANTS,
  deal: DEAL_VARIANTS,
  activity: ACTIVITY_VARIANTS,
  service: SERVICE_VARIANTS,
};

export function StatusBadge({
  kind,
  value,
}: {
  kind: StatusKind;
  value: string;
}) {
  const { t } = useTranslation();
  const map = VARIANT_MAPS[kind];
  const variant: StatusVariant = (map[value] ?? 'default') as StatusVariant;
  // Fall back to the raw enum if a translation is missing (defensive
  // — keeps old pages working even before the catalog is fully filled).
  const label = t(`status.${kind}.${value}`, { defaultValue: value });
  return <Badge variant={variant}>{label}</Badge>;
}
