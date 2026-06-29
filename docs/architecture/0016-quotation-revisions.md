# ADR 0016 — Quotation revisions via self-referencing chain

- **Status:** Accepted
- **Date:** 2026-06-26
- **Day:** 18-D
- **Commits:** `7173f0a` (backend + schema), `7a3ee6f` (frontend button + chip)

## Context

Once a Quotation reaches `SENT`, its contractual fields (title,
notes, taxRate, validUntil, line items) are frozen — the customer
has the document and any change to those fields is a contractual
re-issue, not an edit. The existing UX already told users this via
the "Quotation is SENT and cannot be edited. Create a revision
instead." 409, but no revision flow existed. The user asked:
"我如何把Quotation 加一個新revision" (2026-06-26).

Two options were on the table:

1. **"Quick hack" — clone as a new standalone Quotation.** No schema
   change. The new row gets a fresh sequential number (e.g.
   `Q-2026-0002`). The two quotations are linked only via the
   audit log's metadata (`sourceId` / `sourceNumber`). No chain
   display possible — the user has to find the prior quotation by
   remembering its number.

2. **Standard versioning with chain linkage.** Add
   `parentQuotationId` (FK to self) + `revisionNumber Int`. A new
   route `POST /quotations/:id/revise` clones the source as a new
   DRAFT, links via `parentQuotationId`, increments `revisionNumber`,
   and numbers the new row as `Q-2026-NNNN-R{N}`. The chain is
   navigable in the UI; the Excel export picks up the real
   `revision` field instead of a hard-coded `"0"`.

## Decision

Adopt **option 2** (standard versioning). The audit-trail gap of
option 1 is the deal-breaker — once a sales rep has 5-10 revisions
in flight for a hot customer, "Q-2026-0002" tells you nothing about
the relationship to the original. The schema cost is two new columns
on `Quotation` (one FK + one int).

### Numbering

Format: `Q-YYYY-NNNN-R{N}`. The original is `Q-2026-0001` with
`revisionNumber=0`; the first revision is `Q-2026-0001-R1` with
`revisionNumber=1`; etc. The root number is preserved through the
chain so users can read the lineage by squinting at the number
prefix.

The new `number` is computed by the `nextRevisionInfo(parentId)`
helper:

1. Walk `parentQuotationId` from `parentId` upward until the
   root (where `parentQuotationId IS NULL`).
2. BFS down from the root via `parentQuotationId` links to count
   every descendant in the chain.
3. New `revisionNumber = count` (root is 0, R1 is 1, etc.).
4. New `number = root.number + "-R" + count`.

BFS-counting handles branching: if someone revises from an old
version mid-chain, the next revision gets a fresh unique number
without colliding with the linear-chain numbering.

### Cascade semantics

`onDelete: SetNull` on `parentQuotationId`. Deleting a row in the
middle of a chain doesn't orphan its descendants — they become
new roots. This matches the principle that the chain is
informational, not a hard contract.

### Frontend surface

- Detail page header: `R{revisionNumber}` badge + 「修訂自 {parent.number}」
  chip (linking back to the parent). Hidden for the root quotation.
- Detail page action: 「建立修訂」button, visible only when
  `status !== 'DRAFT'` (since the SENT lock makes editing
  impossible).
- On click: confirm dialog → call `POST /quotations/:id/revise` →
  navigate to the new quotation.

### SENT lock interaction

Revising a SENT quotation creates a NEW DRAFT — it does NOT
unlock the source. The source remains the contractual record;
the new DRAFT is where the edits happen. The user's 「建立修訂」
button is the only way to create a revision; there's no API path
to "unlock" a SENT quotation in place.

## Consequences

- **Migration is required** (no schema-only fix possible). The
  migration is Prisma-generated and adds 2 columns + 1 FK + 1
  index, no backfill needed (defaults handle it).
- **Excel export's `revision` field** now uses real
  `revisionNumber` instead of the hardcoded `"0"`. A regression
  test in `crm-adapter.test.ts` pins this.
- **List page filter chips** for "show revisions of" can be added
  later by querying `prisma.quotation.findMany({ where: { parentQuotationId: X } })`.
  Not in scope for v1.
- **Cross-branch merging** (e.g. two R1 branches of the same root
  both advancing to R2) is not supported. The BFS picks the next
  sequential number based on total chain length, so a second
  R2 in the same chain would error on the `@unique` constraint
  on `number`. The user is expected to keep branches separate or
  delete-and-redo. Filed as a future enhancement.

## Invariant

> **Quotation revision numbers are determined by `parentQuotationId`
> chain walk + BFS descendant count. The `number` field is
> derived from this count and is unique by Prisma's `@unique`
> constraint. Code that creates a new revision MUST use the
> `nextRevisionInfo(parentId)` helper, never invent a number
> directly. Code that re-numbers a chain (e.g. for branch merging)
> MUST run inside a transaction that handles the `@unique`
> conflict.**
