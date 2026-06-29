# ADR 0018 — Author-only edit + delete for Activity and Attachment

- **Status:** Accepted
- **Date:** 2026-06-26 (Activity) + 2026-06-29 (Attachment)
- **Day:** 18-E + Day 19 E-fix
- **Commits:** `0da8766` (Activity), `df59c22` (author-only attachment CRUD)

## Context

Before this ADR:

- `PATCH /activities/:id` did not exist. Activities were
  create-only.
- `DELETE /activities/:id` was open to any authenticated user
  (per the v1 comment "Editing/deleting someone else's activity
  is allowed"). Same shape for `DELETE /attachments/:id` — any
  user could delete any attachment.

The user reported on 2026-06-27:

> "現在我發現Activity 是沒辦法編輯或刪除（自己Activity 應該可以編輯及刪除）"

The "I should be able to edit/delete my own" is a clear request
for an author-only rule. The v1 "anyone can delete" comment was
written before the audit log + sales-rep concerns made
accountability matter.

## Decision

**Author-only for `PATCH /activities/:id`, `DELETE /activities/:id`,
`PATCH /activities/:id/attachments/:id`, `DELETE /…/:id`.** Anyone
authenticated can read; only the author (or uploader, for
attachments) can modify. No admin override in v1 — if a sales
manager needs to clean up someone else's entry, they ask the
author to delete it themselves.

### Why no admin override

A future enhancement could add an `activity:delete:any` permission
for ADMIN role. Not in scope for v1 because:

- The v1 contract is "I made this, I can clean it up." Adding
  admin override would let a manager silently delete a rep's
  follow-up log without leaving the rep's audit trail pointing
  to it. That's the opposite of accountability.
- When the use case actually shows up (e.g. a rep leaves the
  company and their activity entries are cluttering the
  customer's feed), the right answer is `onDelete: SetNull` on
  the FK so the entry becomes anonymous + the rep's User row
  gets a `deactivated` flag. That's a bigger schema change;
  punted.

### Why per-attachment uploader (not author of the parent Activity)

The Activity might be authored by the sales rep, but the
attachment was uploaded by the customer (a CSV they sent over).
The rep can edit their own note, but they shouldn't be able to
delete a customer-uploaded file. The `Attachment.uploadedById`
field is the natural owner.

### SENT lock interaction

Activities and attachments are NOT protected by the SENT lock on
Quotations. They're internal CRM metadata, not contractual. A
sales rep should be able to fix a typo in their own activity log
even after the related quotation is SENT.

### Audit log

Every PATCH / DELETE writes an `ACTIVITY_UPDATED` /
`ACTIVITY_DELETED` row (or `ATTACHMENT_*` once that audit action
is added — currently the existing actions cover it via the
`resourceType: 'activity'` or `'attachment'` field). The
audit metadata carries `actorId` (the deleter/editor) and the
before-state of the row.

## Consequences

- **Frontend surfaces** the edit + delete affordances only when
  `activity.author?.id === currentUser.id` (or
  `attachment.uploadedBy?.id === currentUser.id`). The check is
  duplicated across `<ActivityItem>` and the attachment chip in
  the activity feed — a refactor to a shared `useCanEdit(item)`
  hook is filed but not blocking.
- **Backend 403** is returned if a non-author hits the API
  directly (e.g. a curl from a curious admin). The error
  message is `"Only the author can edit/delete this activity."`
  — explicit so client-side code that misroutes can show a clear
  message.
- **The author rule is enforced server-side, not client-side.**
  A user who manipulates `currentUser.id` in the browser can't
  bypass it. The client-side `isOwn` check is a UX optimization
  (hide buttons the user can't use), not a security boundary.
- **Edit history** is not preserved. A PATCH overwrites the row.
  The `updatedAt` column records when, and the audit log records
  the change, but the prior `content` is gone. This matches the
  rest of the CRM (no soft-delete, no edit history for other
  resources). If a future US needs activity edit history, that's
  a separate feature.

## Invariant

> **Activity + Attachment modification is author-or-uploader-only.
> The backend enforces the rule with a 403 for non-authors; the
> frontend hides the affordances as a UX optimization but is NOT
> the security boundary. If you need to soft-delete someone else's
> entry, the right answer is to deactivate their User (which the
> schema supports via `isActive: false` + a future US) — not to
> add an admin override on the PATCH/DELETE routes.**
