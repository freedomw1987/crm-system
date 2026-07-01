/**
 * DealsActivityPanel — pipeline-meeting follow-up feed.
 *
 * Mounted above the Deal Kanban board (Day N+1). The list shows the
 * most recent follow-up activities across all deals so a sales manager
 * can scan "what happened this period" without having to click into
 * each deal card.
 *
 * Default sort: most recent first (server-side via the orderBy clause
 * in /activities/recent).
 *
 * Filters:
 *   - Author (sales rep) — populated from the User catalogue
 *   - Time window:
 *       * 本週 (this week)  — last 7 days
 *       * 上週 (last week)  — the 7-day window from 7-14 days ago,
 *                              so the user can compare week-on-week
 *       * 本月 (this month) — last 30 days
 *       * 自訂 (custom)     — user-picked from / to dates
 *       * 全部 (all)        — no time filter
 *     The custom range and the predefined windows all map to a
 *     `since` / `until` ISO pair sent to /activities/recent.
 *
 * The filter UI lives next to the title so it doesn't push the kanban
 * board below the fold. All filters update reactively via React Query
 * — no explicit "apply" button needed.
 *
 * 2026-06-29: per-row edit/delete/attachment CRUD is delegated to the
 * shared <ActivityItem>. 2026-06-29: added 上週 and 自訂 time options
 * (the latter exposes a from/to date range that wires through to the
 * new `until` query param on /activities/recent).
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Filter, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, Label } from '@/components/ui/select';
import { activitiesApi, usersApi, type Activity } from '@/lib/api';
import { ActivityItem } from '@/components/activity-feed';

type TimeWindow = 'week' | 'last-week' | 'month' | 'custom' | 'all';

/** Compute the {since, until} ISO bounds for a given window.
 *  Both bounds are inclusive at the day granularity. Undefined
 *  values mean "no bound on that side" (the server skips the
 *  clause). */
function boundsForWindow(
  window: TimeWindow,
  custom: { from: string; to: string },
): { since?: string; until?: string } {
  if (window === 'all') return {};
  if (window === 'custom') {
    const since = custom.from ? dateInputToSince(custom.from) : undefined;
    const until = custom.to ? dateInputToUntil(custom.to) : undefined;
    return { since, until };
  }
  const days = window === 'week' ? 7 : window === 'last-week' ? 14 : 30;
  // Subtract `days` from now and floor to the start of the day so the
  // boundary lines up with how sales reps think about "this week".
  const since = new Date();
  since.setDate(since.getDate() - days);
  since.setHours(0, 0, 0, 0);
  // 上週 also needs an upper bound — end of "7 days ago", which
  // makes the window 7-14 days back, not 0-14 days.
  if (window === 'last-week') {
    const until = new Date();
    until.setDate(until.getDate() - 7);
    until.setHours(23, 59, 59, 999);
    return { since: since.toISOString(), until: until.toISOString() };
  }
  return { since: since.toISOString() };
}

/** HTML <input type="date"> gives "YYYY-MM-DD". Convert to an
 *  ISO timestamp at 00:00:00.000 of that day (the lower bound
 *  for an inclusive day range). */
function dateInputToSince(yyyyMmDd: string): string {
  // Construct in local time so the picker matches what the user
  // sees in their calendar (vs. UTC, which can flip the day).
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  const dt = new Date(y, m - 1, d, 0, 0, 0, 0);
  return dt.toISOString();
}

/** Same as above but for the upper bound: end of the picked day
 *  (23:59:59.999) so activities logged on that day are included. */
function dateInputToUntil(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  const dt = new Date(y, m - 1, d, 23, 59, 59, 999);
  return dt.toISOString();
}

export function DealsActivityPanel() {
  const [authorId, setAuthorId] = useState<string>('');
  const [window, setWindow] = useState<TimeWindow>('week');
  // 2026-06-29: custom date range. Held in <input type="date">
  // format ("YYYY-MM-DD") so the picker stays in sync with the UI
  // without timezone round-tripping. Converted to ISO bounds at
  // query-build time via boundsForWindow.
  const [customFrom, setCustomFrom] = useState<string>('');
  const [customTo, setCustomTo] = useState<string>('');

  // Fetch the user list for the author filter. We use a separate
  // small endpoint; usersApi.list returns all active users with id+name
  // which is all the filter needs. The list is small (< 50 in
  // practice) so a 60-second staleTime is fine. Note: the endpoint
  // returns { items, total } so we extract .items before mapping.
  const { data: usersData } = useQuery({
    queryKey: ['users-all'],
    queryFn: () => usersApi.list({ limit: 200 }),
    staleTime: 60_000,
  });
  const users = usersData?.items ?? [];

  const { since, until } = useMemo(
    () => boundsForWindow(window, { from: customFrom, to: customTo }),
    [window, customFrom, customTo],
  );

  const { data, isLoading } = useQuery({
    queryKey: ['activities', { recent: true, authorId, since, until, limit: 50 }],
    queryFn: () => activitiesApi.recent({
      authorId: authorId || undefined,
      since,
      until,
      limit: 50,
    }),
  });
  const items: Activity[] = data?.items ?? [];
  // Split the custom-range check out so TS keeps `window` as the full
  // union (the `window !== 'week'` term alone would narrow it to
  // 'week' and then the `=== 'custom'` check would be unreachable).
  const isCustomActive = window === 'custom' && (!!customFrom || !!customTo);
  const hasFilter = !!authorId || window !== 'week' || isCustomActive;

  function resetFilters() {
    setAuthorId('');
    setWindow('week');
    setCustomFrom('');
    setCustomTo('');
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap space-y-0">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <CardTitle>最新跟進 (Activity)</CardTitle>
          <span className="text-xs text-muted-foreground">({items.length})</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1">
            <Label htmlFor="activity-author" className="text-xs text-muted-foreground whitespace-nowrap">銷售員</Label>
            <Select
              id="activity-author"
              value={authorId}
              onChange={(e) => setAuthorId(e.target.value)}
              className="h-8 text-xs min-w-[120px]"
            >
              <option value="">全部</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name ?? u.email}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex items-center gap-1">
            <Label htmlFor="activity-window" className="text-xs text-muted-foreground whitespace-nowrap">時間</Label>
            <Select
              id="activity-window"
              value={window}
              onChange={(e) => setWindow(e.target.value as TimeWindow)}
              className="h-8 text-xs min-w-[100px]"
            >
              <option value="week">本週</option>
              <option value="last-week">上週</option>
              <option value="month">本月</option>
              <option value="custom">自訂</option>
              <option value="all">全部</option>
            </Select>
          </div>
          {/* 2026-06-29: when the user picks 自訂, surface two native
              date inputs inline. We don't validate that from <= to
              here — if the user picks them in the wrong order the
              server returns 0 results, which is a clear enough
              signal. `max` on the `to` input prevents choosing a
              future day (a logged activity can't be in the future). */}
          {window === 'custom' && (
            <div className="flex items-center gap-1">
              <Label htmlFor="activity-from" className="text-xs text-muted-foreground whitespace-nowrap">由</Label>
              <input
                id="activity-from"
                type="date"
                value={customFrom}
                max={customTo || undefined}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="h-8 text-xs rounded border bg-background px-2"
                data-testid="activity-from"
              />
              <Label htmlFor="activity-to" className="text-xs text-muted-foreground whitespace-nowrap">至</Label>
              <input
                id="activity-to"
                type="date"
                value={customTo}
                min={customFrom || undefined}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setCustomTo(e.target.value)}
                className="h-8 text-xs rounded border bg-background px-2"
                data-testid="activity-to"
              />
            </div>
          )}
          {hasFilter && (
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" /> 重設
            </button>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <p className="text-sm text-muted-foreground p-6 text-center">載入中...</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground p-6 text-center">
            這段時間未有 Activity 記錄
          </p>
        ) : (
          <ul className="divide-y">
            {items.map((a) => (
              // variant="plain" — the parent <ul> already provides
              // dividers + flush layout, so the row itself stays
              // unbordered (matches the original panel look).
              <ActivityItem key={a.id} activity={a} variant="plain" />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
