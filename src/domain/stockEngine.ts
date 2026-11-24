import type {
  AppRole,
  ErpState,
  MovementDirection,
  PriceHistoryEntry,
  StockBalance,
  StockMovement,
  StockTransaction,
  StockTransactionLine,
} from './types.ts';

export function round2(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

export function round3(val: number): number {
  return Math.round((val + Number.EPSILON) * 1000) / 1000;
}

export function calculateProductionValue(quantity: number, sellingPrice: number): number {
  if (quantity < 0 || sellingPrice < 0) {
    throw new Error('Quantity and selling price must be non-negative');
  }
  return round2(quantity * sellingPrice);
}

export function getEffectiveSellingPrice(
  priceHistory: PriceHistoryEntry[],
  productId: string,
  factoryId: string,
  date: string
): number {
  const candidates = priceHistory
    .filter((entry) => {
      if (entry.productId !== productId) return false;
      if (entry.factoryId !== null && entry.factoryId !== factoryId) return false;
      if (entry.effectiveFrom > date) return false;
      if (entry.effectiveTo !== null && entry.effectiveTo < date) return false;
      return true;
    })
    .sort((a, b) => {
      // Factory-specific price takes precedence over global price, then most recent effectiveFrom
      const aScope = a.factoryId ? 1 : 0;
      const bScope = b.factoryId ? 1 : 0;
      if (aScope !== bScope) return bScope - aScope;
      return b.effectiveFrom.localeCompare(a.effectiveFrom);
    });

  return candidates[0]?.sellingPrice ?? 0;
}

export function calculateFinishedGoodsBridge(params: {
  opening: number;
  production: number;
  dispatch: number;
  returns?: number;
  adjustments?: number;
}): number {
  const { opening, production, dispatch, returns = 0, adjustments = 0 } = params;
  return round3(opening + production - dispatch + returns + adjustments);
}

export function calculateRawMaterialBridge(params: {
  opening: number;
  supplierReceipts: number;
  factoryReceipts: number;
  productionConsumption: number;
  factoryTransfersOut: number;
  otherIssues?: number;
  adjustments?: number;
}): number {
  const {
    opening,
    supplierReceipts,
    factoryReceipts,
    productionConsumption,
    factoryTransfersOut,
    otherIssues = 0,
    adjustments = 0,
  } = params;
  return round3(
    opening +
      supplierReceipts +
      factoryReceipts -
      productionConsumption -
      factoryTransfersOut -
      otherIssues +
      adjustments
  );
}

export function getAvailableStock(
  balances: StockBalance[],
  factoryId: string,
  kind: 'product' | 'material',
  itemId: string
): number {
  const match = balances.find((b) =>
    kind === 'product'
      ? b.factoryId === factoryId && b.productId === itemId
      : b.factoryId === factoryId && b.materialId === itemId
  );
  return match ? round3(match.quantityOnHand) : 0;
}

export function isSuperAdmin(state: ErpState, userId: string): boolean {
  return state.memberships.some(
    (m) => m.userId === userId && m.role === 'super_admin' && m.isActive
  );
}

export function hasFactoryAccess(state: ErpState, userId: string, factoryId: string): boolean {
  if (isSuperAdmin(state, userId)) return true;
  return state.memberships.some(
    (m) => m.userId === userId && m.factoryId === factoryId && m.isActive
  );
}

export function hasFactoryRole(
  state: ErpState,
  userId: string,
  factoryId: string,
  allowedRoles: AppRole[]
): boolean {
  if (isSuperAdmin(state, userId)) return true;
  return state.memberships.some(
    (m) =>
      m.userId === userId &&
      m.factoryId === factoryId &&
      m.isActive &&
      allowedRoles.includes(m.role)
  );
}

export function getUserAccessibleFactories(state: ErpState, userId: string) {
  if (isSuperAdmin(state, userId)) {
    return state.factories.filter((f) => f.isActive);
  }
  const factoryIds = new Set(
    state.memberships.filter((m) => m.userId === userId && m.isActive).map((m) => m.factoryId)
  );
  return state.factories.filter((f) => f.isActive && factoryIds.has(f.id));
}

export function getUserRoleForFactory(
  state: ErpState,
  userId: string,
  factoryId: string
): AppRole | null {
  if (isSuperAdmin(state, userId)) return 'super_admin';
  const match = state.memberships.find(
    (m) => m.userId === userId && m.factoryId === factoryId && m.isActive
  );
  return match ? match.role : null;
}

export interface ApprovalValidationResult {
  allowed: boolean;
  reason?: string;
  insufficientItems?: Array<{
    name: string;
    required: number;
    available: number;
    unit: string;
  }>;
}

export function canApproveTransaction(
  state: ErpState,
  transactionId: string,
  approverUserId: string
): ApprovalValidationResult {
  const tx = state.transactions.find((t) => t.id === transactionId);
  if (!tx) {
    return { allowed: false, reason: 'Transaction record not found.' };
  }
  if (tx.status !== 'submitted') {
    return {
      allowed: false,
      reason: `Transaction is "${tx.status}" and must be in "submitted" status to approve.`,
    };
  }
  if (!hasFactoryRole(state, approverUserId, tx.factoryId, ['super_admin', 'factory_manager'])) {
    return {
      allowed: false,
      reason: 'Only an authorized Factory Manager or Super Admin for this factory can approve.',
    };
  }
  if (state.settings.preventSelfApproval && tx.createdBy === approverUserId) {
    return {
      allowed: false,
      reason: 'Self-approval is blocked: the creator cannot approve their own stock transaction.',
    };
  }

  const lines = state.transactionLines.filter((l) => l.transactionId === tx.id);
  if (lines.length === 0) {
    return { allowed: false, reason: 'Transaction has no line items.' };
  }

  // Check document requirement for dispatches if enabled
  if (tx.transactionType === 'dispatch' && state.settings.requireDispatchDocument) {
    const hasDoc = state.documents.some((d) => d.transactionId === tx.id);
    if (!hasDoc) {
      return {
        allowed: false,
        reason: 'Dispatch requires an attached customer bill or delivery note before approval.',
      };
    }
  }

  // Aggregate outgoing requirements per item so multi-line consumptions are accurately checked
  const requiredOut = new Map<
    string,
    { kind: 'product' | 'material'; itemId: string; qty: number }
  >();
  for (const line of lines) {
    if (line.direction !== 'out') continue;
    const kind = line.productId ? 'product' : 'material';
    const itemId = (line.productId ?? line.materialId)!;
    const key = `${kind}:${itemId}`;
    const existing = requiredOut.get(key);
    requiredOut.set(key, {
      kind,
      itemId,
      qty: round3((existing?.qty ?? 0) + line.quantity),
    });
  }

  const insufficientItems: ApprovalValidationResult['insufficientItems'] = [];
  for (const req of requiredOut.values()) {
    const available = getAvailableStock(state.balances, tx.factoryId, req.kind, req.itemId);
    if (available < req.qty) {
      const meta =
        req.kind === 'product'
          ? state.products.find((p) => p.id === req.itemId)
          : state.rawMaterials.find((m) => m.id === req.itemId);
      const name =
        req.kind === 'product'
          ? (meta as { productName?: string } | undefined)?.productName ?? req.itemId
          : (meta as { materialName?: string } | undefined)?.materialName ?? req.itemId;
      const unit = meta?.unitCode ?? 'KG';
      insufficientItems.push({
        name,
        required: req.qty,
        available,
        unit,
      });
    }
  }

  if (insufficientItems.length > 0) {
    const first = insufficientItems[0];
    return {
      allowed: false,
      reason: `Insufficient stock for ${first.name}: needs ${first.required} ${first.unit}, only ${first.available} ${first.unit} on hand.`,
      insufficientItems,
    };
  }

  return { allowed: true };
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function approveTransaction(
  state: ErpState,
  transactionId: string,
  approverUserId: string,
  remarks = ''
): { ok: boolean; nextState: ErpState; error?: string } {
  const check = canApproveTransaction(state, transactionId, approverUserId);
  if (!check.allowed) {
    return { ok: false, nextState: state, error: check.reason };
  }

  const now = new Date().toISOString();
  const tx = state.transactions.find((t) => t.id === transactionId)!;
  const lines = state.transactionLines.filter((l) => l.transactionId === tx.id);

  // Clone balances map for atomic update
  const nextBalances: StockBalance[] = state.balances.map((b) => ({ ...b }));
  const newMovements: StockMovement[] = [];

  for (const line of lines) {
    const delta = line.direction === 'in' ? line.quantity : -line.quantity;
    const existingIdx = nextBalances.findIndex((b) =>
      line.productId
        ? b.factoryId === tx.factoryId && b.productId === line.productId
        : b.factoryId === tx.factoryId && b.materialId === line.materialId
    );

    if (existingIdx >= 0) {
      const updatedQty = round3(nextBalances[existingIdx].quantityOnHand + delta);
      if (updatedQty < 0) {
        return {
          ok: false,
          nextState: state,
          error: 'Atomic check failed: stock balance would drop below zero.',
        };
      }
      nextBalances[existingIdx] = {
        ...nextBalances[existingIdx],
        quantityOnHand: updatedQty,
        updatedAt: now,
      };
    } else {
      if (delta < 0) {
        return {
          ok: false,
          nextState: state,
          error: 'Atomic check failed: cannot deduct non-existent stock balance.',
        };
      }
      nextBalances.push({
        id: makeId('bal'),
        factoryId: tx.factoryId,
        productId: line.productId,
        materialId: line.materialId,
        quantityOnHand: round3(delta),
        updatedAt: now,
      });
    }

    newMovements.push({
      id: makeId('mov'),
      transactionId: tx.id,
      transactionLineId: line.id,
      factoryId: tx.factoryId,
      productId: line.productId,
      materialId: line.materialId,
      direction: line.direction,
      quantity: line.quantity,
      unitValue: line.unitPrice,
      movementDate: tx.transactionDate,
      createdAt: now,
    });
  }

  const nextTransactions: StockTransaction[] = state.transactions.map((t) =>
    t.id === tx.id
      ? {
          ...t,
          status: 'approved',
          approvedBy: approverUserId,
          approvedAt: now,
        }
      : t
  );

  // Sync transfer status if this transaction belongs to an inter-factory transfer
  const nextTransfers = state.transfers.map((tr) => {
    if (tr.transferOutTransactionId === tx.id) {
      return { ...tr, transferStatus: 'in_transit' as const };
    }
    if (tr.transferInTransactionId === tx.id) {
      const receipt = state.transferReceipts.find((r) => r.transferId === tr.id);
      const hasDiscrepancy = receipt ? Math.abs(receipt.discrepancyQuantity) > 0.0001 : false;
      return {
        ...tr,
        transferStatus: hasDiscrepancy ? ('discrepancy' as const) : ('received' as const),
      };
    }
    return tr;
  });

  const nextState: ErpState = {
    ...state,
    transactions: nextTransactions,
    balances: nextBalances,
    movements: [...newMovements, ...state.movements],
    transfers: nextTransfers,
    approvals: [
      {
        id: makeId('apr'),
        transactionId: tx.id,
        approvedBy: approverUserId,
        decision: 'approved',
        remarks: remarks || 'Approved and posted to stock ledger',
        decidedAt: now,
      },
      ...state.approvals,
    ],
    auditLogs: [
      {
        id: makeId('aud'),
        userId: approverUserId,
        factoryId: tx.factoryId,
        action: 'APPROVE_TRANSACTION',
        tableName: 'stock_transactions',
        recordId: tx.id,
        summary: `Approved ${tx.transactionNumber} (${tx.transactionType}) and posted ${newMovements.length} stock movement(s).`,
        createdAt: now,
      },
      ...state.auditLogs,
    ],
  };

  return { ok: true, nextState };
}

export function rejectTransaction(
  state: ErpState,
  transactionId: string,
  approverUserId: string,
  remarks: string
): { ok: boolean; nextState: ErpState; error?: string } {
  const tx = state.transactions.find((t) => t.id === transactionId);
  if (!tx) return { ok: false, nextState: state, error: 'Transaction not found.' };
  if (tx.status !== 'submitted') {
    return { ok: false, nextState: state, error: 'Only submitted transactions can be rejected.' };
  }
  if (!hasFactoryRole(state, approverUserId, tx.factoryId, ['super_admin', 'factory_manager'])) {
    return {
      ok: false,
      nextState: state,
      error: 'Only an authorized Factory Manager or Super Admin can reject.',
    };
  }
  if (!remarks.trim()) {
    return { ok: false, nextState: state, error: 'Rejection remarks are required.' };
  }

  const now = new Date().toISOString();
  const nextTransactions = state.transactions.map((t) =>
    t.id === tx.id
      ? {
          ...t,
          status: 'rejected' as const,
          approvedBy: approverUserId,
          approvedAt: now,
        }
      : t
  );

  const nextTransfers = state.transfers.map((tr) =>
    tr.transferOutTransactionId === tx.id ? { ...tr, transferStatus: 'rejected' as const } : tr
  );

  return {
    ok: true,
    nextState: {
      ...state,
      transactions: nextTransactions,
      transfers: nextTransfers,
      approvals: [
        {
          id: makeId('apr'),
          transactionId: tx.id,
          approvedBy: approverUserId,
          decision: 'rejected',
          remarks: remarks.trim(),
          decidedAt: now,
        },
        ...state.approvals,
      ],
      auditLogs: [
        {
          id: makeId('aud'),
          userId: approverUserId,
          factoryId: tx.factoryId,
          action: 'REJECT_TRANSACTION',
          tableName: 'stock_transactions',
          recordId: tx.id,
          summary: `Rejected ${tx.transactionNumber}: ${remarks.trim()}`,
          createdAt: now,
        },
        ...state.auditLogs,
      ],
    },
  };
}

export function createTransferReceiptTransaction(
  state: ErpState,
  transferId: string,
  receivedByUserId: string,
  actualQuantity: number,
  receivingRemarks: string
): { ok: boolean; nextState: ErpState; discrepancy: number; error?: string } {
  const transfer = state.transfers.find((t) => t.id === transferId);
  if (!transfer) {
    return { ok: false, nextState: state, discrepancy: 0, error: 'Transfer not found.' };
  }
  if (transfer.transferStatus !== 'in_transit') {
    return {
      ok: false,
      nextState: state,
      discrepancy: 0,
      error: 'Transfer must be in "in_transit" status to confirm receipt.',
    };
  }
  if (!hasFactoryAccess(state, receivedByUserId, transfer.toFactory)) {
    return {
      ok: false,
      nextState: state,
      discrepancy: 0,
      error: 'User does not have access to the destination factory.',
    };
  }
  if (actualQuantity <= 0) {
    return {
      ok: false,
      nextState: state,
      discrepancy: 0,
      error: 'Actual received quantity must be greater than zero.',
    };
  }

  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const discrepancy = round3(transfer.sentQuantity - actualQuantity);

  const txId = makeId('tx');
  const lineId = makeId('txl');
  const txNumber = `TI-${transfer.transferNumber.replace(/^TR-/, '')}`;

  const newTx: StockTransaction = {
    id: txId,
    transactionNumber: txNumber,
    factoryId: transfer.toFactory,
    transactionType: 'transfer_in',
    status: 'submitted',
    transactionDate: today,
    referenceNumber: transfer.transferNumber,
    customerId: null,
    supplierId: null,
    createdBy: receivedByUserId,
    submittedAt: now,
    approvedBy: null,
    approvedAt: null,
    remarks:
      discrepancy !== 0
        ? `Transfer receipt with ${discrepancy} kg discrepancy. ${receivingRemarks}`.trim()
        : receivingRemarks || `Receipt for ${transfer.transferNumber}`,
    createdAt: now,
  };

  const newLine: StockTransactionLine = {
    id: lineId,
    transactionId: txId,
    productId: null,
    materialId: transfer.materialId,
    direction: 'in',
    quantity: round3(actualQuantity),
    unitPrice: transfer.unitCost,
    totalValue: round2(actualQuantity * transfer.unitCost),
    remarks:
      discrepancy !== 0
        ? `Actual received ${actualQuantity} kg vs sent ${transfer.sentQuantity} kg (Discrepancy: ${discrepancy} kg)`
        : 'Full quantity received',
  };

  const receiptId = makeId('trr');
  const nextTransfers = state.transfers.map((t) =>
    t.id === transfer.id ? { ...t, transferInTransactionId: txId } : t
  );

  return {
    ok: true,
    discrepancy,
    nextState: {
      ...state,
      transactions: [newTx, ...state.transactions],
      transactionLines: [newLine, ...state.transactionLines],
      transfers: nextTransfers,
      transferReceipts: [
        {
          id: receiptId,
          transferId: transfer.id,
          actualQuantity: round3(actualQuantity),
          discrepancyQuantity: discrepancy,
          receivedBy: receivedByUserId,
          receivedAt: now,
          receivingRemarks,
        },
        ...state.transferReceipts,
      ],
      auditLogs: [
        {
          id: makeId('aud'),
          userId: receivedByUserId,
          factoryId: transfer.toFactory,
          action: 'RECEIVE_TRANSFER',
          tableName: 'transfer_receipts',
          recordId: receiptId,
          summary: `Recorded receipt for ${transfer.transferNumber}: received ${actualQuantity} kg of ${transfer.sentQuantity} kg (discrepancy ${discrepancy} kg).`,
          createdAt: now,
        },
        ...state.auditLogs,
      ],
    },
  };
}

export interface ValuationSummary {
  productionQtyKg: number;
  productionQtyPcs: number;
  productionValueAtSellingPrice: number;
  productionMaterialCost: number;
  grossPotentialMarginEstimate: number;
  inventoryFinishedValue: number;
  inventoryRawMaterialValue: number;
  totalInventoryValue: number;
  dispatchValue: number;
  dispatchQtyKg: number;
  dispatchQtyPcs: number;
}

export function calculateValuationSummary(
  state: ErpState,
  factoryId: string | 'ALL',
  dateFrom?: string,
  dateTo?: string
): ValuationSummary {
  const inRange = (date: string) => {
    if (dateFrom && date < dateFrom) return false;
    if (dateTo && date > dateTo) return false;
    return true;
  };

  const approvedTxById = new Map<string, StockTransaction>();
  for (const tx of state.transactions) {
    if (tx.status === 'approved' && (factoryId === 'ALL' || tx.factoryId === factoryId)) {
      approvedTxById.set(tx.id, tx);
    }
  }

  let productionQtyKg = 0;
  let productionQtyPcs = 0;
  let productionValueAtSellingPrice = 0;
  let productionMaterialCost = 0;

  for (const po of state.productionOrders) {
    const tx = approvedTxById.get(po.transactionId);
    if (!tx || !inRange(po.productionDate)) continue;

    const lines = state.productionLines.filter((pl) => pl.productionId === po.id);
    for (const pl of lines) {
      const prod = state.products.find((p) => p.id === pl.productId);
      if (prod?.unitCode === 'PCS') {
        productionQtyPcs += pl.quantity;
      } else {
        productionQtyKg += pl.quantity;
      }
      productionValueAtSellingPrice += pl.productionValue;
    }

    const cons = state.materialConsumptions.filter((mc) => mc.productionId === po.id);
    for (const mc of cons) {
      productionMaterialCost += round2(mc.quantity * mc.unitCost);
    }
  }

  let dispatchQtyKg = 0;
  let dispatchQtyPcs = 0;
  let dispatchValue = 0;

  for (const tx of approvedTxById.values()) {
    if (tx.transactionType !== 'dispatch' || !inRange(tx.transactionDate)) continue;
    const lines = state.transactionLines.filter((l) => l.transactionId === tx.id);
    for (const l of lines) {
      if (l.productId) {
        const prod = state.products.find((p) => p.id === l.productId);
        if (prod?.unitCode === 'PCS') dispatchQtyPcs += l.quantity;
        else dispatchQtyKg += l.quantity;
        dispatchValue += l.totalValue;
      }
    }
  }

  let inventoryFinishedValue = 0;
  let inventoryRawMaterialValue = 0;
  const today = new Date().toISOString().slice(0, 10);

  for (const bal of state.balances) {
    if (factoryId !== 'ALL' && bal.factoryId !== factoryId) continue;
    if (bal.materialId) {
      const mat = state.rawMaterials.find((m) => m.id === bal.materialId);
      inventoryRawMaterialValue += round2(bal.quantityOnHand * (mat?.weightedAvgCost ?? 0));
    } else if (bal.productId) {
      // Weighted inventory valuation benchmarked at 85% of current selling price when standard cost isn't separate, or latest cost
      const price = getEffectiveSellingPrice(state.priceHistory, bal.productId, bal.factoryId, today);
      inventoryFinishedValue += round2(bal.quantityOnHand * price * 0.85);
    }
  }

  return {
    productionQtyKg: round3(productionQtyKg),
    productionQtyPcs: round3(productionQtyPcs),
    productionValueAtSellingPrice: round2(productionValueAtSellingPrice),
    productionMaterialCost: round2(productionMaterialCost),
    grossPotentialMarginEstimate: round2(productionValueAtSellingPrice - productionMaterialCost),
    inventoryFinishedValue: round2(inventoryFinishedValue),
    inventoryRawMaterialValue: round2(inventoryRawMaterialValue),
    totalInventoryValue: round2(inventoryFinishedValue + inventoryRawMaterialValue),
    dispatchValue: round2(dispatchValue),
    dispatchQtyKg: round3(dispatchQtyKg),
    dispatchQtyPcs: round3(dispatchQtyPcs),
  };
}

export function getFactoryStockSummary(state: ErpState, factoryId: string | 'ALL') {
  let finishedKg = 0;
  let finishedPcs = 0;
  let rawMaterialKg = 0;

  for (const b of state.balances) {
    if (factoryId !== 'ALL' && b.factoryId !== factoryId) continue;
    if (b.productId) {
      const prod = state.products.find((p) => p.id === b.productId);
      if (prod?.unitCode === 'PCS') finishedPcs += b.quantityOnHand;
      else finishedKg += b.quantityOnHand;
    } else if (b.materialId) {
      rawMaterialKg += b.quantityOnHand;
    }
  }

  return {
    finishedKg: round3(finishedKg),
    finishedPcs: round3(finishedPcs),
    rawMaterialKg: round3(rawMaterialKg),
  };
}

export function getItemFlowBreakdown(
  state: ErpState,
  factoryId: string,
  kind: 'product' | 'material',
  itemId: string
) {
  const txsById = new Map<string, StockTransaction>();
  for (const tx of state.transactions) {
    if (tx.factoryId === factoryId && tx.status === 'approved') {
      txsById.set(tx.id, tx);
    }
  }

  let opening = 0;
  let production = 0;
  let dispatch = 0;
  let supplierReceipts = 0;
  let factoryReceipts = 0;
  let consumption = 0;
  let transfersOut = 0;
  let adjustments = 0;

  for (const mov of state.movements) {
    if (mov.factoryId !== factoryId) continue;
    if (kind === 'product' && mov.productId !== itemId) continue;
    if (kind === 'material' && mov.materialId !== itemId) continue;
    const tx = txsById.get(mov.transactionId);
    if (!tx) continue;

    if (tx.transactionType === 'opening') opening += mov.quantity;
    else if (tx.transactionType === 'production') {
      if (mov.direction === 'in') production += mov.quantity;
      else consumption += mov.quantity;
    } else if (tx.transactionType === 'dispatch') dispatch += mov.quantity;
    else if (tx.transactionType === 'raw_receipt') supplierReceipts += mov.quantity;
    else if (tx.transactionType === 'transfer_in') factoryReceipts += mov.quantity;
    else if (tx.transactionType === 'material_consumption') consumption += mov.quantity;
    else if (tx.transactionType === 'transfer_out') transfersOut += mov.quantity;
    else if (tx.transactionType === 'adjustment' || tx.transactionType === 'return') {
      adjustments += mov.direction === 'in' ? mov.quantity : -mov.quantity;
    }
  }

  const closing =
    kind === 'product'
      ? calculateFinishedGoodsBridge({ opening, production, dispatch, adjustments })
      : calculateRawMaterialBridge({
          opening,
          supplierReceipts,
          factoryReceipts,
          productionConsumption: consumption,
          factoryTransfersOut: transfersOut,
          adjustments,
        });

  return {
    opening: round3(opening),
    production: round3(production),
    dispatch: round3(dispatch),
    supplierReceipts: round3(supplierReceipts),
    factoryReceipts: round3(factoryReceipts),
    consumption: round3(consumption),
    transfersOut: round3(transfersOut),
    adjustments: round3(adjustments),
    closing: round3(closing),
  };
}

export function generateCsvContent(headers: string[], rows: Array<Array<string | number>>): string {
  const escape = (cell: string | number) => {
    const str = String(cell ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  return [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n');
}

export function formatLkr(amount: number): string {
  return `Rs. ${amount.toLocaleString('en-LK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatQty(qty: number, unit: MovementDirection | string): string {
  return `${qty.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} ${unit}`;
}

export function createProductRecord(
  state: ErpState,
  actorUserId: string,
  input: {
    productCode: string;
    productName: string;
    productCategory: string;
    unitCode: 'KG' | 'PCS';
  }
): { ok: boolean; nextState: ErpState; product?: ErpState['products'][number]; error?: string } {
  if (!hasFactoryRole(state, actorUserId, state.factories[0]?.id ?? 'fac-01', ['super_admin', 'factory_manager'])) {
    if (!isSuperAdmin(state, actorUserId)) {
      return { ok: false, nextState: state, error: 'Only Super Admin or Factory Manager can add products.' };
    }
  }
  const code = input.productCode.trim().toUpperCase();
  const name = input.productName.trim();
  const category = input.productCategory.trim() || 'PP Pellets';
  if (!code || !name) {
    return { ok: false, nextState: state, error: 'Product code and product name are required.' };
  }
  if (state.products.some((p) => p.productCode.toUpperCase() === code)) {
    return { ok: false, nextState: state, error: `Product code "${code}" already exists.` };
  }

  const now = new Date().toISOString();
  const prod = {
    id: makeId('prod'),
    productCode: code,
    productName: name,
    productCategory: category,
    unitCode: input.unitCode,
    isActive: true,
    createdAt: now,
  };

  return {
    ok: true,
    product: prod,
    nextState: {
      ...state,
      products: [...state.products, prod],
      auditLogs: [
        {
          id: makeId('aud'),
          userId: actorUserId,
          factoryId: null,
          action: 'CREATE_PRODUCT',
          tableName: 'products',
          recordId: prod.id,
          summary: `Added product ${prod.productCode} – ${prod.productName} (${prod.unitCode}).`,
          createdAt: now,
        },
        ...state.auditLogs,
      ],
    },
  };
}

export function updateProductRecord(
  state: ErpState,
  actorUserId: string,
  productId: string,
  input: {
    productCode: string;
    productName: string;
    productCategory: string;
    unitCode: 'KG' | 'PCS';
    isActive?: boolean;
  }
): { ok: boolean; nextState: ErpState; error?: string } {
  if (!isSuperAdmin(state, actorUserId) && !state.memberships.some((m) => m.userId === actorUserId && m.role === 'factory_manager' && m.isActive)) {
    return { ok: false, nextState: state, error: 'Only Super Admin or Factory Manager can edit products.' };
  }
  const existing = state.products.find((p) => p.id === productId);
  if (!existing) {
    return { ok: false, nextState: state, error: 'Product not found.' };
  }
  const code = input.productCode.trim().toUpperCase();
  const name = input.productName.trim();
  const category = input.productCategory.trim() || existing.productCategory;
  if (!code || !name) {
    return { ok: false, nextState: state, error: 'Product code and product name are required.' };
  }
  if (state.products.some((p) => p.id !== productId && p.productCode.toUpperCase() === code)) {
    return { ok: false, nextState: state, error: `Product code "${code}" is used by another product.` };
  }

  const now = new Date().toISOString();
  const nextProducts = state.products.map((p) =>
    p.id === productId
      ? {
          ...p,
          productCode: code,
          productName: name,
          productCategory: category,
          unitCode: input.unitCode,
          isActive: input.isActive ?? p.isActive,
        }
      : p
  );

  return {
    ok: true,
    nextState: {
      ...state,
      products: nextProducts,
      auditLogs: [
        {
          id: makeId('aud'),
          userId: actorUserId,
          factoryId: null,
          action: 'UPDATE_PRODUCT',
          tableName: 'products',
          recordId: productId,
          summary: `Updated product ${code} – ${name} (${input.unitCode}).`,
          createdAt: now,
        },
        ...state.auditLogs,
      ],
    },
  };
}

export function deleteProductRecord(
  state: ErpState,
  actorUserId: string,
  productId: string
): { ok: boolean; nextState: ErpState; error?: string } {
  if (!isSuperAdmin(state, actorUserId) && !state.memberships.some((m) => m.userId === actorUserId && m.role === 'factory_manager' && m.isActive)) {
    return { ok: false, nextState: state, error: 'Only Super Admin or Factory Manager can delete products.' };
  }
  const existing = state.products.find((p) => p.id === productId);
  if (!existing) {
    return { ok: false, nextState: state, error: 'Product not found.' };
  }

  const now = new Date().toISOString();
  return {
    ok: true,
    nextState: {
      ...state,
      products: state.products.filter((p) => p.id !== productId),
      balances: state.balances.filter((b) => b.productId !== productId),
      priceHistory: state.priceHistory.filter((ph) => ph.productId !== productId),
      auditLogs: [
        {
          id: makeId('aud'),
          userId: actorUserId,
          factoryId: null,
          action: 'DELETE_PRODUCT',
          tableName: 'products',
          recordId: productId,
          summary: `Deleted product ${existing.productCode} – ${existing.productName}.`,
          createdAt: now,
        },
        ...state.auditLogs,
      ],
    },
  };
}

export function createUserAccount(
  state: ErpState,
  actorUserId: string,
  input: {
    fullName: string;
    email: string;
    phone?: string;
    password?: string;
    factoryIds: string[];
    role: AppRole;
  }
): { ok: boolean; nextState: ErpState; userId?: string; error?: string } {
  if (!isSuperAdmin(state, actorUserId)) {
    return { ok: false, nextState: state, error: 'Only Super Admin can create employee or admin accounts.' };
  }
  const fullName = input.fullName.trim();
  const email = input.email.trim().toLowerCase();
  if (!fullName || !email || !email.includes('@')) {
    return { ok: false, nextState: state, error: 'Valid full name and email address are required.' };
  }
  if (state.profiles.some((p) => p.email.toLowerCase() === email)) {
    return { ok: false, nextState: state, error: `An account with email "${email}" already exists.` };
  }
  const assignedFactories =
    input.factoryIds.length > 0
      ? input.factoryIds
      : state.factories[0]?.id
      ? [state.factories[0].id]
      : [];
  if (assignedFactories.length === 0) {
    return { ok: false, nextState: state, error: 'Assign at least one factory to the account.' };
  }

  const now = new Date().toISOString();
  const uid = makeId('u');
  const newProfile = {
    id: uid,
    fullName,
    email,
    phone: (input.phone || '').trim(),
    passwordHash: (input.password || 'wayamba123').trim() || 'wayamba123',
    isActive: true,
    createdAt: now,
  };
  const newMemberships = assignedFactories.map((fid) => ({
    id: makeId('mem'),
    userId: uid,
    factoryId: fid,
    role: input.role,
    isActive: true,
    createdAt: now,
  }));

  return {
    ok: true,
    userId: uid,
    nextState: {
      ...state,
      profiles: [...state.profiles, newProfile],
      memberships: [...state.memberships, ...newMemberships],
      auditLogs: [
        {
          id: makeId('aud'),
          userId: actorUserId,
          factoryId: assignedFactories[0] ?? null,
          action: 'CREATE_USER',
          tableName: 'profiles',
          recordId: uid,
          summary: `Created ${input.role} account for ${fullName} (${email}).`,
          createdAt: now,
        },
        ...state.auditLogs,
      ],
    },
  };
}

export function updateUserAccount(
  state: ErpState,
  actorUserId: string,
  targetUserId: string,
  input: {
    fullName: string;
    email: string;
    phone?: string;
    password?: string;
    factoryIds: string[];
    role: AppRole;
    isActive?: boolean;
  }
): { ok: boolean; nextState: ErpState; error?: string } {
  if (!isSuperAdmin(state, actorUserId)) {
    return { ok: false, nextState: state, error: 'Only Super Admin can update employee accounts and roles.' };
  }
  const existing = state.profiles.find((p) => p.id === targetUserId);
  if (!existing) {
    return { ok: false, nextState: state, error: 'User account not found.' };
  }
  const fullName = input.fullName.trim();
  const email = input.email.trim().toLowerCase();
  if (!fullName || !email || !email.includes('@')) {
    return { ok: false, nextState: state, error: 'Valid full name and email address are required.' };
  }
  if (state.profiles.some((p) => p.id !== targetUserId && p.email.toLowerCase() === email)) {
    return { ok: false, nextState: state, error: `Email "${email}" is already used by another user.` };
  }
  const assignedFactories =
    input.factoryIds.length > 0
      ? input.factoryIds
      : state.factories[0]?.id
      ? [state.factories[0].id]
      : [];

  const now = new Date().toISOString();
  const nextProfiles = state.profiles.map((p) =>
    p.id === targetUserId
      ? {
          ...p,
          fullName,
          email,
          phone: input.phone !== undefined ? input.phone.trim() : p.phone,
          passwordHash:
            input.password && input.password.trim().length > 0
              ? input.password.trim()
              : p.passwordHash,
          isActive: input.isActive ?? p.isActive,
        }
      : p
  );

  const otherMemberships = state.memberships.filter((m) => m.userId !== targetUserId);
  const nextUserMemberships = assignedFactories.map((fid) => ({
    id: makeId('mem'),
    userId: targetUserId,
    factoryId: fid,
    role: input.role,
    isActive: true,
    createdAt: now,
  }));

  return {
    ok: true,
    nextState: {
      ...state,
      profiles: nextProfiles,
      memberships: [...otherMemberships, ...nextUserMemberships],
      auditLogs: [
        {
          id: makeId('aud'),
          userId: actorUserId,
          factoryId: assignedFactories[0] ?? null,
          action: 'UPDATE_USER',
          tableName: 'profiles',
          recordId: targetUserId,
          summary: `Updated account ${fullName} (${email}) as ${input.role}.`,
          createdAt: now,
        },
        ...state.auditLogs,
      ],
    },
  };
}

export function deleteUserAccount(
  state: ErpState,
  actorUserId: string,
  targetUserId: string
): { ok: boolean; nextState: ErpState; error?: string } {
  if (!isSuperAdmin(state, actorUserId)) {
    return { ok: false, nextState: state, error: 'Only Super Admin can delete accounts.' };
  }
  if (actorUserId === targetUserId) {
    return { ok: false, nextState: state, error: 'You cannot delete your own currently active Super Admin account.' };
  }
  const existing = state.profiles.find((p) => p.id === targetUserId);
  if (!existing) {
    return { ok: false, nextState: state, error: 'User account not found.' };
  }

  const now = new Date().toISOString();
  return {
    ok: true,
    nextState: {
      ...state,
      profiles: state.profiles.filter((p) => p.id !== targetUserId),
      memberships: state.memberships.filter((m) => m.userId !== targetUserId),
      auditLogs: [
        {
          id: makeId('aud'),
          userId: actorUserId,
          factoryId: null,
          action: 'DELETE_USER',
          tableName: 'profiles',
          recordId: targetUserId,
          summary: `Deleted user account ${existing.fullName} (${existing.email}).`,
          createdAt: now,
        },
        ...state.auditLogs,
      ],
    },
  };
}

