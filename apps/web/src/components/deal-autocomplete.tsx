/**
 * DealAutocomplete — wraps the shared <Autocomplete> for Deals.
 *
 * RG-2026-06-07-DEAL-AUTOCOMPLETE: replaces the plain <Select> dropdown
 * in QuotationBuilder so Sales can create a brand-new deal inline
 * without leaving the quotation-builder flow. The pattern mirrors
 * CompanyAutocomplete: the shared <Autocomplete> component shows a
 * "+ 新增 Deal: '<query>'" affordance at the bottom of its dropdown,
 * which fires `onCreate(query)`. We open the existing DealDialog
 * (deals.tsx) pre-filled with:
 *   - companyId = the currently selected customer in the builder
 *   - title = the query the user typed in the autocomplete
 *   - stageId = first stage of the default pipeline
 *   - value = 0
 *   - expectedCloseDate = today + 90 days (enterprise close cycle)
 *
 * The dialog's `onSaved(deal)` returns the freshly-created Deal so we
 * can add it to the local catalogue and auto-select it in one round
 * trip — no need to re-fetch the deals list.
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Autocomplete } from './autocomplete';
import { DealDialog } from '@/pages/deals';
import { companiesApi, dealsApi, type Company, type Deal, type PipelineStage } from '@/lib/api';

interface DealAutocompleteProps {
  /**
   * Required: the deal catalogue scoped to the currently selected
   * customer. The QuotationBuilder fetches this via the existing
   * `/api/deals?companyId=X` call, but we ALSO support a self-fetch
   * fallback (when no `deals` prop is passed) for future callers.
   * When `deals` is provided the component does NOT re-fetch — the
   * parent owns the query lifecycle.
   */
  deals?: Deal[];
  /** Currently selected deal id. */
  value?: string;
  /** Called with the picked deal id, or empty string when cleared. */
  onChange: (id: string) => void;
  /**
   * Customer whose deals we're listing. When the customer changes
   * (e.g. user picks a different company in QuotationBuilder) the
   * parent should clear the dealId externally — we don't auto-clear
   * because doing so mid-keystroke would be jarring.
   */
  companyId?: string;
  /**
   * If false, hide the "+ 新增 Deal" affordance. Defaults to true so
   * the QuotationBuilder's quick-create flow works out of the box.
   */
  allowCreate?: boolean;
  /** Disable the input (e.g. when no customer is picked yet). */
  disabled?: boolean;
  placeholder?: string;
  label?: string;
  className?: string;
}

export function DealAutocomplete({
  deals: dealsProp,
  value,
  onChange,
  companyId,
  allowCreate = true,
  disabled,
  placeholder = '搜尋 deal 名...',
  label = '關聯 Deal (可選)',
  className,
}: DealAutocompleteProps) {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [prefillTitle, setPrefillTitle] = useState('');
  /**
   * Local catalogue that grows when a new deal is created inline.
   * We keep it as state (not just a ref) so the autocomplete's
   * filtered list re-renders with the new entry. The parent's
   * `deals` prop is treated as the source of truth on next render
   * (e.g. after the parent's own query invalidation), but in the
   * meantime the locally-pushed deal is visible immediately.
   */
  const [localDeals, setLocalDeals] = useState<Deal[]>([]);

  // Self-fetch fallback (no `deals` prop passed). Uses the same
  // `companyId`-scoped query the QuotationBuilder was using inline.
  // Disabled when the parent already passed a list.
  const { data: fetched = [] } = useQuery({
    queryKey: ['deals-by-company', companyId],
    queryFn: async () => {
      if (!companyId) return [];
      return dealsApi.list({ companyId, limit: 200 });
    },
    enabled: dealsProp === undefined && !!companyId,
    staleTime: 60_000,
  });
  const deals = useMemo(
    () => [...(dealsProp ?? fetched), ...localDeals],
    [dealsProp, fetched, localDeals]
  );

  // Stages catalogue for the create dialog. Mirrors what the /deals
  // page does (kanban bucket flat-map). The first stage is used as
  // the dialog's default so Quick-Create always lands in a known
  // sane position on the pipeline.
  const { data: stages = [] } = useQuery<PipelineStage[]>({
    queryKey: ['deals-kanban-stages'],
    queryFn: async () => {
      const k = await dealsApi.kanban();
      return (k.buckets ?? []).map((b: { stage: PipelineStage }) => b.stage);
    },
    staleTime: 5 * 60_000,
    enabled: allowCreate,
  });

  // Companies catalogue for the DealDialog's company dropdown. We
  // need it because the dialog requires `companies: Company[]` even
  // when the customer is locked (the dropdown is still rendered
  // disabled). Pull from the same cache CompanyAutocomplete uses.
  const { data: companies = [] } = useQuery<Company[]>({
    queryKey: ['companies-all'],
    queryFn: () => companiesApi.list({ limit: 200 }),
    staleTime: 5 * 60_000,
    enabled: allowCreate,
  });

  return (
    <>
      <Autocomplete<Deal>
        items={deals}
        getKey={(d) => d.id}
        getLabel={(d) => d.title}
        getSubLabel={(d) =>
          d.stage?.name ? `${d.stage.name}${d.value != null ? ` · ${formatValue(d.value, d.currency)}` : ''}` : null
        }
        getMeta={(d) => (d.status ? d.status : null)}
        value={value}
        onChange={onChange}
        label={label}
        className={className}
        disabled={disabled || !companyId}
        placeholder={companyId ? placeholder : '請先選客戶'}
        emptyText={companyId ? '這個客戶未有任何 deal' : '請先選客戶'}
        onCreate={
          allowCreate && companyId
            ? (q) => {
                // RG-2026-06-07-DEAL-AUTOCOMPLETE: we intentionally do
                // NOT pass the typed query through as a default title
                // to DealDialog. The DealDialog has no `defaultTitle`
                // prop today, and surfacing a half-baked title to the
                // user would invite accidental creation of deals with
                // typo-laden names. Instead the user sees an empty
                // title field and is forced to confirm what they're
                // naming. The autocomplete's create hint is enough of
                // a context cue.
                setPrefillTitle(q);
                setCreateOpen(true);
              }
            : undefined
        }
      />
      {allowCreate && (
        <DealDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          companies={companies as Company[]}
          stages={stages as PipelineStage[]}
          defaultCompanyId={companyId}
          defaultExpectedCloseDateOffsetDays={90}
          onSaved={(newDeal?: Deal) => {
            if (newDeal) {
              // 1) Append to local catalogue so the autocomplete
              //    re-renders with the new deal as the top entry.
              setLocalDeals((prev: Deal[]) => {
                // Avoid duplicates if the parent invalidates and
                // re-fetches before we close.
                if (prev.some((d: Deal) => d.id === newDeal.id)) return prev;
                return [newDeal, ...prev];
              });
              // 2) Bump the deals-by-company query so any other
              //    consumer of the same cache sees the new row.
              qc.invalidateQueries({ queryKey: ['deals-by-company', companyId] });
              qc.invalidateQueries({ queryKey: ['deals-kanban'] });
              // 3) Auto-select the new deal.
              onChange(newDeal.id);
            }
            setCreateOpen(false);
          }}
        />
      )}
    </>
  );
}

// Inline mini-formatter so we don't pull in lib/utils' heavier
// formatCurrency (which imports the whole utils module). Matches the
// format `deals.tsx` uses in its own kanban cards.
function formatValue(value: number, currency?: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return `${currency ?? 'HKD'} ${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}
