import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Building2, FileText, KanbanSquare, LogOut,
  LayoutDashboard, Menu, X, Settings,
  Sparkles, Package, Briefcase,
} from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// Day 9: reordered to mirror the sales funnel — Dashboard (overview) →
// Companies (accounts) → Deals (pipeline opportunities) → Quotations
// (proposals) → Products / Services (catalogue). AI Assistant was moved
// out of the nav and into a global FAB at the bottom-right of the page
// (see AiFab below) so it's always one tap away from any screen.
const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/companies', label: 'Companies', icon: Building2 },
  { to: '/deals', label: 'Deals', icon: KanbanSquare },
  { to: '/quotations', label: 'Quotation', icon: FileText },
  { to: '/products', label: 'Product', icon: Package },
  { to: '/services', label: 'Service', icon: Briefcase },
];

// Day 14.7 Step 10 — collapsed 5 separate admin links (Users / Roles /
// Man-day / AI 設定 / Audit) into ONE "系統設置" entry that opens the
// tabbed SettingsLayout (Pipelines/Users/Roles/AI/Man-day/Tax/Audit).
// The 5 old top-level routes are still wired as <Navigate /> redirects
// in App.tsx, so existing bookmarks / chat-share links still work, but
// the sidebar no longer advertises them — the goal is a single discoverable
// "System Settings" surface. Audit log is reachable via the Tax tab's
// "View audit log" link (or by navigating /settings/audit directly).
const adminNavItems = [
  { to: '/settings', label: '系統設置', icon: Settings, adminOnly: true },
];

export function AppLayout() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);

  function handleLogout() {
    logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="min-h-screen flex bg-muted/30">
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed lg:static inset-y-0 left-0 z-40 w-64 bg-card border-r flex flex-col transition-transform',
          open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        <div className="h-16 flex items-center justify-between px-4 border-b">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded bg-primary text-primary-foreground flex items-center justify-center font-bold">
              C
            </div>
            <span className="font-semibold">CRM</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setOpen(false)}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        <nav className="flex-1 p-2 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                )
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
          {user?.role === 'ADMIN' && (
            <>
              <div className="px-3 pt-4 pb-1 text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                Admin
              </div>
              {adminNavItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                    )
                  }
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </NavLink>
              ))}
            </>
          )}
        </nav>

        <div className="p-3 border-t">
          <div className="flex items-center gap-3 mb-3 px-2">
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold">
              {user?.name?.charAt(0).toUpperCase() ?? '?'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{user?.name}</div>
              <div className="text-xs text-muted-foreground truncate">{user?.role}</div>
            </div>
          </div>
          <Button variant="outline" size="sm" className="w-full" onClick={handleLogout}>
            <LogOut className="h-4 w-4 mr-2" />
            登出
          </Button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="lg:hidden h-16 border-b flex items-center px-4 bg-card">
          <Button variant="ghost" size="icon" onClick={() => setOpen(true)}>
            <Menu className="h-5 w-5" />
          </Button>
          <span className="ml-3 font-semibold">CRM</span>
        </header>
        <main className="flex-1 overflow-auto">
          <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Global AI Assistant FAB — bottom-right, visible on every page.
          Renders outside <main> so the viewport-fixed positioning isn't
          clipped by main's overflow-auto scroll container. Hides itself
          when the user is already on /ai so it doesn't cover the chat. */}
      <AiFab />
    </div>
  );
}

/**
 * AiFab — Floating Action Button that links to /ai (the AI Assistant page).
 *
 * Design notes (2026-06-09):
 * - 56px circle (Material Design spec for FAB) — big enough for thumb tap,
 *   small enough not to block content
 * - bottom-6 right-6 = 24px margin from edges (Tailwind default)
 * - z-50 to sit above main content and below modals (which use z-[100]+)
 * - Sparkles icon + brand-primary background to read as "special" / "AI"
 * - Pulse ring on the wrapper to draw the eye without being annoying
 * - aria-label for screen readers; visual label only shows on hover
 *   (via a tiny adjacent pill) so the icon stays clean by default
 */
function AiFab() {
  const navigate = useNavigate();
  const location = useLocation();
  const [showLabel, setShowLabel] = useState(false);
  // Hide the FAB when the user is already on the AI chat page — it's
  // distracting and would just cover the chat composer.
  if (location.pathname === '/ai') return null;
  return (
    <button
      type="button"
      onClick={() => navigate('/ai')}
      onMouseEnter={() => setShowLabel(true)}
      onMouseLeave={() => setShowLabel(false)}
      onFocus={() => setShowLabel(true)}
      onBlur={() => setShowLabel(false)}
      aria-label="開 AI Assistant"
      className={cn(
        'group fixed bottom-6 right-6 z-50',
        'h-14 w-14 rounded-full',
        'bg-primary text-primary-foreground shadow-lg hover:shadow-xl',
        'flex items-center justify-center',
        'transition-all hover:scale-105 active:scale-95',
        'focus:outline-none focus:ring-4 focus:ring-primary/30'
      )}
    >
      {/* Subtle pulse ring to catch the eye without being noisy */}
      <span className="absolute inset-0 rounded-full bg-primary/40 animate-ping opacity-30" />
      <Sparkles className="relative h-6 w-6" />
      {/* Tooltip-style label appears on hover/focus, slides in from the right */}
      <span
        className={cn(
          'absolute right-full mr-3 whitespace-nowrap',
          'bg-foreground text-background text-xs font-medium px-2.5 py-1.5 rounded-md shadow-md',
          'transition-opacity',
          showLabel ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
        aria-hidden="true"
      >
        AI Assistant
      </span>
    </button>
  );
}
