-- ============================================================================
-- P2 multi-currency: MOP equivalent snapshot (2026-06-29)
-- ============================================================================
-- Extension of the HKD snapshot work shipped earlier today (migration
-- 20260629120000_p2_multi_currency_snapshot_hkd). Sales team asked to
-- mirror the HKD equivalent row for MOP — `≈ MOP {totalMOP} @ {rate}`
-- underneath the HKD row on every quotation surface (builder totals
-- card, detail summary card, detail print layout, Excel export).
--
-- This migration adds two more snapshot columns to `quotations`:
--   - exchangeRateToMOP (Decimal(10,6)) — the rate that was applied
--                                        (1 native unit → X MOP)
--   - totalMOP          (Decimal(12,2)) — pre-computed MOP total
--
-- Defaults are `0` (not `1` like exchangeRateToHKD) because legacy
-- rows have no meaningful MOP equivalent: pre-P2 every quotation
-- was HKD-denominated, and we don't know what the historical
-- RMB→MOP rate was at issuance time. The display layer guards on
-- `totalMOP > 0`, so legacy rows just don't show the MOP row —
-- same defensive pattern as hiding the HKD row when currency='HKD'.
--
-- New writes always populate both columns. The HKD + MOP snapshots
-- are computed in lock-step from the same `currency` pick on the
-- Quotation row, so they can never disagree about which currency
-- the quotation is in.
-- ============================================================================

ALTER TABLE "quotations"
  ADD COLUMN "exchangeRateToMOP" DECIMAL(10, 6) NOT NULL DEFAULT 0,
  ADD COLUMN "totalMOP"          DECIMAL(12, 2) NOT NULL DEFAULT 0;

-- No backfill. Pre-migration rows were HKD-denominated and we don't
-- have a historical RMB→MOP rate. The display layer hides the MOP
-- row when totalMOP == 0, so legacy rows render cleanly without a
-- MOP equivalent (consistent with the HKD-row being hidden when
-- currency === 'HKD').