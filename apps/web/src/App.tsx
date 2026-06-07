import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { AppLayout } from '@/components/layout/app-layout';
import { RequireAuth } from '@/components/require-auth';
import { LoginPage } from '@/pages/login';
import { DashboardPage } from '@/pages/dashboard';
import { CompaniesPage } from '@/pages/companies';
import { CompanyDetailPage } from '@/pages/company-detail';
import { QuotationsPage } from '@/pages/quotations';
import { QuotationDetailPage } from '@/pages/quotation-detail';
import { DealsPage } from '@/pages/deals';
import { AiChatPage } from '@/pages/ai-chat';
import { UsersPage } from '@/pages/users';
import { UserDetailPage } from '@/pages/user-detail';
import { AuditPage } from '@/pages/audit';
import { ServicesPage } from '@/pages/services';
import { ServiceDetailPage } from '@/pages/service-detail';
import { RolesPage } from '@/pages/roles';
import { ProductsPage } from '@/pages/products';
import { ManDayRolesPage } from '@/pages/man-day-roles';
import { AiConfigPage } from '@/pages/ai-config';
import SettingsPage from '@/pages/settings';
import { SettingsLayout } from '@/components/settings-layout';
import { SettingsTaxPage } from '@/pages/settings-tax';
// Day 14.7 Step 8 — the 5 admin pages that were at top-level routes are
// now mounted as children of <SettingsLayout /> (below). Top-level direct
// routes for them are replaced by <Navigate /> backward-compat redirects.
// (SettingsTabPlaceholder is no longer used — all 7 tabs are real pages now.)

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function Bootstrap() {
  const bootstrap = useAuth((s) => s.bootstrap);
  useEffect(() => {
    bootstrap();
  }, [bootstrap]);
  return null;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Bootstrap />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            element={
              <RequireAuth>
                <AppLayout />
              </RequireAuth>
            }
          >
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/companies" element={<CompaniesPage />} />
            <Route path="/companies/:id" element={<CompanyDetailPage />} />
            <Route path="/quotations" element={<QuotationsPage />} />
            <Route path="/quotations/:id" element={<QuotationDetailPage />} />
            <Route path="/deals" element={<DealsPage />} />
            <Route path="/ai" element={<AiChatPage />} />
            <Route path="/users/:id" element={<UserDetailPage />} />
            <Route path="/services" element={<ServicesPage />} />
            <Route path="/services/:id" element={<ServiceDetailPage />} />
            <Route path="/products" element={<ProductsPage />} />
            {/* Day 14.7 Step 8 — 5 admin pages moved under /settings/*.
                Top-level direct routes are now <Navigate /> backward-compat
                redirects (so existing bookmarks, chat-share links, and any
                other deep links from before today still land on the right
                page). Plan mitigation section called this out. */}
            <Route path="/users" element={<Navigate to="/settings/users" replace />} />
            <Route path="/roles" element={<Navigate to="/settings/roles" replace />} />
            <Route path="/ai-config" element={<Navigate to="/settings/ai" replace />} />
            <Route path="/man-day-roles" element={<Navigate to="/settings/man-day" replace />} />
            <Route path="/audit" element={<Navigate to="/settings/audit" replace />} />
            {/* /settings (Pipeline config) — Day 14.7 Step 6 redirects to the new sub-route.
                Bookmarks / deep links from before today still land on Pipeline. */}
            <Route path="/settings" element={<Navigate to="/settings/pipelines" replace />} />
            {/* Day 14.7 — Settings sub-routes under SettingsLayout (Step 6-8: all 7 tabs live). */}
            <Route path="/settings" element={<SettingsLayout />}>
              <Route path="pipelines" element={<SettingsPage />} />
              <Route path="users" element={<UsersPage />} />
              <Route path="roles" element={<RolesPage />} />
              <Route path="ai" element={<AiConfigPage />} />
              <Route path="man-day" element={<ManDayRolesPage />} />
              <Route path="tax" element={<SettingsTaxPage />} />
              <Route path="audit" element={<AuditPage />} />
            </Route>
          </Route>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
