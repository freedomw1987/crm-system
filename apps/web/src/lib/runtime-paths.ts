function normalizeBase(value: string | undefined): string {
  const raw = (value ?? '/').trim();
  if (!raw || raw === '/') return '';
  const withLeadingSlash = raw.startsWith('/') ? raw : `/${raw}`;
  return withLeadingSlash.replace(/\/+$/, '');
}

function normalizeApiBase(value: string | undefined, appBase: string): string {
  return normalizeBase(value ?? `${appBase}/api`);
}

function withLeadingSlash(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

export const APP_BASENAME = normalizeBase(import.meta.env.BASE_URL);
export const API_BASE = normalizeApiBase(import.meta.env.VITE_API_BASE, APP_BASENAME);

export function appUrl(path: string): string {
  return `${APP_BASENAME}${withLeadingSlash(path)}`;
}

export function apiUrl(path: string): string {
  return `${API_BASE}${withLeadingSlash(path)}`;
}
