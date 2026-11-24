import { useState } from 'react';
import { Factory as FactoryIcon, Lock, Mail, ArrowRight, ShieldCheck } from 'lucide-react';
import type { ErpState, Profile } from '../domain/types.ts';
import { loginEmployee } from '../api/erpClient.ts';
import { ROLE_LABELS } from './StatusLabel.tsx';

interface LoginScreenProps {
  state: ErpState;
  onLoginSuccess: (user: Profile) => void;
}

const DEMO_QUICK_ACCOUNTS = [
  { email: 'waseemmw6521334@gmail.com', roleLabel: 'Super Admin', scope: 'All 3 Factories' },
  { email: 'nimali@wayambaplastic.lk', roleLabel: 'Factory Manager', scope: 'Factory 01 – Main' },
  { email: 'ruwan@wayambaplastic.lk', roleLabel: 'Factory Manager', scope: 'Factory 02 & 03' },
  { email: 'tharindu@wayambaplastic.lk', roleLabel: 'Production Supervisor', scope: 'Factory 01 & 03' },
  { email: 'dilshan@wayambaplastic.lk', roleLabel: 'Storekeeper', scope: 'Factory 01 & 02' },
  { email: 'sanduni@wayambaplastic.lk', roleLabel: 'Dispatch Officer', scope: 'Factory 01 & 03' },
];

export function LoginScreen({ state, onLoginSuccess }: LoginScreenProps) {
  const [email, setEmail] = useState('waseemmw6521334@gmail.com');
  const [password, setPassword] = useState('wayamba123');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const user = await loginEmployee(email, password);
      onLoginSuccess(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in');
    } finally {
      setLoading(false);
    }
  }

  async function handleQuickSignIn(accountEmail: string) {
    setEmail(accountEmail);
    setPassword('wayamba123');
    setError(null);
    setLoading(true);
    try {
      const user = await loginEmployee(accountEmail, 'wayamba123');
      onLoginSuccess(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row">
      {/* Left Industrial Showcase Panel */}
      <div className="relative lg:w-1/2 min-h-[260px] lg:min-h-screen bg-slate-900 overflow-hidden flex flex-col justify-between p-8 lg:p-12">
        {!imgFailed ? (
          <img
            src="/src/assets/images/wayamba_facility_1795499199861.jpg"
            alt="Wayamba Plastic polypropylene pallet and raw material warehouse"
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            className="absolute inset-0 w-full h-full object-cover opacity-55"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-blue-950" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-900/55 to-slate-950/40" />

        <div className="relative z-10 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center text-white">
            <FactoryIcon className="w-5 h-5" aria-hidden="true" />
          </div>
          <div>
            <span className="font-display text-lg font-bold tracking-tight text-white block">
              WAYAMBA PLASTIC
            </span>
            <span className="text-xs text-slate-300">
              Multi-Factory Production &amp; Stock Maintenance ERP
            </span>
          </div>
        </div>

        <div className="relative z-10 max-w-lg space-y-4 mt-12 lg:mt-0">
          <h1 className="font-display text-3xl lg:text-4xl font-bold text-white leading-tight text-balance">
            One source of truth for every kilogram produced, transferred, and dispatched.
          </h1>
          <p className="text-sm lg:text-base text-slate-200 leading-relaxed">
            Centralized stock maintenance across Factory 01 (Main), Factory 02 (Raw Material), and
            Factory 03 (Molding) with manager-approved stock ledger posting and role-based access.
          </p>
          <div className="pt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-300">
            <span>PP Pallets &amp; Pellets</span>
            <span aria-hidden="true">·</span>
            <span>Day &amp; Night Shifts</span>
            <span aria-hidden="true">·</span>
            <span>Stock Ledger Control</span>
          </div>
        </div>
      </div>

      {/* Right Authentication Panel */}
      <div className="lg:w-1/2 flex items-center justify-center p-6 sm:p-10 lg:p-14 bg-white">
        <div className="w-full max-w-md space-y-8">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-blue-700">Employee Access Portal</p>
            <h2 className="font-display text-2xl font-bold text-slate-900">
              Sign in to Wayamba Plastic
            </h2>
            <p className="text-sm text-slate-500">
              Access is scoped to your assigned factories and operational role.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="login-email" className="block text-sm font-medium text-slate-700 mb-1.5">
                Employee Email
              </label>
              <div className="relative">
                <Mail
                  className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2"
                  aria-hidden="true"
                />
                <input
                  id="login-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@wayambaplastic.lk"
                  className="w-full pl-10 pr-4 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="login-password"
                className="block text-sm font-medium text-slate-700 mb-1.5"
              >
                Password
              </label>
              <div className="relative">
                <Lock
                  className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2"
                  aria-hidden="true"
                />
                <input
                  id="login-password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full pl-10 pr-4 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                />
              </div>
            </div>

            {error && (
              <div
                role="alert"
                className="p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg"
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-blue-700 hover:bg-blue-800 disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>{loading ? 'Signing in...' : 'Sign In'}</span>
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </form>

          {/* Role-Based Quick Sign-In Directory for Evaluation */}
          <div className="pt-6 border-t border-slate-200 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                <span>
                  Quick Employee Role Switch (Demo Password: <code className="font-mono">wayamba123</code>)
                </span>
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {DEMO_QUICK_ACCOUNTS.map((acc) => {
                const profile = state.profiles.find((p) => p.email === acc.email);
                const membership = profile
                  ? state.memberships.find((m) => m.userId === profile.id)
                  : null;
                return (
                  <button
                    key={acc.email}
                    type="button"
                    onClick={() => handleQuickSignIn(acc.email)}
                    className="text-left p-2.5 rounded-lg border border-slate-200 hover:border-blue-400 hover:bg-blue-50/40 transition-colors cursor-pointer"
                  >
                    <div className="text-xs font-semibold text-slate-900 truncate">
                      {profile?.fullName ?? acc.email}
                    </div>
                    <div className="text-[11px] text-slate-500 truncate">
                      {membership ? ROLE_LABELS[membership.role] : acc.roleLabel} · {acc.scope}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
