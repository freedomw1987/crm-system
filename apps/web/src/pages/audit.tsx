import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, Label } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { auditApi, type AuditAction, type AuditLog } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';

// Display labels for each action
const ACTION_LABELS: Record<AuditAction, { label: string; variant: 'default' | 'info' | 'success' | 'warning' | 'destructive' | 'secondary' }> = {
  USER_LOGIN:              { label: '登入',         variant: 'success' },
  USER_LOGIN_FAILED:       { label: '登入失敗',     variant: 'destructive' },
  USER_LOGOUT:             { label: '登出',         variant: 'secondary' },
  PASSWORD_CHANGED:        { label: '改密碼',       variant: 'info' },
  USER_CREATED:            { label: '新增用戶',     variant: 'default' },
  USER_UPDATED:            { label: '更新用戶',     variant: 'default' },
  USER_DEACTIVATED:        { label: '停用用戶',     variant: 'warning' },
  USER_REACTIVATED:        { label: '重啟用戶',     variant: 'success' },
  USER_DELETED:            { label: '刪除用戶',     variant: 'destructive' },
  PASSWORD_RESET:          { label: '重設密碼',     variant: 'info' },
  QUOTATION_CREATED:       { label: '新增報價',     variant: 'default' },
  QUOTATION_UPDATED:       { label: '更新報價',     variant: 'default' },
  QUOTATION_DELETED:       { label: '刪除報價',     variant: 'destructive' },
  QUOTATION_STATUS_CHANGED:{ label: '報價狀態變更', variant: 'info' },
  COMPANY_CREATED:         { label: '新增公司',     variant: 'default' },
  COMPANY_UPDATED:         { label: '更新公司',     variant: 'default' },
  COMPANY_DELETED:         { label: '刪除公司',     variant: 'destructive' },
  CONTACT_CREATED:         { label: '新增聯絡人',   variant: 'default' },
  CONTACT_UPDATED:         { label: '更新聯絡人',   variant: 'default' },
  CONTACT_DELETED:         { label: '刪除聯絡人',   variant: 'destructive' },
  DEAL_CREATED:            { label: '新增 Deal',    variant: 'default' },
  DEAL_UPDATED:            { label: '更新 Deal',    variant: 'default' },
  DEAL_DELETED:            { label: '刪除 Deal',    variant: 'destructive' },
};

export function AuditPage() {
  const [action, setAction] = useState<string>('');
  const [actorId, setActorId] = useState<string>('');
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['audit', { action, actorId, search }],
    queryFn: () => auditApi.list({
      action: action || undefined,
      actorId: actorId || undefined,
      resourceId: search || undefined,
      limit: 100,
    }),
  });
  const items = data?.items ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Audit Log</h1>
        <p className="text-muted-foreground">所有用戶喺系統上嘅操作記錄</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="search">Resource ID</Label>
          <Input
            id="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="resource id 篩選"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="action">Action</Label>
          <Select id="action" value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">全部 Action</option>
            {Object.entries(ACTION_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v.label} ({k})</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="actor">Actor ID</Label>
          <Input id="actor" value={actorId} onChange={(e) => setActorId(e.target.value)} placeholder="user id 篩選" />
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">載入中...</p>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            <History className="h-12 w-12 mx-auto mb-3 opacity-50" />
            冇 audit event
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b">
                  <tr className="text-left">
                    <th className="px-4 py-3 font-medium">When</th>
                    <th className="px-4 py-3 font-medium">Actor</th>
                    <th className="px-4 py-3 font-medium">Action</th>
                    <th className="px-4 py-3 font-medium">Resource</th>
                    <th className="px-4 py-3 font-medium">Detail</th>
                    <th className="px-4 py-3 font-medium">IP</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((e) => (
                    <AuditRow key={e.id} event={e} />
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

function AuditRow({ event }: { event: AuditLog }) {
  const meta = ACTION_LABELS[event.action];
  return (
    <tr className="border-b last:border-0 hover:bg-muted/30">
      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
        {formatDateTime(event.createdAt)}
      </td>
      <td className="px-4 py-3 text-xs">
        {event.actor ? (
          <div>
            <div className="font-medium">{event.actor.name}</div>
            <div className="text-muted-foreground">{event.actor.email}</div>
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-4 py-3">
        <Badge variant={meta.variant}>{meta.label}</Badge>
      </td>
      <td className="px-4 py-3 text-xs">
        {event.resourceType && (
          <div>
            <span className="font-medium">{event.resourceType}</span>
            {event.resourceId && (
              <div className="text-muted-foreground font-mono">{event.resourceId.slice(0, 12)}…</div>
            )}
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground max-w-xs truncate">
        {event.description ?? '—'}
      </td>
      <td className="px-4 py-3 text-xs font-mono text-muted-foreground">
        {event.ipAddress ?? '—'}
      </td>
    </tr>
  );
}
