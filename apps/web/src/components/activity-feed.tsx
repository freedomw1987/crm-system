/**
 * ActivityFeed — displays a list of activities (notes, calls, emails,
 * meetings) with optional inline composition + file attachments.
 *
 * Three modes:
 *   - company-bound: pass `companyId` → fetches /activities?companyId=...
 *   - deal-bound:    pass `dealId`    → fetches /activities?dealId=...
 *   - global recent: pass nothing or use the `useRecent` variant below
 *                    (Dashboard calls activitiesApi.recent() directly)
 *
 * Each item shows:
 *   - Activity type icon (NOTE / CALL / EMAIL / MEETING)
 *   - Author name + relative timestamp
 *   - Content (preserves line breaks)
 *   - Attachment list (clickable download link)
 *
 * The composer at the top lets the user write a NOTE and attach files
 * in one flow: type the content, drop/pick files, hit "新增" → backend
 * creates the activity then uploads each attachment against its id.
 *
 * Day N: this is the first UI surface for the activity feed. The
 * backend route was added in da28ec9 but had no frontend caller until
 * now. Dashboard will reuse the read-only list portion in #7.
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { StickyNote, Phone, Mail, Calendar, Paperclip, Trash2, Send, X, FileText } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/input';
import { activitiesApi, attachmentsApi, type Activity, type ActivityType } from '@/lib/api';

const TYPE_META: Record<ActivityType, { icon: typeof StickyNote; label: string; color: string }> = {
  NOTE:    { icon: StickyNote, label: '備註',     color: 'text-slate-500' },
  CALL:    { icon: Phone,      label: '電話',     color: 'text-emerald-500' },
  EMAIL:   { icon: Mail,       label: 'Email',   color: 'text-blue-500' },
  MEETING: { icon: Calendar,   label: '會議',     color: 'text-amber-500' },
};

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

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export interface ActivityFeedProps {
  /** When set, filters the feed to this company. */
  companyId?: string;
  /** When set, filters the feed to this deal. Takes precedence over companyId. */
  dealId?: string;
  /** Cap the list size. Default 50. Set to 5 for a compact "recent" widget. */
  limit?: number;
  /** Hide the composer at the top. Useful for read-only widgets like Dashboard. */
  readOnly?: boolean;
  /** Optional override title (default: "Activity"). */
  title?: string;
}

export function ActivityFeed({
  companyId,
  dealId,
  limit = 50,
  readOnly = false,
  title = 'Activity',
}: ActivityFeedProps) {
  const queryKey = companyId
    ? ['activities', { companyId, limit }]
    : dealId
      ? ['activities', { dealId, limit }]
      : ['activities', { limit }];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => activitiesApi.list({ companyId, dealId, limit }),
  });
  const items = data?.items ?? [];

  if (readOnly) {
    return <ActivityList items={items} isLoading={isLoading} />;
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title} ({items.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Composer companyId={companyId} dealId={dealId} queryKey={queryKey} />
        <ActivityList items={items} isLoading={isLoading} />
      </CardContent>
    </Card>
  );
}

/** Read-only list renderer — shared between the full feed and the
 *  Dashboard's "recent" widget so styling stays consistent. */
function ActivityList({ items, isLoading }: { items: Activity[]; isLoading: boolean }) {
  if (isLoading) {
    return <p className="text-sm text-muted-foreground p-2">載入中...</p>;
  }
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-6">
        仲未有 Activity 記錄
      </p>
    );
  }
  return (
    <ul className="space-y-3">
      {items.map((a) => (
        <ActivityItem key={a.id} activity={a} />
      ))}
    </ul>
  );
}

function ActivityItem({ activity }: { activity: Activity }) {
  const meta = TYPE_META[activity.type] ?? TYPE_META.NOTE;
  const Icon = meta.icon;
  return (
    <li className="flex gap-3 p-3 rounded-lg border bg-card">
      <div className={`shrink-0 mt-0.5 ${meta.color}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <Badge variant="outline" className="text-[10px]">{meta.label}</Badge>
          {activity.author && (
            <span className="font-medium text-foreground">
              {activity.author.name}
            </span>
          )}
          <span className="text-muted-foreground">
            {relativeTime(activity.createdAt)}
          </span>
        </div>
        {activity.content && (
          <p className="text-sm whitespace-pre-wrap break-words">
            {activity.content}
          </p>
        )}
        {activity.attachments && activity.attachments.length > 0 && (
          <ul className="flex flex-wrap gap-1.5 pt-1">
            {activity.attachments.map((att) => (
              <li
                key={att.id}
                className="inline-flex items-center gap-1 text-xs bg-muted px-2 py-1 rounded"
              >
                <FileText className="h-3 w-3 text-muted-foreground" />
                <span className="truncate max-w-[200px]">{att.fileName}</span>
                <span className="text-muted-foreground">{formatBytes(att.sizeBytes)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

/** Composer — text area + file picker. On submit:
 *    1. POST /activities  → get back { id }
 *    2. POST /activities/:id/attachments per picked file
 *    3. Invalidate the feed query so the new item + attachments appear. */
function Composer({
  companyId,
  dealId,
  queryKey,
}: {
  companyId?: string;
  dealId?: string;
  queryKey: readonly unknown[];
}) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [content, setContent] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Auto-grow the textarea up to ~6 lines so the composer doesn't
  // take over the page when the user pastes a long note.
  useEffect(() => {
    const el = document.getElementById('activity-composer') as HTMLTextAreaElement | null;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [content]);

  const submit = useMutation({
    mutationFn: async () => {
      const trimmed = content.trim();
      if (!trimmed && files.length === 0) {
        throw new Error('請輸入內容或加入附件');
      }
      const act = await activitiesApi.create({
        type: 'NOTE',
        content: trimmed,
        ...(companyId ? { companyId } : {}),
        ...(dealId ? { dealId } : {}),
      });
      // Upload each file. Sequential to keep the activity visible in
      // the backend audit log in upload order; the network roundtrip
      // is cheap because nginx already buffers the multipart body.
      for (const f of files) {
        await attachmentsApi.upload(act.id, f);
      }
      return act;
    },
    onSuccess: () => {
      setContent('');
      setFiles([]);
      setError(null);
      qc.invalidateQueries({ queryKey: ['activities'] });
    },
    onError: (e) => setError((e as Error).message),
  });

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFiles((prev) => [...prev, ...Array.from(list)]);
  }

  return (
    <div className="space-y-2 border rounded-lg p-3 bg-muted/30">
      <Textarea
        id="activity-composer"
        placeholder="寫低 follow-up 進度、客戶 reply、打咗電話嘅 outcome…"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={2}
        className="resize-none"
      />
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className="inline-flex items-center gap-1 text-xs bg-background border px-2 py-1 rounded"
            >
              <Paperclip className="h-3 w-3 text-muted-foreground" />
              <span className="truncate max-w-[180px]">{f.name}</span>
              <span className="text-muted-foreground">{formatBytes(f.size)}</span>
              <button
                type="button"
                aria-label={`移除 ${f.name}`}
                onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                className="text-muted-foreground hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={submit.isPending}
        >
          <Paperclip className="h-3.5 w-3.5 mr-1" /> 加附件
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
        />
        <Button
          type="button"
          size="sm"
          onClick={() => submit.mutate()}
          disabled={submit.isPending || (!content.trim() && files.length === 0)}
        >
          <Send className="h-3.5 w-3.5 mr-1" />
          {submit.isPending ? '儲存中…' : '新增'}
        </Button>
      </div>
    </div>
  );
}

/**
 * RecentActivitiesWidget — slim wrapper for the Dashboard. Uses the
 * global /activities/recent endpoint and renders read-only.
 */
export function RecentActivitiesWidget({ limit = 10 }: { limit?: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ['activities', { recent: true, limit }],
    queryFn: () => activitiesApi.recent({ limit }),
  });
  const items = data?.items ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>最近 Activity</CardTitle>
      </CardHeader>
      <CardContent>
        <ActivityList items={items} isLoading={isLoading} />
      </CardContent>
    </Card>
  );
}

/* Re-export so other files (e.g. company detail) can show a delete
 * button without rebuilding the same mutation boilerplate. */
export function useDeleteActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => activitiesApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['activities'] }),
  });
}

/* Internal helper for the "remove this activity" affordance. Currently
 * not mounted in the read-only list (kept for future admin tools). */
export function DeleteActivityButton({ id, onDone }: { id: string; onDone?: () => void }) {
  const del = useDeleteActivity();
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label="刪除 activity"
      onClick={() => {
        if (!confirm('確定刪除呢個 activity?')) return;
        del.mutate(id, { onSuccess: onDone });
      }}
      disabled={del.isPending}
    >
      <Trash2 className="h-3 w-3 text-destructive" />
    </Button>
  );
}
