import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { History } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, Label } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { auditApi, type AuditAction, type AuditLog } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';

// Display variants for each action. The label is resolved at render time
// via t(`audit.actions.${action}`); only the visual variant (which feeds
// the Badge component) lives in this map.
//
// Why split label/variant: t() is a hook and can't be called inside a
// module-level object literal, so we keep the variant map here and look
// up the label from the i18n bundle inside the components that render.
//
// Unknown actions (e.g. a future backend enum we haven't mapped yet)
// fall back to a secondary gray badge showing the raw enum — see the
// `?? FALLBACK` line in AuditRow. That fallback is the only thing keeping
// the page from crashing when the backend emits an action we forgot to
// add here, so KEEP IT even when extending this map.
const ACTION_VARIANTS: Record<AuditAction, 'default' | 'info' | 'success' | 'warning' | 'destructive' | 'secondary'> = {
  USER_LOGIN:              'success',
  USER_LOGIN_FAILED:       'destructive',
  USER_LOGOUT:             'secondary',
  PASSWORD_CHANGED:        'info',
  USER_CREATED:            'default',
  USER_UPDATED:            'default',
  USER_DEACTIVATED:        'warning',
  USER_REACTIVATED:        'success',
  USER_DELETED:            'destructive',
  PASSWORD_RESET:          'info',
  QUOTATION_CREATED:       'default',
  QUOTATION_UPDATED:       'default',
  QUOTATION_DELETED:       'destructive',
  QUOTATION_STATUS_CHANGED:'info',
  COMPANY_CREATED:         'default',
  COMPANY_UPDATED:         'default',
  COMPANY_DELETED:         'destructive',
  CONTACT_CREATED:         'default',
  CONTACT_UPDATED:         'default',
  CONTACT_DELETED:         'destructive',
  DEAL_CREATED:            'default',
  DEAL_UPDATED:            'default',
  DEAL_DELETED:            'destructive',
  DEAL_STAGE_CHANGED:      'info',
  PRODUCT_CREATED:         'default',
  PRODUCT_UPDATED:         'default',
  PRODUCT_DELETED:         'destructive',
  SERVICE_CREATED:         'default',
  SERVICE_UPDATED:         'default',
  SERVICE_DELETED:         'destructive',
  ROLE_CREATED:            'default',
  ROLE_UPDATED:            'default',
  ROLE_DELETED:            'destructive',
  REGION_CREATED:          'default',
  REGION_UPDATED:          'default',
  REGION_DELETED:          'destructive',
};

const FALLBACK_VARIANT = 'secondary' as const;
function getActionVariant(action: string) {
  return ACTION_VARIANTS[action as AuditAction] ?? FALLBACK_VARIANT;
}

export function AuditPage() {
  // Day 14.7 Step 7/12 — initial filter values can be passed via query
  // string so cross-tab links (e.g. Settings → Tax → "View audit log" with
  // `?action=SYSTEM_CONFIG_UPDATED`) land pre-filtered.
  //
  // Step 12 fix: Step 7 used `useState(searchParams.get('action'))` which
  // only reads the URL on mount. When the user navigates between audit
  // pages via in-app <Link> clicks, react-router v7 reuses the existing
  // component (no remount) so the filter state would NOT update from the
  // new query string — the URL changes but the select/input stays on
  // whatever the user last typed. The useEffect below syncs the URL
  // → state on every searchParams change so deep links work whether you
  // arrive via direct nav, browser back/forward, or in-app link.
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const [action, setAction] = useState<string>(searchParams.get('action') ?? '');
  const [actorId, setActorId] = useState<string>(searchParams.get('actorId') ?? '');
  const [search, setSearch] = useState(searchParams.get('resourceId') ?? '');

  useEffect(() => {
    setAction(searchParams.get('action') ?? '');
    setActorId(searchParams.get('actorId') ?? '');
    setSearch(searchParams.get('resourceId') ?? '');
  }, [searchParams]);

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
        <h1 className="text-2xl md:text-3xl font-bold">{t('audit.title')}</h1>
        <p className="text-muted-foreground">{t('audit.pageSubtitle')}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="search">{t('audit.filter.resourceIdLabel')}</Label>
          <Input
            id="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('audit.filter.resourceIdPlaceholder')}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="action">{t('audit.filter.action')}</Label>
          <Select id="action" value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">{t('audit.filter.allActionsLabel')}</option>
            {Object.entries(ACTION_VARIANTS).map(([k]) => (
              <option key={k} value={k}>{t('audit.actionOption', { label: t(`audit.actions.${k}` as const), key: k })}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="actor">{t('audit.filter.actorIdLabel')}</Label>
          <Input id="actor" value={actorId} onChange={(e) => setActorId(e.target.value)} placeholder={t('audit.filter.actorIdPlaceholder')} />
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t('audit.loading')}</p>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            <History className="h-12 w-12 mx-auto mb-3 opacity-50" />
            {t('audit.empty')}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b">
                  <tr className="text-left">
                    <th className="px-4 py-3 font-medium">{t('audit.table.timestamp')}</th>
                    <th className="px-4 py-3 font-medium">{t('audit.table.actor')}</th>
                    <th className="px-4 py-3 font-medium">{t('audit.table.action')}</th>
                    <th className="px-4 py-3 font-medium">{t('audit.table.entity')}</th>
                    <th className="px-4 py-3 font-medium">{t('audit.table.details')}</th>
                    <th className="px-4 py-3 font-medium">{t('audit.table.ipAddress')}</th>
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
  const { t } = useTranslation();
  // Use the safe accessor so a missing label (e.g. a brand-new backend
  // action we haven't mapped yet) doesn't take down the entire row with
  // a "Cannot read properties of undefined (reading 'variant')" error.
  const variant = getActionVariant(event.action);
  // Only attempt i18n lookup for actions we've mapped; unknown actions
  // (future backend enums) fall through to the raw enum so the row still
  // renders something useful.
  const known = (event.action in ACTION_VARIANTS);
  const label = known ? t(`audit.actions.${event.action}` as const) : event.action;
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
        <Badge variant={variant}>{label}</Badge>
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
