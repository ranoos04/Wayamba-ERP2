import { useMemo, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import type { ErpState, Factory } from '../domain/types.ts';
import {
  generateCsvContent,
  getFactoryStockSummary,
} from '../domain/stockEngine.ts';

interface ReportsViewProps {
  state: ErpState;
  accessibleFactories: Factory[];
  selectedFactoryId: string;
}

type ReportKey =
  | 'daily_production'
  | 'shift_report'
  | 'operator_performance'
  | 'machine_production'
  | 'finished_stock'
  | 'raw_stock'
  | 'customer_dispatch'
  | 'inter_factory_transfer'
  | 'material_consumption'
  | 'factory_comparison'
  | 'audit_report';

const REPORT_LIST: Array<{ key: ReportKey; label: string }> = [
  { key: 'daily_production', label: 'Daily Production Report' },
  { key: 'shift_report', label: 'Day / Night Shift Report' },
  { key: 'operator_performance', label: 'Operator Performance' },
  { key: 'machine_production', label: 'Machine Production Report' },
  { key: 'finished_stock', label: 'Finished Stock Report' },
  { key: 'raw_stock', label: 'Raw Material Stock Report' },
  { key: 'customer_dispatch', label: 'Customer Dispatch Report' },
  { key: 'inter_factory_transfer', label: 'Inter-Factory Transfer Report' },
  { key: 'material_consumption', label: 'Material Consumption Report' },
  { key: 'factory_comparison', label: 'Factory Stock Comparison' },
  { key: 'audit_report', label: 'Audit Trail Report' },
];

export function ReportsView({
  state,
  accessibleFactories,
  selectedFactoryId,
}: ReportsViewProps) {
  const [reportKey, setReportKey] = useState<ReportKey>('daily_production');
  const [factoryFilter, setFactoryFilter] = useState<string>(selectedFactoryId);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [productFilter, setProductFilter] = useState('ALL');
  const [customerFilter, setCustomerFilter] = useState('ALL');

  const inDateRange = (d: string) => {
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  };
  const inFac = (fid: string | null) => factoryFilter === 'ALL' || fid === factoryFilter;

  const { headers, rows } = useMemo(() => {
    const h: string[] = [];
    const r: Array<Array<string | number>> = [];

    if (reportKey === 'daily_production' || reportKey === 'shift_report') {
      h.push('Order No', 'Date', 'Factory', 'Shift', 'Machine', 'Product', 'Qty', 'Unit');
      for (const po of state.productionOrders) {
        const tx = state.transactions.find((t) => t.id === po.transactionId);
        if (!tx || tx.status !== 'approved' || !inFac(tx.factoryId) || !inDateRange(po.productionDate)) continue;
        const fac = state.factories.find((f) => f.id === tx.factoryId);
        const shift = state.shifts.find((s) => s.id === po.shiftId);
        const mac = state.machines.find((m) => m.id === po.machineId);
        for (const pl of state.productionLines.filter((l) => l.productionId === po.id)) {
          if (productFilter !== 'ALL' && pl.productId !== productFilter) continue;
          const prod = state.products.find((p) => p.id === pl.productId);
          r.push([
            tx.transactionNumber,
            po.productionDate,
            fac?.factoryCode ?? '',
            shift?.shiftName ?? '',
            mac?.machineCode ?? '',
            prod?.productName ?? 'Removed Product',
            pl.quantity,
            prod?.unitCode ?? 'KG',
          ]);
        }
      }
    } else if (reportKey === 'operator_performance') {
      h.push('Operator', 'Orders Worked', 'Total Output (KG/PCS)');
      const map = new Map<string, { orders: number; qty: number }>();
      for (const po of state.productionOrders) {
        const tx = state.transactions.find((t) => t.id === po.transactionId);
        if (!tx || tx.status !== 'approved' || !inFac(tx.factoryId) || !inDateRange(po.productionDate)) continue;
        const lines = state.productionLines.filter((l) => l.productionId === po.id);
        const qty = lines.reduce((s, l) => s + l.quantity, 0);
        for (const pop of state.productionOperators.filter((o) => o.productionId === po.id)) {
          const cur = map.get(pop.operatorId) ?? { orders: 0, qty: 0 };
          map.set(pop.operatorId, { orders: cur.orders + 1, qty: cur.qty + qty });
        }
      }
      for (const [opId, stats] of map.entries()) {
        const prof = state.profiles.find((p) => p.id === opId);
        r.push([prof?.fullName ?? opId, stats.orders, stats.qty]);
      }
    } else if (reportKey === 'machine_production') {
      h.push('Factory', 'Machine Code', 'Machine Name', 'Runs', 'Total Output');
      for (const mac of state.machines) {
        if (!inFac(mac.factoryId)) continue;
        const fac = state.factories.find((f) => f.id === mac.factoryId);
        let runs = 0;
        let qty = 0;
        for (const po of state.productionOrders) {
          if (po.machineId !== mac.id || !inDateRange(po.productionDate)) continue;
          const tx = state.transactions.find((t) => t.id === po.transactionId);
          if (!tx || tx.status !== 'approved') continue;
          runs += 1;
          for (const pl of state.productionLines.filter((l) => l.productionId === po.id)) {
            qty += pl.quantity;
          }
        }
        r.push([fac?.factoryCode ?? '', mac.machineCode, mac.machineName, runs, qty]);
      }
    } else if (reportKey === 'finished_stock') {
      h.push('Factory', 'Product Code', 'Product Name', 'Category', 'On Hand', 'Unit');
      for (const bal of state.balances) {
        if (!bal.productId || !inFac(bal.factoryId)) continue;
        if (productFilter !== 'ALL' && bal.productId !== productFilter) continue;
        const fac = state.factories.find((f) => f.id === bal.factoryId);
        const prod = state.products.find((p) => p.id === bal.productId);
        r.push([
          fac?.factoryCode ?? '',
          prod?.productCode ?? '',
          prod?.productName ?? 'Removed Product',
          prod?.productCategory ?? '',
          bal.quantityOnHand,
          prod?.unitCode ?? 'KG',
        ]);
      }
    } else if (reportKey === 'raw_stock') {
      h.push('Factory', 'Material Code', 'Raw Material', 'On Hand (KG)');
      for (const bal of state.balances) {
        if (!bal.materialId || !inFac(bal.factoryId)) continue;
        const fac = state.factories.find((f) => f.id === bal.factoryId);
        const mat = state.rawMaterials.find((m) => m.id === bal.materialId);
        r.push([
          fac?.factoryCode ?? '',
          mat?.materialCode ?? '',
          mat?.materialName ?? '',
          bal.quantityOnHand,
        ]);
      }
    } else if (reportKey === 'customer_dispatch') {
      h.push('Dispatch No', 'Date', 'Factory', 'Customer', 'Product', 'Qty', 'Unit');
      for (const dsp of state.dispatches) {
        const tx = state.transactions.find((t) => t.id === dsp.transactionId);
        if (!tx || tx.status !== 'approved' || !inFac(tx.factoryId) || !inDateRange(dsp.dispatchDate)) continue;
        if (customerFilter !== 'ALL' && dsp.customerId !== customerFilter) continue;
        const fac = state.factories.find((f) => f.id === tx.factoryId);
        const cust = state.customers.find((c) => c.id === dsp.customerId);
        for (const l of state.transactionLines.filter((tl) => tl.transactionId === tx.id)) {
          if (productFilter !== 'ALL' && l.productId !== productFilter) continue;
          const prod = state.products.find((p) => p.id === l.productId);
          r.push([
            tx.transactionNumber,
            dsp.dispatchDate,
            fac?.factoryCode ?? '',
            cust?.customerName ?? '',
            prod?.productName ?? 'Removed Product',
            l.quantity,
            prod?.unitCode ?? 'KG',
          ]);
        }
      }
    } else if (reportKey === 'inter_factory_transfer') {
      h.push('Transfer No', 'From', 'To', 'Material', 'Sent (KG)', 'Received (KG)', 'Discrepancy (KG)', 'Status');
      for (const tr of state.transfers) {
        if (factoryFilter !== 'ALL' && tr.fromFactory !== factoryFilter && tr.toFactory !== factoryFilter) continue;
        const fromF = state.factories.find((f) => f.id === tr.fromFactory);
        const toF = state.factories.find((f) => f.id === tr.toFactory);
        const mat = state.rawMaterials.find((m) => m.id === tr.materialId);
        const rec = state.transferReceipts.find((rc) => rc.transferId === tr.id);
        r.push([
          tr.transferNumber,
          fromF?.factoryCode ?? '',
          toF?.factoryCode ?? '',
          mat?.materialName ?? '',
          tr.sentQuantity,
          rec ? rec.actualQuantity : 'Pending',
          rec ? rec.discrepancyQuantity : 0,
          tr.transferStatus,
        ]);
      }
    } else if (reportKey === 'material_consumption') {
      h.push('Order No', 'Date', 'Factory', 'Raw Material', 'Consumed (KG)');
      for (const mc of state.materialConsumptions) {
        const po = state.productionOrders.find((o) => o.id === mc.productionId);
        const tx = po ? state.transactions.find((t) => t.id === po.transactionId) : null;
        if (!po || !tx || tx.status !== 'approved' || !inFac(tx.factoryId) || !inDateRange(po.productionDate)) continue;
        const fac = state.factories.find((f) => f.id === tx.factoryId);
        const mat = state.rawMaterials.find((m) => m.id === mc.materialId);
        r.push([
          tx.transactionNumber,
          po.productionDate,
          fac?.factoryCode ?? '',
          mat?.materialName ?? '',
          mc.quantity,
        ]);
      }
    } else if (reportKey === 'factory_comparison') {
      h.push('Factory', 'Finished Stock (KG)', 'Finished Pallets (PCS)', 'Raw Material Stock (KG)');
      const targetFacs = factoryFilter === 'ALL' ? accessibleFactories : accessibleFactories.filter((f) => f.id === factoryFilter);
      for (const fac of targetFacs) {
        const sum = getFactoryStockSummary(state, fac.id);
        r.push([
          fac.factoryName,
          sum.finishedKg,
          sum.finishedPcs,
          sum.rawMaterialKg,
        ]);
      }
    } else if (reportKey === 'audit_report') {
      h.push('Timestamp', 'User', 'Factory', 'Action', 'Table', 'Summary');
      for (const log of state.auditLogs) {
        if (factoryFilter !== 'ALL' && log.factoryId !== factoryFilter) continue;
        const usr = state.profiles.find((p) => p.id === log.userId);
        const fac = state.factories.find((f) => f.id === log.factoryId);
        r.push([
          log.createdAt.slice(0, 19).replace('T', ' '),
          usr?.fullName ?? log.userId,
          fac?.factoryCode ?? 'Global',
          log.action,
          log.tableName,
          log.summary,
        ]);
      }
    }

    return { headers: h, rows: r };
  }, [reportKey, factoryFilter, dateFrom, dateTo, productFilter, customerFilter, state, accessibleFactories]);

  function handleExportCsv() {
    const csv = generateCsvContent(headers, rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wayamba-${reportKey}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div className="no-print flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-900">
            Management Reports &amp; Exports
          </h1>
          <p className="text-sm text-slate-500">
            Filter by date range, factory, product, or customer and export directly to Excel (CSV) or PDF.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExportCsv}
            className="px-3.5 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 text-sm font-medium rounded-lg flex items-center gap-2 whitespace-nowrap cursor-pointer"
          >
            <Download className="w-4 h-4" aria-hidden="true" />
            <span>Export Excel (CSV)</span>
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white text-sm font-semibold rounded-lg flex items-center gap-2 whitespace-nowrap cursor-pointer"
          >
            <Printer className="w-4 h-4" aria-hidden="true" />
            <span>Print / PDF</span>
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="no-print bg-white border border-slate-200 rounded-lg p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <div>
          <label htmlFor="rep-type" className="block text-[11px] font-medium text-slate-500 mb-1">
            Report Type
          </label>
          <select
            id="rep-type"
            value={reportKey}
            onChange={(e) => setReportKey(e.target.value as ReportKey)}
            className="w-full px-2.5 py-2 text-xs font-medium border border-slate-300 rounded-md"
          >
            {REPORT_LIST.map((rep) => (
              <option key={rep.key} value={rep.key}>
                {rep.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="rep-factory" className="block text-[11px] font-medium text-slate-500 mb-1">
            Factory
          </label>
          <select
            id="rep-factory"
            value={factoryFilter}
            onChange={(e) => setFactoryFilter(e.target.value)}
            className="w-full px-2.5 py-2 text-xs border border-slate-300 rounded-md"
          >
            <option value="ALL">All Factories</option>
            {accessibleFactories.map((f) => (
              <option key={f.id} value={f.id}>
                {f.factoryCode} — {f.factoryName}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="rep-from" className="block text-[11px] font-medium text-slate-500 mb-1">
            From Date
          </label>
          <input
            id="rep-from"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-full px-2.5 py-2 text-xs border border-slate-300 rounded-md"
          />
        </div>

        <div>
          <label htmlFor="rep-to" className="block text-[11px] font-medium text-slate-500 mb-1">
            To Date
          </label>
          <input
            id="rep-to"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-full px-2.5 py-2 text-xs border border-slate-300 rounded-md"
          />
        </div>

        <div>
          <label htmlFor="rep-product" className="block text-[11px] font-medium text-slate-500 mb-1">
            Product / Customer
          </label>
          {reportKey === 'customer_dispatch' ? (
            <select
              id="rep-product"
              value={customerFilter}
              onChange={(e) => setCustomerFilter(e.target.value)}
              className="w-full px-2.5 py-2 text-xs border border-slate-300 rounded-md"
            >
              <option value="ALL">All Customers</option>
              {state.customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.customerName}
                </option>
              ))}
            </select>
          ) : (
            <select
              id="rep-product"
              value={productFilter}
              onChange={(e) => setProductFilter(e.target.value)}
              className="w-full px-2.5 py-2 text-xs border border-slate-300 rounded-md"
            >
              <option value="ALL">All Products</option>
              {state.products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.productName}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Report Output Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h2 className="font-display text-sm font-bold text-slate-900">
            {REPORT_LIST.find((r) => r.key === reportKey)?.label}
          </h2>
          <span className="font-mono tabular-nums text-xs text-slate-500">
            {rows.length} record(s)
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
              <tr>
                {headers.map((h) => (
                  <th key={h} className="py-2.5 px-4 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row, idx) => (
                <tr key={idx} className="hover:bg-slate-50/70">
                  {row.map((cell, cIdx) => (
                    <td
                      key={cIdx}
                      className={`py-2.5 px-4 whitespace-nowrap ${
                        typeof cell === 'number' ? 'font-mono tabular-nums font-medium' : ''
                      }`}
                    >
                      {typeof cell === 'number' ? cell.toLocaleString('en-US') : cell}
                    </td>
                  ))}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={headers.length || 1} className="py-10 text-center text-sm text-slate-500">
                    No records match the selected report filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
