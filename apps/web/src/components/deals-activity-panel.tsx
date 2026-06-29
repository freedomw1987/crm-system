/**
 * DealsActivityPanel — weekly pipeline-meeting follow-up feed.
 *
 * Mounted above the Deal Kanban board (Day N+1). The list shows the
 * most recent follow-up activities across all deals so a sales manager
 * can scan "what happened this week" without having to click into
 * each deal card.
 *
 * Default sort: most recent first (server-side via the orderBy clause
 * in /activities/recent).
 *
 * Filters:
 *   - Author (sales rep) — populated from the User catalogue
 *   - Time window — "this week" / "this month" / "all" maps to a
 *     `since` ISO timestamp sent to the server
 *
 * The filter UI lives next to the title so it doesn't push the kanban
 * board below the fold. Both filters update reactively via React
 * Query — no explicit "apply" button needed.
 *
 * 2026-06-29: per-row edit/delete/attachment CRUD is now delegated to
 * the shared <ActivityItem> (apps/web/src/components/activity-feed.tsx).
 * The deal-context line (deal title / company name) is rendered by
 * ActivityItem itself when the API includes the joined deal/company
 * objects — which the /activities/recent endpoint does — so we don't
 * need to duplicate the header chrome here.
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Filter, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, Label } from '@/components/ui/select';
import { activitiesApi, usersApi, type Activity } from '@/lib/api';
import { ActivityItem } from '@/components/activity-feed';

type TimeWindow = 'week' | 'month' | 'all';

function sinceForWindow(window: TimeWindow): string | undefined {
  if (window === 'all') return undefined;
  const days = window === 'week' ? 7 : 30;
  // Subtract `days` from now and floor to the start of the day so the
  // boundary lines up with how sales reps think about "this week".
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function DealsActivityPanel() {
  const [authorId, setAuthorId] = useState<string>('');
  const [window, setWindow] = useState<TimeWindow>('week');

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

  const since = useMemo(() => sinceForWindow(window), [window]);

  const { data, isLoading } = useQuery({
    queryKey: ['activities', { recent: true, authorId, since, limit: 50 }],
    queryFn: () => activitiesApi.recent({
      authorId: authorId || undefined,
      since,
      limit: 50,
    }),
  });
  const items: Activity[] = data?.items ?? [];
  const hasFilter = !!authorId || window !== 'week';

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
              <option value="month">本月</option>
              <option value="all">全部</option>
            </Select>
          </div>
          {hasFilter && (
            <button
              type="button"
              onClick={() => { setAuthorId(''); setWindow('week'); }}
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
            呢段時間未有 Activity 記錄
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
