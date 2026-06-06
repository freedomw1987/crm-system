/**
 * Typed API client — all calls go through here.
 * Auth token is read from localStorage and attached as Bearer.
 */

const TOKEN_KEY = 'crm:token';
const API_BASE = '/api'; // Vite proxy strips /api prefix

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

  const res = await fetch(`${API_BASE}${path}`, {
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
        window.location.assign('/login');
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
  /** For SERVICE items: snapshot of the service's man-day structure at the
   *  time the quotation was created. Used to display the SOW breakdown in the
   *  quotation detail view even if the service template is later changed. */
  manDaySnapshot?: Array<{ role: string; dayRate: number; days: number; subtotal: number }> | null;
}
export type QuotationStatus = 'DRAFT' | 'SENT' | 'VIEWED' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'INVOICED';
export interface Quotation {
  id: string;
  number: string;
  title?: string | null;
  status: QuotationStatus;
  companyId: string;
  // Detail response: full company object. List response: { id, name }.
  company?: {
    id: string;
    name: string;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
  };
  createdBy?: { id: string; name: string; email: string };
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
export const quotationsApi = {
  list: (params: { companyId?: string; status?: string; dealId?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.companyId) qs.set('companyId', params.companyId);
    if (params.status) qs.set('status', params.status);
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
    title?: string;
    notes?: string;
    taxRate?: number;
    validUntil?: string;
    items: QuotationItemInput[];
  }) => request<Quotation>('/quotations', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<Pick<Quotation, 'title' | 'notes' | 'taxRate' | 'status' | 'validUntil'>>) =>
    request<Quotation>(`/quotations/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  remove: (id: string) => request<{ success: boolean }>(`/quotations/${id}`, { method: 'DELETE' }),
  addItem: (quotationId: string, item: QuotationItemInput) =>
    request<QuotationItem>(`/quotations/${quotationId}/items`, { method: 'POST', body: JSON.stringify(item) }),
  updateItem: (quotationId: string, itemId: string, item: Partial<QuotationItemInput>) =>
    request<QuotationItem>(`/quotations/${quotationId}/items/${itemId}`, { method: 'PATCH', body: JSON.stringify(item) }),
  removeItem: (quotationId: string, itemId: string) =>
    request<{ success: boolean }>(`/quotations/${quotationId}/items/${itemId}`, { method: 'DELETE' }),
  setStatus: (id: string, status: Quotation['status']) =>
    request<Quotation>(`/quotations/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
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
  /** Day 8: Kanban view — returns stages with nested deals. */
  kanban: () => request<KanbanData>('/deals/kanban'),
  /** Day 8: Move deal to a new stage (drag-drop endpoint). */
  moveStage: (id: string, stageId: string) =>
    request<Deal>(`/deals/${id}/stage`, { method: 'PATCH', body: JSON.stringify({ stageId }) }),
  create: (data: { title: string; companyId: string; value: number; stageId: string; ownerId?: string; probability?: number; expectedCloseDate?: string; description?: string }) =>
    request<Deal>('/deals', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<{ title: string; value: number; probability: number; expectedCloseDate: string; description: string }>) =>
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
export interface AgentRunResult {
  conversationId: string;
  reply: string;
  toolCalls: Array<{ name: string; args: unknown; result: unknown }>;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
}
export const chatApi = {
  list: () => request<ConversationSummary[]>('/chat/conversations'),
  get: (id: string) => request<Conversation>(`/chat/conversations/${id}`),
  send: (message: string, conversationId?: string) =>
    request<AgentRunResult>('/chat/send', {
      method: 'POST',
      body: JSON.stringify({ message, conversationId }),
    }),
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
  /** Computed: dayRate × days. */
  subtotal?: number;
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
