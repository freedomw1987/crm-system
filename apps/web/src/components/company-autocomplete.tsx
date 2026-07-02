/**
 * CompanyAutocomplete — wraps the shared <Autocomplete> for Companies.
 *
 * Used in QuotationBuilder, DealDialog, and anywhere else that needs to pick
 * a company from the catalogue. The "create new" affordance opens a
 * full CompanyFormDialog (or, when `onCreate` is not provided, falls back
 * to a no-op — the parent decides which create flow to invoke).
 *
 * Day N: the company catalogue can be passed in via the `companies` prop
 * (kept for back-compat with callers that already fetched the list for
 * their own use, e.g. deals.tsx uses it to render the company name next
 * to each deal). When the prop is omitted, the component self-fetches
 * via companiesApi.list so callers like QuotationBuilderForm don't need
 * a duplicate useQuery.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Autocomplete } from './autocomplete';
import { CompanyFormDialog } from '@/pages/companies';
import { companiesApi, regionsApi, type Company } from '@/lib/api';

interface CompanyAutocompleteProps {
  /** Optional pre-fetched list. If omitted, the component self-fetches
   *  via companiesApi.list (limit 200, sorted by name). */
  companies?: Company[];
  value?: string;
  onChange: (id: string) => void;
  /** Called with the newly created company so the parent can add it to
   *  its local catalogue list (e.g. for the "open from current deals"
   *  list). If omitted, the dialog is not rendered. */
  onCreated?: (c: Company) => void;
  label?: string;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
  /** When false, hide the "+ 新增" create flow entirely. */
  allowCreate?: boolean;
}

export function CompanyAutocomplete({
  companies: companiesProp, value, onChange, onCreated,
  label, className, disabled, placeholder, allowCreate = true,
}: CompanyAutocompleteProps) {
  const { t } = useTranslation();
  const resolvedLabel = label ?? t('company.label');
  const resolvedPlaceholder = placeholder ?? t('company.searchPlaceholder');
  const [createOpen, setCreateOpen] = useState(false);
  const [prefillName, setPrefillName] = useState('');
  const qc = useQueryClient();
  // Self-fetch when the caller didn't pass a pre-loaded list. The query is
  // disabled when `companies` is provided, so existing callers (deals.tsx
  // passes a list to DealDialog) keep their current behaviour with no
  // duplicate network round-trip.
  const { data: fetched = [] } = useQuery({
    queryKey: ['companies-all'],
    queryFn: () => companiesApi.list({ limit: 200 }),
    enabled: companiesProp === undefined,
    staleTime: 5 * 60_000,
  });
  const companies = companiesProp ?? fetched;
  // The create dialog needs the regions catalogue. Day N: we fetch here
  // rather than threading it through props so every caller (Quotation
  // builder, Deal dialog, etc.) gets it for free.
  const { data: regions = [] } = useQuery({
    queryKey: ['regions'],
    queryFn: () => regionsApi.list(),
    staleTime: 5 * 60_000,
    enabled: allowCreate,
  });

  return (
    <>
      <Autocomplete<Company>
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
        onCreate={allowCreate ? (q) => { setPrefillName(q); setCreateOpen(true); } : undefined}
      />
      {allowCreate && (
        <CompanyFormDialog
          mode="create"
          open={createOpen}
          onOpenChange={setCreateOpen}
          defaultName={prefillName}
          regions={regions}
          onSaved={(c) => {
            if (c) {
              // Invalidate the companies catalogue so the new row shows up
              // in the dropdown immediately. This matters when the
              // autocomplete owns the query (no `companies` prop passed);
              // for callers that passed a pre-loaded list they should
              // handle their own invalidation.
              qc.invalidateQueries({ queryKey: ['companies-all'] });
              onCreated?.(c);
              onChange(c.id);
            }
            setCreateOpen(false);
          }}
        />
      )}
    </>
  );
}

// Re-export `companiesApi` so the create dialog can call it without a
// second import in consuming files. (Lightweight convenience.)
export { companiesApi };
