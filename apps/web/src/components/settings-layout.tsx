import { useCallback } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

/**
 * SettingsLayout — Day 14.7 (Step 6 — Tabs nav).
 *
 * Wraps `/settings/*` sub-routes and renders a 7-tab nav:
 *   Pipelines · Users · Roles · AI · Man-day · Tax · Audit
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
 * Step 7-8 will swap the `<Outlet />` children from placeholders to real
 * per-tab pages.
 *
 * **Plan execution note (Day 14.7 Step 6)**: The original Day 11 /settings
 * (Pipeline) used a direct route `<SettingsPage />` with its own button-style
 * tab strip. Plan JSON (A — Tabs) moves the entry point INTO this layout at
 * `/settings/pipelines`, and the legacy `/settings` becomes a `<Navigate>` to
 * the new URL so existing bookmarks still land on Pipeline.
 */

const TABS = [
  { value: 'pipelines', label: 'Pipelines' },
  { value: 'users', label: 'Users' },
  { value: 'roles', label: 'Roles' },
  { value: 'ai', label: 'AI' },
  { value: 'man-day', label: 'Man-day' },
  { value: 'tax', label: 'Tax' },
  { value: 'audit', label: 'Audit' },
] as const;

type TabValue = (typeof TABS)[number]['value'];

const TAB_VALUES = TABS.map((t) => t.value) as readonly string[];

function isTabValue(seg: string | undefined): seg is TabValue {
  return !!seg && (TAB_VALUES as readonly string[]).includes(seg);
}

export function SettingsLayout() {
  const location = useLocation();
  const navigate = useNavigate();

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
        <h1 className="text-2xl font-bold">系統設置</h1>
        <p className="text-sm text-muted-foreground">
          管理 sales pipeline、user、role、AI、man-day 角色、稅率同 audit log。
        </p>
      </div>

      <Tabs value={currentTab} onValueChange={handleTabChange}>
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Outlet />
    </div>
  );
}
