/**
 * Autocomplete — generic typeahead combobox.
 *
 * Used for picking a Company, Product, or Service from a (potentially long)
 * catalogue. Features:
 *   - Filtered by query on the label
 *   - Keyboard nav (↑/↓, Enter, Esc)
 *   - Optional "Create new: '<query>'" affordance at the bottom
 *   - White background dropdown (the `bg-popover` token is broken in
 *     tailwind.config.js, see day-n-frontend.md §7)
 *
 * Consumers wrap it for specific entities (see `CompanyAutocomplete`,
 * `ProductAutocomplete`, `ServiceAutocomplete` below).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/select';
import { cn } from '@/lib/utils';

export interface AutocompleteProps<T> {
  items: T[];
  /** Stable unique key for each item (used in React keys and as the value). */
  getKey: (item: T) => string;
  /** Human-readable label shown in the input + dropdown rows. */
  getLabel: (item: T) => string;
  /** Optional secondary line shown under the label in the dropdown. */
  getSubLabel?: (item: T) => string | null | undefined;
  /** Optional right-aligned meta shown in the dropdown row (e.g. price). */
  getMeta?: (item: T) => string | null | undefined;
  /** The currently selected key. Undefined = nothing selected. */
  value?: string;
  /** Called with the picked key, or empty string when the user clears. */
  onChange: (key: string) => void;
  placeholder?: string;
  emptyText?: string;
  /** When provided, show a "Create new: '<query>'" entry at the bottom. */
  onCreate?: (query: string) => void;
  /** Optional label shown above the input. */
  label?: string;
  className?: string;
  /** Disable the input (e.g. in read-only mode). */
  disabled?: boolean;
  /** Free-text search against `getLabel` only. Set false to disable
   *  filtering (useful for short lists). */
  filterable?: boolean;
  /** Max items shown in the dropdown. Default 10. */
  maxItems?: number;
}

export function Autocomplete<T>({
  items,
  getKey,
  getLabel,
  getSubLabel,
  getMeta,
  value,
  onChange,
  placeholder,
  emptyText,
  onCreate,
  label,
  className,
  disabled,
  filterable = true,
  maxItems = 10,
}: AutocompleteProps<T>) {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t('common.autocomplete.searchPlaceholder');
  const resolvedEmptyText = emptyText ?? t('common.autocomplete.noResults');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(() => items.find((i) => getKey(i) === value), [items, value, getKey]);
  // When the parent re-mounts with a new selection, sync the visible text.
  useEffect(() => {
    if (selected) setQuery(getLabel(selected));
  }, [selected, getLabel]);

  const filtered = useMemo(() => {
    if (!filterable || !query) return items.slice(0, maxItems);
    const q = query.toLowerCase();
    return items
      .filter((i) => getLabel(i).toLowerCase().includes(q))
      .slice(0, maxItems);
  }, [items, query, getLabel, filterable, maxItems]);

  // Close on outside click
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  function pick(k: string) {
    onChange(k);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = filtered[highlight];
      if (item) pick(getKey(item));
      else if (onCreate && query.trim()) onCreate(query.trim());
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  const showCreate = !!onCreate && query.trim().length > 0;

  return (
    <div className={cn('w-full', className)}>
      {label && <Label className="text-xs text-muted-foreground">{label}</Label>}
      <div className="relative" ref={wrapRef}>
        <Input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setHighlight(0); if (value) onChange(''); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={resolvedPlaceholder}
          disabled={disabled}
          autoComplete="off"
        />
        {open && !disabled && (
          <div className="absolute z-50 top-full mt-1 left-0 right-0 max-h-72 overflow-y-auto bg-white border border-border rounded shadow-lg">
            {filtered.length === 0 ? (
              <div className="p-2 text-sm text-muted-foreground text-center">{resolvedEmptyText}</div>
            ) : (
              filtered.map((it, idx) => {
                const k = getKey(it);
                return (
                  <button
                    type="button"
                    key={k}
                    onClick={() => pick(k)}
                    onMouseEnter={() => setHighlight(idx)}
                    className={cn(
                      'w-full text-left px-2 py-1.5 text-sm flex justify-between items-center',
                      highlight === idx ? 'bg-muted' : 'hover:bg-muted/50'
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{getLabel(it)}</div>
                      {getSubLabel && getSubLabel(it) && (
                        <div className="text-xs text-muted-foreground truncate">{getSubLabel(it)}</div>
                      )}
                    </div>
                    {getMeta && getMeta(it) && (
                      <span className="text-xs tabular-nums shrink-0 ml-2 text-muted-foreground">{getMeta(it)}</span>
                    )}
                  </button>
                );
              })
            )}
            {showCreate && (
              <div className="border-t p-1">
                <button
                  type="button"
                  onClick={() => { onCreate!(query.trim()); setOpen(false); }}
                  className="w-full text-left px-2 py-1.5 text-sm text-primary hover:bg-muted rounded flex items-center gap-1"
                >
                  <Plus className="h-3 w-3" /> {t('common.autocomplete.addNew', { name: query.trim() })}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
