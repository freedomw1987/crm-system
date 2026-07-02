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
import { useTranslation } from 'react-i18next';
import { StickyNote, Phone, Mail, Calendar, Paperclip, Trash2, Send, X, FileText, Download, Loader2, Pencil } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/input';
import { activitiesApi, attachmentsApi, type Activity, type ActivityType, type Attachment } from '@/lib/api';
import { downloadAttachment } from '@/lib/attachment-download';
import { useAuth } from '@/lib/auth';

// Icon + color stay as constant exports (they're not user-visible).
// Labels are computed via t('status.activity.<TYPE>') inside consumers
// so they pick up the active locale.
const TYPE_META: Record<ActivityType, { icon: typeof StickyNote; color: string }> = {
  NOTE:    { icon: StickyNote, color: 'text-slate-500' },
  CALL:    { icon: Phone,      color: 'text-emerald-500' },
  EMAIL:   { icon: Mail,       color: 'text-blue-500' },
  MEETING: { icon: Calendar,   color: 'text-amber-500' },
};
// 2026-06-30: re-export the icon/color table for sibling components
// (e.g. DealActivityDialog) so the "新增 Activity" picker on deal
// cards stays in lock-step with the edit dialog's dropdown. The
// labels are sourced from t('status.activity.<TYPE>') directly —
// kept in lock-step via the shared status namespace.
export const ACTIVITY_TYPE_META = TYPE_META;

/** Format an ISO timestamp as a short relative-time label.
 *  Pure of API calls — output respects the active locale. */
function relativeTime(iso: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return t('activity.time.justNow');
  const min = Math.floor(sec / 60);
  if (min < 60) return t('activity.time.minutesAgo', { count: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t('activity.time.hoursAgo', { count: hr });
  const day = Math.floor(hr / 24);
  if (day < 7) return t('activity.time.daysAgo', { count: day });
  return new Date(iso).toLocaleDateString();
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
  title,
}: ActivityFeedProps) {
  const { t } = useTranslation();
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
  const resolvedTitle = title ?? t('activity.title');

  if (readOnly) {
    return <ActivityList items={items} isLoading={isLoading} />;
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{resolvedTitle} ({items.length})</CardTitle>
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
  const { t } = useTranslation();
  if (isLoading) {
    return <p className="text-sm text-muted-foreground p-2">{t('common.loading')}</p>;
  }
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-6">
        {t('activity.empty.noRecords')}
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

export function ActivityItem({
  activity,
  /**
   * Visual variant. Different surfaces wrap ActivityItem in different
   * containers (e.g. DealsActivityPanel uses `<ul className="divide-y">`
   * with no per-row card chrome, while the company feed uses
   * `<ul className="space-y-3">` and wants each row to read as a
   * distinct card). Defaults to `'card'`.
   *   - 'card'  : bordered, rounded, bg-card, p-3 (the original look)
   *   - 'plain' : flush against a divide-y / hover-bg parent, p-4
   */
  variant = 'card',
}: {
  activity: Activity;
  variant?: 'card' | 'plain';
}) {
  const { t } = useTranslation();
  const meta = TYPE_META[activity.type] ?? TYPE_META.NOTE;
  const Icon = meta.icon;
  // 2026-06-27: own-activity edit/delete affordances. The buttons
  // are only mounted when the current user is the author — the
  // backend enforces the same rule (author-only on PATCH /
  // DELETE), so a non-author doesn't even see the controls.
  // `useDeleteActivity()` is a hook exposed by this file (see
  // bottom of file); we just call it here for the inline
  // confirm-and-delete flow.
  const currentUserId = useAuth((s) => s.user?.id);
  const isOwn = !!currentUserId && activity.author?.id === currentUserId;
  const qc = useQueryClient();
  const deleteActivity = useMutation({
    mutationFn: (id: string) => activitiesApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['activities'] }),
  });
  const [editOpen, setEditOpen] = useState(false);
  const [editType, setEditType] = useState<ActivityType>(activity.type);
  const [editContent, setEditContent] = useState(activity.content);
  const updateActivity = useMutation({
    mutationFn: (data: { type: ActivityType; content: string }) =>
      activitiesApi.update(activity.id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['activities'] });
      setEditOpen(false);
    },
  });
  // 2026-06-29: edit-time attachment CRUD. The dialog edits
  // type + content as one PATCH, but attachment upload/remove are
  // applied immediately and independently (each is its own
  // multipart POST / DELETE) so the user doesn't have to re-pick
  // files after a content edit. Author-only on the backend, but
  // we already gate the entire edit affordance on `isOwn`, so
  // these mutations are unreachable for non-authors.
  const editFileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingFiles, setUploadingFiles] = useState<
    Array<{ key: string; name: string; size: number; status: 'uploading' | 'error'; error?: string }>
  >([]);
  const removeAttachment = useMutation({
    mutationFn: (id: string) => attachmentsApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['activities'] }),
  });

  async function handleEditFilePick(list: FileList | null) {
    if (!list) return;
    // Snapshot the entries up front; `list` is a live FileList that
    // resets when the underlying input clears.
    const files = Array.from(list);
    for (const f of files) {
      const key = `${f.name}-${f.size}-${Date.now()}-${Math.random()}`;
      setUploadingFiles((prev) => [...prev, { key, name: f.name, size: f.size, status: 'uploading' }]);
      try {
        await attachmentsApi.upload(activity.id, f);
        // On success, refetch the feed. The new attachment transitions
        // from the "uploading" chip into the "saved" list automatically.
        qc.invalidateQueries({ queryKey: ['activities'] });
        setUploadingFiles((prev) => prev.filter((p) => p.key !== key));
      } catch (e) {
        setUploadingFiles((prev) =>
          prev.map((p) => p.key === key ? { ...p, status: 'error', error: (e as Error).message } : p)
        );
      }
    }
  }
  // Track per-attachment busy state so multiple attachments in the same
  // activity can be downloaded independently. Errors are kept as
  // {id, message} so the chip itself can show the failure inline.
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function handleDownload(att: Attachment) {
    setBusy((b) => ({ ...b, [att.id]: true }));
    setErrors((e) => {
      if (!(att.id in e)) return e;
      const { [att.id]: _omit, ...rest } = e;
      return rest;
    });
    try {
      await downloadAttachment(att);
    } catch (e) {
      setErrors((prev) => ({ ...prev, [att.id]: e instanceof Error ? e.message : t('activity.error.downloadFailed') }));
    } finally {
      setBusy((b) => ({ ...b, [att.id]: false }));
    }
  }

  return (
    <li className={
      variant === 'card'
        ? 'flex gap-3 p-3 rounded-lg border bg-card'
        : 'flex gap-3 p-4 hover:bg-muted/30 transition-colors'
    }>
      <div className={`shrink-0 mt-0.5 ${meta.color}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <Badge variant="outline" className="text-[10px]">{t(`status.activity.${activity.type}`)}</Badge>
          {activity.author && (
            <span className="font-medium text-foreground">
              {activity.author.name}
            </span>
          )}
          <span className="text-muted-foreground">
            {relativeTime(activity.createdAt, t)}
          </span>
          {/* 2026-06-29: deal / company context. Only the /activities/recent
              endpoint includes the joined deal/company objects, so this
              renders on the pipeline panel but not on the company feed
              (where the deal/company context is implicit from the page
              the user is on). Edit/delete buttons still come after. */}
          {activity.deal && (
            <span className="text-muted-foreground">
              · <span className="font-medium text-foreground">{activity.deal.title}</span>
            </span>
          )}
          {activity.company && !activity.deal && (
            <span className="text-muted-foreground">
              · <span className="font-medium text-foreground">{activity.company.name}</span>
            </span>
          )}
          {/* 2026-06-27: own-activity edit/delete affordances. Only
              rendered when the current user is the author. 2026-06-29
              bumped to always-visible icon chips (h-3.5 w-3.5 + border)
              — the previous hover-only 12px muted icons were effectively
              invisible to users. */}
          {isOwn && (
            <div className="ml-auto inline-flex items-center gap-1 shrink-0">
              <button
                type="button"
                aria-label={t('common.edit')}
                title={t('common.edit')}
                onClick={() => {
                  setEditType(activity.type);
                  setEditContent(activity.content);
                  setEditOpen(true);
                }}
                className="inline-flex items-center justify-center h-6 w-6 rounded border bg-background text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                data-testid="activity-edit"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                aria-label={t('common.delete')}
                title={t('common.delete')}
                onClick={() => {
                  if (!confirm(t('activity.delete.confirm'))) return;
                  deleteActivity.mutate(activity.id);
                }}
                disabled={deleteActivity.isPending}
                className="inline-flex items-center justify-center h-6 w-6 rounded border bg-background text-muted-foreground hover:text-destructive hover:bg-muted transition-colors disabled:opacity-50"
                data-testid="activity-delete"
              >
                {deleteActivity.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          )}
        </div>
        {activity.content && (
          <p className="text-sm whitespace-pre-wrap break-words">
            {activity.content}
          </p>
        )}
        {activity.attachments && activity.attachments.length > 0 && (
          <ul className="flex flex-wrap gap-1.5 pt-1">
            {activity.attachments.map((att) => (
              <li key={att.id} className="flex flex-col">
                <button
                  type="button"
                  onClick={() => handleDownload(att)}
                  disabled={!!busy[att.id]}
                  title={t('activity.attachment.download', { name: att.fileName })}
                  className="inline-flex items-center gap-1 text-xs bg-muted px-2 py-1 rounded hover:bg-muted/70 transition-colors disabled:opacity-50"
                >
                  {busy[att.id] ? (
                    <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                  ) : (
                    <FileText className="h-3 w-3 text-muted-foreground" />
                  )}
                  <span className="truncate max-w-[200px]">{att.fileName}</span>
                  <span className="text-muted-foreground">{formatBytes(att.sizeBytes)}</span>
                  <Download className="h-3 w-3 text-muted-foreground" />
                </button>
                {errors[att.id] && (
                  <span className="text-[10px] text-destructive mt-0.5 px-1">
                    {errors[att.id]}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {/* 2026-06-27: edit dialog. Only opened by the pencil button
          above, which is only rendered when the user is the
          author. The dialog pre-fills type + content; on save
          calls activitiesApi.update which triggers a query
          refetch so the new content shows immediately. */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('activity.edit.title')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">{t('activity.type')}</label>
              <select
                value={editType}
                onChange={(e) => setEditType(e.target.value as ActivityType)}
                className="w-full h-9 rounded border bg-background px-2 text-sm mt-1"
                data-testid="activity-edit-type"
              >
                {(['NOTE', 'CALL', 'EMAIL', 'MEETING'] as ActivityType[]).map((tt) => (
                  <option key={tt} value={tt}>{t(`status.activity.${tt}`)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">{t('activity.content')}</label>
              <Textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                rows={4}
                className="mt-1"
                data-testid="activity-edit-content"
              />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs text-muted-foreground">
                  {t('activity.edit.attachments', { count: (activity.attachments ?? []).length })}
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => editFileInputRef.current?.click()}
                  disabled={uploadingFiles.some((u) => u.status === 'uploading')}
                  data-testid="activity-edit-add-attachment"
                >
                  <Paperclip className="h-3.5 w-3.5 mr-1" /> {t('activity.attachment.add')}
                </Button>
                <input
                  ref={editFileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => { handleEditFilePick(e.target.files); e.target.value = ''; }}
                />
              </div>
              {((activity.attachments && activity.attachments.length > 0) || uploadingFiles.length > 0) && (
                <ul className="space-y-1.5 mt-1.5">
                  {(activity.attachments ?? []).map((att) => (
                    <li
                      key={att.id}
                      className="flex items-center gap-2 text-xs bg-muted/40 border rounded px-2 py-1.5"
                      data-testid="activity-edit-attachment-row"
                    >
                      <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="truncate flex-1" title={att.fileName}>{att.fileName}</span>
                      <span className="text-muted-foreground shrink-0">{formatBytes(att.sizeBytes)}</span>
                      <button
                        type="button"
                        aria-label={t('activity.attachment.download', { name: att.fileName })}
                        title={t('activity.attachment.download', { name: att.fileName })}
                        onClick={() => handleDownload(att as Attachment)}
                        disabled={!!busy[att.id]}
                        className="text-muted-foreground hover:text-foreground p-0.5 disabled:opacity-50"
                      >
                        {busy[att.id] ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        type="button"
                        aria-label={t('activity.attachment.remove', { name: att.fileName })}
                        title={t('activity.attachment.remove', { name: att.fileName })}
                        onClick={() => {
                          if (!confirm(t('activity.attachment.removeConfirm', { name: att.fileName }))) return;
                          removeAttachment.mutate(att.id);
                        }}
                        disabled={removeAttachment.isPending}
                        className="text-muted-foreground hover:text-destructive p-0.5 disabled:opacity-50"
                        data-testid="activity-edit-attachment-remove"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                  {uploadingFiles.map((u) => (
                    <li
                      key={u.key}
                      className={`flex items-center gap-2 text-xs border rounded px-2 py-1.5 ${
                        u.status === 'error' ? 'border-destructive/40 bg-destructive/5' : 'bg-muted/20 border-dashed'
                      }`}
                      data-testid="activity-edit-attachment-pending"
                    >
                      <Paperclip className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="truncate flex-1" title={u.name}>{u.name}</span>
                      <span className="text-muted-foreground shrink-0">{formatBytes(u.size)}</span>
                      {u.status === 'uploading' ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                      ) : (
                        <span className="text-destructive text-[10px]" title={u.error}>{t('activity.upload.failed')}</span>
                      )}
                      {u.status === 'error' && (
                        <button
                          type="button"
                          aria-label={t('activity.attachment.remove', { name: u.name })}
                          onClick={() => setUploadingFiles((prev) => prev.filter((p) => p.key !== u.key))}
                          className="text-muted-foreground hover:text-destructive p-0.5"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {updateActivity.error && (
              <p className="text-sm text-destructive">
                {(updateActivity.error as Error).message}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditOpen(false)} disabled={updateActivity.isPending}>{t('common.cancel')}</Button>
            <Button
              onClick={() => updateActivity.mutate({ type: editType, content: editContent })}
              disabled={updateActivity.isPending || editContent.trim().length === 0}
              data-testid="activity-edit-save"
            >
              {updateActivity.isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  {t('common.save')}…
                </>
              ) : t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
  const { t } = useTranslation();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 2026-06-30: let the rep pick the activity type up-front instead
  // of having to log everything as NOTE then change it via the edit
  // dialog. Default NOTE preserves the common case. Labels come from
  // the shared status.activity.* keys so this stays in lock-step with
  // the edit dialog + DealActivityDialog.
  const [type, setType] = useState<ActivityType>('NOTE');
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
        throw new Error(t('activity.error.contentOrAttachmentRequired'));
      }
      const act = await activitiesApi.create({
        type,
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
      <div>
        <label className="text-xs text-muted-foreground" htmlFor="activity-composer-type">{t('activity.type')}</label>
        <select
          id="activity-composer-type"
          value={type}
          onChange={(e) => setType(e.target.value as ActivityType)}
          className="w-full h-9 rounded border bg-background px-2 text-sm mt-1"
          data-testid="activity-composer-type"
        >
          {(['NOTE', 'CALL', 'EMAIL', 'MEETING'] as ActivityType[]).map((tt) => (
            <option key={tt} value={tt}>{t(`status.activity.${tt}`)}</option>
          ))}
        </select>
      </div>
      <Textarea
        id="activity-composer"
        placeholder={t('activity.composer.placeholder')}
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
                aria-label={t('activity.attachment.remove', { name: f.name })}
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
          <Paperclip className="h-3.5 w-3.5 mr-1" /> {t('activity.attachment.add')}
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
          {submit.isPending ? t('common.loading') : t('activity.composer.saveButton')}
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
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({
    queryKey: ['activities', { recent: true, limit }],
    queryFn: () => activitiesApi.recent({ limit }),
  });
  const items = data?.items ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('activity.panel.title')}</CardTitle>
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
  const { t } = useTranslation();
  const del = useDeleteActivity();
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={t('common.delete')}
      onClick={() => {
        if (!confirm(t('activity.delete.confirm'))) return;
        del.mutate(id, { onSuccess: onDone });
      }}
      disabled={del.isPending}
    >
      <Trash2 className="h-3 w-3 text-destructive" />
    </Button>
  );
}
