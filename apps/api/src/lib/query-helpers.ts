/**
 * Query string helpers for Elysia route handlers.
 *
 * Centralises the small parsing utilities that the Deals +
 * Quotations routes share. Keep this file dependency-free
 * (no Prisma, no Elysia) so it can be imported by any layer.
 */

/**
 * Coerce a `?ids=a&ids=b` (array) or `?ids=a,b` (single string) query
 * value into a uniform `string[]`. Used by the multi-select filter
 * params (companyIds, ownerIds, createdByIds). Returns [] when the
 * input is missing or only contains empty strings.
 */
export function toIdArray(v: string | string[] | undefined): string[] {
  if (v === undefined || v === null) return [];
  const arr = Array.isArray(v) ? v : v.split(',');
  return arr.map((s) => s.trim()).filter((s) => s.length > 0);
}
