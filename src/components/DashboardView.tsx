import { useState } from 'react';
import { ArrowRight, BarChart2, Maximize2, Minimize2 } from 'lucide-react';
import type { ErpState } from '../domain/types.ts';
import {
  calculateValuationSummary,
  getAvailableStock,
  getFactoryStockSummary,
} from '../domain/stockEngine.ts';
import type { NavSection } from './AppShell.tsx';
import { StatusLabel } from './StatusLabel.tsx';

interface DashboardViewProps {
  state: ErpState;
  selectedFactoryId: string;
  onNavigate: (section: NavSection) => void;
}

export function DashboardView({ state, selectedFactoryId, onNavigate }: DashboardViewProps) {
  const [chartExpanded, setChartExpanded] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const factoryScope = selectedFactoryId;

  const isInFactory = (fId: string) => factoryScope === 'ALL' || fId === factoryScope;

  const stockSummary = getFactoryStockSummary(state, factoryScope);
  const valuation = calculateValuationSummary(state, factoryScope);

  // Today's approved production & dispatch quantities (KG + PCS)
  let todayProdKg = 0;
  let todayProdPcs = 0;
  let dayShiftKg = 0;
  let nightShiftKg = 0;

  for (const po of state.productionOrders) {
    const tx = state.transactions.find((t) => t.id === po.transactionId);
    if (!tx || tx.status !== 'approved' || !isInFactory(tx.factoryId)) continue;

    const shift = state.shifts.find((s) => s.id === po.shiftId);
    const lines = state.productionLines.filter((pl) => pl.productionId === po.id);
    for (const pl of lines) {
      const prod = state.products.find((p) => p.id === pl.productId);
      if (prod?.unitCode === 'PCS') {
        if (po.productionDate === today) todayProdPcs += pl.quantity;
      } else {
        if (po.productionDate === today) todayProdKg += pl.quantity;
        if (shift?.shiftName === 'Day') dayShiftKg += pl.quantity;
        if (shift?.shiftName === 'Night') nightShiftKg += pl.quantity;
      }
    }
  }

  let todayDispKg = 0;
  let todayDispPcs = 0;
  for (const tx of state.transactions) {
    if (
      tx.transactionType !== 'dispatch' ||
      tx.status !== 'approved' ||
      !isInFactory(tx.factoryId) ||
      tx.transactionDate !== today
    ) {
      continue;
    }
    const lines = state.transactionLines.filter((l) => l.transactionId === tx.id);
    for (const l of lines) {
      if (!l.productId) continue;
      const prod = state.products.find((p) => p.id === l.productId);
      if (prod?.unitCode === 'PCS') todayDispPcs += l.quantity;
      else todayDispKg += l.quantity;
    }
  }

  // Pending Approvals Breakdown
  const pendingTxs = state.transactions.filter(
    (t) => t.status === 'submitted' && isInFactory(t.factoryId)
  );
  const pendingProd = pendingTxs.filter((t) => t.transactionType === 'production').length;
  const pendingDisp = pendingTxs.filter((t) => t.transactionType === 'dispatch').length;
  const pendingRec = pendingTxs.filter(
    (t) => t.transactionType === 'raw_receipt' || t.transactionType === 'transfer_in'
  ).length;
  const pendingOther = pendingTxs.length - pendingProd - pendingDisp - pendingRec;

  const recentMovements = state.movements
    .filter((m) => isInFactory(m.factoryId))
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 6);

  const maxShiftKg = Math.max(dayShiftKg, nightShiftKg, 1);

  return (
    <div className="space-y-6">
      {/* Top 4 KPI Cards (Section 7.2 Blueprint) */}
      <section aria-label="Key Factory Metrics" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="text-xs font-medium text-slate-500">Today&apos;s Production</div>
          <div className="mt-2 font-mono tabular-nums text-2xl font-bold text-slate-900">
            {todayProdKg.toLocaleString('en-US')} kg
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            {todayProdPcs > 0 ? `+ ${todayProdPcs.toLocaleString('en-US')} pcs pallets` : 'Approved shifts today'}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="text-xs font-medium text-slate-500">Today&apos;s Dispatch</div>
          <div className="mt-2 font-mono tabular-nums text-2xl font-bold text-slate-900">
            {todayDispKg.toLocaleString('en-US')} kg
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            {todayDispPcs > 0 ? `+ ${todayDispPcs.toLocaleString('en-US')} pcs pallets` : 'Verified customer dispatches'}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="text-xs font-medium text-slate-500">Finished Goods Stock</div>
          <div className="mt-2 font-mono tabular-nums text-2xl font-bold text-slate-900">
            {stockSummary.finishedKg.toLocaleString('en-US')} kg
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            {stockSummary.finishedPcs.toLocaleString('en-US')} pcs pallets on hand
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="text-xs font-medium text-slate-500">Raw Material Stock</div>
          <div className="mt-2 font-mono tabular-nums text-2xl font-bold text-slate-900">
            {stockSummary.rawMaterialKg.toLocaleString('en-US')} kg
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Virgin, regrind &amp; masterbatch
          </div>
        </div>
      </section>

      {/* Production Overview Chart + Pending Approvals Queue */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div
          className={`bg-white border border-slate-200 rounded-lg p-5 ${
            chartExpanded ? 'lg:col-span-3' : 'lg:col-span-2'
          }`}
        >
          <div className="flex items-center justify-between gap-4 pb-4 border-b border-slate-100">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900 flex items-center gap-2">
                <BarChart2 className="w-4 h-4 text-blue-700" aria-hidden="true" />
                Production Overview (Day vs Night Shift)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Approved pellet extrusion output in KG across recorded shifts
              </p>
            </div>
            <button
              type="button"
              onClick={() => setChartExpanded((v) => !v)}
              className="text-xs font-medium text-slate-600 hover:text-slate-900 px-2.5 py-1.5 border border-slate-200 rounded-md flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              {chartExpanded ? (
                <>
                  <Minimize2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Collapse</span>
                </>
              ) : (
                <>
                  <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Expand chart</span>
                </>
              )}
            </button>
          </div>

          <div className="pt-5 space-y-5">
            <div className="space-y-4">
              {/* Day Shift Bar */}
              <div>
                <div className="flex items-center justify-between text-sm mb-1.5">
                  <span className="font-medium text-slate-700">Day Shift (06:00 – 18:00)</span>
                  <span className="font-mono tabular-nums font-semibold text-slate-900">
                    {dayShiftKg.toLocaleString('en-US')} kg
                  </span>
                </div>
                <div className="h-7 bg-slate-100 rounded overflow-hidden">
                  <div
                    className="h-full bg-blue-700 rounded transition-all duration-300"
                    style={{ width: `${Math.max(4, (dayShiftKg / maxShiftKg) * 100)}%` }}
                  />
                </div>
              </div>

              {/* Night Shift Bar */}
              <div>
                <div className="flex items-center justify-between text-sm mb-1.5">
                  <span className="font-medium text-slate-700">Night Shift (18:00 – 06:00)</span>
                  <span className="font-mono tabular-nums font-semibold text-slate-900">
                    {nightShiftKg.toLocaleString('en-US')} kg
                  </span>
                </div>
                <div className="h-7 bg-slate-100 rounded overflow-hidden">
                  <div
                    className="h-full bg-slate-700 rounded transition-all duration-300"
                    style={{ width: `${Math.max(4, (nightShiftKg / maxShiftKg) * 100)}%` }}
                  />
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
              <div>
                <div className="text-slate-500">Approved Output (KG)</div>
                <div className="mt-1 font-mono tabular-nums font-semibold text-slate-900">
                  {valuation.productionQtyKg.toLocaleString('en-US')} kg
                </div>
              </div>
              <div>
                <div className="text-slate-500">Approved Output (Pallets)</div>
                <div className="mt-1 font-mono tabular-nums font-semibold text-slate-900">
                  {valuation.productionQtyPcs.toLocaleString('en-US')} pcs
                </div>
              </div>
              <div>
                <div className="text-slate-500">Active Machines</div>
                <div className="mt-1 font-mono tabular-nums font-semibold text-slate-900">
                  {state.machines.filter((m) => m.isActive && isInFactory(m.factoryId)).length}
                </div>
              </div>
              <div>
                <div className="text-slate-500">In-Transit Transfers</div>
                <div className="mt-1 font-mono tabular-nums font-semibold text-slate-900">
                  {state.transfers.filter((t) => t.transferStatus === 'in_transit').length}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Pending Approvals Panel */}
        <div
          className={`bg-white border border-slate-200 rounded-lg p-5 flex flex-col justify-between ${
            chartExpanded ? 'lg:col-span-3' : ''
          }`}
        >
          <div>
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <h2 className="font-display text-base font-semibold text-slate-900">
                Pending Approvals
              </h2>
              <span className="font-mono tabular-nums text-sm font-semibold text-amber-700">
                {pendingTxs.length} awaiting
              </span>
            </div>

            <div className="divide-y divide-slate-100 mt-1">
              <div className="py-3 flex items-center justify-between text-sm">
                <span className="text-slate-600">Production records</span>
                <span className="font-mono tabular-nums font-semibold text-slate-900">
                  {pendingProd}
                </span>
              </div>
              <div className="py-3 flex items-center justify-between text-sm">
                <span className="text-slate-600">Dispatch records</span>
                <span className="font-mono tabular-nums font-semibold text-slate-900">
                  {pendingDisp}
                </span>
              </div>
              <div className="py-3 flex items-center justify-between text-sm">
                <span className="text-slate-600">Material &amp; transfer receipts</span>
                <span className="font-mono tabular-nums font-semibold text-slate-900">
                  {pendingRec}
                </span>
              </div>
              {pendingOther > 0 && (
                <div className="py-3 flex items-center justify-between text-sm">
                  <span className="text-slate-600">Transfers &amp; adjustments</span>
                  <span className="font-mono tabular-nums font-semibold text-slate-900">
                    {pendingOther}
                  </span>
                </div>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => onNavigate('approvals')}
            className="mt-4 w-full py-2 px-3 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer"
          >
            <span>Open Approval Centre</span>
            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Finished Product Stock Snapshot */}
      <section aria-label="Finished Product Stock Snapshot" className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-4 border-b border-slate-100">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              Current Stock by Product
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Live approved finished goods balance maintained across your selected factory scope.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => onNavigate('admin')}
              className="text-xs font-medium text-blue-700 hover:text-blue-800 whitespace-nowrap cursor-pointer"
            >
              Manage Products &amp; Roles
            </button>
            <button
              type="button"
              onClick={() => onNavigate('stock')}
              className="text-xs font-medium text-slate-700 hover:text-slate-900 whitespace-nowrap cursor-pointer"
            >
              Stock Bridges
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-4">
          {state.products
            .filter((p) => p.isActive)
            .map((prod) => {
              const targetFacs =
                factoryScope === 'ALL' ? state.factories.map((f) => f.id) : [factoryScope];
              const onHand = targetFacs.reduce(
                (sum, fid) => sum + getAvailableStock(state.balances, fid, 'product', prod.id),
                0
              );
              return (
                <div key={prod.id} className="p-3.5 rounded-lg bg-slate-50 border border-slate-200/80">
                  <div className="text-xs text-slate-500 font-mono">{prod.productCode}</div>
                  <div className="text-sm font-semibold text-slate-900 truncate mt-0.5">
                    {prod.productName}
                  </div>
                  <div className="mt-2 font-mono tabular-nums text-lg font-bold text-slate-900">
                    {onHand.toLocaleString('en-US')} {prod.unitCode}
                  </div>
                  <div className="text-[11px] text-slate-500">{prod.productCategory}</div>
                </div>
              );
            })}
        </div>
      </section>

      {/* Recent Stock Ledger Movements */}
      <section aria-label="Recent Stock Movements" className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="font-display text-base font-semibold text-slate-900">
            Recent Approved Stock Ledger Movements
          </h2>
          <button
            type="button"
            onClick={() => onNavigate('stock')}
            className="text-xs font-medium text-blue-700 hover:text-blue-800 cursor-pointer"
          >
            Full Ledger
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500">
              <tr>
                <th className="py-2.5 px-4">Date</th>
                <th className="py-2.5 px-4">Transaction</th>
                <th className="py-2.5 px-4">Factory</th>
                <th className="py-2.5 px-4">Item</th>
                <th className="py-2.5 px-4">Direction</th>
                <th className="py-2.5 px-4 text-right">Quantity</th>
                <th className="py-2.5 px-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {recentMovements.map((mov) => {
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
                    <td className="py-2.5 px-4 font-mono tabular-nums text-xs text-slate-600 whitespace-nowrap">
                      {mov.movementDate}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-xs font-medium text-slate-900 whitespace-nowrap">
                      {tx?.transactionNumber ?? mov.transactionId}
                    </td>
                    <td className="py-2.5 px-4 text-xs text-slate-600 whitespace-nowrap">
                      {fac?.factoryCode}
                    </td>
                    <td className="py-2.5 px-4 text-slate-900 font-medium">
                      {prod?.productName ?? mat?.materialName ?? 'Item'}
                    </td>
                    <td className="py-2.5 px-4 text-xs">
                      <span
                        className={
                          mov.direction === 'in'
                            ? 'text-emerald-700 font-medium'
                            : 'text-slate-700 font-medium'
                        }
                      >
                        {mov.direction === 'in' ? 'Stock In (+)' : 'Stock Out (-)'}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                      {mov.direction === 'in' ? '+' : '-'}
                      {mov.quantity.toLocaleString('en-US')} {unit}
                    </td>
                    <td className="py-2.5 px-4">
                      <StatusLabel status={tx?.status ?? 'approved'} />
                    </td>
                  </tr>
                );
              })}
              {recentMovements.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-sm text-slate-500">
                    No approved stock movements recorded for this factory yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
