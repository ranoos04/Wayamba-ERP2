import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeedState } from './seedData.ts';
import {
  approveTransaction,
  calculateFinishedGoodsBridge,
  calculateProductionValue,
  calculateRawMaterialBridge,
  calculateValuationSummary,
  canApproveTransaction,
  createProductRecord,
  createTransferReceiptTransaction,
  createUserAccount,
  deleteProductRecord,
  deleteUserAccount,
  getAvailableStock,
  getEffectiveSellingPrice,
  rejectTransaction,
  updateProductRecord,
  updateUserAccount,
} from './stockEngine.ts';

test('finished goods closing stock formula matches spec example (5000 + 1500 + 1200 - 2000 = 5700)', () => {
  const closing = calculateFinishedGoodsBridge({
    opening: 5000,
    production: 1500 + 1200,
    dispatch: 2000,
  });
  assert.equal(closing, 5700);
});

test('raw material closing stock formula computes receipts, transfers, and consumption', () => {
  const closing = calculateRawMaterialBridge({
    opening: 10000,
    supplierReceipts: 5000,
    factoryReceipts: 2950,
    productionConsumption: 4200,
    factoryTransfersOut: 1500,
    otherIssues: 250,
  });
  assert.equal(closing, 12000);
});

test('production value uses selling price (1500 * 310 = 465000) and separates from cost margin', () => {
  assert.equal(calculateProductionValue(1500, 310), 465000);

  const state = createSeedState();
  const summary = calculateValuationSummary(state, 'fac-01');
  // Day shift: 2500*310 = 775,000; Night shift: 1500*310 + 500*345 = 637,500 => Total 1,412,500
  assert.equal(summary.productionValueAtSellingPrice, 1412500);
  // Material cost: (2450*270 + 100*620) + (2000*185) = 723,500 + 370,000 = 1,093,500
  assert.equal(summary.productionMaterialCost, 1093500);
  assert.equal(summary.grossPotentialMarginEstimate, 319000);
});

test('selling price history respects effective dates and factory scope without mutating past records', () => {
  const state = createSeedState();
  const today = new Date().toISOString().slice(0, 10);
  assert.equal(getEffectiveSellingPrice(state.priceHistory, 'prod-pellet-blk', 'fac-01', today), 310);

  // Add a factory-specific price override effective today
  state.priceHistory.push({
    id: 'ph-override',
    productId: 'prod-pellet-blk',
    factoryId: 'fac-01',
    sellingPrice: 325,
    effectiveFrom: today,
    effectiveTo: null,
    createdBy: 'u-admin',
    createdAt: new Date().toISOString(),
  });
  assert.equal(getEffectiveSellingPrice(state.priceHistory, 'prod-pellet-blk', 'fac-01', today), 325);
  // Historical approved production line remains locked at 310
  assert.equal(state.productionLines[0].sellingPrice, 310);
});

test('self-approval is blocked and cross-factory non-manager approval is blocked', () => {
  const state = createSeedState();
  // tx-prod-f1-pend1 was created by u-sup-1 in fac-01
  const supAttempt = canApproveTransaction(state, 'tx-prod-f1-pend1', 'u-sup-1');
  assert.equal(supAttempt.allowed, false);

  // u-mgr-2 only manages fac-02 and fac-03, NOT fac-01
  const crossFactoryAttempt = canApproveTransaction(state, 'tx-prod-f1-pend1', 'u-mgr-2');
  assert.equal(crossFactoryAttempt.allowed, false);

  // u-mgr-1 is factory_manager of fac-01 and did not create tx-prod-f1-pend1
  const validAttempt = canApproveTransaction(state, 'tx-prod-f1-pend1', 'u-mgr-1');
  assert.equal(validAttempt.allowed, true);
});

test('atomic approval updates balances and ledger; rejection leaves stock unchanged', () => {
  const state = createSeedState();
  const beforePallets = getAvailableStock(state.balances, 'fac-01', 'product', 'prod-pallet-hd');
  const beforeVirgin = getAvailableStock(state.balances, 'fac-01', 'material', 'mat-virgin');

  // Reject first on a copy -> stock stays identical
  const rej = rejectTransaction(state, 'tx-prod-f1-pend1', 'u-mgr-1', 'Recheck mold count');
  assert.equal(rej.ok, true);
  assert.equal(getAvailableStock(rej.nextState.balances, 'fac-01', 'product', 'prod-pallet-hd'), beforePallets);
  assert.equal(rej.nextState.movements.length, state.movements.length);

  // Approve on original state -> +120 PCS pallets, -1800 KG virgin
  const apr = approveTransaction(state, 'tx-prod-f1-pend1', 'u-mgr-1', 'Verified');
  assert.equal(apr.ok, true);
  assert.equal(
    getAvailableStock(apr.nextState.balances, 'fac-01', 'product', 'prod-pallet-hd'),
    beforePallets + 120
  );
  assert.equal(
    getAvailableStock(apr.nextState.balances, 'fac-01', 'material', 'mat-virgin'),
    beforeVirgin - 1800
  );
  assert.equal(apr.nextState.movements.length, state.movements.length + 2);
});

test('dispatch exceeding available stock is blocked at approval', () => {
  const state = createSeedState();
  // Set pending dispatch line quantity above available 320 PCS
  const modifiedLineIdx = state.transactionLines.findIndex((l) => l.transactionId === 'tx-disp-f1-pend1');
  state.transactionLines[modifiedLineIdx] = {
    ...state.transactionLines[modifiedLineIdx],
    quantity: 999,
  };

  const check = canApproveTransaction(state, 'tx-disp-f1-pend1', 'u-mgr-1');
  assert.equal(check.allowed, false);
  assert.match(check.reason ?? '', /Insufficient stock/);
});

test('inter-factory transfer records 50 kg discrepancy and adds actual 2950 kg (not 3000 kg) on approval', () => {
  const state = createSeedState();
  const f1RegrindBefore = getAvailableStock(state.balances, 'fac-01', 'material', 'mat-regrind');

  // tr-1 sent 3,000 kg from F02 to F01 and is currently in_transit
  const receiptRes = createTransferReceiptTransaction(
    state,
    'tr-1',
    'u-str-1',
    2950,
    'Weighbridge ticket shows 50 kg transit moisture/spillage loss'
  );
  assert.equal(receiptRes.ok, true);
  assert.equal(receiptRes.discrepancy, 50);

  // Not yet added to F01 until Manager approves receipt
  assert.equal(
    getAvailableStock(receiptRes.nextState.balances, 'fac-01', 'material', 'mat-regrind'),
    f1RegrindBefore
  );

  const transferInTxId = receiptRes.nextState.transfers.find((t) => t.id === 'tr-1')!
    .transferInTransactionId!;
  const aprRes = approveTransaction(receiptRes.nextState, transferInTxId, 'u-mgr-1', 'Discrepancy logged');
  assert.equal(aprRes.ok, true);

  // Exactly 2,950 kg added to F01
  assert.equal(
    getAvailableStock(aprRes.nextState.balances, 'fac-01', 'material', 'mat-regrind'),
    f1RegrindBefore + 2950
  );
  const updatedTransfer = aprRes.nextState.transfers.find((t) => t.id === 'tr-1')!;
  assert.equal(updatedTransfer.transferStatus, 'discrepancy');
});

test('primary super admin uses user email and defaults to stock-only mode without dispatch bill requirement', () => {
  const state = createSeedState();
  const admin = state.profiles.find((p) => p.id === 'u-admin');
  assert.equal(admin?.email, 'waseemmw6521334@gmail.com');
  assert.equal(state.settings.stockOnlyMode, true);
  assert.equal(state.settings.requireDispatchDocument, false);
});

test('admin can add, edit, and delete products without requiring prices', () => {
  const state = createSeedState();
  const created = createProductRecord(state, 'u-admin', {
    productCode: 'PP-CRATE-50',
    productName: 'PP Heavy Crate 50L',
    productCategory: 'PP Crates',
    unitCode: 'PCS',
  });
  assert.equal(created.ok, true);
  assert.ok(created.product);
  assert.equal(created.nextState.products.length, state.products.length + 1);

  // Duplicate product code is rejected
  const dup = createProductRecord(created.nextState, 'u-admin', {
    productCode: 'pp-crate-50',
    productName: 'Duplicate Crate',
    productCategory: 'PP Crates',
    unitCode: 'PCS',
  });
  assert.equal(dup.ok, false);

  // Edit product
  const edited = updateProductRecord(created.nextState, 'u-admin', created.product!.id, {
    productCode: 'PP-CRATE-60',
    productName: 'PP Export Crate 60L',
    productCategory: 'PP Pallets',
    unitCode: 'PCS',
  });
  assert.equal(edited.ok, true);
  const foundEdited = edited.nextState.products.find((p) => p.id === created.product!.id);
  assert.equal(foundEdited?.productCode, 'PP-CRATE-60');
  assert.equal(foundEdited?.productName, 'PP Export Crate 60L');

  // Delete product
  const deleted = deleteProductRecord(edited.nextState, 'u-admin', created.product!.id);
  assert.equal(deleted.ok, true);
  assert.equal(deleted.nextState.products.some((p) => p.id === created.product!.id), false);
});

test('admin can manually add, edit, and delete operators and other roles', () => {
  const state = createSeedState();
  const addedOp = createUserAccount(state, 'u-admin', {
    fullName: 'Saman Kumara',
    email: 'saman.op@wayambaplastic.lk',
    phone: '+94 77 111 2233',
    password: 'op123',
    factoryIds: ['fac-01', 'fac-03'],
    role: 'operator',
  });
  assert.equal(addedOp.ok, true);
  assert.ok(addedOp.userId);
  assert.equal(
    addedOp.nextState.memberships.filter((m) => m.userId === addedOp.userId && m.role === 'operator').length,
    2
  );

  // Edit operator to production_supervisor
  const edited = updateUserAccount(addedOp.nextState, 'u-admin', addedOp.userId!, {
    fullName: 'Saman Kumara (Lead)',
    email: 'saman.lead@wayambaplastic.lk',
    phone: '+94 77 111 2233',
    factoryIds: ['fac-01'],
    role: 'production_supervisor',
    isActive: true,
  });
  assert.equal(edited.ok, true);
  assert.equal(
    edited.nextState.memberships.find((m) => m.userId === addedOp.userId)?.role,
    'production_supervisor'
  );

  // Cannot self-delete active super admin
  const selfDel = deleteUserAccount(edited.nextState, 'u-admin', 'u-admin');
  assert.equal(selfDel.ok, false);

  // Can delete other user
  const del = deleteUserAccount(edited.nextState, 'u-admin', addedOp.userId!);
  assert.equal(del.ok, true);
  assert.equal(del.nextState.profiles.some((p) => p.id === addedOp.userId), false);
});

