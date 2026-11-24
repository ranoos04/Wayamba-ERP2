import { useState } from 'react';
import { Plus, Truck, X } from 'lucide-react';
import type { ErpState, Factory, Profile } from '../domain/types.ts';
import { getAvailableStock } from '../domain/stockEngine.ts';
import { createCustomerDispatch } from '../api/erpClient.ts';
import { StatusLabel } from './StatusLabel.tsx';

interface DispatchViewProps {
  state: ErpState;
  currentUser: Profile;
  accessibleFactories: Factory[];
  selectedFactoryId: string;
  onStateUpdated: (next: ErpState) => void;
}

export function DispatchView({
  state,
  currentUser,
  accessibleFactories,
  selectedFactoryId,
  onStateUpdated,
}: DispatchViewProps) {
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const defaultFactory =
    selectedFactoryId !== 'ALL'
      ? selectedFactoryId
      : accessibleFactories[0]?.id ?? 'fac-01';

  const today = new Date().toISOString().slice(0, 10);

  const [factoryId, setFactoryId] = useState(defaultFactory);
  const [customerId, setCustomerId] = useState(state.customers[0]?.id ?? '');
  const [dispatchDate, setDispatchDate] = useState(today);
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [deliveryNote, setDeliveryNote] = useState('');
  const [productId, setProductId] = useState(state.products[0]?.id ?? '');
  const [quantity, setQuantity] = useState('500');
  const [remarks, setRemarks] = useState('');

  const activeProducts = state.products.filter((p) => p.isActive);
  const effectiveProductId = activeProducts.some((p) => p.id === productId)
    ? productId
    : activeProducts[0]?.id ?? '';

  const available = effectiveProductId
    ? getAvailableStock(state.balances, factoryId, 'product', effectiveProductId)
    : 0;
  const qtyNum = Number(quantity) || 0;
  const exceedsStock = qtyNum > available;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!effectiveProductId) {
      setError('Select an active product to dispatch.');
      return;
    }
    if (qtyNum <= 0) {
      setError('Dispatch quantity must be greater than zero.');
      return;
    }
    if (exceedsStock) {
      setError(`Cannot dispatch ${qtyNum} units: only ${available} units available on hand.`);
      return;
    }

    setSubmitting(true);
    try {
      const res = await createCustomerDispatch({
        userId: currentUser.id,
        factoryId,
        customerId,
        dispatchDate,
        vehicleNumber: vehicleNumber.trim(),
        deliveryNote: deliveryNote.trim(),
        productId: effectiveProductId,
        quantity: qtyNum,
        unitPrice: 0,
        remarks,
      });
      onStateUpdated(res.state);
      setShowModal(false);
      setRemarks('');
      setVehicleNumber('');
      setDeliveryNote('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create dispatch');
    } finally {
      setSubmitting(false);
    }
  }

  const scopedDispatches = state.dispatches.filter((d) => {
    const tx = state.transactions.find((t) => t.id === d.transactionId);
    if (!tx) return false;
    return selectedFactoryId === 'ALL' || tx.factoryId === selectedFactoryId;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-900">Customer Dispatch</h1>
          <p className="text-sm text-slate-500">
            Track outgoing stock dispatches and manager-approved finished goods deductions.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setError(null);
            setFactoryId(defaultFactory);
            setShowModal(true);
          }}
          className="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold rounded-lg flex items-center gap-2 whitespace-nowrap self-start sm:self-auto cursor-pointer"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          <span>New Customer Dispatch</span>
        </button>
      </div>

      {/* Dispatches Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500">
              <tr>
                <th className="py-3 px-4">Dispatch No</th>
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Customer</th>
                <th className="py-3 px-4">Vehicle / Ref</th>
                <th className="py-3 px-4">Product</th>
                <th className="py-3 px-4 text-right">Quantity</th>
                <th className="py-3 px-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {scopedDispatches.map((dsp) => {
                const tx = state.transactions.find((t) => t.id === dsp.transactionId)!;
                const cust = state.customers.find((c) => c.id === dsp.customerId);
                const lines = state.transactionLines.filter((l) => l.transactionId === tx.id);

                return (
                  <tr key={dsp.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4 font-mono text-xs font-semibold text-slate-900 whitespace-nowrap">
                      {tx.transactionNumber}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-600 whitespace-nowrap">
                      {dsp.dispatchDate}
                    </td>
                    <td className="py-3 px-4 text-xs font-medium text-slate-900">
                      {cust?.customerName ?? 'Customer'}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600 whitespace-nowrap">
                      <div>{dsp.vehicleNumber || '—'}</div>
                      {dsp.deliveryNote && (
                        <div className="font-mono text-[11px] text-slate-400">{dsp.deliveryNote}</div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-900">
                      {lines.map((l) => {
                        const p = state.products.find((pr) => pr.id === l.productId);
                        return <div key={l.id}>{p?.productName ?? 'Removed Product'}</div>;
                      })}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-xs font-semibold text-slate-900 whitespace-nowrap">
                      {lines.map((l) => {
                        const p = state.products.find((pr) => pr.id === l.productId);
                        return (
                          <div key={l.id}>
                            {l.quantity.toLocaleString('en-US')} {p?.unitCode ?? 'KG'}
                          </div>
                        );
                      })}
                    </td>
                    <td className="py-3 px-4">
                      <StatusLabel status={tx.status} />
                    </td>
                  </tr>
                );
              })}
              {scopedDispatches.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-sm text-slate-500">
                    No customer dispatches found for this factory.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Dispatch Modal (Stock Only) */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-dispatch-title"
        >
          <form
            onSubmit={handleSubmit}
            className="bg-white border border-slate-200 rounded-xl w-full max-w-xl overflow-hidden shadow-xl"
          >
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Truck className="w-5 h-5 text-blue-700" aria-hidden="true" />
                <h2 id="new-dispatch-title" className="font-display text-lg font-bold text-slate-900">
                  New Customer Dispatch (Stock Out)
                </h2>
              </div>
              <button
                type="button"
                aria-label="Close modal"
                onClick={() => setShowModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
              {error && (
                <div role="alert" className="p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg">
                  {error}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="dsp-factory" className="block text-xs font-medium text-slate-700 mb-1">
                    Dispatching Factory
                  </label>
                  <select
                    id="dsp-factory"
                    value={factoryId}
                    onChange={(e) => setFactoryId(e.target.value)}
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
                  <label htmlFor="dsp-date" className="block text-xs font-medium text-slate-700 mb-1">
                    Dispatch Date
                  </label>
                  <input
                    id="dsp-date"
                    type="date"
                    value={dispatchDate}
                    onChange={(e) => setDispatchDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="dsp-customer" className="block text-xs font-medium text-slate-700 mb-1">
                  Customer / Recipient
                </label>
                <select
                  id="dsp-customer"
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                >
                  {state.customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.customerCode} — {c.customerName}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="dsp-dn" className="block text-xs font-medium text-slate-700 mb-1">
                    Reference / Note (Optional)
                  </label>
                  <input
                    id="dsp-dn"
                    type="text"
                    value={deliveryNote}
                    onChange={(e) => setDeliveryNote(e.target.value)}
                    placeholder="Optional gate pass or ref"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                  />
                </div>
                <div>
                  <label htmlFor="dsp-vehicle" className="block text-xs font-medium text-slate-700 mb-1">
                    Vehicle No (Optional)
                  </label>
                  <input
                    id="dsp-vehicle"
                    type="text"
                    value={vehicleNumber}
                    onChange={(e) => setVehicleNumber(e.target.value)}
                    placeholder="e.g. WP LB-4418"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-200">
                <div>
                  <label htmlFor="dsp-product" className="block text-xs font-medium text-slate-700 mb-1">
                    Product (On hand: {available.toLocaleString('en-US')})
                  </label>
                  <select
                    id="dsp-product"
                    value={effectiveProductId}
                    onChange={(e) => setProductId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                  >
                    {activeProducts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.productName} ({p.unitCode})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="dsp-qty" className="block text-xs font-medium text-slate-700 mb-1">
                    Quantity
                  </label>
                  <input
                    id="dsp-qty"
                    type="number"
                    min="0.01"
                    step="any"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    className={`w-full px-3 py-2 text-sm font-mono tabular-nums border rounded-md ${
                      exceedsStock ? 'border-red-500 bg-red-50/40' : 'border-slate-300'
                    }`}
                  />
                  {exceedsStock && (
                    <p className="text-[11px] text-red-700 mt-0.5">
                      Exceeds available stock ({available})
                    </p>
                  )}
                </div>
              </div>

              <div>
                <label htmlFor="dsp-remarks" className="block text-xs font-medium text-slate-700 mb-1">
                  Remarks (Optional)
                </label>
                <input
                  id="dsp-remarks"
                  type="text"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Optional dispatch notes"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>
            </div>

            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-sm font-medium text-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || exceedsStock}
                className="px-4 py-2 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg cursor-pointer"
              >
                {submitting ? 'Submitting...' : 'Submit Dispatch for Approval'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
