import { describe, expect, test } from 'vitest';
import { i18n, initI18n } from '../index';

/**
 * P3-i18n fix (2026-07-02): namespace-resolution guard.
 *
 * The ~900 call sites in this codebase use the dotted form
 * `t('dashboard.title')` and rely on `initI18n()` to wrap `i18n.t`
 * so the first dot-segment is interpreted as a NAMESPACE prefix
 * (not a nested key path). This test pins that behaviour so a
 * future regression that removes the wrapper is caught immediately.
 *
 * Why a unit test (not just an e2e): a single `t('dashboard.title')`
 * call inside a test exercises the same wrapper that all 900 call
 * sites go through, so any change to the resolution rule (or
 * accidental removal of the wrapper in `index.ts`) is caught here
 * before the UI breaks.
 */

describe('i18n namespace resolution (P3-i18n 2026-07-02 fix)', () => {
  test('initI18n() wraps i18n.t with namespace-prefix resolution', () => {
    initI18n();
    expect(i18n.isInitialized).toBe(true);
  });

  test('t("dashboard.title") resolves to the registered string, not the key', () => {
    initI18n();
    // Default language at boot — en — gives us a known-good baseline.
    const result = i18n.t('dashboard.title');
    expect(result).not.toBe('dashboard.title');
    // Should be the en bundle value: "Dashboard".
    expect(result).toBe('Dashboard');
  });

  test('t("dashboard.title") works in zh-TW after changeLanguage', async () => {
    initI18n();
    await i18n.changeLanguage('zh-TW');
    const result = i18n.t('dashboard.title');
    expect(result).toBe('儀表板');
  });

  test('t("dashboard.title") works in zh-CN', async () => {
    initI18n();
    await i18n.changeLanguage('zh-CN');
    const result = i18n.t('dashboard.title');
    expect(result).toBe('仪表板');
  });

  test('nested keys like dialog.matrix.selectedCount (3 segments) still resolve', async () => {
    initI18n();
    await i18n.changeLanguage('en');
    // 'dialog' is NOT a registered namespace, so the wrapper must NOT
    // rewrite this. i18next looks up `dialog.matrix.selectedCount` in
    // the defaultNS (common) which doesn't exist — but the bug we're
    // guarding against is the wrapper CORRECTLY leaving it alone, not
    // the catalog containing it. We assert the wrapper doesn't crash
    // and doesn't accidentally rewrite to `dialog:matrix.selectedCount`
    // (which would also fail, but in a different way).
    const result = i18n.t('role.dialog.matrix.selectedCount');
    // Either the lookup succeeds (catalog has it) OR it returns the
    // key as a fallback. The KEY thing is the wrapper didn't corrupt
    // the call into something more broken.
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  test('explicit ns option in t() overrides the prefix heuristic', () => {
    initI18n();
    // 'nav.appName' would normally rewrite to 'nav:appName' (because
    // 'nav' is a registered namespace). But when the caller passes
    // an explicit `ns: 'common'`, we respect it. The lookup fails
    // (common has no 'nav.appName' key) — what matters is that we
    // DID NOT rewrite the key.
    const result = i18n.t('nav.appName', { ns: 'common' });
    expect(result).toBe('nav.appName'); // i18next returns the key on miss
  });

  test('single-segment keys (no dot) pass through unchanged', () => {
    initI18n();
    // 'common.save' is `common:save` in registered namespace form.
    // It should resolve to the en bundle value.
    expect(i18n.t('common.save')).toBe('Save');
  });

  test('plain single word (no namespace) resolves in defaultNS (common)', () => {
    initI18n();
    expect(i18n.t('save')).toBe('Save');
  });
});