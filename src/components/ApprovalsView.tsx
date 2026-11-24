import { useState } from 'react';
import { AlertCircle, CheckCircle2, FileText, ShieldAlert, XCircle } from 'lucide-react';
import type { ErpState, Profile } from '../domain/types.ts';
import { canApproveTransaction } from '../domain/stockEngine.ts';
import { approveTransactionApi, rejectTransactionApi } from '../api/erpClient.ts';
import { StatusLabel } from './StatusLabel.tsx';

interface ApprovalsViewProps {
  state: ErpState;
  currentUser: Profile;
  selectedFactoryId: string;
  onStateUpdated: (next: ErpState) => void;
}

export function ApprovalsView({
  state,
  currentUser,
  selectedFactoryId,
  onStateUpdated,
}: ApprovalsViewProps) {
  const [remarksMap, setRemarksMap] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const pendingTxs = state.transactions.filter(
    (t) =>
      t.status === 'submitted' &&
      (selectedFactoryId === 'ALL' || t.factoryId === selectedFactoryId)
  );

  const recentDecisions = state.approvals.slice(0, 8);

  async function handleApprove(txId: string) {
    setError(null);
    setBusyId(txId);
    try {
      const res = await approveTransactionApi(txId, currentUser.id, remarksMap[txId] || 'Approved');
      onStateUpdated(res.state);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approval failed');
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(txId: string) {
    setError(null);
    const remarks = remarksMap[txId]?.trim() || '';
    if (!remarks) {
      setError('Please enter rejection remarks before rejecting a transaction.');
      return;
    }
    setBusyId(txId);
    try {
      const res = await rejectTransactionApi(txId, currentUser.id, remarks);
      onStateUpdated(res.state);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rejection failed');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-bold text-slate-900">Approval Centre</h1>
        <p className="text-sm text-slate-500">
          Only an authorized Factory Manager or Super Admin (not the transaction creator) can approve and post stock movements atomically.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="p-3.5 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2"
        >
          <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {/* Pending Queue */}
      <div className="space-y-4">
        {pendingTxs.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-lg p-10 text-center space-y-2">
            <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" aria-hidden="true" />
            <div className="text-sm font-semibold text-slate-900">All caught up</div>
            <p className="text-xs text-slate-500">
              There are no submitted transactions awaiting manager approval in this factory scope.
            </p>
          </div>
        ) : (
          pendingTxs.map((tx) => {
            const fac = state.factories.find((f) => f.id === tx.factoryId);
            const creator = state.profiles.find((p) => p.id === tx.createdBy);
            const lines = state.transactionLines.filter((l) => l.transactionId === tx.id);
            const docs = state.documents.filter((d) => d.transactionId === tx.id);
            const validation = canApproveTransaction(state, tx.id, currentUser.id);

            return (
              <div
                key={tx.id}
                className="bg-white border border-slate-200 rounded-lg p-5 space-y-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 pb-3 border-b border-slate-100">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-bold text-slate-900">
                        {tx.transactionNumber}
                      </span>
                      <span className="text-xs text-slate-400">·</span>
                      <span className="text-xs font-medium text-slate-700 capitalize">
                        {tx.transactionType.replace('_', ' ')}
                      </span>
                      <span className="text-xs text-slate-400">·</span>
                      <span className="text-xs text-slate-600">{fac?.factoryName}</span>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      Date: <span className="font-mono tabular-nums">{tx.transactionDate}</span> ·
                      Submitted by <strong className="text-slate-700">{creator?.fullName}</strong>
                      {tx.referenceNumber ? ` · Ref: ${tx.referenceNumber}` : ''}
                    </div>
                  </div>
                  <StatusLabel status={tx.status} />
                </div>

                {/* Line Items */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="text-slate-500 border-b border-slate-100">
                      <tr>
                        <th className="py-2 pr-3">Item</th>
                        <th className="py-2 px-3">Movement</th>
                        <th className="py-2 pl-3 text-right">Quantity</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {lines.map((l) => {
                        const prod = l.productId
                          ? state.products.find((p) => p.id === l.productId)
                          : null;
                        const mat = l.materialId
                          ? state.rawMaterials.find((m) => m.id === l.materialId)
                          : null;
                        const unit = prod?.unitCode ?? mat?.unitCode ?? 'KG';
                        return (
                          <tr key={l.id}>
                            <td className="py-2 pr-3 font-medium text-slate-900">
                              {prod?.productName ?? mat?.materialName ?? 'Removed Product'}
                            </td>
                            <td className="py-2 px-3 text-slate-600">
                              {l.direction === 'in' ? 'Stock In (+)' : 'Stock Out (-)'}
                            </td>
                            <td className="py-2 pl-3 text-right font-mono tabular-nums font-semibold">
                              {l.quantity.toLocaleString('en-US')} {unit}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {docs.length > 0 && (
                  <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
                    <span className="font-medium">Attached Bills:</span>
                    {docs.map((d) => (
                      <span key={d.id} className="inline-flex items-center gap-1 text-slate-800">
                        <FileText className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                        {d.fileName} ({d.documentType})
                      </span>
                    ))}
                  </div>
                )}

                {!validation.allowed && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-md flex items-start gap-2 text-xs text-amber-900">
                    <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
                    <span>{validation.reason}</span>
                  </div>
                )}

                {/* Decision Bar */}
                <div className="pt-2 flex flex-col sm:flex-row sm:items-center gap-3">
                  <input
                    type="text"
                    aria-label={`Approval or rejection remarks for ${tx.transactionNumber}`}
                    value={remarksMap[tx.id] ?? ''}
                    onChange={(e) =>
                      setRemarksMap((prev) => ({ ...prev, [tx.id]: e.target.value }))
                    }
                    placeholder="Approval note or mandatory rejection reason..."
                    className="flex-1 px-3 py-2 text-xs border border-slate-300 rounded-md"
                  />
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={busyId === tx.id}
                      onClick={() => handleReject(tx.id)}
                      className="px-3.5 py-2 text-xs font-semibold text-red-700 bg-white border border-red-300 hover:bg-red-50 rounded-lg flex items-center gap-1.5 cursor-pointer"
                    >
                      <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Reject</span>
                    </button>
                    <button
                      type="button"
                      disabled={busyId === tx.id || !validation.allowed}
                      onClick={() => handleApprove(tx.id)}
                      className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-45 rounded-lg flex items-center gap-1.5 cursor-pointer"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Approve &amp; Post Stock</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Approval History */}
      <section aria-label="Approval Decision History" className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200">
          <h2 className="font-display text-sm font-semibold text-slate-900">
            Recent Manager Decisions
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
              <tr>
                <th className="py-2.5 px-4">Transaction</th>
                <th className="py-2.5 px-4">Manager</th>
                <th className="py-2.5 px-4">Decision</th>
                <th className="py-2.5 px-4">Remarks</th>
                <th className="py-2.5 px-4">Decided At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {recentDecisions.map((a) => {
                const tx = state.transactions.find((t) => t.id === a.transactionId);
                const mgr = state.profiles.find((p) => p.id === a.approvedBy);
                return (
                  <tr key={a.id}>
                    <td className="py-2.5 px-4 font-mono font-semibold text-slate-900">
                      {tx?.transactionNumber ?? a.transactionId}
                    </td>
                    <td className="py-2.5 px-4 text-slate-800">{mgr?.fullName}</td>
                    <td className="py-2.5 px-4">
                      <StatusLabel status={a.decision} />
                    </td>
                    <td className="py-2.5 px-4 text-slate-600">{a.remarks}</td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-slate-500">
                      {a.decidedAt.slice(0, 16).replace('T', ' ')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
