import { PERMISSIONS } from './permissions';

export * from './permissions';

/** All permission keys flattened (used by role management UI for matrix display) */
export const ALL_PERMISSIONS: readonly string[] = Object.freeze(
  Object.keys(PERMISSIONS)
);
