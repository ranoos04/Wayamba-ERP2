import { useEffect, useMemo, useState } from 'react';
import { Plus, Search, Send, Trash2, X } from 'lucide-react';
import type { ErpState, Factory, Profile } from '../domain/types.ts';
import { getAvailableStock } from '../domain/stockEngine.ts';
import { createProductionOrder, submitDraftTransaction } from '../api/erpClient.ts';
import { StatusLabel } from './StatusLabel.tsx';

interface ProductionViewProps {
  state: ErpState;
  currentUser: Profile;
  accessibleFactories: Factory[];
  selectedFactoryId: string;
  openCreateInitially?: boolean;
  onConsumeOpenCreate?: () => void;
  onStateUpdated: (next: ErpState) => void;
}

export function ProductionView({
  state,
  currentUser,
  accessibleFactories,
  selectedFactoryId,
  openCreateInitially = false,
  onConsumeOpenCreate,
  onStateUpdated,
}: ProductionViewProps) {
  const [search, setSearch] = useState('');
  const [shiftFilter, setShiftFilter] = useState<'ALL' | 'Day' | 'Night'>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [showModal, setShowModal] = useState(openCreateInitially);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const defaultFactory =
    selectedFactoryId !== 'ALL'
      ? selectedFactoryId
      : accessibleFactories[0]?.id ?? 'fac-01';

  const today = new Date().toISOString().slice(0, 10);

  // Form state (Workflow A)
  const [formFactoryId, setFormFactoryId] = useState(defaultFactory);
  const [formDate, setFormDate] = useState(today);
  const [formShiftId, setFormShiftId] = useState('shift-day');
  const [formMachineId, setFormMachineId] = useState('');
  const [selectedOperators, setSelectedOperators] = useState<string[]>(['u-op-1']);
  const [outputProductId, setOutputProductId] = useState(state.products[0]?.id ?? '');
  const [outputQty, setOutputQty] = useState('1500');
  const [consumptions, setConsumptions] = useState<Array<{ materialId: string; quantity: string }>>([
    { materialId: state.rawMaterials[0]?.id ?? 'mat-virgin', quantity: '1520' },
  ]);
  const [remarks, setRemarks] = useState('');

  useEffect(() => {
    if (openCreateInitially) {
      setShowModal(true);
      onConsumeOpenCreate?.();
    }
  }, [openCreateInitially, onConsumeOpenCreate]);

  const factoryMachines = useMemo(
    () => state.machines.filter((m) => m.factoryId === formFactoryId && m.isActive),
    [state.machines, formFactoryId]
  );

  const effectiveMachineId =
    factoryMachines.some((m) => m.id === formMachineId)
      ? formMachineId
      : factoryMachines[0]?.id ?? '';

  const operatorProfiles = useMemo(() => {
    const opUserIds = new Set(
      state.memberships
        .filter((m) => m.role === 'operator' || m.role === 'production_supervisor')
        .map((m) => m.userId)
    );
    return state.profiles.filter((p) => p.isActive && opUserIds.has(p.id));
  }, [state.profiles, state.memberships]);

  const activeProducts = useMemo(() => state.products.filter((p) => p.isActive), [state.products]);
  const effectiveProductId = activeProducts.some((p) => p.id === outputProductId)
    ? outputProductId
    : activeProducts[0]?.id ?? '';

  function handleProductOrDateChange(nextProductId: string, nextDate: string, nextFactory: string) {
    setOutputProductId(nextProductId);
    setFormDate(nextDate);
    setFormFactoryId(nextFactory);
  }

  function toggleOperator(opId: string) {
    setSelectedOperators((prev) =>
      prev.includes(opId) ? prev.filter((id) => id !== opId) : [...prev, opId]
    );
  }

  async function handleSaveProduction(submitNow: boolean) {
    setError(null);
    const qtyNum = Number(outputQty);
    if (!effectiveMachineId) {
      setError('Select an active machine for this factory.');
      return;
    }
    if (!effectiveProductId) {
      setError('Select an active finished product.');
      return;
    }
    if (selectedOperators.length === 0) {
      setError('Assign at least one operator.');
      return;
    }
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      setError('Production output quantity must be greater than zero.');
      return;
    }

    const parsedConsumptions = consumptions
      .map((c) => ({ materialId: c.materialId, quantity: Number(c.quantity) }))
      .filter((c) => Number.isFinite(c.quantity) && c.quantity > 0);

    setSubmitting(true);
    try {
      const res = await createProductionOrder({
        userId: currentUser.id,
        factoryId: formFactoryId,
        productionDate: formDate,
        shiftId: formShiftId,
        machineId: effectiveMachineId,
        operatorIds: selectedOperators,
        outputs: [{ productId: effectiveProductId, quantity: qtyNum, sellingPrice: 0 }],
        consumptions: parsedConsumptions,
        remarks,
        submitNow,
      });
      onStateUpdated(res.state);
      setShowModal(false);
      setRemarks('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save production order');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmitDraft(txId: string) {
    try {
      const res = await submitDraftTransaction(txId, currentUser.id);
      onStateUpdated(res.state);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit draft');
    }
  }

  const filteredOrders = state.productionOrders.filter((po) => {
    const tx = state.transactions.find((t) => t.id === po.transactionId);
    if (!tx) return false;
    if (selectedFactoryId !== 'ALL' && tx.factoryId !== selectedFactoryId) return false;
    const shift = state.shifts.find((s) => s.id === po.shiftId);
    if (shiftFilter !== 'ALL' && shift?.shiftName !== shiftFilter) return false;
    if (statusFilter !== 'ALL' && tx.status !== statusFilter) return false;

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const machine = state.machines.find((m) => m.id === po.machineId);
      const lines = state.productionLines.filter((pl) => pl.productionId === po.id);
      const prodNames = lines
        .map((l) => state.products.find((p) => p.id === l.productId)?.productName ?? '')
        .join(' ');
      const matches =
        tx.transactionNumber.toLowerCase().includes(q) ||
        (machine?.machineName.toLowerCase().includes(q) ?? false) ||
        prodNames.toLowerCase().includes(q);
      if (!matches) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Section Header & Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-900">Production Records</h1>
          <p className="text-sm text-slate-500">
            Day &amp; Night shift output, machine &amp; operator assignment, and raw material consumption.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setFormFactoryId(defaultFactory);
            setShowModal(true);
          }}
          className="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap self-start sm:self-auto cursor-pointer"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          <span>Add Production Order</span>
        </button>
      </div>

      {/* Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search
            className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
            aria-hidden="true"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search order no, product, or machine..."
            aria-label="Search production records"
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
          {(['ALL', 'Day', 'Night'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setShiftFilter(s)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                shiftFilter === s
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {s === 'ALL' ? 'All Shifts' : `${s} Shift`}
            </button>
          ))}
        </div>

        <select
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="text-sm border border-slate-300 rounded-md px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
        >
          <option value="ALL">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="submitted">Pending Approval</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      {/* Production Orders Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500">
              <tr>
                <th className="py-3 px-4">Order No</th>
                <th className="py-3 px-4">Date &amp; Shift</th>
                <th className="py-3 px-4">Factory &amp; Machine</th>
                <th className="py-3 px-4">Operators</th>
                <th className="py-3 px-4">Output Product</th>
                <th className="py-3 px-4 text-right">Quantity</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredOrders.map((po) => {
                const tx = state.transactions.find((t) => t.id === po.transactionId)!;
                const fac = state.factories.find((f) => f.id === tx.factoryId);
                const mac = state.machines.find((m) => m.id === po.machineId);
                const shift = state.shifts.find((s) => s.id === po.shiftId);
                const lines = state.productionLines.filter((pl) => pl.productionId === po.id);
                const ops = state.productionOperators
                  .filter((o) => o.productionId === po.id)
                  .map((o) => state.profiles.find((p) => p.id === o.operatorId)?.fullName ?? '')
                  .filter(Boolean);

                return (
                  <tr key={po.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4 font-mono text-xs font-semibold text-slate-900 whitespace-nowrap">
                      {tx.transactionNumber}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="font-mono tabular-nums text-xs text-slate-900">
                        {po.productionDate}
                      </div>
                      <div className="text-xs text-slate-500">{shift?.shiftName} Shift</div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="text-xs font-medium text-slate-900">
                        {fac?.factoryCode} · {mac?.machineCode}
                      </div>
                      <div className="text-xs text-slate-500 truncate max-w-[180px]">
                        {mac?.machineName}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-700 max-w-[160px]">
                      {ops.join(', ') || '—'}
                    </td>
                    <td className="py-3 px-4">
                      {lines.map((l) => {
                        const prod = state.products.find((p) => p.id === l.productId);
                        return (
                          <div key={l.id} className="text-xs font-medium text-slate-900">
                            {prod?.productName ?? 'Removed Product'}
                          </div>
                        );
                      })}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-xs font-semibold text-slate-900 whitespace-nowrap">
                      {lines.map((l) => {
                        const prod = state.products.find((p) => p.id === l.productId);
                        return (
                          <div key={l.id}>
                            {l.quantity.toLocaleString('en-US')} {prod?.unitCode ?? 'KG'}
                          </div>
                        );
                      })}
                    </td>
                    <td className="py-3 px-4">
                      <StatusLabel status={tx.status} />
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      {tx.status === 'draft' ? (
                        <button
                          type="button"
                          onClick={() => handleSubmitDraft(tx.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 border border-blue-200 rounded cursor-pointer"
                        >
                          <Send className="w-3 h-3" aria-hidden="true" />
                          Submit
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filteredOrders.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-sm text-slate-500">
                    No production orders match your current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Production Order Modal (Workflow A) */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-production-title"
        >
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-2xl my-8 overflow-hidden shadow-xl">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 id="new-production-title" className="font-display text-lg font-bold text-slate-900">
                  Add Daily Production Order
                </h2>
                <p className="text-xs text-slate-500">
                  Finished stock updates automatically upon manager approval.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close modal"
                onClick={() => setShowModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-md cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
              {error && (
                <div
                  role="alert"
                  className="p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg"
                >
                  {error}
                </div>
              )}

              {/* Step 1: Factory, Date, Shift */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="prod-factory" className="block text-xs font-medium text-slate-700 mb-1">
                    Factory
                  </label>
                  <select
                    id="prod-factory"
                    value={formFactoryId}
                    onChange={(e) =>
                      handleProductOrDateChange(outputProductId, formDate, e.target.value)
                    }
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
                  <label htmlFor="prod-date" className="block text-xs font-medium text-slate-700 mb-1">
                    Production Date
                  </label>
                  <input
                    id="prod-date"
                    type="date"
                    value={formDate}
                    onChange={(e) =>
                      handleProductOrDateChange(outputProductId, e.target.value, formFactoryId)
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                  />
                </div>

                <div>
                  <label htmlFor="prod-shift" className="block text-xs font-medium text-slate-700 mb-1">
                    Shift
                  </label>
                  <select
                    id="prod-shift"
                    value={formShiftId}
                    onChange={(e) => setFormShiftId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                  >
                    {state.shifts.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.shiftName} ({s.startTime}–{s.endTime})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Step 2: Machine (factory-scoped) & Operators */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="prod-machine" className="block text-xs font-medium text-slate-700 mb-1">
                    Machine (Factory Scoped)
                  </label>
                  <select
                    id="prod-machine"
                    value={effectiveMachineId}
                    onChange={(e) => setFormMachineId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                  >
                    {factoryMachines.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.machineCode} — {m.machineName}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <span className="block text-xs font-medium text-slate-700 mb-1">
                    Assign Operators ({selectedOperators.length} selected)
                  </span>
                  <div className="border border-slate-300 rounded-md p-2 max-h-28 overflow-y-auto space-y-1">
                    {operatorProfiles.map((op) => (
                      <label
                        key={op.id}
                        className="flex items-center gap-2 text-xs text-slate-800 cursor-pointer py-0.5"
                      >
                        <input
                          type="checkbox"
                          checked={selectedOperators.includes(op.id)}
                          onChange={() => toggleOperator(op.id)}
                          className="rounded border-slate-300 text-blue-700"
                        />
                        <span>{op.fullName}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              {/* Step 3: Output Product & Quantity */}
              <div className="pt-4 border-t border-slate-200 space-y-3">
                <h3 className="text-sm font-semibold text-slate-900">Finished Product Output</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="prod-output-product" className="block text-xs font-medium text-slate-700 mb-1">
                      Product
                    </label>
                    <select
                      id="prod-output-product"
                      value={effectiveProductId}
                      onChange={(e) =>
                        handleProductOrDateChange(e.target.value, formDate, formFactoryId)
                      }
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
                    <label htmlFor="prod-output-qty" className="block text-xs font-medium text-slate-700 mb-1">
                      Produced Quantity
                    </label>
                    <input
                      id="prod-output-qty"
                      type="number"
                      min="0.001"
                      step="any"
                      value={outputQty}
                      onChange={(e) => setOutputQty(e.target.value)}
                      className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-md"
                    />
                  </div>
                </div>
              </div>

              {/* Step 4: Raw Material Consumption */}
              <div className="pt-4 border-t border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Raw Material Consumption
                  </h3>
                  <button
                    type="button"
                    onClick={() =>
                      setConsumptions((prev) => [
                        ...prev,
                        { materialId: state.rawMaterials[0]?.id ?? 'mat-virgin', quantity: '0' },
                      ])
                    }
                    className="text-xs font-medium text-blue-700 hover:text-blue-800 cursor-pointer"
                  >
                    + Add Material Line
                  </button>
                </div>

                {consumptions.map((line, idx) => {
                  const avail = getAvailableStock(
                    state.balances,
                    formFactoryId,
                    'material',
                    line.materialId
                  );
                  return (
                    <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-7">
                        <label className="block text-[11px] text-slate-500 mb-1">
                          Material (On hand: {avail.toLocaleString('en-US')} kg)
                        </label>
                        <select
                          aria-label={`Consumed material ${idx + 1}`}
                          value={line.materialId}
                          onChange={(e) =>
                            setConsumptions((prev) =>
                              prev.map((row, i) =>
                                i === idx ? { ...row, materialId: e.target.value } : row
                              )
                            )
                          }
                          className="w-full px-2.5 py-2 text-sm border border-slate-300 rounded-md"
                        >
                          {state.rawMaterials.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.materialCode} — {m.materialName}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="col-span-4">
                        <label className="block text-[11px] text-slate-500 mb-1">Qty (KG)</label>
                        <input
                          aria-label={`Consumed quantity ${idx + 1}`}
                          type="number"
                          min="0"
                          step="any"
                          value={line.quantity}
                          onChange={(e) =>
                            setConsumptions((prev) =>
                              prev.map((row, i) =>
                                i === idx ? { ...row, quantity: e.target.value } : row
                              )
                            )
                          }
                          className="w-full px-2.5 py-2 text-sm font-mono tabular-nums border border-slate-300 rounded-md"
                        />
                      </div>
                      <div className="col-span-1 flex justify-end pb-1">
                        {consumptions.length > 1 && (
                          <button
                            type="button"
                            aria-label={`Remove material line ${idx + 1}`}
                            onClick={() =>
                              setConsumptions((prev) => prev.filter((_, i) => i !== idx))
                            }
                            className="p-1.5 text-slate-400 hover:text-red-600 cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div>
                <label htmlFor="prod-remarks" className="block text-xs font-medium text-slate-700 mb-1">
                  Shift Remarks
                </label>
                <input
                  id="prod-remarks"
                  type="text"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Optional quality check or batch note"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>
            </div>

            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-sm font-medium text-slate-700 hover:text-slate-900 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => handleSaveProduction(false)}
                className="px-4 py-2 text-sm font-medium text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer"
              >
                Save Draft
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => handleSaveProduction(true)}
                className="px-4 py-2 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer"
              >
                {submitting ? 'Submitting...' : 'Submit for Approval'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
