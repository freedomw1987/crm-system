import { useCallback } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

/**
 * SettingsLayout — Day 14.7 (Step 6 — Tabs nav).
 *
 * Wraps `/settings/*` sub-routes and renders an 8-tab nav:
 *   Account · Pipelines · Users · Roles · AI · Man-day · Tax · Currency · Maintenance Fee · Audit
 *
 * The Account tab is FIRST and visible to ALL roles (admin or not) — it's
 * where every user picks their language preference and finds personal
 * settings. Admin tabs follow; admins get all of them, non-admins see
 * Account + can still navigate to admin URLs directly (existing route
 * guards, unchanged).
 *
 * Source-of-truth: the URL (`/settings/<tab>`). The Tabs `value` is derived
 * from `useLocation()`. Clicking a TabsTrigger calls `navigate('/settings/<tab>')`
 * so the URL stays the single source of truth and deep links (`/settings/tax`)
 * land on the right tab.
 *
 * Why TabsTrigger + onClick (not NavLink): Radix `<Tabs>` in controlled mode
 * requires `<TabsTrigger value=…>` children that match the active `value`;
 * mixing NavLinks inside a controlled Tabs makes Radix warn about missing
 * triggers. We pay a small cost: middle-click "open in new tab" doesn't work
 * on the tab strip (it's a `<button>`, not an `<a>`). The trade-off is
 * acceptable because the tab nav is for in-app navigation; deep links from
 * bookmarks / chat / email still hit the right sub-route directly.
 *
 * **P3-i18n (2026-07-02)**: tab labels now go through i18n via `labelKey`.
 * The labelKey string is the source of truth — `nav.settings` resolves to
 * "System Settings" / "系統設定" / "系统设置". Add a new tab by appending
 * to TABS + adding the same `labelKey` to all three locale JSONs.
 *
 * **Plan execution note (Day 14.7 Step 6)**: The original Day 11 /settings
 * (Pipeline) used a direct route `<SettingsPage />` with its own button-style
 * tab strip. Plan JSON (A — Tabs) moves the entry point INTO this layout at
 * `/settings/pipelines`, and the legacy `/settings` becomes a `<Navigate>` to
 * the new URL so existing bookmarks still land on Pipeline.
 */

const TABS = [
  // P3-i18n (2026-07-02): Account is the FIRST tab and visible to all
  // roles (admin or not). Order matters — non-admins shouldn't see an
  // empty admin-only strip when they navigate to /settings.
  { value: 'account', labelKey: 'nav.account' },
  { value: 'pipelines', labelKey: 'nav.settingsTabs.pipelines' },
  { value: 'users', labelKey: 'nav.settingsTabs.users' },
  { value: 'roles', labelKey: 'nav.settingsTabs.roles' },
  { value: 'ai', labelKey: 'nav.settingsTabs.ai' },
  { value: 'man-day', labelKey: 'nav.settingsTabs.manDay' },
  { value: 'tax', labelKey: 'nav.settingsTabs.tax' },
  // P2 multi-currency (2026-06-29): currency tab sits next to Tax
  // — both are numeric settings that drive the Quotation builder's
  // pre-fill logic, so visually grouping them helps admins spot
  // the relationship.
  { value: 'currency', labelKey: 'nav.settingsTabs.currency' },
  // 2026-07-01 (US-MAINT-1): Maintenance Service tab — sits
  // between Currency and Audit because it's another numeric setting
  // that drives the Quotation builder's "+ 維護費用" button.
  // 2026-07-01 rename: 維修費用 → 維護費用 (per user request).
  // Same group as Tax / Currency for the same reason.
  { value: 'maintenance-fee', labelKey: 'nav.settingsTabs.maintenanceFee' },
  { value: 'audit', labelKey: 'nav.settingsTabs.audit' },
] as const;

type TabValue = (typeof TABS)[number]['value'];

const TAB_VALUES = TABS.map((t) => t.value) as readonly string[];

function isTabValue(seg: string | undefined): seg is TabValue {
  return !!seg && (TAB_VALUES as readonly string[]).includes(seg);
}

export function SettingsLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const currentTab: TabValue = (() => {
    const m = location.pathname.match(/^\/settings\/([^/]+)/);
    const seg = m?.[1];
    return isTabValue(seg) ? seg : 'pipelines';
  })();

  const handleTabChange = useCallback(
    (next: string) => {
      if (isTabValue(next) && next !== currentTab) {
        navigate(`/settings/${next}`);
      }
    },
    [navigate, currentTab]
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('nav.settings')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('settings.description')}
        </p>
      </div>

      <Tabs value={currentTab} onValueChange={handleTabChange}>
        <TabsList>
          {TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {t(tab.labelKey)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Outlet />
    </div>
  );
}