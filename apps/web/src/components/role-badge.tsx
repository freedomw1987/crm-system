/**
 * `<RoleBadge>` — single source of truth for the user-role chip
 * (ADMIN / SALES / VIEWER). Replaces raw `user.role` strings in
 * JSX so the role label flows through i18n instead of leaking the
 * DB enum into the UI.
 *
 * Usage:
 *   <RoleBadge role={user.role} />
 */

import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';

export type RoleVariant = 'default' | 'info' | 'success' | 'secondary' | 'destructive';

const VARIANTS: Record<string, RoleVariant> = {
  ADMIN: 'destructive',     // red — admin-only power
  SALES: 'info',            // blue — the common case
  VIEWER: 'secondary',      // grey — read-only
};

export function RoleBadge({ role }: { role: 'ADMIN' | 'SALES' | 'VIEWER' | string }) {
  const { t } = useTranslation();
  const variant: RoleVariant = (VARIANTS[role] ?? 'default') as RoleVariant;
  const label = t(`role.${role}`, { defaultValue: role });
  return <Badge variant={variant}>{label}</Badge>;
}
