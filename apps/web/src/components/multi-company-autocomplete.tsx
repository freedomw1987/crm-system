/**
 * MultiCompanyAutocomplete — multi-select company picker for filter UIs.
 *
 * Day 10.1 sibling to CompanyAutocomplete. Self-fetches via
 * companiesApi.list (limit 200) so the Deals / Quotation pages
 * don't need a duplicate useQuery just to populate the filter
 * dropdown. Callers that already have the list can pass it via the
 * `companies` prop to skip the fetch.
 */
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { MultiAutocomplete } from './multi-autocomplete';
import { companiesApi, type Company } from '@/lib/api';

interface MultiCompanyAutocompleteProps {
  companies?: Company[];
  value: string[];
  onChange: (ids: string[]) => void;
  label?: string;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
}

export function MultiCompanyAutocomplete({
  companies: companiesProp,
  value,
  onChange,
  label,
  className,
  disabled,
  placeholder,
}: MultiCompanyAutocompleteProps) {
  const { t } = useTranslation();
  const resolvedLabel = label ?? t('company.label');
  const resolvedPlaceholder = placeholder ?? t('company.searchPlaceholder');
  const { data: fetched = [] } = useQuery({
    queryKey: ['companies-all'],
    queryFn: () => companiesApi.list({ limit: 200 }),
    enabled: companiesProp === undefined,
    staleTime: 5 * 60_000,
  });
  const companies = companiesProp ?? fetched;
  return (
    <MultiAutocomplete<Company>
      items={companies}
      getKey={(c) => c.id}
      getLabel={(c) => c.name}
      getSubLabel={(c) => (c.region?.name ?? c.region?.code ?? null) || null}
      value={value}
      onChange={onChange}
      label={resolvedLabel}
      className={className}
      disabled={disabled}
      placeholder={resolvedPlaceholder}
    />
  );
}
