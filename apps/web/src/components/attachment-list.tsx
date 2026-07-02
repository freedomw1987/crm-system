/**
 * AttachmentList — flat list of every file attached to any activity
 * scoped to a company. Wraps `attachmentsApi.forCompany` and renders
 * each row as a download affordance.
 *
 * Used as the "附件" tab on the company detail page. The actual
 * upload path is the Activity composer (`<ActivityFeed>`); this list
 * is read-only and exists so users can find a file uploaded weeks ago
 * without scrolling through every activity item.
 *
 * Why fetch+blob (not a plain <a href>):
 * The download endpoint requires a JWT Bearer token. A plain <a href>
 * would hit the backend with no Authorization header, get 401, and
 * (worst case) leak the file body in the error response. The proper
 * path is fetch + Authorization header + blob + object URL, which lets
 * the browser save the file under its real Content-Disposition name.
 */

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Paperclip, Download, FileText, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { attachmentsApi, type Attachment } from '@/lib/api';
import { downloadAttachment } from '@/lib/attachment-download';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('zh-HK', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export interface AttachmentListProps {
  companyId: string;
}

export function AttachmentList({ companyId }: AttachmentListProps) {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({
    queryKey: ['attachments', { companyId }],
    queryFn: () => attachmentsApi.forCompany(companyId),
  });
  const items: Attachment[] = data?.items ?? [];
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload(att: Attachment) {
    setError(null);
    setDownloadingId(att.id);
    try {
      await downloadAttachment(att);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('attachment.downloadFailed'));
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Paperclip className="h-4 w-4" /> {t('attachment.title', { count: items.length })}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-6 text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin" /> {t('attachment.loading')}
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground p-6 text-center">
            {t('attachment.empty')}
          </p>
        ) : (
          <ul className="divide-y">
            {items.map((att) => (
              <li key={att.id} className="flex items-center gap-3 p-4">
                <div className="h-9 w-9 rounded bg-muted flex items-center justify-center shrink-0">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{att.fileName}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatBytes(att.sizeBytes)} · {formatDate(att.createdAt)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleDownload(att)}
                  disabled={downloadingId === att.id}
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline shrink-0 disabled:opacity-50"
                  title={t('attachment.download')}
                >
                  {downloadingId === att.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  )}
                  {t('attachment.download')}
                </button>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="text-sm text-destructive px-4 pb-3">{error}</p>}
      </CardContent>
    </Card>
  );
}
