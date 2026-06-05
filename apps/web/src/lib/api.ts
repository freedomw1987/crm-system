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
export interface Company {
  id: string;
  name: string;
  legalName?: string | null;
  industry?: string | null;
  status: 'active' | 'inactive' | 'blacklisted';
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  _count?: { contacts: number; quotations: number; deals: number };
}
export const companiesApi = {
  list: (params: { query?: string; status?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.query) qs.set('query', params.query);
    if (params.status) qs.set('status', params.status);
    if (params.limit) qs.set('limit', String(params.limit));
    return request<{ items: Company[]; total: number } | Company[]>(`/companies${qs.toString() ? `?${qs}` : ''}`).then((r) =>
      Array.isArray(r) ? r : r.items
    );
  },
  get: (id: string) => request<Company>(`/companies/${id}`),
  create: (data: Partial<Company>) => request<Company>('/companies', { method: 'POST', body: JSON.stringify(data) }),
};

// ---------- Products ----------
export interface Product {
  id: string;
  sku: string;
  name: string;
  description?: string | null;
  category?: string | null;
  unitPrice: number;
  currency: string;
  stockQuantity: number;
}
export const productsApi = {
  list: (params: { query?: string; category?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.query) qs.set('query', params.query);
    if (params.category) qs.set('category', params.category);
    if (params.limit) qs.set('limit', String(params.limit));
    return request<{ items: Product[]; total: number }>(`/products${qs.toString() ? `?${qs}` : ''}`).then((r) => r.items);
  },
  get: (id: string) => request<Product>(`/products/${id}`),
};

// ---------- Quotations ----------
export interface QuotationItem {
  id?: string;
  productId?: string | null;
  sku?: string | null;
  name: string;
  description?: string | null;
  quantity: number;
  unitPrice: number;
  discount: number;
  lineTotal: number;
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
  productId?: string;
  sku?: string;
  name: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
}
export const quotationsApi = {
  list: (params: { companyId?: string; status?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.companyId) qs.set('companyId', params.companyId);
    if (params.status) qs.set('status', params.status);
    if (params.limit) qs.set('limit', String(params.limit));
    return request<{ items: Quotation[]; total: number }>(`/quotations${qs.toString() ? `?${qs}` : ''}`).then((r) => r.items);
  },
  get: (id: string) => request<Quotation>(`/quotations/${id}`),
  create: (data: {
    companyId: string;
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
export interface Deal {
  id: string;
  title: string;
  value: number;
  currency: string;
  status: 'OPEN' | 'WON' | 'LOST';
  probability: number;
  expectedCloseDate?: string | null;
  company?: { id: string; name: string };
  owner?: { id: string; name: string };
  stage?: { id: string; name: string; probability: number };
}
export const dealsApi = {
  list: (params: { status?: string; companyId?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set('status', params.status);
    if (params.companyId) qs.set('companyId', params.companyId);
    if (params.limit) qs.set('limit', String(params.limit));
    return request<{ items: Deal[]; total: number }>(`/deals${qs.toString() ? `?${qs}` : ''}`).then((r) => r.items);
  },
  create: (data: { title: string; companyId: string; value: number; stageId: string; ownerId?: string; probability?: number }) =>
    request<Deal>('/deals', { method: 'POST', body: JSON.stringify(data) }),
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
  | 'DEAL_CREATED' | 'DEAL_UPDATED' | 'DEAL_DELETED';
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
