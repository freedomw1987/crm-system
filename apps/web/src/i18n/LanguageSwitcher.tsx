/**
 * `<LanguageSwitcher>` — three-option locale picker.
 *
 * Visual design: the rest of the app uses Radix primitives wrapped
 * with Tailwind (see `components/role-dialog.tsx` for the dialog
 * pattern), so we follow the same idiom with Radix `Select`.
 *
 * Behaviour:
 *   - Reads active locale from `useLocale()`.
 *   - Calling `onChange` swaps i18n language AND mirrors to
 *     localStorage (the `languageChanged` listener in
 *     `i18n/index.ts` handles the persistence).
 *   - Optimistic: the page re-renders in the new locale BEFORE the
 *     PATCH /auth/me/preferences call returns. If the server rejects
 *     (rare — should only happen if the user is offline or the JWT
 *     expired mid-edit), `useAuth().refresh()` from the parent
 *     settings page resets state.
 */

import * as Select from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';

import { useLocale } from './LocaleContext';
import type { SupportedLng } from './config';

const LABELS: Record<SupportedLng, string> = {
  en: 'English',
  'zh-TW': '繁體中文',
  'zh-CN': '简体中文',
};

export function LanguageSwitcher({
  onChange,
}: {
  /**
   * Called when the user picks a different locale. The parent is
   * responsible for the network persistence (PATCH /auth/me/preferences).
   * i18n already swapped languages locally by the time this fires.
   */
  onChange?: (next: SupportedLng) => void;
}) {
  const { locale, changeLocale, locales } = useLocale();

  const handleValueChange = async (next: string) => {
    if (!locales.includes(next as SupportedLng)) return;
    const typed = next as SupportedLng;
    // Apply locally first so the UI re-renders without waiting on the server.
    await changeLocale(typed);
    onChange?.(typed);
  };

  return (
    <Select.Root value={locale} onValueChange={handleValueChange}>
      <Select.Trigger
        className="inline-flex h-9 min-w-[180px] items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm hover:bg-accent focus:outline-none focus:ring-1 focus:ring-ring"
        aria-label="Language"
      >
        <Select.Value>{LABELS[locale]}</Select.Value>
        <Select.Icon>
          <ChevronDown className="h-4 w-4 opacity-60" aria-hidden />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          position="popper"
          sideOffset={4}
          className="z-50 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md"
        >
          <Select.Viewport className="p-1">
            {locales.map((lng) => (
              <Select.Item
                key={lng}
                value={lng}
                className="relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
              >
                <Select.ItemIndicator className="absolute left-2 inline-flex h-4 w-4 items-center justify-center">
                  <Check className="h-4 w-4" aria-hidden />
                </Select.ItemIndicator>
                <Select.ItemText>{LABELS[lng]}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
