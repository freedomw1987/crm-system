/**
 * AI Configuration page (Day 10+)
 *
 * Admin-only form at /admin/ai-config for setting the external LLM
 * provider (endpoint URL, API key, model name) that powers the AI
 * Assistant. The api key is stored encrypted at rest on the server
 * (AES-256-GCM keyed off AI_CONFIG_ENCRYPTION_KEY) and never returned
 * to the client in plaintext — the GET endpoint returns a masked
 * representation (e.g. "sk-p...1234") so admins can confirm a key is
 * set without seeing it.
 *
 * Security / UX:
 * - The api key is always presented as a password input. The masked
 *   value is shown as placeholder text only. To "rotate" the key the
 *   admin types a new one and saves; the previous one is overwritten
 *   on the server.
 * - We never pre-fill the api key field. This avoids a class of leaks
 *   where a screenshot or shoulder-surf would expose the live key.
 * - The Save button is disabled while the key field is empty (i.e.
 *   the admin must explicitly re-enter the key on every save).
 * - A "Connection test" button hits a tiny LLM ping endpoint (see
 *   routes/ai-config.ts) to verify the saved config is reachable.
 *   This is the only feedback channel for "is the endpoint correct?"
 *   short of sending a real chat message and watching it 500.
 */

import { useEffect, useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Sparkles, Eye, EyeOff, Loader2, CheckCircle2, AlertCircle, TestTube2 } from 'lucide-react';
import { aiConfigApi, type AiConfigResponse } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/lib/auth';
import { apiUrl } from '@/lib/runtime-paths';

interface TestResult {
  ok: boolean;
  message: string;
  latencyMs?: number;
}

export function AiConfigPage() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const isAdmin = user?.role === 'ADMIN';

  const [endpointUrl, setEndpointUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [modelName, setModelName] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const { data: config, isLoading } = useQuery({
    queryKey: ['ai-config'],
    queryFn: () => aiConfigApi.get(),
    enabled: isAdmin,
  });

  // Populate the form when the GET resolves. We only set the api key
  // field if the user explicitly clicks "rotate" — otherwise we leave
  // it blank so an unsaved keystroke can never accidentally clear the
  // real key on the server.
  useEffect(() => {
    if (config && !hydrated) {
      setEndpointUrl(config.endpointUrl);
      setModelName(config.modelName);
      setSystemPrompt(config.systemPrompt);
      setHydrated(true);
    }
  }, [config, hydrated]);

  const saveMutation = useMutation({
    mutationFn: () => aiConfigApi.save({ endpointUrl, apiKey, modelName, systemPrompt }),
    onSuccess: () => {
      setApiKey(''); // clear from form so it's not sitting in the DOM
      qc.invalidateQueries({ queryKey: ['ai-config'] });
      qc.invalidateQueries({ queryKey: ['ai-config-status'] });
    },
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      const start = Date.now();
      const r = await fetch(apiUrl('/ai/config/test'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('crm:token')}` },
        body: JSON.stringify({ endpointUrl, modelName, apiKey: apiKey || '__use_saved__' }),
      });
      const latencyMs = Date.now() - start;
      const body = await r.json().catch(() => ({}));
      if (!r.ok) return { ok: false, message: body?.error ?? `HTTP ${r.status}`, latencyMs };
      return { ok: true, message: body?.message ?? 'Connection successful', latencyMs };
    },
    onSuccess: (result) => setTestResult(result),
  });

  if (!isAdmin) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-muted-foreground">
          <Sparkles className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>{t('ai.config.fields.adminOnly')}</p>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>;
  }

  const canSave = endpointUrl.trim() && apiKey.trim() && modelName.trim() && !saveMutation.isPending;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
          <Sparkles className="h-7 w-7" /> {t('ai.config.title')}
        </h1>
        <p className="text-muted-foreground">
          {t('ai.config.subtitle')}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('ai.config.providerCard.title')}</CardTitle>
          <CardDescription>
            {t('ai.config.providerCard.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Status pill */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{t('ai.config.fields.statusLabel')}</span>
            {config?.configured ? (
              <Badge variant="default" className="bg-green-600">
                <CheckCircle2 className="h-3 w-3 mr-1" /> {t('ai.config.fields.configured')}
              </Badge>
            ) : (
              <Badge variant="secondary">
                <AlertCircle className="h-3 w-3 mr-1" /> {t('ai.config.fields.notConfigured')}
              </Badge>
            )}
            {config?.updatedAt && (
              <span className="text-xs text-muted-foreground">
                · {config.updatedByName
                  ? t('ai.config.fields.lastUpdatedBy', { date: new Date(config.updatedAt).toLocaleString(), name: config.updatedByName })
                  : t('ai.config.fields.lastUpdated', { date: new Date(config.updatedAt).toLocaleString() })}
              </span>
            )}
          </div>

          {/* Endpoint URL */}
          <div className="space-y-1.5">
            <Label htmlFor="endpointUrl">{t('ai.config.fields.endpointUrl')}</Label>
            <Input
              id="endpointUrl"
              value={endpointUrl}
              onChange={(e) => setEndpointUrl(e.target.value)}
              placeholder={t('ai.config.fields.endpointUrlPlaceholder')}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              <Trans
                i18nKey="ai.config.fields.endpointUrlHint"
                values={{
                  openai: 'https://api.openai.com/v1',
                  openrouter: 'https://openrouter.ai/api/v1',
                  vllm: 'http://localhost:8000/v1',
                }}
                components={{
                  openai: <code />,
                  openrouter: <code />,
                  vllm: <code />,
                }}
              />
            </p>
          </div>

          {/* API Key */}
          <div className="space-y-1.5">
            <Label htmlFor="apiKey">{t('ai.config.apiKey')} *</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  id="apiKey"
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={config?.hasApiKey
                    ? t('ai.config.fields.apiKeyCurrentHint', { mask: config.apiKeyMasked })
                    : t('ai.config.fields.apiKeyPlaceholder')}
                  autoComplete="off"
                  className="pr-10 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                  aria-label={showKey ? t('ai.config.fields.hideKey') : t('ai.config.fields.showKey')}
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('ai.config.fields.apiKeyHint')}
            </p>
          </div>

          {/* Model Name */}
          <div className="space-y-1.5">
            <Label htmlFor="modelName">{t('ai.config.fields.modelName')}</Label>
            <Input
              id="modelName"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              placeholder={t('ai.config.fields.modelNamePlaceholder')}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              {t('ai.config.fields.modelNameHint')}
            </p>
          </div>

          {/* System Prompt (optional) */}
          <div className="space-y-1.5">
            <Label htmlFor="systemPrompt">{t('ai.config.fields.systemPromptLabel')}</Label>
            <Textarea
              id="systemPrompt"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder={t('ai.config.fields.systemPromptPlaceholder')}
              rows={6}
            />
            <p className="text-xs text-muted-foreground">
              {t('ai.config.fields.systemPromptHint')}
            </p>
          </div>

          {/* Test result */}
          {testResult && (
            <div
              className={`p-3 rounded text-sm flex items-center gap-2 ${
                testResult.ok
                  ? 'bg-green-50 text-green-900 border border-green-200'
                  : 'bg-red-50 text-red-900 border border-red-200'
              }`}
            >
              {testResult.ok ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0" />
              )}
              <span>
                {testResult.message}
                {testResult.latencyMs !== undefined && t('ai.config.fields.latency', { ms: testResult.latencyMs })}
              </span>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Button onClick={() => saveMutation.mutate()} disabled={!canSave}>
              {saveMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              {t('ai.config.save')}
            </Button>
            <Button
              variant="outline"
              onClick={() => testMutation.mutate()}
              disabled={!endpointUrl.trim() || !modelName.trim() || testMutation.isPending}
            >
              {testMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <TestTube2 className="h-4 w-4 mr-2" />
              )}
              {t('ai.config.test')}
            </Button>
            {saveMutation.isSuccess && (
              <span className="text-sm text-green-700 flex items-center gap-1">
                <CheckCircle2 className="h-4 w-4" /> {t('ai.config.saved')}
              </span>
            )}
            {saveMutation.isError && (
              <span className="text-sm text-red-700 flex items-center gap-1">
                <AlertCircle className="h-4 w-4" /> {t('ai.config.errors.saveFailedWithMessage', { message: (saveMutation.error as Error).message })}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
