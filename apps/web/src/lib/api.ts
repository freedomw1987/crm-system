/**
 * Typed API client — all calls go through here.
 * Auth token is read from localStorage and attached as Bearer.
 */

import { apiUrl, appUrl } from './runtime-paths';

const TOKEN_KEY = 'crm:token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `API ${status}`);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(apiUrl(path), {
    ...options,
    headers,
  });

  const contentType = res.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json')
    ? await res.json().catch(() => null)
    : await res.text().catch(() => null);

  if (!res.ok) {
    const message =
      (body && typeof body === 'object' && 'error' in body
        ? (body as { error: string }).error
        : null) ?? `Request failed (${res.status})`;
    if (res.status === 401) {
      setToken(null);
      // Avoid redirect loop
      if (!window.location.pathname.startsWith('/login')) {
        window.location.assign(appUrl('/login'));
      }
    }
    throw new ApiError(res.status, body, message);
  }
  return body as T;
}

export const api = {
  get: <T>(p: string) => request<T>(p),
  post: <T>(p: string, body?: unknown) =>
    request<T>(p, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(p: string, body?: unknown) =>
    request<T>(p, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(p: string) => request<T>(p, { method: 'DELETE' }),
};

// ---------- Auth ----------
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'SALES' | 'VIEWER';
}

export const authApi = {
  login: (email: string, password: string) =>
    request<{ token: string; user: AuthUser }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  me: () => request<AuthUser>('/auth/me'),
};

// ---------- Companies ----------
export interface Region {
  id: string;
  code: string;
  name: string;
  flag?: string | null;
  isActive: boolean;
  sortOrder: number;
  _count?: { companies: number };
}

/**
 * Day 9: A company's region is now a FK to the Region table rather than a
 * hard-coded enum. `region` (FK include) and `regionId` are both present
 * on list/get responses. `customRegion` remains for the free-form case.
 */
export interface Company {
  id: string;
  name: string;
  legalName?: string | null;
  /** Business registration / tax ID (Day N: surfaced in the edit dialog). */
  taxId?: string | null;
  industry?: string | null;
  status: 'active' | 'inactive' | 'blacklisted';
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  regionId?: string | null;
  region?: Region | null;
  customRegion?: string | null;
  _count?: { contacts: number; quotations: number; deals: number };
}
export const companiesApi = {
  list: (params: { search?: string; status?: string; region?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.search) qs.set('search', params.search);
    if (params.status) qs.set('status', params.status);
    if (params.region) qs.set('region', params.region);
    if (params.limit) qs.set('limit', String(params.limit));
    return request<{ items: Company[]; total: number } | Company[]>(`/companies${qs.toString() ? `?${qs}` : ''}`).then((r) =>
      Array.isArray(r) ? r : r.items
    );
  },
  get: (id: string) => request<Company & {
    contacts: Contact[];
    quotations: Array<{ id: string; number: string; status: string; total: number; createdAt: string }>;
    deals: Array<{ id: string; title: string; value: number; status: string; stage: { name: string; color: string } }>;
  }>(`/companies/${id}`),
  // Day N: loose input type so the edit dialog can send taxId + website
  // without TS yelling. The backend only accepts fields it knows about.
  create: (data: Partial<Company> & { regionId?: string; region?: string; customRegion?: string }) =>
    request<Company>('/companies', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<Company> & { regionId?: string | null; region?: string | null; customRegion?: string }) =>
    request<Company>(`/companies/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  remove: (id: string) => request<{ success: boolean }>(`/companies/${id}`, { method: 'DELETE' }),
};

// ---------- Contacts (Day 8) ----------
export interface Contact {
  id: string;
  /** Always present on list response. On company-detail response, omitted (companyId is implicit). */
  companyId?: string;
  firstName: string;
  lastName: string;
  title?: string | null;
  department?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  isPrimary: boolean;
}
export const contactsApi = {
  list: (params: { companyId?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.companyId) qs.set('companyId', params.companyId);
    if (params.limit) qs.set('limit', String(params.limit));
    return request<{ items: Contact[]; total: number } | Contact[]>(`/contacts${qs.toString() ? `?${qs}` : ''}`).then((r) =>
      Array.isArray(r) ? r : r.items
    );
  },
  create: (data: Partial<Contact>) => request<Contact>('/contacts', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<Contact>) =>
    request<Contact>(`/contacts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  remove: (id: string) => request<{ success: boolean }>(`/contacts/${id}`, { method: 'DELETE' }),
};

// ---------- Products ----------
export interface Product {
  id: string;
  sku: string;
  name: string;
  /** Long-form product description. */
  description?: string | null;
  category?: string | null;
  /** Selling price per unit. */
  unitPrice: number;
  /** Cost basis (admin-only visibility). */
  costPrice?: number | null;
  currency: string;
  trackInventory: boolean;
  stockQuantity: number | null;
  lowStockThreshold: number | null;
  status: 'ACTIVE' | 'ARCHIVED' | 'OUT_OF_STOCK';
  imageUrl?: string | null;
  metadata?: unknown;
  createdAt: string;
  updatedAt?: string;
}
export interface ProductInput {
  sku: string;
  name: string;
  description?: string;
  category?: string;
  unitPrice: number;
  costPrice?: number;
  currency?: string;
  trackInventory?: boolean;
  stockQuantity?: number;
  lowStockThreshold?: number;
  status?: 'ACTIVE' | 'ARCHIVED' | 'OUT_OF_STOCK';
  imageUrl?: string;
}
export const productsApi = {
  list: (params: { query?: string; category?: string; status?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') qs.set(k, String(v)); });
    // Backend returns a bare array; companiesApi returns { items, total }.
    // Accept either shape so the list works regardless of which the API speaks.
    return request<{ items: Product[]; total: number } | Product[]>(`/products${qs.toString() ? `?${qs}` : ''}`).then((r) =>
      Array.isArray(r) ? r : r.items
    );
  },
  get: (id: string) => request<Product>(`/products/${id}`),
  create: (data: ProductInput) => request<Product>('/products', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<ProductInput>) =>
    request<Product>(`/products/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  remove: (id: string) => request<{ success: boolean }>(`/products/${id}`, { method: 'DELETE' }),
};

// ---------- Quotations ----------
export interface QuotationItem {
  id?: string;
  /** 'PRODUCT' (with productId) or 'SERVICE' (with serviceId + manDaySnapshot). */
  itemType: 'PRODUCT' | 'SERVICE';
  productId?: string | null;
  serviceId?: string | null;
  sku?: string | null;
  name: string;
  description?: string | null;
  quantity: number;
  unitPrice: number;
  discount: number;
  lineTotal: number;
  /** Day N: cost snapshot at line creation. SERVICE lines sum man-day
   *  costRate × days × quantity; PRODUCT lines stay at 0. */
  costSnapshot: number;
  /** Day N: sell total minus cost snapshot. Positive for healthy margin. */
  lineGp: number;
  /** Day N: lineGp / lineTotal × 100. PRODUCT is always 100. */
  lineGpPercent: number;
  /** For SERVICE items: snapshot of the service's man-day structure at the
   *  time the quotation was created. Used to display the SOW breakdown in the
   *  quotation detail view even if the service template is later changed. */
  manDaySnapshot?: Array<{ role: string; dayRate: number; days: number; subtotal: number; costRate?: number; manDayRoleId?: string }> | null;
  // P2-Snapshot-Display: live relations, ONLY populated by GET /quotations/:id
  // (the list endpoint doesn't include them). When these are null while
  // productId/serviceId is set, the catalogue record was deleted (FK was
  // SetNull'd). The snapshot fields (name, description, manDaySnapshot) hold
  // the historical value — see `isLineItemDeleted` in
  // `quotation-line-item-snapshot.tsx`.
  product?: { id: string; name: string; sku: string; description?: string | null } | null;
  service?: { id: string; name: string; description?: string | null } | null;
}
export type QuotationStatus = 'DRAFT' | 'SENT' | 'VIEWED' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'INVOICED';
export interface Quotation {
  id: string;
  number: string;
  title?: string | null;
  status: QuotationStatus;
  companyId: string;
  // Day 8: link to a Deal (sales pipeline opportunity). Optional — a
  // quote can exist standalone. The detail response includes the full
  // deal object (id, title, stage); the list response is { id, title,
  // stage: { name, color } }. 2026-06-26: PATCH /quotations/:id now
  // accepts dealId so the QuotationBuilder can move a DRAFT between
  // Deals; we type it as nullable so the frontend can also clear the
  // link (dealId: null) to detach a quotation from its deal.
  dealId?: string | null;
  // 2026-06-26: standard versioning. parentQuotationId points to
  // the immediate predecessor (null for the original). revisionNumber
  // is 0 for an original, 1 for R1, etc. The detail response
  // includes a slim parentQuotation { id, number } so the detail
  // page can render the "修訂自 X" chip without an extra fetch.
  parentQuotationId?: string | null;
  parentQuotation?: { id: string; number: string } | null;
  revisionNumber?: number;
  // 2026-06-26: optional follow-up salesperson (separate from
  // createdById — the creator is often not the same person who
  // follows up with the customer). Nullable because the DB column
  // is nullable; the backend defaults salesRepId to the
  // authenticated user on create when omitted, so newly-created
  // rows always carry a sales rep unless explicitly cleared.
  // Migration backfills existing rows from createdById.
  salesRepId?: string | null;
  // Detail response: full company object. List response: { id, name }.
  company?: {
    id: string;
    name: string;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
  };
  createdBy?: { id: string; name: string; email: string };
  // 2026-06-26: nullable relation — null means the row's salesRepId
  // is null (cleared) OR the relation wasn't included in the
  // include clause. Callers that care about the distinction should
  // read `salesRepId` explicitly.
  salesRep?: { id: string; name: string; email: string } | null;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  notes?: string | null;
  generatedByAi: boolean;
  aiPrompt?: string | null;
  validUntil?: string | null;
  sentAt?: string | null;
  acceptedAt?: string | null;
  createdAt: string;
  updatedAt?: string;
  items: QuotationItem[];
  _count?: { items: number };
}
export interface QuotationItemInput {
  /** 'PRODUCT' (with productId) or 'SERVICE' (with serviceId + manDaySnapshot). */
  itemType: 'PRODUCT' | 'SERVICE';
  productId?: string;
  serviceId?: string;
  sku?: string;
  name: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  /** For SERVICE items: snapshot of the chosen service's man-day structure. */
  manDaySnapshot?: Array<{ role: string; dayRate: number; days: number; subtotal: number }>;
}
/**
 * Add a multi-value query param to URLSearchParams. Uses the
 * `?key=a&key=b` form (preferred by Elysia + standard HTTP — the
 * backend's `toIdArray` helper understands both array and
 * comma-separated forms, but the array form is what Elysia delivers
 * when the client uses `qs.append`).
 */
function appendMulti(qs: URLSearchParams, key: string, values: string[] | undefined): void {
  if (!values || values.length === 0) return;
  for (const v of values) qs.append(key, v);
}

export const quotationsApi = {
  list: (params: {
    companyId?: string;
    companyIds?: string[];
    status?: string;
    createdById?: string;
    createdByIds?: string[];
    dealId?: string;
    limit?: number;
  } = {}) => {
    const qs = new URLSearchParams();
    if (params.companyId) qs.set('companyId', params.companyId);
    appendMulti(qs, 'companyIds', params.companyIds);
    if (params.status) qs.set('status', params.status);
    if (params.createdById) qs.set('createdById', params.createdById);
    appendMulti(qs, 'createdByIds', params.createdByIds);
    if (params.dealId) qs.set('dealId', params.dealId);
    if (params.limit) qs.set('limit', String(params.limit));
    return request<{ items: Quotation[]; total: number } | Quotation[]>(`/quotations${qs.toString() ? `?${qs}` : ''}`).then((r) =>
      Array.isArray(r) ? r : r.items
    );
  },
  get: (id: string) => request<Quotation & { deal?: { id: string; title: string; stage: { name: string; color: string } } }>(`/quotations/${id}`),
  create: (data: {
    companyId: string;
    dealId?: string;
    // 2026-06-26: optional follow-up salesperson. When omitted,
    // the backend defaults to the authenticated user. Pass an
    // explicit user id to create a quote on behalf of another
    // sales rep (e.g. manager-built quote handed to a rep).
    salesRepId?: string;
    title?: string;
    notes?: string;
    taxRate?: number;
    validUntil?: string;
    items: QuotationItemInput[];
  }) => request<Quotation>('/quotations', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<Pick<Quotation, 'title' | 'notes' | 'taxRate' | 'status' | 'validUntil' | 'dealId' | 'salesRepId'>>) =>
    request<Quotation>(`/quotations/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  remove: (id: string) => request<{ success: boolean }>(`/quotations/${id}`, { method: 'DELETE' }),
  // 2026-06-26: quick-hack revise flow. Clones the source as a
  // new DRAFT quotation and returns it. The caller (detail
  // page) navigates to the new id so the user can edit
  // immediately. Returns the full Quotation (with items) so
  // the detail page can render without a refetch.
  revise: (id: string) => request<Quotation>(`/quotations/${id}/revise`, { method: 'POST' }),
  addItem: (quotationId: string, item: QuotationItemInput) =>
    request<QuotationItem>(`/quotations/${quotationId}/items`, { method: 'POST', body: JSON.stringify(item) }),
  updateItem: (quotationId: string, itemId: string, item: Partial<QuotationItemInput>) =>
    request<QuotationItem>(`/quotations/${quotationId}/items/${itemId}`, { method: 'PATCH', body: JSON.stringify(item) }),
  removeItem: (quotationId: string, itemId: string) =>
    request<{ success: boolean }>(`/quotations/${quotationId}/items/${itemId}`, { method: 'DELETE' }),
  setStatus: (id: string, status: Quotation['status']) =>
    request<Quotation>(`/quotations/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
  // 2026-06-07 (US-A5): Download quotation as .xlsx (5 worksheets, bc-quotation
  // format). Uses raw fetch because the response is binary, not JSON.
  // Calls window.URL.createObjectURL to trigger a browser download dialog.
  downloadExcel: async (id: string, opts: { lang?: 'zh' | 'en'; version?: 'v1' | 'v2' } = {}) => {
    const qs = new URLSearchParams();
    qs.set('lang', opts.lang ?? 'zh');
    qs.set('version', opts.version ?? 'v2');
    const token = getToken();
    const r = await fetch(apiUrl(`/quotations/${id}/export-xlsx?${qs}`), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!r.ok) {
      const errBody = await r.text().catch(() => '');
      throw new Error(`Excel download failed (${r.status}): ${errBody}`);
    }
    const blob = await r.blob();
    // 2026-06-07: prefer backend-set filename (Content-Disposition), fall
    // back to a sensible default.
    const cd = r.headers.get('content-disposition') ?? '';
    const m = cd.match(/filename="?([^"]+)"?/);
    const filename = m?.[1] ?? `quotation-${id}.xlsx`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // 2026-06-07: defer revoke to next tick so the browser has time to
    // dispatch the download event.
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return filename;
  },
};

// ---------- Deals ----------
export interface PipelineStage {
  id: string;
  name: string;
  position: number;
  probability: number;
  color: string;
}
export interface Deal {
  id: string;
  title: string;
  value: number;
  currency: string;
  status: 'OPEN' | 'WON' | 'LOST';
  probability: number;
  expectedCloseDate?: string | null;
  closedAt?: string | null;
  company?: { id: string; name: string; region?: string };
  owner?: { id: string; name: string; email: string };
  stage?: { id: string; name: string; probability: number; color: string };
  /** Day 8: number of quotations linked to this deal. */
  _count?: { quotations: number };
}
export interface KanbanBucket {
  stage: PipelineStage;
  deals: Deal[];
}
export interface KanbanData {
  pipeline: { id: string; name: string; isDefault: boolean };
  buckets: KanbanBucket[];
}
export const dealsApi = {
  list: (params: { status?: string; companyId?: string; stageId?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set('status', params.status);
    if (params.companyId) qs.set('companyId', params.companyId);
    if (params.stageId) qs.set('stageId', params.stageId);
    if (params.limit) qs.set('limit', String(params.limit));
    return request<{ items: Deal[]; total: number } | Deal[]>(`/deals${qs.toString() ? `?${qs}` : ''}`).then((r) =>
      Array.isArray(r) ? r : r.items
    );
  },
  get: (id: string) => request<Deal & { quotations: Array<{ id: string; number: string; status: string; total: number }> }>(`/deals/${id}`),
  // 2026-06-09: multi-select filter for the Kanban page. Accepts
  // `companyIds` and `ownerIds` arrays; single-id `companyId` /
  // `ownerId` are kept for back-compat with existing callers.
  kanban: (params: {
    companyId?: string;
    companyIds?: string[];
    ownerId?: string;
    ownerIds?: string[];
    pipelineId?: string;
  } = {}) => {
    const qs = new URLSearchParams();
    if (params.companyId) qs.set('companyId', params.companyId);
    appendMulti(qs, 'companyIds', params.companyIds);
    if (params.ownerId) qs.set('ownerId', params.ownerId);
    appendMulti(qs, 'ownerIds', params.ownerIds);
    if (params.pipelineId) qs.set('pipelineId', params.pipelineId);
    return request<KanbanData>(`/deals/kanban${qs.toString() ? `?${qs}` : ''}`);
  },
  /** Day 8: Move deal to a new stage (drag-drop endpoint). */
  moveStage: (id: string, stageId: string) =>
    request<Deal>(`/deals/${id}/stage`, { method: 'PATCH', body: JSON.stringify({ stageId }) }),
  create: (data: { title: string; companyId: string; value: number; stageId: string; ownerId?: string; probability?: number; expectedCloseDate?: string; description?: string }) =>
    request<Deal>('/deals', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<{ title: string; value: number; probability: number; expectedCloseDate: string; description: string; ownerId?: string | null }>) =>
    request<Deal>(`/deals/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  remove: (id: string) => request<{ success: boolean }>(`/deals/${id}`, { method: 'DELETE' }),
};

// ---------- Regions (Day 9) ----------
// CRUD for the Region catalogue. The list endpoint is public-to-all-authed
// users (no `requirePermission` check on the backend) so the company
// form/filter can always render the current set. Mutations require
// `company:write` per the backend.
export const regionsApi = {
  list: () => request<Region[]>('/regions'),
  get: (id: string) => request<Region>(`/regions/${id}`),
  create: (data: { code: string; name: string; flag?: string; sortOrder?: number }) =>
    request<Region>('/regions', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<{ name: string; flag: string; isActive: boolean; sortOrder: number }>) =>
    request<Region>(`/regions/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  remove: (id: string) => request<{ success: boolean }>(`/regions/${id}`, { method: 'DELETE' }),
};

// ---------- Users (admin) ----------
export interface UserSummary {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'SALES' | 'VIEWER';
  isActive: boolean;
  lastLoginAt?: string | null;
  createdAt: string;
  updatedAt?: string;
}
export const usersApi = {
  list: (params: { search?: string; role?: string; isActive?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.search) qs.set('search', params.search);
    if (params.role) qs.set('role', params.role);
    if (params.isActive) qs.set('isActive', params.isActive);
    if (params.limit) qs.set('limit', String(params.limit));
    return request<{ items: UserSummary[]; total: number }>(`/users${qs.toString() ? `?${qs}` : ''}`);
  },
  get: (id: string) => request<UserSummary>(`/users/${id}`),
  create: (data: { email: string; name: string; role: 'ADMIN' | 'SALES' | 'VIEWER'; password: string }) =>
    request<UserSummary>('/users', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<Pick<UserSummary, 'name' | 'role' | 'isActive'>>) =>
    request<UserSummary>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  remove: (id: string) => request<{ success: boolean }>(`/users/${id}`, { method: 'DELETE' }),
  resetPassword: (id: string, newPassword: string) =>
    request<{ success: boolean }>(`/users/${id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ newPassword }),
    }),
};
export const authApiExtra = {
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ success: boolean }>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
};

// ---------- Audit Log (admin) ----------
export type AuditAction =
  | 'USER_LOGIN' | 'USER_LOGIN_FAILED' | 'USER_LOGOUT' | 'PASSWORD_CHANGED'
  | 'USER_CREATED' | 'USER_UPDATED' | 'USER_DEACTIVATED' | 'USER_REACTIVATED' | 'USER_DELETED' | 'PASSWORD_RESET'
  | 'QUOTATION_CREATED' | 'QUOTATION_UPDATED' | 'QUOTATION_DELETED' | 'QUOTATION_STATUS_CHANGED'
  | 'COMPANY_CREATED' | 'COMPANY_UPDATED' | 'COMPANY_DELETED'
  | 'CONTACT_CREATED' | 'CONTACT_UPDATED' | 'CONTACT_DELETED'
  | 'DEAL_CREATED' | 'DEAL_UPDATED' | 'DEAL_DELETED' | 'DEAL_STAGE_CHANGED'
  | 'PRODUCT_CREATED' | 'PRODUCT_UPDATED' | 'PRODUCT_DELETED'
  | 'SERVICE_CREATED' | 'SERVICE_UPDATED' | 'SERVICE_DELETED'
  | 'ROLE_CREATED' | 'ROLE_UPDATED' | 'ROLE_DELETED'
  | 'REGION_CREATED' | 'REGION_UPDATED' | 'REGION_DELETED';
export interface AuditLog {
  id: string;
  actorId: string | null;
  action: AuditAction;
  resourceType: string | null;
  resourceId: string | null;
  description: string | null;
  metadata: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  actor: { id: string; name: string; email: string; role: string } | null;
}
export const auditApi = {
  list: (params: { actorId?: string; action?: string; resourceType?: string; resourceId?: string; from?: string; to?: string; limit?: number; offset?: number } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') qs.set(k, String(v)); });
    return request<{ items: AuditLog[]; total: number }>(`/audit${qs.toString() ? `?${qs}` : ''}`);
  },
  actions: () => request<AuditAction[]>('/audit/actions'),
};

// ---------- AI Chat ----------
export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
  createdAt: string;
  _count: { messages: number };
}
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string | null;
  toolArgs?: unknown;
  toolResult?: unknown;
  createdAt: string;
}
export interface Conversation extends ConversationSummary {
  messages: ChatMessage[];
}
/**
 * Events the backend's `/chat/send` endpoint streams back as
 * Server-Sent Events. The frontend consumes these incrementally to
 * render tokens and tool calls as they happen.
 */
export type StreamEvent =
  | { type: 'token'; delta: string }
  | { type: 'tool_start'; name: string; args: unknown }
  | { type: 'tool_end'; name: string; result: unknown; error?: string }
  | { type: 'done'; conversationId: string; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }
  | { type: 'error'; message: string };
export const chatApi = {
  list: () => request<ConversationSummary[]>('/chat/conversations'),
  get: (id: string) => request<Conversation>(`/chat/conversations/${id}`),
  /**
   * Stream a chat message. Unlike the other endpoints, this returns
   * a Promise that resolves with `{ conversationId }` once the
   * `done` event is received. The `onEvent` callback is invoked
   * synchronously for each `StreamEvent` as it arrives — including
   * `token` (incremental assistant text) and `tool_start` /
   * `tool_end` (tool invocations and their results).
   *
   * On any HTTP error (4xx / 5xx) the body is parsed as JSON and
   * thrown as `ApiError`. On a stream-level `error` event, we throw
   * a regular `Error` after the response stream closes.
   */
  send: async (
    message: string,
    conversationId: string | undefined,
    onEvent: (ev: StreamEvent) => void,
  ): Promise<{ conversationId: string }> => {
    const token = getToken();
    const r = await fetch(apiUrl('/chat/send'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ message, conversationId }),
    });
    if (!r.ok || !r.body) {
      let errMsg = `Chat send failed (${r.status})`;
      try {
        const body = await r.json();
        if (body && typeof body === 'object' && 'error' in body) {
          errMsg = (body as { error: string }).error;
        }
      } catch { /* not json */ }
      throw new ApiError(r.status, null, errMsg);
    }
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let doneConversationId: string | undefined;
    let errorMessage: string | undefined;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE frames are separated by a blank line. Process all
      // complete frames in the buffer; keep any partial tail.
      let idx: number;
      // eslint-disable-next-line no-cond-assign
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (!payload) continue;
          try {
            const ev = JSON.parse(payload) as StreamEvent;
            onEvent(ev);
            if (ev.type === 'done') doneConversationId = ev.conversationId;
            if (ev.type === 'error') errorMessage = ev.message;
          } catch {
            // Ignore malformed frames; the next valid frame will
            // recover the stream's intent.
          }
        }
      }
    }
    if (errorMessage) throw new Error(errorMessage);
    if (!doneConversationId) throw new Error('Stream ended without done event');
    return { conversationId: doneConversationId };
  },
  remove: (id: string) => request<{ success: boolean }>(`/chat/conversations/${id}`, { method: 'DELETE' }),
};

// ---------- Services (Day 7) ----------
export interface ServiceManDay {
  id?: string;
  /** Free-text role name, e.g. "Senior Consultant", "Project Manager". */
  role: string;
  /** Per-day rate for this role in the service's currency. */
  dayRate: number;
  /** Number of days for this role. */
  days: number;
  /**
   * Day N: optional FK to the ManDayRole catalogue row this line was
   * snapshotted from. When set, the backend treats this as a catalogue
   * line — the name/price/cost stored on the row are snapshots taken
   * at write time, so renaming the role later doesn't break this
   * service. Null on legacy free-form rows (pre-Day-N).
   */
  manDayRoleId?: string | null;
  /** Day N: cost per day in HKD. The backend snapshots this on the
   *  quotation item at create-time, but the service's own manDayLines
   *  also carry it so the quotation builder can render a live GP%
   *  preview without re-fetching. Missing in legacy rows (pre-Day N)
   *  — treat as 0. */
  costRate?: number;
  /** Computed: dayRate × days. */
  subtotal?: number;
  /** Sort order within the service. Lower numbers first. */
  sortOrder?: number;
}
export interface Service {
  id: string;
  name: string;
  /** Service SOW (Statement of Work) — long-form description. */
  description: string | null;
  /** Free-text category, e.g. "Consulting". */
  category?: string | null;
  /** Lifecycle status — controls whether the service appears in active pickers. */
  status?: 'ACTIVE' | 'ARCHIVED' | 'DRAFT';
  /** Total quoted price for this service (sum of man-day subtotals). */
  unitPrice: number;
  currency: string;
  sortOrder: number;
  manDays: ServiceManDay[];
  createdAt: string;
  updatedAt?: string;
}
// Backend's Prisma client returns the man-day relation under the
// camelCased key `manDayLines` (preserved from the Prisma model name).
// The frontend's `Service` type uses `manDays` to match the URL slug
// and the wire-format key for the POST/PATCH validators' payload.
// All API entry points that read a Service from the response normalise
// `manDayLines` → `manDays` so the rest of the frontend can rely on a
// single field name. (`create` and `update` are normalised defensively
// too — the PATCH endpoint currently doesn't `include: manDayLines`
// on its return, so the field is absent in those responses, but we
// fall back to `manDays ?? []` for safety against future regressions.)
function normaliseService<T extends { manDays?: unknown; manDayLines?: unknown }>(s: T): T {
  const manDaysFromWire = (s as { manDayLines?: ServiceManDay[] }).manDayLines;
  if (manDaysFromWire !== undefined) {
    return { ...s, manDays: manDaysFromWire as ServiceManDay[] };
  }
  return s;
}
export const servicesApi = {
  list: (params: { status?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') qs.set(k, String(v)); });
    return request<{ items: Service[]; total: number } | Service[]>(`/services${qs.toString() ? `?${qs}` : ''}`).then((r) => {
      const items = Array.isArray(r) ? r : r.items;
      return items.map(normaliseService);
    });
  },
  get: (id: string) =>
    request<Service>(`/services/${id}`).then(normaliseService),
  create: (data: {
    name: string;
    description?: string;
    category?: string;
    unitPrice?: number;
    currency?: string;
    status?: 'ACTIVE' | 'ARCHIVED' | 'DRAFT';
    sortOrder?: number;
    /** Wire-format key for the backend validator — must be `manDayLines`
     *  (Prisma relation name) on POST /services. */
    manDayLines?: Array<{ role: string; dayRate: number; days: number }>;
  }) => request<Service>('/services', { method: 'POST', body: JSON.stringify(data) }).then(normaliseService),
  update: (id: string, data: Partial<{
    name: string;
    description: string;
    category?: string;
    unitPrice: number;
    currency: string;
    status?: 'ACTIVE' | 'ARCHIVED' | 'DRAFT';
    sortOrder: number;
    /** Wire-format key for the backend validator — must be `manDayLines`
     *  (Prisma relation name) to match POST /services. PATCH currently has
     *  no body validator, so a stale `manDays` key would silently no-op;
     *  we keep the wire key correct so the relation is actually replaced
     *  when the backend eventually adds a validator (or if it already
     *  strips unknown keys upstream). */
    manDayLines?: Array<{ role: string; dayRate: number; days: number }>;
  }>) => request<Service>(`/services/${id}`, { method: 'PATCH', body: JSON.stringify(data) }).then(normaliseService),
  remove: (id: string) => request<{ success: boolean }>(`/services/${id}`, { method: 'DELETE' }),
};

// ---------- Roles (Day 7) ----------
// The backend has two shapes for Role depending on the endpoint:
//   - GET /roles (list):        { name, displayName, description, isSystem,
//                                 _count: { users, permissions }, ... }
//   - GET /roles/:id (detail):  { ...same..., permissions: string[] }
// The union below covers both; consumers should treat either as optional.
export interface Role {
  id: string;
  name: string;
  /** Optional human-friendly label (Chinese label set in seed). */
  displayName?: string | null;
  description: string | null;
  isSystem: boolean;
  /** Present on GET /roles/:id (full list of granted permission keys). */
  permissions?: string[];
  /** Counts come from the include on the list endpoint. */
  _count?: { users?: number; permissions?: number };
  createdAt: string;
  updatedAt?: string;
}
export const rolesApi = {
  list: () => request<{ items: Role[]; total: number }>('/roles'),
  // Backend returns a plain string[] of permission keys (not a map). The roles
  // page receives this array and uses it as both the list of all permissions
  // and (joined with the permission enum labels from /api/roles/permissions)
  // for the human-readable matrix display. We accept the array and let the
  // page extract the labels from a separate call.
  permissions: () => request<string[]>('/roles/permissions'),
  get: (id: string) => request<Role>(`/roles/${id}`),
  create: (data: { name: string; description?: string; permissions: string[] }) =>
    request<Role>('/roles', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<{ name: string; description: string; permissions: string[] }>) =>
    request<Role>(`/roles/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  remove: (id: string) => request<{ success: boolean }>(`/roles/${id}`, { method: 'DELETE' }),
};

// ---------- Man-day Roles (Day N) ----------
// Catalogue of man-day roles. Admin-only mutations. Currency is locked to
// CNY on the backend (do not expose a currency field anywhere in the UI).
export interface ManDayRole {
  id: string;
  name: string;
  /** Sell price per man-day (CNY). */
  price: number;
  /** Cost per man-day (CNY). */
  cost: number;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}
export const manDayRolesApi = {
  list: () => request<ManDayRole[]>('/man-day-roles'),
  get: (id: string) => request<ManDayRole>(`/man-day-roles/${id}`),
  create: (data: { name: string; price: number; cost?: number; sortOrder?: number; isActive?: boolean }) =>
    request<ManDayRole>('/man-day-roles', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<{ name: string; price: number; cost: number; sortOrder: number; isActive: boolean }>) =>
    request<ManDayRole>(`/man-day-roles/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  remove: (id: string) => request<{ success: boolean }>(`/man-day-roles/${id}`, { method: 'DELETE' }),
};

// ---------- Activities + Attachments (Day N) ----------
export type ActivityType = 'NOTE' | 'CALL' | 'EMAIL' | 'MEETING';
export interface Activity {
  id: string;
  companyId: string | null;
  dealId: string | null;
  authorId: string;
  type: ActivityType;
  content: string;
  createdAt: string;
  updatedAt: string;
  author?: { id: string; name: string; email: string };
  company?: { id: string; name: string } | null;
  deal?: { id: string; title: string } | null;
  attachments?: Array<{ id: string; fileName: string; mimeType: string; sizeBytes: number; createdAt: string }>;
}
export interface Attachment {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  uploadedBy?: { id: string; name: string };
  /** Only present on /companies/:id/attachments list. */
  activity?: { id: string; type: ActivityType; content: string; createdAt: string };
}
export const activitiesApi = {
  list: (params: { companyId?: string; dealId?: string; type?: string; limit?: number; offset?: number } = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') qs.set(k, String(v)); });
    return request<{ items: Activity[]; total: number }>(`/activities${qs.toString() ? `?${qs}` : ''}`);
  },
  recent: (params: { limit?: number; authorId?: string; since?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.limit !== undefined) qs.set('limit', String(Math.min(params.limit, 50)));
    if (params.authorId) qs.set('authorId', params.authorId);
    if (params.since) qs.set('since', params.since);
    return request<{ items: Activity[]; total: number }>(`/activities/recent${qs.toString() ? `?${qs}` : ''}`);
  },
  create: (data: { companyId?: string; dealId?: string; type?: ActivityType; content: string }) =>
    request<Activity>('/activities', { method: 'POST', body: JSON.stringify(data) }),
  // 2026-06-27: edit your own activity. Backend author-checks
  // (returns 403 if you're not the author). Accepts either
  // `type` or `content` (or both); omitted fields are untouched.
  update: (id: string, data: { type?: ActivityType; content?: string }) =>
    request<Activity>(`/activities/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  remove: (id: string) => request<{ success: boolean }>(`/activities/${id}`, { method: 'DELETE' }),
};
export const attachmentsApi = {
  forCompany: (companyId: string) =>
    request<{ items: Attachment[]; total: number }>(`/companies/${companyId}/attachments`),
  forActivity: (activityId: string) =>
    request<{ items: Attachment[]; total: number }>(`/activities/${activityId}/attachments`),
  /**
   * Upload a single file to an activity. Uses raw fetch (NOT request<T>)
   * because the request<T> helper is hard-coded to application/json and
   * does not support multipart/form-data bodies.
   */
  upload: async (activityId: string, file: File): Promise<Attachment> => {
    const fd = new FormData();
    fd.append('file', file);
    const token = getToken();
    const r = await fetch(apiUrl(`/activities/${activityId}/attachments`), {
      method: 'POST',
      body: fd,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!r.ok) {
      let errMsg = `Upload failed (${r.status})`;
      try {
        const body = await r.json();
        if (body && typeof body === 'object' && 'error' in body) errMsg = (body as { error: string }).error;
      } catch { /* not json */ }
      throw new ApiError(r.status, null, errMsg);
    }
    const body = await r.json() as { items: Attachment[]; total: number };
    return body.items[0];
  },
  downloadUrl: (id: string) => apiUrl(`/attachments/${id}/download`),
  remove: (id: string) => request<{ success: boolean }>(`/attachments/${id}`, { method: 'DELETE' }),
};

// ---------- AI Configuration (Day 10+) ----------
// Admin-only page at /admin/ai-config. The PUT endpoint requires the
// caller to re-enter the api key on every save (we never persist the
// existing key on partial updates). The GET endpoint returns a masked
// version of the key + a hasApiKey flag, never the ciphertext.
export interface AiConfigResponse {
  configured: boolean;
  endpointUrl: string;
  /** Always a masked representation, e.g. "sk-p...1234". */
  apiKeyMasked: string;
  hasApiKey: boolean;
  modelName: string;
  systemPrompt: string;
  updatedAt: string | null;
  updatedByName: string | null;
}
export interface AiConfigStatus {
  configured: boolean;
  reason?: string;
  modelName?: string;
  updatedAt?: string;
}
export const aiConfigApi = {
  status: () => request<AiConfigStatus>('/ai/config/status'),
  get: () => request<AiConfigResponse>('/ai/config'),
  /**
   * Upsert the singleton config row. apiKey is required — we never
   * preserve the previous key on partial updates (defence-in-depth
   * against an attacker who already has session access being able
   * to keep the key alive by sending a modelName-only PATCH).
   */
  save: (data: {
    endpointUrl: string;
    apiKey: string;
    modelName: string;
    systemPrompt?: string;
  }) => request<{ success: boolean; updatedAt: string }>('/ai/config', {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
};

// ---------- Settings (Day 11) ----------
// Admin-only configuration for sales pipelines and (Phase 2) global
// tax rate etc. The PipelineStage type re-uses the one declared above
// for Deals (the wire shape is identical).
export interface PipelineWithStages {
  id: string;
  name: string;
  isDefault: boolean;
  stages: (PipelineStage & { _count?: { deals: number } })[];
}
// **Day 14.7 Step 5 fix (caught in Step 7)**: Backend (`/api/settings/tax`)
// uses `rate` (not `defaultTaxRate`) for the JSON field on BOTH the GET
// response and the PUT body. The first client wrapper I wrote in Step 5
// assumed `defaultTaxRate` based on the Plan doc wording, but per "backend
// is source of truth" (user feedback 2026-06-04) we follow the wire format
// that `prisma.systemConfig.upsert({ data: { value: rate } })` actually
// returns. Also includes `key` + `description` (per backend) and `updatedBy`
// may be `User | null` (admin hasn't been wired to the row yet) — not just
// a string. See routes/settings.ts GET + PUT.
export interface TaxConfig {
  key: string;
  rate: number; // percent (0–100)
  description?: string | null;
  updatedAt?: string | null;
  updatedBy?: { id: string; name: string; email: string } | null;
}

export const settingsApi = {
  // Tax Rate (global default; per-quotation override still allowed in builder)
  getTax: () => request<TaxConfig>('/settings/tax'),
  putTax: (data: { rate: number }) =>
    request<TaxConfig>('/settings/tax', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  listPipelines: () => request<PipelineWithStages[]>('/settings/pipelines'),
  createStage: (data: {
    name: string;
    probability?: number;
    color?: string;
    pipelineId?: string;
  }) =>
    request<PipelineStage>('/settings/pipelines/stages', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateStage: (
    id: string,
    data: {
      name?: string;
      probability?: number;
      color?: string | null;
      position?: number;
    }
  ) =>
    request<PipelineStage>(`/settings/pipelines/stages/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteStage: (id: string) =>
    request<{ ok: boolean }>(`/settings/pipelines/stages/${id}`, {
      method: 'DELETE',
    }),
};
