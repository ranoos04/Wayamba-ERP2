import { useState } from 'react';
import { AlertTriangle, ArrowRight, Check, Plus, X } from 'lucide-react';
import type { ErpState, Factory, Profile, Transfer } from '../domain/types.ts';
import { getAvailableStock } from '../domain/stockEngine.ts';
import {
  createInterFactoryTransfer,
  receiveInterFactoryTransfer,
} from '../api/erpClient.ts';
import { StatusLabel } from './StatusLabel.tsx';

interface TransfersViewProps {
  state: ErpState;
  currentUser: Profile;
  accessibleFactories: Factory[];
  selectedFactoryId: string;
  onStateUpdated: (next: ErpState) => void;
}

export function TransfersView({
  state,
  currentUser,
  accessibleFactories,
  selectedFactoryId,
  onStateUpdated,
}: TransfersViewProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [receivingTransfer, setReceivingTransfer] = useState<Transfer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const defaultFrom =
    selectedFactoryId !== 'ALL'
      ? selectedFactoryId
      : accessibleFactories[0]?.id ?? 'fac-02';
  const defaultTo =
    state.factories.find((f) => f.id !== defaultFrom)?.id ?? 'fac-01';

  const [fromFactory, setFromFactory] = useState(defaultFrom);
  const [toFactory, setToFactory] = useState(defaultTo);
  const [materialId, setMaterialId] = useState(state.rawMaterials[1]?.id ?? state.rawMaterials[0]?.id ?? '');
  const [sentQuantity, setSentQuantity] = useState('1000');
  const [remarks, setRemarks] = useState('');

  // Receive form
  const [actualQuantity, setActualQuantity] = useState('');
  const [receiveRemarks, setReceiveRemarks] = useState('');

  const availableAtSource = getAvailableStock(
    state.balances,
    fromFactory,
    'material',
    materialId
  );

  async function handleCreateTransfer(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const qty = Number(sentQuantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError('Quantity must be greater than zero.');
      return;
    }
    if (fromFactory === toFactory) {
      setError('Source and destination factories must be different.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await createInterFactoryTransfer({
        userId: currentUser.id,
        fromFactory,
        toFactory,
        materialId,
        sentQuantity: qty,
        remarks,
      });
      onStateUpdated(res.state);
      setShowCreate(false);
      setRemarks('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create transfer');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirmReceipt(e: React.FormEvent) {
    e.preventDefault();
    if (!receivingTransfer) return;
    setError(null);
    const actual = Number(actualQuantity);
    if (!Number.isFinite(actual) || actual <= 0) {
      setError('Actual received quantity must be greater than zero.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await receiveInterFactoryTransfer(receivingTransfer.id, {
        userId: currentUser.id,
        actualQuantity: actual,
        remarks: receiveRemarks,
      });
      onStateUpdated(res.state);
      setReceivingTransfer(null);
      setReceiveRemarks('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to confirm receipt');
    } finally {
      setSubmitting(false);
    }
  }

  const scopedTransfers = state.transfers.filter(
    (tr) =>
      selectedFactoryId === 'ALL' ||
      tr.fromFactory === selectedFactoryId ||
      tr.toFactory === selectedFactoryId
  );

  const liveDiff = receivingTransfer
    ? receivingTransfer.sentQuantity - (Number(actualQuantity) || 0)
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-900">
            Inter-Factory Transfers
          </h1>
          <p className="text-sm text-slate-500">
            Track material movement between factories with actual received confirmation and discrepancy logging.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setError(null);
            setShowCreate(true);
          }}
          className="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold rounded-lg flex items-center gap-2 whitespace-nowrap self-start sm:self-auto cursor-pointer"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          <span>Create Transfer</span>
        </button>
      </div>

      {/* Transfers Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500">
              <tr>
                <th className="py-3 px-4">Transfer No</th>
                <th className="py-3 px-4">Route</th>
                <th className="py-3 px-4">Raw Material</th>
                <th className="py-3 px-4 text-right">Sent Qty</th>
                <th className="py-3 px-4 text-right">Actual Received</th>
                <th className="py-3 px-4 text-right">Discrepancy</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {scopedTransfers.map((tr) => {
                const fromF = state.factories.find((f) => f.id === tr.fromFactory);
                const toF = state.factories.find((f) => f.id === tr.toFactory);
                const mat = state.rawMaterials.find((m) => m.id === tr.materialId);
                const receipt = state.transferReceipts.find((r) => r.transferId === tr.id);
                const inTx = tr.transferInTransactionId
                  ? state.transactions.find((t) => t.id === tr.transferInTransactionId)
                  : null;

                const canConfirmReceive =
                  tr.transferStatus === 'in_transit' && !tr.transferInTransactionId;

                return (
                  <tr key={tr.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4 font-mono text-xs font-semibold text-slate-900 whitespace-nowrap">
                      {tr.transferNumber}
                    </td>
                    <td className="py-3 px-4 text-xs font-medium text-slate-900 whitespace-nowrap">
                      <span>{fromF?.factoryCode}</span>
                      <ArrowRight className="w-3.5 h-3.5 inline mx-1.5 text-slate-400" aria-hidden="true" />
                      <span>{toF?.factoryCode}</span>
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-800">{mat?.materialName}</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-xs font-semibold text-slate-900">
                      {tr.sentQuantity.toLocaleString('en-US')} kg
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-xs text-slate-800">
                      {receipt ? `${receipt.actualQuantity.toLocaleString('en-US')} kg` : '—'}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-xs">
                      {receipt ? (
                        receipt.discrepancyQuantity !== 0 ? (
                          <span className="font-semibold text-red-700">
                            {receipt.discrepancyQuantity > 0 ? `-${receipt.discrepancyQuantity}` : `+${Math.abs(receipt.discrepancyQuantity)}`} kg
                          </span>
                        ) : (
                          <span className="text-emerald-700">0 kg</span>
                        )
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <StatusLabel status={tr.transferStatus} />
                      {inTx && inTx.status === 'submitted' && (
                        <div className="text-[11px] text-amber-700 mt-0.5">
                          Receipt pending manager approval
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      {canConfirmReceive ? (
                        <button
                          type="button"
                          onClick={() => {
                            setError(null);
                            setReceivingTransfer(tr);
                            setActualQuantity(String(tr.sentQuantity));
                          }}
                          className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-700 hover:bg-blue-800 text-white text-xs font-semibold rounded-md cursor-pointer"
                        >
                          <Check className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Confirm Receipt</span>
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {scopedTransfers.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-sm text-slate-500">
                    No inter-factory transfers recorded.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Transfer Modal */}
      {showCreate && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-transfer-title"
        >
          <form
            onSubmit={handleCreateTransfer}
            className="bg-white border border-slate-200 rounded-xl w-full max-w-lg overflow-hidden shadow-xl"
          >
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 id="create-transfer-title" className="font-display text-lg font-bold text-slate-900">
                Create Inter-Factory Transfer
              </h2>
              <button
                type="button"
                aria-label="Close modal"
                onClick={() => setShowCreate(false)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {error && (
                <div role="alert" className="p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg">
                  {error}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="tr-from" className="block text-xs font-medium text-slate-700 mb-1">
                    From Factory
                  </label>
                  <select
                    id="tr-from"
                    value={fromFactory}
                    onChange={(e) => setFromFactory(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                  >
                    {accessibleFactories.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.factoryCode} — {f.factoryName}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="tr-to" className="block text-xs font-medium text-slate-700 mb-1">
                    To Factory
                  </label>
                  <select
                    id="tr-to"
                    value={toFactory}
                    onChange={(e) => setToFactory(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                  >
                    {state.factories.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.factoryCode} — {f.factoryName}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="tr-mat" className="block text-xs font-medium text-slate-700 mb-1">
                  Raw Material (Available at source: {availableAtSource.toLocaleString('en-US')} kg)
                </label>
                <select
                  id="tr-mat"
                  value={materialId}
                  onChange={(e) => setMaterialId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                >
                  {state.rawMaterials.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.materialCode} — {m.materialName}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="tr-qty" className="block text-xs font-medium text-slate-700 mb-1">
                  Sent Quantity (KG)
                </label>
                <input
                  id="tr-qty"
                  type="number"
                  min="0.01"
                  step="any"
                  value={sentQuantity}
                  onChange={(e) => setSentQuantity(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-md"
                />
              </div>

              <div>
                <label htmlFor="tr-remarks" className="block text-xs font-medium text-slate-700 mb-1">
                  Transfer Notes
                </label>
                <input
                  id="tr-remarks"
                  type="text"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Lorry dispatch or pallet batch details"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>
            </div>

            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 text-sm font-medium text-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer"
              >
                {submitting ? 'Submitting...' : 'Submit Transfer Dispatch'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Receive Transfer Modal (Actual Quantity + Discrepancy Check) */}
      {receivingTransfer && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="receive-transfer-title"
        >
          <form
            onSubmit={handleConfirmReceipt}
            className="bg-white border border-slate-200 rounded-xl w-full max-w-md overflow-hidden shadow-xl"
          >
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 id="receive-transfer-title" className="font-display text-lg font-bold text-slate-900">
                  Receive Transfer {receivingTransfer.transferNumber}
                </h2>
                <p className="text-xs text-slate-500">
                  Enter the actual weighed quantity received. Discrepancies are flagged for investigation.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close modal"
                onClick={() => setReceivingTransfer(null)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {error && (
                <div role="alert" className="p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg">
                  {error}
                </div>
              )}

              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 flex items-center justify-between text-xs">
                <span className="text-slate-600">Dispatched Quantity:</span>
                <span className="font-mono tabular-nums font-bold text-slate-900">
                  {receivingTransfer.sentQuantity.toLocaleString('en-US')} kg
                </span>
              </div>

              <div>
                <label htmlFor="recv-actual" className="block text-xs font-medium text-slate-700 mb-1">
                  Actual Received Quantity (KG)
                </label>
                <input
                  id="recv-actual"
                  type="number"
                  min="0.01"
                  step="any"
                  required
                  value={actualQuantity}
                  onChange={(e) => setActualQuantity(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-md"
                />
              </div>

              {Math.abs(liveDiff) > 0.001 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2 text-xs text-amber-900">
                  <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
                  <div>
                    <div className="font-semibold">
                      Discrepancy Detected: {liveDiff > 0 ? `${liveDiff} kg short` : `${Math.abs(liveDiff)} kg excess`}
                    </div>
                    <div className="mt-0.5 text-amber-800">
                      Only {actualQuantity || 0} kg will be queued for Factory receipt approval; the {Math.abs(liveDiff)} kg variance will be logged.
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label htmlFor="recv-remarks" className="block text-xs font-medium text-slate-700 mb-1">
                  Receiving / Weighbridge Remarks
                </label>
                <input
                  id="recv-remarks"
                  type="text"
                  value={receiveRemarks}
                  onChange={(e) => setReceiveRemarks(e.target.value)}
                  placeholder="Weighbridge ticket or moisture note"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>
            </div>

            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setReceivingTransfer(null)}
                className="px-4 py-2 text-sm font-medium text-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer"
              >
                {submitting ? 'Confirming...' : 'Submit Receipt for Approval'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
