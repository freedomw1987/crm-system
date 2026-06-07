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
import { SettingsTabPlaceholder } from '@/pages/settings-tab-placeholder';

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
            <Route path="/users" element={<UsersPage />} />
            <Route path="/users/:id" element={<UserDetailPage />} />
            <Route path="/audit" element={<AuditPage />} />
            <Route path="/services" element={<ServicesPage />} />
            <Route path="/services/:id" element={<ServiceDetailPage />} />
            <Route path="/products" element={<ProductsPage />} />
            <Route path="/roles" element={<RolesPage />} />
            <Route path="/man-day-roles" element={<ManDayRolesPage />} />
            <Route path="/ai-config" element={<AiConfigPage />} />
            {/* /settings (Pipeline config) — Day 14.7 Step 6 redirects to the new sub-route.
                Bookmarks / deep links from before today still land on Pipeline. */}
            <Route path="/settings" element={<Navigate to="/settings/pipelines" replace />} />
            {/* Day 14.7 — Settings sub-routes under SettingsLayout (Step 6: Tabs nav done; Step 7-8 fill children). */}
            <Route path="/settings" element={<SettingsLayout />}>
              <Route path="pipelines" element={<SettingsPage />} />
              <Route path="users" element={<SettingsTabPlaceholder title="Users" description="User management (moved from top-level)." step="Step 8" />} />
              <Route path="roles" element={<SettingsTabPlaceholder title="Roles" description="Role & permission management (moved from top-level)." step="Step 8" />} />
              <Route path="ai" element={<SettingsTabPlaceholder title="AI Config" description="AI provider config (moved from top-level)." step="Step 8" />} />
              <Route path="man-day" element={<SettingsTabPlaceholder title="Man-day Roles" description="Man-day role catalog (moved from top-level)." step="Step 8" />} />
              <Route path="tax" element={<SettingsTabPlaceholder title="Tax Rate" description="Global default tax rate for new quotations. Per-quotation override remains available in the quotation builder." step="Step 7" />} />
              <Route path="audit" element={<SettingsTabPlaceholder title="Audit Log" description="System audit log (moved from top-level)." step="Step 8" />} />
            </Route>
          </Route>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
