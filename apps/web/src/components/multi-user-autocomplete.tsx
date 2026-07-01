/**
 * MultiUserAutocomplete — multi-select user picker for filter UIs.
 *
 * Day 10.1: powers the "Sales rep" filter on the Deals / Quotation
 * pages. By default fetches all SALES-role users (the only people
 * who can own a deal or create a quotation), sorted by name. Callers
 * can override `roleFilter` for e.g. ADMIN+VIEWER views.
 *
 * "Sales rep" semantics:
 *   - For `Deal`: the `ownerId` column
 *   - For `Quotation`: the `createdById` column (Quotation has no
 *     separate `ownerId`; whoever created the quote is treated as
 *     its sales rep). We pass the same user list to both filters —
 *     the parent decides which id field to use.
 */
import { useQuery } from '@tanstack/react-query';
import { MultiAutocomplete } from './multi-autocomplete';
import { usersApi, type UserSummary } from '@/lib/api';

interface MultiUserAutocompleteProps {
  value: string[];
  onChange: (ids: string[]) => void;
  /** Restrict to a specific role. Default: 'SALES' (the only role
   *  that can own a deal or create a quotation in the seed). */
  roleFilter?: 'ADMIN' | 'SALES' | 'VIEWER';
  /** Include inactive users. Default: false — they can't own new
   *  things, so the filter dropdown should hide them. */
  includeInactive?: boolean;
  label?: string;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
}

export function MultiUserAutocomplete({
  value,
  onChange,
  roleFilter = 'SALES',
  includeInactive = false,
  label = '銷售員',
  className,
  disabled,
  placeholder = '搜尋銷售員...',
}: MultiUserAutocompleteProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['users', { role: roleFilter }],
    queryFn: () => usersApi.list({ role: roleFilter, limit: 200 }),
    staleTime: 5 * 60_000,
  });
  const all = (data?.items ?? []).filter((u) => includeInactive || u.isActive);
  // Sort by name for stable display
  const users: UserSummary[] = [...all].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <MultiAutocomplete<UserSummary>
      items={users}
      getKey={(u) => u.id}
      getLabel={(u) => u.name}
      getSubLabel={(u) => u.email}
      value={value}
      onChange={onChange}
      label={label}
      className={className}
      disabled={disabled || isLoading}
      placeholder={placeholder}
      emptyText={isLoading ? '載入中...' : '找不到'}
    />
  );
}
