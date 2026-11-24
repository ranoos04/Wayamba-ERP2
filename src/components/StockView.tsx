import { useState } from 'react';
import { ClipboardCheck, PackagePlus, X } from 'lucide-react';
import type { ErpState, Factory, Profile } from '../domain/types.ts';
import {
  getAvailableStock,
  getItemFlowBreakdown,
} from '../domain/stockEngine.ts';
import { createRawReceipt, recordPhysicalStockCount } from '../api/erpClient.ts';
import { StatusLabel } from './StatusLabel.tsx';

interface StockViewProps {
  state: ErpState;
  currentUser: Profile;
  accessibleFactories: Factory[];
  selectedFactoryId: string;
  onStateUpdated: (next: ErpState) => void;
}

type StockTab = 'finished' | 'raw' | 'ledger' | 'counts';

export function StockView({
  state,
  currentUser,
  accessibleFactories,
  selectedFactoryId,
  onStateUpdated,
}: StockViewProps) {
  const [activeTab, setActiveTab] = useState<StockTab>('finished');
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [showCountModal, setShowCountModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const activeFactoryId =
    selectedFactoryId !== 'ALL'
      ? selectedFactoryId
      : accessibleFactories[0]?.id ?? 'fac-01';

  const today = new Date().toISOString().slice(0, 10);

  // Material Receipt form state
  const [recFactoryId, setRecFactoryId] = useState(activeFactoryId);
  const [recSupplierId, setRecSupplierId] = useState(state.suppliers[0]?.id ?? '');
  const [recMaterialId, setRecMaterialId] = useState(state.rawMaterials[0]?.id ?? '');
  const [recQty, setRecQty] = useState('2500');
  const [recRef, setRecRef] = useState('');
  const [recDate, setRecDate] = useState(today);
  const [recRemarks, setRecRemarks] = useState('');

  // Physical Stock Count state
  const [countValues, setCountValues] = useState<Record<string, string>>({});
  const [countRemarks, setCountRemarks] = useState('');

  async function handleSubmitReceipt(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const qty = Number(recQty);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError('Receipt quantity must be greater than zero.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await createRawReceipt({
        userId: currentUser.id,
        factoryId: recFactoryId,
        supplierId: recSupplierId,
        materialId: recMaterialId,
        quantity: qty,
        unitCost: 0,
        receiptDate: recDate,
        referenceNumber: recRef || `GRN-${Date.now().toString().slice(-4)}`,
        remarks: recRemarks,
      });
      onStateUpdated(res.state);
      setShowReceiptModal(false);
      setRecRemarks('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit receipt');
    } finally {
      setSubmitting(false);
    }
  }

  function openCountModal() {
    const initial: Record<string, string> = {};
    for (const p of state.products) {
      initial[`p:${p.id}`] = String(
        getAvailableStock(state.balances, activeFactoryId, 'product', p.id)
      );
    }
    for (const m of state.rawMaterials) {
      initial[`m:${m.id}`] = String(
        getAvailableStock(state.balances, activeFactoryId, 'material', m.id)
      );
    }
    setCountValues(initial);
    setError(null);
    setShowCountModal(true);
  }

  async function handleSubmitStockCount(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const lines = [
        ...state.products.map((p) => ({
          productId: p.id,
          materialId: null,
          actualQuantity: Math.max(0, Number(countValues[`p:${p.id}`] ?? 0)),
        })),
        ...state.rawMaterials.map((m) => ({
          productId: null,
          materialId: m.id,
          actualQuantity: Math.max(0, Number(countValues[`m:${m.id}`] ?? 0)),
        })),
      ];
      const res = await recordPhysicalStockCount({
        userId: currentUser.id,
        factoryId: activeFactoryId,
        countDate: today,
        remarks: countRemarks || 'Physical stock count verification',
        lines,
      });
      onStateUpdated(res.state);
      setShowCountModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save stock count');
    } finally {
      setSubmitting(false);
    }
  }

  const factoryLabel =
    selectedFactoryId === 'ALL'
      ? accessibleFactories[0]?.factoryCode ?? 'F01'
      : state.factories.find((f) => f.id === selectedFactoryId)?.factoryCode ?? 'F01';

  const movementsScoped = state.movements
    .filter((m) => selectedFactoryId === 'ALL' || m.factoryId === selectedFactoryId)
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-900">
            Stock &amp; Raw Materials
          </h1>
          <p className="text-sm text-slate-500">
            Automatic closing stock engine: Opening + Production/Receipts − Dispatch/Consumption.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={openCountModal}
            className="px-3.5 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 text-sm font-medium rounded-lg flex items-center gap-2 whitespace-nowrap cursor-pointer"
          >
            <ClipboardCheck className="w-4 h-4" aria-hidden="true" />
            <span>Physical Stock Count</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setRecFactoryId(activeFactoryId);
              setError(null);
              setShowReceiptModal(true);
            }}
            className="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold rounded-lg flex items-center gap-2 whitespace-nowrap cursor-pointer"
          >
            <PackagePlus className="w-4 h-4" aria-hidden="true" />
            <span>Receive Material (GRN)</span>
          </button>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-lg w-fit">
        {(
          [
            { id: 'finished', label: 'Finished Goods Stock' },
            { id: 'raw', label: 'Raw Material Stock' },
            { id: 'ledger', label: 'Stock Movement Ledger' },
            { id: 'counts', label: 'Stocktaking History' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-3.5 py-2 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === tab.id
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab 1: Finished Goods Stock Bridge */}
      {activeTab === 'finished' && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between text-xs text-slate-500">
            <span>
              Formula: <strong className="text-slate-800">Closing = Opening + Production − Dispatch</strong>
            </span>
            <span>Factory scope: {selectedFactoryId === 'ALL' ? 'All Factories' : factoryLabel}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500">
                <tr>
                  <th className="py-3 px-4">Code</th>
                  <th className="py-3 px-4">Finished Product</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4 text-right">Opening</th>
                  <th className="py-3 px-4 text-right">+ Production</th>
                  <th className="py-3 px-4 text-right">− Dispatch</th>
                  <th className="py-3 px-4 text-right">Closing On Hand</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {state.products.map((prod) => {
                  const targetFactories =
                    selectedFactoryId === 'ALL'
                      ? accessibleFactories.map((f) => f.id)
                      : [selectedFactoryId];

                  let opening = 0;
                  let production = 0;
                  let dispatch = 0;
                  let onHand = 0;

                  for (const fid of targetFactories) {
                    const flow = getItemFlowBreakdown(state, fid, 'product', prod.id);
                    opening += flow.opening;
                    production += flow.production;
                    dispatch += flow.dispatch;
                    onHand += getAvailableStock(state.balances, fid, 'product', prod.id);
                  }

                  return (
                    <tr key={prod.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4 font-mono text-xs text-slate-600">{prod.productCode}</td>
                      <td className="py-3 px-4 font-medium text-slate-900">{prod.productName}</td>
                      <td className="py-3 px-4 text-xs text-slate-500">{prod.productCategory}</td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-xs text-slate-600">
                        {opening.toLocaleString('en-US')} {prod.unitCode}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-xs text-emerald-700">
                        +{production.toLocaleString('en-US')} {prod.unitCode}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-xs text-slate-700">
                        -{dispatch.toLocaleString('en-US')} {prod.unitCode}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-sm font-bold text-slate-900">
                        {onHand.toLocaleString('en-US')} {prod.unitCode}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: Raw Material Stock Bridge */}
      {activeTab === 'raw' && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between text-xs text-slate-500">
            <span>
              Formula: <strong className="text-slate-800">Closing = Opening + Receipts + Transfers In − Consumption − Transfers Out</strong>
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500">
                <tr>
                  <th className="py-3 px-4">Code</th>
                  <th className="py-3 px-4">Raw Material</th>
                  <th className="py-3 px-4 text-right">Opening</th>
                  <th className="py-3 px-4 text-right">+ Receipts / In</th>
                  <th className="py-3 px-4 text-right">− Consumed / Out</th>
                  <th className="py-3 px-4 text-right">Closing On Hand</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {state.rawMaterials.map((mat) => {
                  const targetFactories =
                    selectedFactoryId === 'ALL'
                      ? accessibleFactories.map((f) => f.id)
                      : [selectedFactoryId];

                  let opening = 0;
                  let inflows = 0;
                  let outflows = 0;
                  let onHand = 0;

                  for (const fid of targetFactories) {
                    const flow = getItemFlowBreakdown(state, fid, 'material', mat.id);
                    opening += flow.opening;
                    inflows += flow.supplierReceipts + flow.factoryReceipts;
                    outflows += flow.consumption + flow.transfersOut;
                    onHand += getAvailableStock(state.balances, fid, 'material', mat.id);
                  }

                  const lowStock = onHand > 0 && onHand < mat.reorderLevel;

                  return (
                    <tr key={mat.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4 font-mono text-xs text-slate-600">{mat.materialCode}</td>
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-900">{mat.materialName}</div>
                        {lowStock && (
                          <div className="text-[11px] font-medium text-amber-700">
                            Below reorder level ({mat.reorderLevel.toLocaleString('en-US')} kg)
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-xs text-slate-600">
                        {opening.toLocaleString('en-US')} kg
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-xs text-emerald-700">
                        +{inflows.toLocaleString('en-US')} kg
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-xs text-slate-700">
                        -{outflows.toLocaleString('en-US')} kg
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-sm font-bold text-slate-900">
                        {onHand.toLocaleString('en-US')} kg
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Immutable Stock Ledger */}
      {activeTab === 'ledger' && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500">
                <tr>
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Transaction</th>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4">Factory</th>
                  <th className="py-3 px-4">Item</th>
                  <th className="py-3 px-4 text-right">Quantity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {movementsScoped.map((mov) => {
                  const tx = state.transactions.find((t) => t.id === mov.transactionId);
                  const fac = state.factories.find((f) => f.id === mov.factoryId);
                  const prod = mov.productId
                    ? state.products.find((p) => p.id === mov.productId)
                    : null;
                  const mat = mov.materialId
                    ? state.rawMaterials.find((m) => m.id === mov.materialId)
                    : null;
                  const unit = prod?.unitCode ?? mat?.unitCode ?? 'KG';

                  return (
                    <tr key={mov.id} className="hover:bg-slate-50/70">
                      <td className="py-2.5 px-4 font-mono tabular-nums text-xs text-slate-600">
                        {mov.movementDate}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-xs font-medium text-slate-900">
                        {tx?.transactionNumber}
                      </td>
                      <td className="py-2.5 px-4 text-xs text-slate-600 capitalize">
                        {tx?.transactionType.replace('_', ' ')}
                      </td>
                      <td className="py-2.5 px-4 text-xs text-slate-600">{fac?.factoryCode}</td>
                      <td className="py-2.5 px-4 text-xs font-medium text-slate-900">
                        {prod?.productName ?? mat?.materialName ?? 'Removed Product'}
                      </td>
                      <td
                        className={`py-2.5 px-4 text-right font-mono tabular-nums text-xs font-semibold ${
                          mov.direction === 'in' ? 'text-emerald-700' : 'text-slate-800'
                        }`}
                      >
                        {mov.direction === 'in' ? '+' : '-'}
                        {mov.quantity.toLocaleString('en-US')} {unit}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 4: Stocktaking History */}
      {activeTab === 'counts' && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          {state.stockCounts.length === 0 ? (
            <div className="p-10 text-center space-y-3">
              <p className="text-sm text-slate-600">
                No physical stock counts have been recorded yet. Run a physical stock count to compare system vs warehouse balances and generate variance adjustments.
              </p>
              <button
                type="button"
                onClick={openCountModal}
                className="px-4 py-2 bg-blue-700 text-white text-sm font-medium rounded-lg cursor-pointer"
              >
                Start First Stock Count
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500">
                  <tr>
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4">Factory</th>
                    <th className="py-3 px-4">Counted By</th>
                    <th className="py-3 px-4">Variance Lines</th>
                    <th className="py-3 px-4">Remarks</th>
                    <th className="py-3 px-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {state.stockCounts.map((sc) => {
                    const fac = state.factories.find((f) => f.id === sc.factoryId);
                    const user = state.profiles.find((p) => p.id === sc.countedBy);
                    const variances = state.stockCountLines.filter(
                      (l) => l.stockCountId === sc.id && Math.abs(l.variance) > 0.001
                    );
                    return (
                      <tr key={sc.id}>
                        <td className="py-3 px-4 font-mono tabular-nums text-xs">{sc.countDate}</td>
                        <td className="py-3 px-4 text-xs font-medium">{fac?.factoryCode}</td>
                        <td className="py-3 px-4 text-xs">{user?.fullName}</td>
                        <td className="py-3 px-4 font-mono tabular-nums text-xs">
                          {variances.length} variance item(s)
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-600">{sc.remarks}</td>
                        <td className="py-3 px-4">
                          <StatusLabel status="approved" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Receive Material Modal */}
      {showReceiptModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="receive-mat-title"
        >
          <form
            onSubmit={handleSubmitReceipt}
            className="bg-white border border-slate-200 rounded-xl w-full max-w-lg overflow-hidden shadow-xl"
          >
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 id="receive-mat-title" className="font-display text-lg font-bold text-slate-900">
                Receive Raw Material (Supplier GRN)
              </h2>
              <button
                type="button"
                aria-label="Close modal"
                onClick={() => setShowReceiptModal(false)}
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
                  <label htmlFor="rec-factory" className="block text-xs font-medium text-slate-700 mb-1">
                    Receiving Factory
                  </label>
                  <select
                    id="rec-factory"
                    value={recFactoryId}
                    onChange={(e) => setRecFactoryId(e.target.value)}
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
                  <label htmlFor="rec-date" className="block text-xs font-medium text-slate-700 mb-1">
                    Receipt Date
                  </label>
                  <input
                    id="rec-date"
                    type="date"
                    value={recDate}
                    onChange={(e) => setRecDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="rec-supplier" className="block text-xs font-medium text-slate-700 mb-1">
                  Supplier
                </label>
                <select
                  id="rec-supplier"
                  value={recSupplierId}
                  onChange={(e) => setRecSupplierId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                >
                  {state.suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.supplierCode} — {s.supplierName}
                    </option>
                  ))}
                </select>
              </div>

                <div>
                  <label htmlFor="rec-material" className="block text-xs font-medium text-slate-700 mb-1">
                    Raw Material
                  </label>
                  <select
                    id="rec-material"
                    value={recMaterialId}
                    onChange={(e) => setRecMaterialId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                  >
                    {state.rawMaterials.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.materialCode} — {m.materialName}
                      </option>
                    ))}
                  </select>
                </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="rec-qty" className="block text-xs font-medium text-slate-700 mb-1">
                    Quantity (KG)
                  </label>
                  <input
                    id="rec-qty"
                    type="number"
                    min="0.01"
                    step="any"
                    required
                    value={recQty}
                    onChange={(e) => setRecQty(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label htmlFor="rec-ref" className="block text-xs font-medium text-slate-700 mb-1">
                    Reference No (Optional)
                  </label>
                  <input
                    id="rec-ref"
                    type="text"
                    value={recRef}
                    onChange={(e) => setRecRef(e.target.value)}
                    placeholder="GRN or batch note"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="rec-remarks" className="block text-xs font-medium text-slate-700 mb-1">
                  Remarks (Optional)
                </label>
                <input
                  id="rec-remarks"
                  type="text"
                  value={recRemarks}
                  onChange={(e) => setRecRemarks(e.target.value)}
                  placeholder="Optional delivery or quality note"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>
            </div>

            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowReceiptModal(false)}
                className="px-4 py-2 text-sm font-medium text-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer"
              >
                {submitting ? 'Submitting...' : 'Submit for Approval'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Physical Stock Count Modal */}
      {showCountModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="stock-count-title"
        >
          <form
            onSubmit={handleSubmitStockCount}
            className="bg-white border border-slate-200 rounded-xl w-full max-w-2xl overflow-hidden shadow-xl"
          >
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 id="stock-count-title" className="font-display text-lg font-bold text-slate-900">
                  Physical Stock Count — {factoryLabel}
                </h2>
                <p className="text-xs text-slate-500">
                  Any variance between system and physical quantities creates an adjustment transaction for Manager approval.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close modal"
                onClick={() => setShowCountModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 max-h-[65vh] overflow-y-auto space-y-4">
              {error && (
                <div role="alert" className="p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg">
                  {error}
                </div>
              )}

              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500">
                  <tr>
                    <th className="py-2 px-3">Item</th>
                    <th className="py-2 px-3 text-right">System Qty</th>
                    <th className="py-2 px-3 text-right">Actual Count</th>
                    <th className="py-2 px-3 text-right">Variance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {state.products.map((p) => {
                    const sys = getAvailableStock(state.balances, activeFactoryId, 'product', p.id);
                    const actual = Number(countValues[`p:${p.id}`] ?? sys);
                    const variance = actual - sys;
                    return (
                      <tr key={p.id}>
                        <td className="py-2 px-3 text-xs font-medium text-slate-900">
                          {p.productName} ({p.unitCode})
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums text-xs text-slate-600">
                          {sys}
                        </td>
                        <td className="py-2 px-3 text-right">
                          <input
                            aria-label={`Actual count for ${p.productName}`}
                            type="number"
                            min="0"
                            step="any"
                            value={countValues[`p:${p.id}`] ?? ''}
                            onChange={(e) =>
                              setCountValues((prev) => ({ ...prev, [`p:${p.id}`]: e.target.value }))
                            }
                            className="w-24 px-2 py-1 text-right font-mono tabular-nums text-xs border border-slate-300 rounded"
                          />
                        </td>
                        <td
                          className={`py-2 px-3 text-right font-mono tabular-nums text-xs font-semibold ${
                            variance === 0
                              ? 'text-slate-400'
                              : variance > 0
                              ? 'text-emerald-700'
                              : 'text-red-700'
                          }`}
                        >
                          {variance > 0 ? `+${variance}` : variance}
                        </td>
                      </tr>
                    );
                  })}
                  {state.rawMaterials.map((m) => {
                    const sys = getAvailableStock(state.balances, activeFactoryId, 'material', m.id);
                    const actual = Number(countValues[`m:${m.id}`] ?? sys);
                    const variance = actual - sys;
                    return (
                      <tr key={m.id}>
                        <td className="py-2 px-3 text-xs font-medium text-slate-900">
                          {m.materialName} (KG)
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums text-xs text-slate-600">
                          {sys}
                        </td>
                        <td className="py-2 px-3 text-right">
                          <input
                            aria-label={`Actual count for ${m.materialName}`}
                            type="number"
                            min="0"
                            step="any"
                            value={countValues[`m:${m.id}`] ?? ''}
                            onChange={(e) =>
                              setCountValues((prev) => ({ ...prev, [`m:${m.id}`]: e.target.value }))
                            }
                            className="w-24 px-2 py-1 text-right font-mono tabular-nums text-xs border border-slate-300 rounded"
                          />
                        </td>
                        <td
                          className={`py-2 px-3 text-right font-mono tabular-nums text-xs font-semibold ${
                            variance === 0
                              ? 'text-slate-400'
                              : variance > 0
                              ? 'text-emerald-700'
                              : 'text-red-700'
                          }`}
                        >
                          {variance > 0 ? `+${variance}` : variance}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div>
                <label htmlFor="count-remarks" className="block text-xs font-medium text-slate-700 mb-1">
                  Count Remarks
                </label>
                <input
                  id="count-remarks"
                  type="text"
                  value={countRemarks}
                  onChange={(e) => setCountRemarks(e.target.value)}
                  placeholder="Month-end physical stock verification"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>
            </div>

            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowCountModal(false)}
                className="px-4 py-2 text-sm font-medium text-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer"
              >
                {submitting ? 'Recording...' : 'Record Stock Count'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
