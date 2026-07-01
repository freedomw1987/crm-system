/**
 * MultiAutocomplete — multi-select dropdown with chip display.
 *
 * Day 10.1: David asked for multi-select autocomplete for the
 * Company + sales-rep filters on the Deals / Quotation pages. We
 * built a sibling component to `Autocomplete` rather than adding a
 * `multi` prop to the single-select one — the UX (chips above the
 * input, ⌫-to-remove on the focused chip) is different enough that
 * threading both modes through the same code path made it harder to
 * read.
 *
 * The component:
 *   - Renders selected items as removable chips above the input
 *   - Filter dropdown on the input (same fuzzy-ish substring match
 *     as the single-select `Autocomplete`)
 *   - Keyboard: ↑/↓ to navigate, Enter to pick, ⌫ on empty input
 *     to remove the last chip, Esc to close
 *   - Calls onChange with the new array every time a chip is added
 *     or removed — the parent owns the array
 *
 * It does NOT support `onCreate` (no "Create new X from the filter
 * dropdown" affordance) because the consumers in this batch only
 * filter against existing records.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/select';
import { cn } from '@/lib/utils';

export interface MultiAutocompleteProps<T> {
  items: T[];
  getKey: (item: T) => string;
  getLabel: (item: T) => string;
  getSubLabel?: (item: T) => string | null | undefined;
  /** Currently selected keys. Order is preserved for chip display. */
  value: string[];
  /** Called with the new array of selected keys. */
  onChange: (keys: string[]) => void;
  placeholder?: string;
  emptyText?: string;
  label?: string;
  className?: string;
  disabled?: boolean;
  maxItems?: number;
}

export function MultiAutocomplete<T>({
  items,
  getKey,
  getLabel,
  getSubLabel,
  value,
  onChange,
  placeholder = '搜尋...',
  emptyText = '找不到',
  label,
  className,
  disabled,
  maxItems = 10,
}: MultiAutocompleteProps<T>) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const selectedItems = useMemo(() => {
    const byId = new Map(items.map((i) => [getKey(i), i]));
    return value
      .map((k) => byId.get(k))
      .filter((i): i is T => i !== undefined);
  }, [items, value, getKey]);
  const selectedSet = useMemo(() => new Set(value), [value]);

  const filtered = useMemo(() => {
    // Always hide already-selected items from the dropdown — adding
    // a duplicate is meaningless.
    const pool = items.filter((i) => !selectedSet.has(getKey(i)));
    if (!query) return pool.slice(0, maxItems);
    const q = query.toLowerCase();
    return pool
      .filter((i) => getLabel(i).toLowerCase().includes(q))
      .slice(0, maxItems);
  }, [items, query, getLabel, selectedSet, getKey, maxItems]);

  // Reset highlight when the filtered list changes shape
  useEffect(() => {
    setHighlight(0);
  }, [query]);

  // Close on outside click
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  function add(k: string) {
    if (selectedSet.has(k)) return;
    onChange([...value, k]);
    setQuery('');
  }

  function remove(k: string) {
    onChange(value.filter((x) => x !== k));
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (e.key === 'Backspace' && query === '' && value.length > 0) {
      e.preventDefault();
      onChange(value.slice(0, -1));
      return;
    }
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') setOpen(true);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, Math.max(0, filtered.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = filtered[highlight];
      if (item) add(getKey(item));
    }
  }

  return (
    <div className={cn('w-full', className)}>
      {label && <Label className="text-xs text-muted-foreground">{label}</Label>}
      <div className="relative" ref={wrapRef}>
        <div className={cn(
          'flex flex-wrap items-center gap-1 min-h-9 w-full rounded-md border border-input bg-white px-2 py-1 text-sm',
          disabled && 'opacity-50 cursor-not-allowed',
        )}>
          {selectedItems.map((it) => {
            const k = getKey(it);
            return (
              <span
                key={k}
                className="inline-flex items-center gap-1 rounded bg-primary/10 text-primary text-xs px-1.5 py-0.5"
              >
                <span className="truncate max-w-[180px]">{getLabel(it)}</span>
                <button
                  type="button"
                  onClick={() => remove(k)}
                  disabled={disabled}
                  className="rounded hover:bg-primary/20 p-0.5"
                  aria-label={`移除 ${getLabel(it)}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            );
          })}
          <Input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder={selectedItems.length === 0 ? placeholder : ''}
            disabled={disabled}
            autoComplete="off"
            className="flex-1 min-w-[8ch] border-0 p-0 h-7 shadow-none focus-visible:ring-0"
          />
        </div>
        {open && !disabled && (
          <div className="absolute z-50 top-full mt-1 left-0 right-0 max-h-72 overflow-y-auto bg-white border border-border rounded shadow-lg">
            {filtered.length === 0 ? (
              <div className="p-2 text-sm text-muted-foreground text-center">
                {selectedItems.length > 0 && items.length > 0 && selectedSet.size === items.length
                  ? '已選晒所有項目'
                  : emptyText}
              </div>
            ) : (
              filtered.map((it, idx) => {
                const k = getKey(it);
                return (
                  <button
                    type="button"
                    key={k}
                    onClick={() => { add(k); setOpen(true); }}
                    onMouseEnter={() => setHighlight(idx)}
                    className={cn(
                      'w-full text-left px-2 py-1.5 text-sm flex justify-between items-center',
                      highlight === idx ? 'bg-muted' : 'hover:bg-muted/50',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{getLabel(it)}</div>
                      {getSubLabel && getSubLabel(it) && (
                        <div className="text-xs text-muted-foreground truncate">{getSubLabel(it)}</div>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}
