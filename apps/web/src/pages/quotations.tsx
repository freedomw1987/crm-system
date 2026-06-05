import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FileText, Plus, Sparkles, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/input';
import { quotationsApi, chatApi } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';

export function QuotationsPage() {
  const navigate = useNavigate();
  const { data: quotations = [], isLoading } = useQuery({
    queryKey: ['quotations'],
    queryFn: () => quotationsApi.list({ limit: 50 }),
  });

  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  async function handleAiDraft() {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    setAiError(null);
    try {
      // Send prompt to AI agent which may call draft_quotation tool
      const result = await chatApi.send(aiPrompt);
      const quotationToolCall = result.toolCalls.find((tc) => tc.name === 'draft_quotation');
      if (quotationToolCall) {
        const draftResult = quotationToolCall.result as { quotationId?: string };
        if (draftResult?.quotationId) {
          setAiOpen(false);
          setAiPrompt('');
          navigate(`/quotations/${draftResult.quotationId}`);
          return;
        }
      }
      // No quotation drafted — keep dialog open with reply
      setAiError('AI 冇整到 quotation,睇下 chat 了解詳情');
    } catch (err) {
      setAiError((err as Error).message);
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Quotations</h1>
          <p className="text-muted-foreground">所有報價單</p>
        </div>
        <div className="flex gap-2">
          <Dialog open={aiOpen} onOpenChange={setAiOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Sparkles className="h-4 w-4 mr-2" />
                AI Draft
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>AI 報價助手</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  用自然語言講你想點報,例如:
                </p>
                <ul className="text-xs text-muted-foreground list-disc pl-5 space-y-1">
                  <li>「幫 ABC Company 開個 5 個 AC01 同 2 個 AC02 嘅 quotation」</li>
                  <li>「幫我整個 deal 客戶嘅 starter pack」</li>
                </ul>
                <Textarea
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="你想點報..."
                  rows={4}
                />
                {aiError && (
                  <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded">
                    {aiError}
                  </p>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAiOpen(false)}>
                  取消
                </Button>
                <Button onClick={handleAiDraft} disabled={aiLoading || !aiPrompt.trim()}>
                  {aiLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      AI 諗緊...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4 mr-2" />
                      生成草稿
                    </>
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">載入中...</p>
      ) : quotations.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
            未有報價單,試下用 AI 整一個
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b">
                  <tr className="text-left">
                    <th className="px-4 py-3 font-medium">Number</th>
                    <th className="px-4 py-3 font-medium">Company</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium text-right">Total</th>
                    <th className="px-4 py-3 font-medium">Created</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {quotations.map((q) => (
                    <tr key={q.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3 font-mono text-xs">
                        {q.generatedByAi && (
                          <Sparkles className="inline h-3 w-3 mr-1 text-purple-600" />
                        )}
                        {q.number}
                      </td>
                      <td className="px-4 py-3">{q.company?.name ?? '—'}</td>
                      <td className="px-4 py-3">
                        <QuotationStatusBadge status={q.status} />
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">
                        {formatCurrency(q.total)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {formatDate(q.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button asChild variant="ghost" size="sm">
                          <Link to={`/quotations/${q.id}`}>查看</Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function QuotationStatusBadge({ status }: { status: string }) {
  const map: Record<string, 'default' | 'secondary' | 'info' | 'success' | 'warning' | 'destructive'> = {
    DRAFT: 'secondary',
    SENT: 'info',
    VIEWED: 'info',
    ACCEPTED: 'success',
    REJECTED: 'destructive',
    EXPIRED: 'warning',
    INVOICED: 'success',
  };
  return <Badge variant={map[status] ?? 'default'}>{status}</Badge>;
}

// Re-export for use in router
export { Plus };
