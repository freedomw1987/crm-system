import { describe, expect, test } from 'vitest';
import { i18n, initI18n } from '../index';
import { SUPPORTED_LNGS } from '../config';

/**
 * P3-i18n (2026-07-02): catalog-completeness guard.
 *
 * Every locale must define the SAME keys for the SAME namespaces.
 * This test reads each locale's namespace bundle and asserts that
 * the key set (computed by deep-flattening the JSON) is identical.
 *
 * Why this matters:
 *   - A missing key falls back to English at runtime (the `defaultValue`
 *     arg in `t()`) — silent in production, but embarrassing in QA.
 *   - Drift between locales (e.g. adding a key to en but forgetting
 *     zh-TW) shows up as a tiny English string inside an otherwise
 *     translated UI.
 *   - Cheap to compute; runs in <50ms.
 */

type Tree = string | { [k: string]: Tree };
const bundles: Record<(typeof SUPPORTED_LNGS)[number], Record<string, Tree>> = {
  en: {
    common: require('../../locales/en/common.json'),
    nav: require('../../locales/en/nav.json'),
    auth: require('../../locales/en/auth.json'),
    role: require('../../locales/en/role.json'),
    status: require('../../locales/en/status.json'),
    errors: require('../../locales/en/errors.json'),
    dashboard: require('../../locales/en/dashboard.json'),
    settings: require('../../locales/en/settings.json'),
    activity: require('../../locales/en/activity.json'),
    company: require('../../locales/en/company.json'),
    deal: require('../../locales/en/deal.json'),
    quotation: require('../../locales/en/quotation.json'),
    product: require('../../locales/en/product.json'),
    service: require('../../locales/en/service.json'),
    contact: require('../../locales/en/contact.json'),
    user: require('../../locales/en/user.json'),
    audit: require('../../locales/en/audit.json'),
    ai: require('../../locales/en/ai.json'),
    attachment: require('../../locales/en/attachment.json'),
  },
  'zh-TW': {
    common: require('../../locales/zh-TW/common.json'),
    nav: require('../../locales/zh-TW/nav.json'),
    auth: require('../../locales/zh-TW/auth.json'),
    role: require('../../locales/zh-TW/role.json'),
    status: require('../../locales/zh-TW/status.json'),
    errors: require('../../locales/zh-TW/errors.json'),
    dashboard: require('../../locales/zh-TW/dashboard.json'),
    settings: require('../../locales/zh-TW/settings.json'),
    activity: require('../../locales/zh-TW/activity.json'),
    company: require('../../locales/zh-TW/company.json'),
    deal: require('../../locales/zh-TW/deal.json'),
    quotation: require('../../locales/zh-TW/quotation.json'),
    product: require('../../locales/zh-TW/product.json'),
    service: require('../../locales/zh-TW/service.json'),
    contact: require('../../locales/zh-TW/contact.json'),
    user: require('../../locales/zh-TW/user.json'),
    audit: require('../../locales/zh-TW/audit.json'),
    ai: require('../../locales/zh-TW/ai.json'),
    attachment: require('../../locales/zh-TW/attachment.json'),
  },
  'zh-CN': {
    common: require('../../locales/zh-CN/common.json'),
    nav: require('../../locales/zh-CN/nav.json'),
    auth: require('../../locales/zh-CN/auth.json'),
    role: require('../../locales/zh-CN/role.json'),
    status: require('../../locales/zh-CN/status.json'),
    errors: require('../../locales/zh-CN/errors.json'),
    dashboard: require('../../locales/zh-CN/dashboard.json'),
    settings: require('../../locales/zh-CN/settings.json'),
    activity: require('../../locales/zh-CN/activity.json'),
    company: require('../../locales/zh-CN/company.json'),
    deal: require('../../locales/zh-CN/deal.json'),
    quotation: require('../../locales/zh-CN/quotation.json'),
    product: require('../../locales/zh-CN/product.json'),
    service: require('../../locales/zh-CN/service.json'),
    contact: require('../../locales/zh-CN/contact.json'),
    user: require('../../locales/zh-CN/user.json'),
    audit: require('../../locales/zh-CN/audit.json'),
    ai: require('../../locales/zh-CN/ai.json'),
    attachment: require('../../locales/zh-CN/attachment.json'),
  },
};

function flatten(prefix: string, value: Tree, out: Set<string>): void {
  if (typeof value === 'string') {
    out.add(prefix);
    return;
  }
  for (const [k, v] of Object.entries(value)) {
    flatten(prefix ? `${prefix}.${k}` : k, v, out);
  }
}

function keysFor(locale: (typeof SUPPORTED_LNGS)[number]): Set<string> {
  const out = new Set<string>();
  for (const [ns, tree] of Object.entries(bundles[locale])) {
    flatten(ns, tree, out);
  }
  return out;
}

describe('i18n catalog completeness (P3-i18n)', () => {
  test('en defines every key (baseline)', () => {
    const enKeys = keysFor('en');
    expect(enKeys.size).toBeGreaterThan(50); // sanity — a Phase-1 catalog has >50 keys
  });

  for (const lng of ['zh-TW', 'zh-CN'] as const) {
    test(`${lng} has the same key set as en (no missing translations)`, () => {
      const en = keysFor('en');
      const other = keysFor(lng);
      const missing = [...en].filter((k) => !other.has(k));
      const extra = [...other].filter((k) => !en.has(k));
      // Sort so the failure message is stable across runs.
      expect({ missing: missing.sort(), extra: extra.sort() }).toEqual({
        missing: [],
        extra: [],
      });
    });
  }

  test('initI18n() is idempotent and resolves a known key', async () => {
    initI18n();
    // Re-init should not throw — second call is a no-op.
    initI18n();
    // Wait for any pending resource loads to settle. There are no
    // async loads in our setup, so a microtask is enough.
    await Promise.resolve();
    expect(i18n.isInitialized).toBe(true);
    expect(i18n.t('common.save')).toBeTruthy();
  });

  test('every status namespace has the canonical enum keys', () => {
    // The Prisma enums are the source of truth for status values;
    // every locale must define labels for every enum value, or
    // StatusBadge will render the raw enum.
    const expected: Record<string, string[]> = {
      'status.quotation': ['DRAFT', 'SENT', 'VIEWED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'INVOICED'],
      'status.deal': ['OPEN', 'WON', 'LOST'],
      'status.activity': ['NOTE', 'CALL', 'EMAIL', 'MEETING'],
      'status.service': ['ACTIVE', 'ARCHIVED', 'DRAFT'],
    };
    for (const lng of SUPPORTED_LNGS) {
      const ks = keysFor(lng);
      for (const [ns, vals] of Object.entries(expected)) {
        for (const v of vals) {
          expect(ks.has(`${ns}.${v}`), `${lng} missing ${ns}.${v}`).toBe(true);
        }
      }
    }
  });

  test('role namespace has ADMIN / SALES / VIEWER (every locale)', () => {
    for (const lng of SUPPORTED_LNGS) {
      const ks = keysFor(lng);
      for (const role of ['ADMIN', 'SALES', 'VIEWER']) {
        expect(ks.has(`role.${role}`), `${lng} missing role.${role}`).toBe(true);
      }
    }
  });
});
