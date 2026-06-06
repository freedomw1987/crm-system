/**
 * CompanyAutocomplete — wraps the shared <Autocomplete> for Companies.
 *
 * Used in QuotationBuilder, DealDialog, and anywhere else that needs to pick
 * a company from the catalogue. The "create new" affordance opens a
 * full CompanyFormDialog (or, when `onCreate` is not provided, falls back
 * to a no-op — the parent decides which create flow to invoke).
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Autocomplete } from './autocomplete';
import { CompanyFormDialog } from '@/pages/companies';
import { companiesApi, regionsApi, type Company } from '@/lib/api';

interface CompanyAutocompleteProps {
  companies: Company[];
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
  companies, value, onChange, onCreated,
  label = '公司', className, disabled, placeholder = '搜尋公司名...', allowCreate = true,
}: CompanyAutocompleteProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [prefillName, setPrefillName] = useState('');
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
        label={label}
        className={className}
        disabled={disabled}
        placeholder={placeholder}
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
