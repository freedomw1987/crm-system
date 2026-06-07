import { Outlet } from 'react-router-dom';

/**
 * SettingsLayout — Day 14.7 (Step 5 stub).
 *
 * Wraps `/settings/*` sub-routes (Users / Roles / AI / Man-day / Tax / Audit).
 * Step 6 will add a Tab nav (shadcn `<Tabs>`) here; for now it's a passthrough
 * `<Outlet />` so the route tree is in place and we can wire per-tab pages
 * incrementally without re-touching `App.tsx`.
 *
 * The legacy `/settings` (Pipeline config) is NOT a child of this layout —
 * it keeps its own route so existing bookmark links + Pipeline tab still work.
 */
export function SettingsLayout() {
  return <Outlet />;
}
