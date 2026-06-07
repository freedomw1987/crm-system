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
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { StickyNote, Phone, Mail, Calendar, Paperclip, Filter, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, Label } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { activitiesApi, usersApi, type Activity, type ActivityType } from '@/lib/api';

const TYPE_META: Record<ActivityType, { icon: typeof StickyNote; label: string; color: string }> = {
  NOTE:    { icon: StickyNote, label: '備註',   color: 'text-slate-500' },
  CALL:    { icon: Phone,      label: '電話',   color: 'text-emerald-500' },
  EMAIL:   { icon: Mail,       label: 'Email', color: 'text-blue-500' },
  MEETING: { icon: Calendar,   label: '會議',   color: 'text-amber-500' },
};

type TimeWindow = 'week' | 'month' | 'all';

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return '剛剛';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分鐘前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小時前`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} 天前`;
  return new Date(iso).toLocaleDateString('zh-HK');
}

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
            {items.map((a) => {
              const meta = TYPE_META[a.type] ?? TYPE_META.NOTE;
              const Icon = meta.icon;
              return (
                <li key={a.id} className="flex items-start gap-3 p-4">
                  <div className={`shrink-0 mt-0.5 ${meta.color}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap text-xs">
                      <Badge variant="outline" className="text-[10px]">{meta.label}</Badge>
                      {a.author && (
                        <span className="font-medium text-foreground">{a.author.name}</span>
                      )}
                      <span className="text-muted-foreground">{relativeTime(a.createdAt)}</span>
                      {a.deal && (
                        <span className="text-muted-foreground">
                          · <span className="font-medium text-foreground">{a.deal.title}</span>
                        </span>
                      )}
                      {a.company && !a.deal && (
                        <span className="text-muted-foreground">
                          · <span className="font-medium text-foreground">{a.company.name}</span>
                        </span>
                      )}
                    </div>
                    {a.content && (
                      <p className="text-sm whitespace-pre-wrap break-words line-clamp-2">{a.content}</p>
                    )}
                    {a.attachments && a.attachments.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-0.5">
                        {a.attachments.map((att) => (
                          <span
                            key={att.id}
                            className="inline-flex items-center gap-1 text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground"
                          >
                            <Paperclip className="h-2.5 w-2.5" /> {att.fileName}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
