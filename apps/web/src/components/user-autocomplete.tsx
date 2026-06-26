/**
 * UserAutocomplete — single-select user picker.
 *
 * 2026-06-26: P2 sales-rep feature. Used by DealDialog and
 * QuotationBuilder to pick the follow-up salesperson.
 *
 * Why a separate single-select component instead of reusing
 * MultiUserAutocomplete with `value={id ? [id] : []}`:
 *   - The downstream value is `string | null` (matches the
 *     `ownerId` / `salesRepId` DB columns), not `string[]`.
 *   - Single-select UX is simpler: "clear" sets null, not `[]`.
 *   - The label / placeholder can be customised per call site
 *     ("銷售員" for sales-rep fields, "Owner" elsewhere, etc.).
 *
 * Fetches SALES-role users by default. Callers can override
 * `roleFilter` to include ADMIN (e.g. for an "any user" admin
 * picker) and `includeInactive` to surface soft-deleted users.
 */
import { useQuery } from '@tanstack/react-query';
import { Autocomplete } from './autocomplete';
import { usersApi, type UserSummary } from '@/lib/api';

interface UserAutocompleteProps {
  value?: string | null;
  onChange: (id: string | null) => void;
  /** Restrict to a specific role. Default: 'SALES'. */
  roleFilter?: 'ADMIN' | 'SALES' | 'VIEWER';
  /** Include inactive users. Default: false. */
  includeInactive?: boolean;
  label?: string;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
}

export function UserAutocomplete({
  value,
  onChange,
  roleFilter = 'SALES',
  includeInactive = false,
  label = '銷售員',
  className,
  disabled,
  placeholder = '搜尋銷售員...',
}: UserAutocompleteProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['users', { role: roleFilter }],
    queryFn: () => usersApi.list({ role: roleFilter, limit: 200 }),
    staleTime: 5 * 60_000,
  });
  const all = (data?.items ?? []).filter((u) => includeInactive || u.isActive);
  const users: UserSummary[] = [...all].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <Autocomplete<UserSummary>
      items={users}
      getKey={(u) => u.id}
      getLabel={(u) => u.name}
      getSubLabel={(u) => u.email}
      value={value ?? undefined}
      onChange={(key) => onChange(key || null)}
      label={label}
      className={className}
      disabled={disabled || isLoading}
      placeholder={placeholder}
      emptyText={isLoading ? '載入中...' : '搵唔到'}
    />
  );
}
