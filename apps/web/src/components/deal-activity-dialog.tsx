/**
 * DealActivityDialog — quick composer for logging follow-up activity
 * against a specific deal. Shown when a Sales rep clicks "＋ Activity"
 * on a deal card in the Kanban board (Day N+1).
 *
 * This is a write-only dialog — the deal's full Activity feed lives
 * inside the company detail page (and on the dashboard's recent
 * widget). Here we only need the "post a new note + attach files"
 * affordance, so the dialog is the composer half of ActivityFeed
 * (text + attachments) rewrapped in a modal.
 *
 * Submission:
 *   1. POST /activities with the typed content (and dealId)
 *   2. POST /activities/:id/attachments per picked file
 *   3. Invalidate ['activities'] so the company feed picks up the new
 *      row, and ['deal', dealId] (or the deals-kanban cache) so the
 *      dashboard's "recent activity" widget shows it.
 */

import { useEffect, useRef, useState } from 'react';
import { Paperclip, Send, X, Loader2, StickyNote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/input';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { activitiesApi, attachmentsApi, type ActivityType } from '@/lib/api';
import { ACTIVITY_TYPE_META } from '@/components/activity-feed';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export interface DealActivityDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Deal the activity is being logged against. */
  dealId: string;
  /** Optional display context — shown in the dialog title. */
  dealTitle?: string;
}

export function DealActivityDialog({
  open, onOpenChange, dealId, dealTitle,
}: DealActivityDialogProps) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 2026-06-30: let the sales rep pick the activity type (備註 / 電話
  // / Email / 會議) up-front, matching the home-page edit dialog.
  // Previously this dialog hard-coded `type: 'NOTE'` which meant
  // calls and meetings had to be logged via the edit dialog after
  // the fact — defeating the purpose of "新增 Activity" on the deal
  // card. Default stays NOTE to preserve the common case.
  const [type, setType] = useState<ActivityType>('NOTE');
  const [content, setContent] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Reset the form when the dialog opens so a previous half-typed note
  // doesn't leak into the next deal.
  useEffect(() => {
    if (open) {
      setType('NOTE');
      setContent('');
      setFiles([]);
      setError(null);
    }
  }, [open]);

  // Auto-grow the textarea up to ~6 lines so the composer doesn't
  // take over the dialog when the user pastes a long note.
  useEffect(() => {
    const el = document.getElementById('deal-activity-composer') as HTMLTextAreaElement | null;
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
        type,
        content: trimmed,
        dealId,
      });
      // Sequential uploads so the backend audit log lists them in order.
      // nginx already buffers the multipart body so the roundtrip is
      // cheap.
      for (const f of files) {
        await attachmentsApi.upload(act.id, f);
      }
      return act;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['activities'] });
      qc.invalidateQueries({ queryKey: ['deals-kanban'] });
      onOpenChange(false);
    },
    onError: (e) => setError(e instanceof Error ? e.message : '儲存失敗'),
  });

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFiles((prev) => [...prev, ...Array.from(list)]);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <StickyNote className="h-4 w-4 text-slate-500" />
            新增 Activity{dealTitle ? ` · ${dealTitle}` : ''}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground" htmlFor="deal-activity-type">類型</label>
            <select
              id="deal-activity-type"
              value={type}
              onChange={(e) => setType(e.target.value as ActivityType)}
              className="w-full h-9 rounded border bg-background px-2 text-sm mt-1"
              data-testid="deal-activity-type"
            >
              {(['NOTE', 'CALL', 'EMAIL', 'MEETING'] as ActivityType[]).map((t) => (
                <option key={t} value={t}>{ACTIVITY_TYPE_META[t].label}</option>
              ))}
            </select>
          </div>
          <Textarea
            id="deal-activity-composer"
            placeholder="寫低 follow-up 進度、客戶 reply、打咗電話嘅 outcome…"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={3}
            className="resize-none"
            autoFocus
          />
          {files.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {files.map((f, i) => (
                <li
                  key={`${f.name}-${i}`}
                  className="inline-flex items-center gap-1 text-xs bg-muted px-2 py-1 rounded"
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
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="ghost"
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
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={submit.isPending}
          >
            取消
          </Button>
          <Button
            type="button"
            onClick={() => submit.mutate()}
            disabled={submit.isPending || (!content.trim() && files.length === 0)}
          >
            {submit.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1" />}
            儲存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
