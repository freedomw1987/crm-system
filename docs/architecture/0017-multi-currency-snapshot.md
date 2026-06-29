# ADR 0017 — Multi-currency snapshots on Quotation (HKD + MOP)

- **Status:** Accepted
- **Date:** 2026-06-29
- **Day:** 19
- **Commits:** `d2ae58e` (schema + RM default), `f01a9b9` (settings endpoint), `96e58c6` (UI picker), `22b34a3` (deals stats), `c9f9110` (deal currency restricted), `17f7cc9` (auth scope), `f321df0` (MOP mirror)

## Context

The CRM operates in a region with three currencies in active use:
RMB (China mainland, the historical default), HKD (Hong Kong), and
MOP (Macau). Different customers demand quotes in different
currencies, and the sales team needs to track what was actually
agreed-to at quote time — not what the live exchange rate happens
to be when someone looks at the quote two years later.

The naive design — store one `currency` field on the Quotation
and look up the rate from a live table at display time — has a
silent bug: if admin updates the exchange rate (which is the
whole point of an admin-editable rate), every historical quote
silently re-reports its HKD/MOP equivalent. A customer's "we
agreed on 162k HKD" becomes a different number on the next page
load.

## Decision

**Snapshot the rate at quote creation time, and the recomputed
total too.** Four new columns on `Quotation`:

| Column                 | Type     | Notes                                  |
| --------------------- | ------- | -------------------------------------- |
| `exchangeRateToHKD`   | Decimal? | rate captured at create time           |
| `totalHKD`            | Decimal? | `subtotal * (1 + taxRate/100) * rateToHKD`, computed and stored |
| `exchangeRateToMOP`   | Decimal? | rate captured at create time           |
| `totalMOP`            | Decimal? | mirror of totalHKD                     |

Plus two `SystemConfig` keys:

| Key         | Type   | Purpose                                 |
| ----------- | ------ | --------------------------------------- |
| `cny_to_hkd` | number | admin-editable; default-flow currency   |
| `hkd_to_mop` | number | admin-editable; secondary conversion   |

### When the snapshot is captured

On `POST /quotations` (create), the route reads the live
`cny_to_hkd` from SystemConfig, multiplies through, and persists
`exchangeRateToHKD` + `totalHKD`. The MOP equivalents are computed
in the same pass. The HKD/MOP totals are recomputed via
`recalcQuotationAndItems()` (same call that refreshes GP%), so
they stay in sync with the `subtotal` / `taxAmount` edits.

The customer-currency `total` (in `currency` field — HKD / RMB /
MOP) is unaffected. The snapshots are **only** the HKD + MOP
equivalents.

### Frontend display

- The Quotation builder + detail page + print route all show the
  customer-currency total AND the HKD equivalent next to it. The
  MOP equivalent shows in a smaller line below.
- The Excel `sow` sheet renders three rows: customer-currency,
  HKD, MOP. Each uses the snapshot, not a live recompute.
- The Kanban deal card + list-page stats sum in HKD (the system
  default) and convert to MOP when the user has the MOP filter
  active.

### Currency picker flow

Currency defaults flow from system → Deal → Quotation, so users
never have to type a currency manually. The user can override
at any point in the flow. The Deal currency is restricted to
`HKD | RMB | MOP` (admin can add more by editing the dropdown
list in `ProductDialog`, but those three are the only ones with
ExchangeRate snapshots today).

## Consequences

- **Schema migration required** for `Quotation.{exchangeRateToHKD,
  totalHKD, exchangeRateToMOP, totalMOP}`. Done in two Prisma-generated
  migrations: `20260629120000_p2_multi_currency_snapshot_hkd` (HKD
  fields first) and `20260629140000_p2_multi_currency_snapshot_mop`
  (MOP mirror). Both apply cleanly via `prisma migrate deploy`.
- **Old quotations (pre-Day-19)** have `null` for the snapshot
  fields. The frontend falls back to "—" or hides the HKD/MOP
  row when null. The Excel export emits only the customer-currency
  row in that case.
- **Rate changes after the fact don't shift historical totals.** A
  customer who signed in 2024 at 1.08 CNY→HKD will see "162k HKD"
  in 2026 even if the rate is now 1.12. The system-config change
  only affects new quotes. This is the intended contract.
- **Live `cny_to_hkd` is a single number, not a time series.** If
  we ever need per-day rate lookup (e.g. for retroactive currency
  conversion on an old quote), this ADR will need to be superseded
  with a `ExchangeRateHistory` table.
- **Caching concern**: the frontend reads `cny_to_hkd` and
  `hkd_to_mop` from the settings API on every Quotation builder
  open. For high-traffic deploys, a server-side cache (Redis
  with 5-minute TTL) would help. Not in scope for v1.

## Invariant

> **`Quotation.{exchangeRateToHKD, totalHKD, exchangeRateToMOP,
> totalMOP}` are captured at create time and NEVER recomputed
> against live rates on read.** Any code that reads these fields
> for display MUST use the snapshot value verbatim. Recomputing
> against the current `cny_to_hkd` is a silent bug that breaks the
> contract. If you find yourself wanting to "refresh" the
> snapshot, the answer is: create a new revision, don't rewrite
> the existing row.
