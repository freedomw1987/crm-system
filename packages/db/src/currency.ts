/**
 * Currency helpers — P2 multi-currency (2026-06-29)
 *
 * The system stores billing currency as a string ('RMB' | 'HKD' |
 * 'MOP') on monetary rows. Each row also snapshots the exchange
 * rate that was applied and the HKD equivalent of the native total,
 * so historical reports stay stable when the admin later changes
 * the live rates.
 *
 * Lives in @crm/db (not @crm/shared) because `getCurrencyConfig`
 * touches SystemConfig via Prisma. `hkdRateFor` is pure but lives
 * here too so both helpers ship from one place — consumers
 * (apps/api routes + packages/ai tools) import from a single file.
 *
 * The default rate pair is seeded in packages/db/prisma/seed.ts so a
 * fresh DB boots to a known state. v1 reads from the DB on every
 * call (saves are not hot-path). If rate lookups ever become hot,
 * swap the body of `getCurrencyConfig` for a process-level cache
 * with TTL + bust-on-write — callers don't need to change.
 */
import { prisma } from './index';

export type CurrencyCode = 'RMB' | 'HKD' | 'MOP';

export interface CurrencyConfig {
  default: CurrencyCode;
  rates: { 'RMB->HKD': number; 'RMB->MOP': number };
}

/**
 * Read the currency config from SystemConfig. Returns sensible
 * defaults if the row is missing (the seed should have created it,
 * but a fresh DB without seed should still let the system boot).
 */
export async function getCurrencyConfig(): Promise<CurrencyConfig> {
  const row = await prisma.systemConfig.findUnique({
    where: { key: 'currency_config' },
  });
  if (!row) {
    return { default: 'RMB', rates: { 'RMB->HKD': 1.08, 'RMB->MOP': 1.16 } };
  }
  // Defensive normalisation: the stored value is a JSON object but
  // the DB driver might deserialize it as a string in some configs.
  const v = row.value as unknown;
  const obj = typeof v === 'string' ? JSON.parse(v) : (v ?? {});
  const def: CurrencyCode =
    obj.default === 'HKD' || obj.default === 'MOP' ? obj.default : 'RMB';
  const rHKD = Number(obj?.rates?.['RMB->HKD'] ?? 1.08);
  const rMOP = Number(obj?.rates?.['RMB->MOP'] ?? 1.16);
  return {
    default: def,
    rates: {
      'RMB->HKD': Number.isFinite(rHKD) && rHKD > 0 ? rHKD : 1.08,
      'RMB->MOP': Number.isFinite(rMOP) && rMOP > 0 ? rMOP : 1.16,
    },
  };
}

/**
 * Compute the multiplier to convert an amount in `currency` to HKD.
 *
 *   HKD → HKD: 1
 *   RMB → HKD: cfg.rates['RMB->HKD']
 *   MOP → HKD: cfg.rates['RMB->HKD'] / cfg.rates['RMB->MOP']
 *             (1 MOP = (1/RMB->MOP) RMB, then × RMB->HKD)
 *   anything else: null (caller should 400)
 *
 * `null` is the signal for the caller to reject the request — the
 * admin has not configured a rate for the chosen currency.
 */
export function hkdRateFor(
  currency: string,
  cfg: { rates: { 'RMB->HKD': number; 'RMB->MOP': number } },
): number | null {
  if (currency === 'HKD') return 1;
  if (currency === 'RMB') return cfg.rates['RMB->HKD'];
  if (currency === 'MOP') {
    const m = cfg.rates['RMB->MOP'];
    if (!Number.isFinite(m) || m <= 0) return null;
    return cfg.rates['RMB->HKD'] / m;
  }
  return null;
}

/**
 * Resolve a billing currency + HKD snapshot in one call.
 *
 * Helper for save paths (Quotation create/update, AI draft_quotation)
 * that need both the HKD rate and the validated currency code.
 * Returns `null` for `rate` if the admin has not configured a rate
 * for the chosen currency — caller should 400 in that case.
 */
export async function resolveCurrencySnapshot(
  requested: string | null | undefined,
): Promise<{ currency: CurrencyCode; rate: number } | null> {
  const cfg = await getCurrencyConfig();
  const chosen = (requested || cfg.default) as CurrencyCode;
  if (chosen !== 'RMB' && chosen !== 'HKD' && chosen !== 'MOP') return null;
  const rate = hkdRateFor(chosen, cfg);
  if (rate == null) return null;
  return { currency: chosen, rate };
}
