import { useState, type ReactNode } from 'react';
import {
  ArrowLeftRight,
  BarChart3,
  Boxes,
  CheckSquare,
  Factory as FactoryIcon,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  Settings,
  Shield,
  Truck,
  Wrench,
  X,
} from 'lucide-react';
import type { AppRole, ErpState, Factory, Profile } from '../domain/types.ts';
import { getUserRoleForFactory } from '../domain/stockEngine.ts';
import { ROLE_LABELS } from './StatusLabel.tsx';

export type NavSection =
  | 'dashboard'
  | 'production'
  | 'stock'
  | 'dispatch'
  | 'transfers'
  | 'approvals'
  | 'reports'
  | 'admin';

interface AppShellProps {
  state: ErpState;
  currentUser: Profile;
  accessibleFactories: Factory[];
  selectedFactoryId: string;
  onSelectFactory: (factoryId: string) => void;
  activeSection: NavSection;
  onSelectSection: (section: NavSection) => void;
  onSwitchUser: (userId: string) => void;
  onLogout: () => void;
  onPrimaryAction: () => void;
  primaryActionLabel: string;
  pendingApprovalCount: number;
  inTransitCount: number;
  children: ReactNode;
}

const NAV_ITEMS: Array<{
  id: NavSection;
  label: string;
  icon: typeof LayoutDashboard;
}> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'production', label: 'Production', icon: Wrench },
  { id: 'stock', label: 'Stock & Materials', icon: Boxes },
  { id: 'dispatch', label: 'Dispatch', icon: Truck },
  { id: 'transfers', label: 'Transfers', icon: ArrowLeftRight },
  { id: 'approvals', label: 'Approval Centre', icon: CheckSquare },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
  { id: 'admin', label: 'Master Data & Audit', icon: Settings },
];

const SECTION_TITLES: Record<NavSection, string> = {
  dashboard: 'Dashboard',
  production: 'Production Orders',
  stock: 'Stock & Materials',
  dispatch: 'Customer Dispatch',
  transfers: 'Inter-Factory Transfers',
  approvals: 'Approval Centre',
  reports: 'Reports & Stock',
  admin: 'Master Data & Users',
};

export function AppShell({
  state,
  currentUser,
  accessibleFactories,
  selectedFactoryId,
  onSelectFactory,
  activeSection,
  onSelectSection,
  onSwitchUser,
  onLogout,
  onPrimaryAction,
  primaryActionLabel,
  pendingApprovalCount,
  inTransitCount,
  children,
}: AppShellProps) {
  const [moreOpen, setMoreOpen] = useState(false);

  const activeFactory = accessibleFactories.find((f) => f.id === selectedFactoryId);
  const activeRole: AppRole | null =
    selectedFactoryId === 'ALL'
      ? 'super_admin'
      : getUserRoleForFactory(state, currentUser.id, selectedFactoryId);

  const canViewAllFactories = state.memberships.some(
    (m) => m.userId === currentUser.id && m.role === 'super_admin' && m.isActive
  );

  function navigateTo(section: NavSection) {
    setMoreOpen(false);
    onSelectSection(section);
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row">
      {/* Desktop Left Sidebar */}
      <aside className="no-print hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 bg-slate-900 text-slate-200 border-r border-slate-800">
        <div className="h-16 px-5 flex items-center gap-3 border-b border-slate-800">
          <div className="w-8 h-8 rounded-md bg-blue-600 flex items-center justify-center text-white shrink-0">
            <FactoryIcon className="w-4 h-4" aria-hidden="true" />
          </div>
          <span className="font-display font-bold text-sm tracking-tight text-white whitespace-nowrap">
            WAYAMBA PLASTIC
          </span>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto" aria-label="Primary Navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            const badgeCount =
              item.id === 'approvals'
                ? pendingApprovalCount
                : item.id === 'transfers'
                ? inTransitCount
                : 0;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => navigateTo(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-blue-700 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <span className="flex items-center gap-3 min-w-0">
                  <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{item.label}</span>
                </span>
                {badgeCount > 0 && (
                  <span
                    className={`font-mono text-xs px-1.5 py-0.5 rounded ${
                      isActive ? 'bg-blue-800 text-white' : 'bg-amber-500/20 text-amber-300'
                    }`}
                  >
                    {badgeCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Signed-in Employee Profile & Sign Out */}
        <div className="p-4 border-t border-slate-800 space-y-3">
          <div className="space-y-0.5">
            <div className="text-sm font-semibold text-white truncate">{currentUser.fullName}</div>
            <div className="text-xs text-slate-400 truncate">
              {activeRole ? ROLE_LABELS[activeRole] : 'Authorized Staff'}
            </div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg border border-slate-700 text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0 pb-20 lg:pb-0">
        {/* Top Bar Contract: Breadcrumb Left — Primary Action Right */}
        <header className="no-print h-16 bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4 sticky top-0 z-20">
          <div className="flex items-center gap-2 min-w-0 text-sm">
            <span className="font-display font-bold text-slate-900 whitespace-nowrap lg:hidden">
              WAYAMBA PLASTIC
            </span>
            <nav aria-label="Breadcrumb" className="hidden lg:flex items-center gap-2 text-sm min-w-0">
              <span className="text-slate-500 whitespace-nowrap">Wayamba Plastic</span>
              <span className="text-slate-300" aria-hidden="true">
                /
              </span>
              <span className="text-slate-600 truncate max-w-[240px]">
                {selectedFactoryId === 'ALL'
                  ? 'All Factories'
                  : activeFactory?.factoryName ?? 'Factory'}
              </span>
              <span className="text-slate-300" aria-hidden="true">
                /
              </span>
              <span className="font-semibold text-slate-900 whitespace-nowrap">
                {SECTION_TITLES[activeSection]}
              </span>
            </nav>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={onPrimaryAction}
              className="px-3.5 sm:px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white text-xs sm:text-sm font-semibold rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span className="sm:hidden">Production</span>
              <span className="hidden sm:inline">{primaryActionLabel}</span>
            </button>
          </div>
        </header>

        {/* Workspace Toolbar: Factory Selector + Role Switcher (Below Top Bar) */}
        <div className="no-print bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 py-2.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <label
                htmlFor="factory-selector"
                className="text-xs font-medium text-slate-500 whitespace-nowrap"
              >
                Active Factory
              </label>
              <select
                id="factory-selector"
                value={selectedFactoryId}
                onChange={(e) => onSelectFactory(e.target.value)}
                className="text-xs sm:text-sm font-medium text-slate-900 bg-slate-50 border border-slate-300 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                {canViewAllFactories && <option value="ALL">All Factories (Consolidated)</option>}
                {accessibleFactories.map((fac) => (
                  <option key={fac.id} value={fac.id}>
                    {fac.factoryCode} — {fac.factoryName}
                  </option>
                ))}
              </select>
            </div>

            {activeRole && (
              <span className="text-xs text-slate-500 hidden sm:inline">
                Role: <strong className="font-medium text-slate-800">{ROLE_LABELS[activeRole]}</strong>
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Shield className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
            <label htmlFor="user-switcher" className="text-xs text-slate-500 whitespace-nowrap">
              Acting User
            </label>
            <select
              id="user-switcher"
              value={currentUser.id}
              onChange={(e) => onSwitchUser(e.target.value)}
              className="text-xs font-medium text-slate-800 bg-slate-50 border border-slate-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-600 max-w-[200px]"
            >
              {state.profiles
                .filter((p) => p.isActive)
                .map((p) => {
                  const mem = state.memberships.find((m) => m.userId === p.id);
                  return (
                    <option key={p.id} value={p.id}>
                      {p.fullName} ({mem ? ROLE_LABELS[mem.role] : 'Staff'})
                    </option>
                  );
                })}
            </select>
          </div>
        </div>

        {/* Main Viewport */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1320px] w-full mx-auto">
          {children}
        </main>
      </div>

      {/* Mobile More Menu Drawer */}
      {moreOpen && (
        <div
          className="no-print lg:hidden fixed inset-0 z-40 bg-slate-950/50 flex items-end"
          role="dialog"
          aria-modal="true"
          aria-label="More ERP Sections"
        >
          <div className="bg-white w-full rounded-t-2xl p-5 space-y-3 border-t border-slate-200">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <span className="font-display text-sm font-bold text-slate-900">
                More Operations &amp; Admin
              </span>
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setMoreOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => navigateTo('approvals')}
                className="p-3 text-left border border-slate-200 rounded-lg text-xs font-semibold text-slate-900 flex items-center justify-between"
              >
                <span>Approval Centre</span>
                {pendingApprovalCount > 0 && (
                  <span className="font-mono text-amber-700">{pendingApprovalCount}</span>
                )}
              </button>
              <button
                type="button"
                onClick={() => navigateTo('transfers')}
                className="p-3 text-left border border-slate-200 rounded-lg text-xs font-semibold text-slate-900 flex items-center justify-between"
              >
                <span>Transfers</span>
                {inTransitCount > 0 && (
                  <span className="font-mono text-blue-700">{inTransitCount}</span>
                )}
              </button>
              <button
                type="button"
                onClick={() => navigateTo('reports')}
                className="p-3 text-left border border-slate-200 rounded-lg text-xs font-semibold text-slate-900"
              >
                Reports &amp; Exports
              </button>
              <button
                type="button"
                onClick={() => navigateTo('admin')}
                className="p-3 text-left border border-slate-200 rounded-lg text-xs font-semibold text-slate-900"
              >
                Master Data &amp; Audit
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                setMoreOpen(false);
                onLogout();
              }}
              className="w-full py-2.5 border border-slate-300 rounded-lg text-xs font-medium text-slate-700 flex items-center justify-center gap-2"
            >
              <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Sign Out ({currentUser.fullName})</span>
            </button>
          </div>
        </div>
      )}

      {/* Mobile 5-Tab Bottom Navigation (Section 7.4 of Spec: Home, Production, Stock, Dispatch, More) */}
      <nav
        aria-label="Mobile Navigation"
        className="no-print lg:hidden fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 flex items-center justify-around h-16 z-30"
      >
        <button
          type="button"
          onClick={() => navigateTo('dashboard')}
          className={`flex flex-col items-center justify-center flex-1 h-full text-[11px] font-medium ${
            activeSection === 'dashboard' ? 'text-blue-700' : 'text-slate-500'
          }`}
        >
          <LayoutDashboard className="w-5 h-5 mb-0.5" aria-hidden="true" />
          <span>Home</span>
        </button>
        <button
          type="button"
          onClick={() => navigateTo('production')}
          className={`flex flex-col items-center justify-center flex-1 h-full text-[11px] font-medium ${
            activeSection === 'production' ? 'text-blue-700' : 'text-slate-500'
          }`}
        >
          <Wrench className="w-5 h-5 mb-0.5" aria-hidden="true" />
          <span>Production</span>
        </button>
        <button
          type="button"
          onClick={() => navigateTo('stock')}
          className={`flex flex-col items-center justify-center flex-1 h-full text-[11px] font-medium ${
            activeSection === 'stock' ? 'text-blue-700' : 'text-slate-500'
          }`}
        >
          <Boxes className="w-5 h-5 mb-0.5" aria-hidden="true" />
          <span>Stock</span>
        </button>
        <button
          type="button"
          onClick={() => navigateTo('dispatch')}
          className={`flex flex-col items-center justify-center flex-1 h-full text-[11px] font-medium ${
            activeSection === 'dispatch' ? 'text-blue-700' : 'text-slate-500'
          }`}
        >
          <Truck className="w-5 h-5 mb-0.5" aria-hidden="true" />
          <span>Dispatch</span>
        </button>
        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          className={`relative flex flex-col items-center justify-center flex-1 h-full text-[11px] font-medium ${
            ['transfers', 'approvals', 'reports', 'admin'].includes(activeSection) || moreOpen
              ? 'text-blue-700'
              : 'text-slate-500'
          }`}
        >
          <Menu className="w-5 h-5 mb-0.5" aria-hidden="true" />
          <span>More</span>
          {pendingApprovalCount > 0 && (
            <span className="absolute top-1.5 right-3 font-mono text-[10px] px-1 bg-amber-600 text-white rounded">
              {pendingApprovalCount}
            </span>
          )}
        </button>
      </nav>
    </div>
  );
}
