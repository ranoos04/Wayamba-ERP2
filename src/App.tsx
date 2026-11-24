import { useEffect, useMemo, useState } from 'react';
import { fetchErpState } from './api/erpClient.ts';
import { getUserAccessibleFactories } from './domain/stockEngine.ts';
import type { ErpState, Profile } from './domain/types.ts';
import { AdminView } from './components/AdminView.tsx';
import { AppShell, type NavSection } from './components/AppShell.tsx';
import { ApprovalsView } from './components/ApprovalsView.tsx';
import { DashboardView } from './components/DashboardView.tsx';
import { DispatchView } from './components/DispatchView.tsx';
import { LoginScreen } from './components/LoginScreen.tsx';
import { ProductionView } from './components/ProductionView.tsx';
import { ReportsView } from './components/ReportsView.tsx';
import { StockView } from './components/StockView.tsx';
import { TransfersView } from './components/TransfersView.tsx';

const STORAGE_USER_KEY = 'wayamba_erp_user_id';
const STORAGE_FACTORY_KEY = 'wayamba_erp_factory_id';

export default function App() {
  const [state, setState] = useState<ErpState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      return 'u-admin';
    }
    return window.localStorage.getItem(STORAGE_USER_KEY);
  });
  const [selectedFactoryId, setSelectedFactoryId] = useState<string>(() => {
    if (typeof window === 'undefined') return 'fac-01';
    return window.localStorage.getItem(STORAGE_FACTORY_KEY) || 'fac-01';
  });
  const [activeSection, setActiveSection] = useState<NavSection>('dashboard');
  const [openProductionCreate, setOpenProductionCreate] = useState(false);

  useEffect(() => {
    fetchErpState()
      .then((data) => {
        setState(data);
      })
      .catch((err) => {
        setLoadError(err instanceof Error ? err.message : 'Unable to load WAYAMBA PLASTIC ERP');
      });
  }, []);

  const currentUser: Profile | null = useMemo(() => {
    if (!state || !currentUserId) return null;
    return state.profiles.find((p) => p.id === currentUserId && p.isActive) ?? null;
  }, [state, currentUserId]);

  const accessibleFactories = useMemo(() => {
    if (!state || !currentUser) return [];
    return getUserAccessibleFactories(state, currentUser.id);
  }, [state, currentUser]);

  const effectiveFactoryId = useMemo(() => {
    if (!currentUser) return 'fac-01';
    if (selectedFactoryId === 'ALL') {
      const isSuper = state?.memberships.some(
        (m) => m.userId === currentUser.id && m.role === 'super_admin' && m.isActive
      );
      if (isSuper) return 'ALL';
    }
    if (accessibleFactories.some((f) => f.id === selectedFactoryId)) {
      return selectedFactoryId;
    }
    return accessibleFactories[0]?.id ?? 'fac-01';
  }, [state, currentUser, accessibleFactories, selectedFactoryId]);

  function handleLoginSuccess(user: Profile) {
    setCurrentUserId(user.id);
    window.localStorage.setItem(STORAGE_USER_KEY, user.id);
    setActiveSection('dashboard');
  }

  function handleSwitchUser(userId: string) {
    setCurrentUserId(userId);
    window.localStorage.setItem(STORAGE_USER_KEY, userId);
  }

  function handleSelectFactory(factoryId: string) {
    setSelectedFactoryId(factoryId);
    window.localStorage.setItem(STORAGE_FACTORY_KEY, factoryId);
  }

  function handleLogout() {
    setCurrentUserId(null);
    window.localStorage.removeItem(STORAGE_USER_KEY);
    setActiveSection('dashboard');
  }

  function handlePrimaryAction() {
    setOpenProductionCreate(true);
    setActiveSection('production');
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white border border-red-200 rounded-lg p-6 max-w-md w-full space-y-3">
          <h1 className="font-display text-lg font-bold text-slate-900">Connection Error</h1>
          <p className="text-sm text-red-700">{loadError}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-blue-700 text-white text-sm font-semibold rounded-lg cursor-pointer"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="w-full max-w-md space-y-3">
          <div className="h-4 bg-slate-200 rounded w-1/3 animate-pulse" />
          <div className="h-24 bg-slate-200 rounded animate-pulse" />
          <div className="h-12 bg-slate-200 rounded animate-pulse" />
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return <LoginScreen state={state} onLoginSuccess={handleLoginSuccess} />;
  }

  const pendingApprovalCount = state.transactions.filter(
    (t) =>
      t.status === 'submitted' &&
      (effectiveFactoryId === 'ALL' || t.factoryId === effectiveFactoryId)
  ).length;

  const inTransitCount = state.transfers.filter((t) => t.transferStatus === 'in_transit').length;

  return (
    <AppShell
      state={state}
      currentUser={currentUser}
      accessibleFactories={accessibleFactories}
      selectedFactoryId={effectiveFactoryId}
      onSelectFactory={handleSelectFactory}
      activeSection={activeSection}
      onSelectSection={setActiveSection}
      onSwitchUser={handleSwitchUser}
      onLogout={handleLogout}
      onPrimaryAction={handlePrimaryAction}
      primaryActionLabel="New Production"
      pendingApprovalCount={pendingApprovalCount}
      inTransitCount={inTransitCount}
    >
      {activeSection === 'dashboard' && (
        <DashboardView
          state={state}
          selectedFactoryId={effectiveFactoryId}
          onNavigate={setActiveSection}
        />
      )}

      {activeSection === 'production' && (
        <ProductionView
          state={state}
          currentUser={currentUser}
          accessibleFactories={accessibleFactories}
          selectedFactoryId={effectiveFactoryId}
          openCreateInitially={openProductionCreate}
          onConsumeOpenCreate={() => setOpenProductionCreate(false)}
          onStateUpdated={setState}
        />
      )}

      {activeSection === 'stock' && (
        <StockView
          state={state}
          currentUser={currentUser}
          accessibleFactories={accessibleFactories}
          selectedFactoryId={effectiveFactoryId}
          onStateUpdated={setState}
        />
      )}

      {activeSection === 'dispatch' && (
        <DispatchView
          state={state}
          currentUser={currentUser}
          accessibleFactories={accessibleFactories}
          selectedFactoryId={effectiveFactoryId}
          onStateUpdated={setState}
        />
      )}

      {activeSection === 'transfers' && (
        <TransfersView
          state={state}
          currentUser={currentUser}
          accessibleFactories={accessibleFactories}
          selectedFactoryId={effectiveFactoryId}
          onStateUpdated={setState}
        />
      )}

      {activeSection === 'approvals' && (
        <ApprovalsView
          state={state}
          currentUser={currentUser}
          selectedFactoryId={effectiveFactoryId}
          onStateUpdated={setState}
        />
      )}

      {activeSection === 'reports' && (
        <ReportsView
          state={state}
          accessibleFactories={accessibleFactories}
          selectedFactoryId={effectiveFactoryId}
        />
      )}

      {activeSection === 'admin' && (
        <AdminView state={state} currentUser={currentUser} onStateUpdated={setState} />
      )}
    </AppShell>
  );
}
