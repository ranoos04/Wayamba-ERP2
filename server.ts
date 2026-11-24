import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { createSeedState } from './src/domain/seedData.ts';
import {
  approveTransaction,
  calculateProductionValue,
  createProductRecord,
  createTransferReceiptTransaction,
  createUserAccount,
  deleteProductRecord,
  deleteUserAccount,
  getAvailableStock,
  hasFactoryAccess,
  isSuperAdmin,
  rejectTransaction,
  round2,
  round3,
  updateProductRecord,
  updateUserAccount,
} from './src/domain/stockEngine.ts';
import type {
  AppRole,
  DocumentRecord,
  ErpState,
  Factory,
  Machine,
  Product,
  RawMaterial,
  StockCountLine,
  StockTransaction,
  StockTransactionLine,
} from './src/domain/types.ts';

const PORT = 3000;
const DATA_DIR = path.resolve(process.cwd(), '.data');
const DATA_FILE = path.join(DATA_DIR, 'wayamba-erp.json');

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function loadState(): ErpState {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as ErpState;
      if (parsed && Array.isArray(parsed.factories) && Array.isArray(parsed.transactions)) {
        if (parsed.settings && typeof parsed.settings.stockOnlyMode !== 'boolean') {
          parsed.settings.stockOnlyMode = true;
        }
        return parsed;
      }
    }
  } catch (err) {
    console.error('Failed to load persisted ERP state, using seed data:', err);
  }
  const initial = createSeedState();
  saveState(initial);
  return initial;
}

function saveState(state: ErpState): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

function nextSequenceNumber(state: ErpState, prefix: string): string {
  let maxNum = 100;
  for (const t of state.transactions) {
    if (t.transactionNumber.startsWith(`${prefix}-`)) {
      const suffix = Number(t.transactionNumber.slice(prefix.length + 1));
      if (Number.isFinite(suffix) && suffix > maxNum) {
        maxNum = suffix;
      }
    }
  }
  return `${prefix}-${String(maxNum + 1).padStart(3, '0')}`;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  let state: ErpState = loadState();

  // API: Full ERP State
  app.get('/api/state', (_req, res) => {
    res.json(state);
  });

  // API: Employee Login
  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }
    const normalized = email.trim().toLowerCase();
    const user = state.profiles.find(
      (p) => p.email.toLowerCase() === normalized && p.isActive
    );
    if (!user || user.passwordHash !== password) {
      res.status(401).json({ error: 'Invalid employee credentials or inactive account.' });
      return;
    }
    res.json({ user });
  });

  // API: Create Production Order (Draft or Submitted)
  app.post('/api/transactions/production', (req, res) => {
    const body = req.body as {
      userId: string;
      factoryId: string;
      productionDate: string;
      shiftId: string;
      machineId: string;
      operatorIds: string[];
      outputs: Array<{ productId: string; quantity: number; sellingPrice: number }>;
      consumptions: Array<{ materialId: string; quantity: number }>;
      remarks?: string;
      submitNow?: boolean;
    };

    if (!body.userId || !body.factoryId || !body.machineId || !body.shiftId) {
      res.status(400).json({ error: 'Factory, machine, shift, and user are required.' });
      return;
    }
    if (!hasFactoryAccess(state, body.userId, body.factoryId)) {
      res.status(403).json({ error: 'User does not have access to this factory.' });
      return;
    }
    const machine = state.machines.find(
      (m) => m.id === body.machineId && m.factoryId === body.factoryId
    );
    if (!machine) {
      res.status(400).json({ error: 'Selected machine does not belong to the chosen factory.' });
      return;
    }
    if (!body.outputs || body.outputs.length === 0 || body.outputs.some((o) => o.quantity <= 0)) {
      res.status(400).json({ error: 'At least one output product with quantity > 0 is required.' });
      return;
    }
    if (!body.operatorIds || body.operatorIds.length === 0) {
      res.status(400).json({ error: 'Please assign at least one production operator.' });
      return;
    }

    const factory = state.factories.find((f) => f.id === body.factoryId)!;
    const now = new Date().toISOString();
    const txId = makeId('tx');
    const poId = makeId('po');
    const txNum = nextSequenceNumber(state, `PR-${factory.factoryCode}`);

    const newTx: StockTransaction = {
      id: txId,
      transactionNumber: txNum,
      factoryId: body.factoryId,
      transactionType: 'production',
      status: body.submitNow ? 'submitted' : 'draft',
      transactionDate: body.productionDate,
      referenceNumber: `${body.shiftId === 'shift-day' ? 'DAY' : 'NIGHT'}-${machine.machineCode}`,
      customerId: null,
      supplierId: null,
      createdBy: body.userId,
      submittedAt: body.submitNow ? now : null,
      approvedBy: null,
      approvedAt: null,
      remarks: body.remarks || '',
      createdAt: now,
    };

    const newLines: StockTransactionLine[] = [];
    const newProdLines = body.outputs.map((out) => {
      const price = Number.isFinite(out.sellingPrice) ? out.sellingPrice : 0;
      const val = calculateProductionValue(out.quantity, price);
      newLines.push({
        id: makeId('txl'),
        transactionId: txId,
        productId: out.productId,
        materialId: null,
        direction: 'in',
        quantity: round3(out.quantity),
        unitPrice: round2(price),
        totalValue: val,
        remarks: 'Production finished output',
      });
      return {
        id: makeId('pl'),
        productionId: poId,
        productId: out.productId,
        quantity: round3(out.quantity),
        sellingPrice: round2(price),
        productionValue: val,
      };
    });

    const newConsumptions = (body.consumptions || [])
      .filter((c) => c.quantity > 0)
      .map((c) => {
        const mat = state.rawMaterials.find((m) => m.id === c.materialId);
        const unitCost = mat?.weightedAvgCost ?? 0;
        newLines.push({
          id: makeId('txl'),
          transactionId: txId,
          productId: null,
          materialId: c.materialId,
          direction: 'out',
          quantity: round3(c.quantity),
          unitPrice: unitCost,
          totalValue: round2(c.quantity * unitCost),
          remarks: 'Production raw material consumption',
        });
        return {
          id: makeId('mc'),
          productionId: poId,
          materialId: c.materialId,
          quantity: round3(c.quantity),
          unitCost,
        };
      });

    const newOps = body.operatorIds.map((opId, idx) => ({
      id: makeId('pop'),
      productionId: poId,
      operatorId: opId,
      operatorRole: idx === 0 ? 'Lead Operator' : 'Assistant Operator',
    }));

    state = {
      ...state,
      transactions: [newTx, ...state.transactions],
      transactionLines: [...newLines, ...state.transactionLines],
      productionOrders: [
        {
          id: poId,
          transactionId: txId,
          machineId: body.machineId,
          shiftId: body.shiftId,
          productionDate: body.productionDate,
          remarks: body.remarks || '',
        },
        ...state.productionOrders,
      ],
      productionLines: [...newProdLines, ...state.productionLines],
      productionOperators: [...newOps, ...state.productionOperators],
      materialConsumptions: [...newConsumptions, ...state.materialConsumptions],
      auditLogs: [
        {
          id: makeId('aud'),
          userId: body.userId,
          factoryId: body.factoryId,
          action: body.submitNow ? 'SUBMIT_PRODUCTION' : 'CREATE_PRODUCTION_DRAFT',
          tableName: 'production_orders',
          recordId: poId,
          summary: `${body.submitNow ? 'Submitted' : 'Saved draft'} production ${txNum} on ${machine.machineCode}.`,
          createdAt: now,
        },
        ...state.auditLogs,
      ],
    };

    saveState(state);
    res.json({ state, transactionId: txId });
  });

  // API: Create Raw Material Receipt (Supplier / Opening)
  app.post('/api/transactions/receipt', (req, res) => {
    const body = req.body as {
      userId: string;
      factoryId: string;
      supplierId: string;
      materialId: string;
      quantity: number;
      unitCost: number;
      receiptDate: string;
      referenceNumber: string;
      remarks?: string;
      document?: {
        fileName: string;
        mimeType: string;
        fileSizeBytes: number;
        documentType: DocumentRecord['documentType'];
        previewDataUrl?: string;
      };
    };

    if (!body.userId || !body.factoryId || !body.supplierId || !body.materialId || body.quantity <= 0) {
      res.status(400).json({ error: 'Supplier, material, factory, and quantity > 0 are required.' });
      return;
    }
    if (!hasFactoryAccess(state, body.userId, body.factoryId)) {
      res.status(403).json({ error: 'Access denied for this factory.' });
      return;
    }

    const factory = state.factories.find((f) => f.id === body.factoryId)!;
    const now = new Date().toISOString();
    const txId = makeId('tx');
    const txNum = nextSequenceNumber(state, `GRN-${factory.factoryCode}`);

    const newTx: StockTransaction = {
      id: txId,
      transactionNumber: txNum,
      factoryId: body.factoryId,
      transactionType: 'raw_receipt',
      status: 'submitted',
      transactionDate: body.receiptDate,
      referenceNumber: body.referenceNumber || `SUP-${Date.now().toString().slice(-4)}`,
      customerId: null,
      supplierId: body.supplierId,
      createdBy: body.userId,
      submittedAt: now,
      approvedBy: null,
      approvedAt: null,
      remarks: body.remarks || '',
      createdAt: now,
    };

    const unitCost = Number.isFinite(body.unitCost) ? body.unitCost : 0;
    const newLine: StockTransactionLine = {
      id: makeId('txl'),
      transactionId: txId,
      productId: null,
      materialId: body.materialId,
      direction: 'in',
      quantity: round3(body.quantity),
      unitPrice: round2(unitCost),
      totalValue: round2(body.quantity * unitCost),
      remarks: 'Supplier raw material receipt',
    };

    const docs = [...state.documents];
    if (body.document) {
      docs.unshift({
        id: makeId('doc'),
        transactionId: txId,
        filePath: `${body.factoryId}/${txId}/${body.document.fileName}`,
        fileName: body.document.fileName,
        mimeType: body.document.mimeType,
        documentType: body.document.documentType,
        fileSizeBytes: body.document.fileSizeBytes,
        previewDataUrl: body.document.previewDataUrl,
        uploadedBy: body.userId,
        uploadedAt: now,
      });
    }

    state = {
      ...state,
      transactions: [newTx, ...state.transactions],
      transactionLines: [newLine, ...state.transactionLines],
      documents: docs,
      auditLogs: [
        {
          id: makeId('aud'),
          userId: body.userId,
          factoryId: body.factoryId,
          action: 'SUBMIT_RAW_RECEIPT',
          tableName: 'stock_transactions',
          recordId: txId,
          summary: `Submitted GRN ${txNum} for ${body.quantity} kg.`,
          createdAt: now,
        },
        ...state.auditLogs,
      ],
    };

    saveState(state);
    res.json({ state, transactionId: txId });
  });

  // API: Create Customer Dispatch
  app.post('/api/transactions/dispatch', (req, res) => {
    const body = req.body as {
      userId: string;
      factoryId: string;
      customerId: string;
      dispatchDate: string;
      vehicleNumber: string;
      deliveryNote: string;
      invoiceNumber: string;
      productId: string;
      quantity: number;
      unitPrice: number;
      remarks?: string;
      document?: {
        fileName: string;
        mimeType: string;
        fileSizeBytes: number;
        documentType: DocumentRecord['documentType'];
        previewDataUrl?: string;
      };
    };

    if (!body.userId || !body.factoryId || !body.customerId || !body.productId || body.quantity <= 0) {
      res.status(400).json({ error: 'Customer, product, factory, and quantity > 0 are required.' });
      return;
    }
    if (!hasFactoryAccess(state, body.userId, body.factoryId)) {
      res.status(403).json({ error: 'Access denied for this factory.' });
      return;
    }
    if (state.settings.requireDispatchDocument && !body.document) {
      res.status(400).json({ error: 'Customer bill or delivery note attachment is required.' });
      return;
    }

    const available = getAvailableStock(state.balances, body.factoryId, 'product', body.productId);
    if (body.quantity > available) {
      res.status(400).json({
        error: `Dispatch quantity (${body.quantity}) exceeds available stock (${available}).`,
      });
      return;
    }

    const factory = state.factories.find((f) => f.id === body.factoryId)!;
    const now = new Date().toISOString();
    const txId = makeId('tx');
    const txNum = nextSequenceNumber(state, `DS-${factory.factoryCode}`);

    const newTx: StockTransaction = {
      id: txId,
      transactionNumber: txNum,
      factoryId: body.factoryId,
      transactionType: 'dispatch',
      status: 'submitted',
      transactionDate: body.dispatchDate,
      referenceNumber: body.invoiceNumber || body.deliveryNote || txNum,
      customerId: body.customerId,
      supplierId: null,
      createdBy: body.userId,
      submittedAt: now,
      approvedBy: null,
      approvedAt: null,
      remarks: body.remarks || '',
      createdAt: now,
    };

    const dispPrice = Number.isFinite(body.unitPrice) ? body.unitPrice : 0;
    const newLine: StockTransactionLine = {
      id: makeId('txl'),
      transactionId: txId,
      productId: body.productId,
      materialId: null,
      direction: 'out',
      quantity: round3(body.quantity),
      unitPrice: round2(dispPrice),
      totalValue: round2(body.quantity * dispPrice),
      remarks: `Customer dispatch ${body.deliveryNote || txNum}`.trim(),
    };

    const docs = [...state.documents];
    if (body.document) {
      docs.unshift({
        id: makeId('doc'),
        transactionId: txId,
        filePath: `${body.factoryId}/${txId}/${body.document.fileName}`,
        fileName: body.document.fileName,
        mimeType: body.document.mimeType,
        documentType: body.document.documentType,
        fileSizeBytes: body.document.fileSizeBytes,
        previewDataUrl: body.document.previewDataUrl,
        uploadedBy: body.userId,
        uploadedAt: now,
      });
    }

    state = {
      ...state,
      transactions: [newTx, ...state.transactions],
      transactionLines: [newLine, ...state.transactionLines],
      dispatches: [
        {
          id: makeId('dsp'),
          transactionId: txId,
          customerId: body.customerId,
          dispatchDate: body.dispatchDate,
          vehicleNumber: body.vehicleNumber || '',
          deliveryNote: body.deliveryNote || '',
        },
        ...state.dispatches,
      ],
      documents: docs,
      auditLogs: [
        {
          id: makeId('aud'),
          userId: body.userId,
          factoryId: body.factoryId,
          action: 'SUBMIT_DISPATCH',
          tableName: 'dispatches',
          recordId: txId,
          summary: `Submitted dispatch ${txNum} (${body.quantity} units).`,
          createdAt: now,
        },
        ...state.auditLogs,
      ],
    };

    saveState(state);
    res.json({ state, transactionId: txId });
  });

  // API: Submit Draft Transaction
  app.post('/api/transactions/:id/submit', (req, res) => {
    const { id } = req.params;
    const { userId } = req.body as { userId: string };
    const tx = state.transactions.find((t) => t.id === id);
    if (!tx) {
      res.status(404).json({ error: 'Transaction not found.' });
      return;
    }
    if (tx.status !== 'draft') {
      res.status(400).json({ error: 'Only draft transactions can be submitted.' });
      return;
    }
    const now = new Date().toISOString();
    state = {
      ...state,
      transactions: state.transactions.map((t) =>
        t.id === id ? { ...t, status: 'submitted', submittedAt: now } : t
      ),
      auditLogs: [
        {
          id: makeId('aud'),
          userId,
          factoryId: tx.factoryId,
          action: 'SUBMIT_TRANSACTION',
          tableName: 'stock_transactions',
          recordId: id,
          summary: `Submitted ${tx.transactionNumber} for manager approval.`,
          createdAt: now,
        },
        ...state.auditLogs,
      ],
    };
    saveState(state);
    res.json({ state });
  });

  // API: Attach Document to Existing Transaction
  app.post('/api/transactions/:id/documents', (req, res) => {
    const { id } = req.params;
    const body = req.body as {
      userId: string;
      fileName: string;
      mimeType: string;
      fileSizeBytes: number;
      documentType: DocumentRecord['documentType'];
      previewDataUrl?: string;
    };
    const tx = state.transactions.find((t) => t.id === id);
    if (!tx) {
      res.status(404).json({ error: 'Transaction not found.' });
      return;
    }
    const allowedMimes = ['application/pdf', 'image/jpeg', 'image/png'];
    if (!allowedMimes.includes(body.mimeType)) {
      res.status(400).json({ error: 'Only PDF, JPG, and PNG documents are permitted.' });
      return;
    }
    const now = new Date().toISOString();
    const doc: DocumentRecord = {
      id: makeId('doc'),
      transactionId: id,
      filePath: `${tx.factoryId}/${id}/${body.fileName}`,
      fileName: body.fileName,
      mimeType: body.mimeType,
      documentType: body.documentType,
      fileSizeBytes: body.fileSizeBytes,
      previewDataUrl: body.previewDataUrl,
      uploadedBy: body.userId,
      uploadedAt: now,
    };
    state = {
      ...state,
      documents: [doc, ...state.documents],
      auditLogs: [
        {
          id: makeId('aud'),
          userId: body.userId,
          factoryId: tx.factoryId,
          action: 'UPLOAD_DOCUMENT',
          tableName: 'documents',
          recordId: doc.id,
          summary: `Attached ${body.documentType} (${body.fileName}) to ${tx.transactionNumber}.`,
          createdAt: now,
        },
        ...state.auditLogs,
      ],
    };
    saveState(state);
    res.json({ state, document: doc });
  });

  // API: Approve Transaction (Atomic Stock Engine)
  app.post('/api/transactions/:id/approve', (req, res) => {
    const { id } = req.params;
    const { userId, remarks } = req.body as { userId: string; remarks?: string };
    const result = approveTransaction(state, id, userId, remarks);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    state = result.nextState;
    saveState(state);
    res.json({ state });
  });

  // API: Reject Transaction
  app.post('/api/transactions/:id/reject', (req, res) => {
    const { id } = req.params;
    const { userId, remarks } = req.body as { userId: string; remarks: string };
    const result = rejectTransaction(state, id, userId, remarks || '');
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    state = result.nextState;
    saveState(state);
    res.json({ state });
  });

  // API: Create Inter-Factory Transfer
  app.post('/api/transfers', (req, res) => {
    const body = req.body as {
      userId: string;
      fromFactory: string;
      toFactory: string;
      materialId: string;
      sentQuantity: number;
      remarks?: string;
      document?: {
        fileName: string;
        mimeType: string;
        fileSizeBytes: number;
        documentType: DocumentRecord['documentType'];
        previewDataUrl?: string;
      };
    };

    if (!body.fromFactory || !body.toFactory || body.fromFactory === body.toFactory) {
      res.status(400).json({ error: 'Source and destination factories must be distinct.' });
      return;
    }
    if (!hasFactoryAccess(state, body.userId, body.fromFactory)) {
      res.status(403).json({ error: 'No access to source factory.' });
      return;
    }
    if (body.sentQuantity <= 0) {
      res.status(400).json({ error: 'Transfer quantity must be greater than zero.' });
      return;
    }

    const available = getAvailableStock(
      state.balances,
      body.fromFactory,
      'material',
      body.materialId
    );
    if (body.sentQuantity > available) {
      res.status(400).json({
        error: `Transfer quantity (${body.sentQuantity} kg) exceeds available stock (${available} kg).`,
      });
      return;
    }

    const fromFac = state.factories.find((f) => f.id === body.fromFactory)!;
    const toFac = state.factories.find((f) => f.id === body.toFactory)!;
    const mat = state.rawMaterials.find((m) => m.id === body.materialId)!;
    const now = new Date().toISOString();
    const today = now.slice(0, 10);
    const txId = makeId('tx');
    const trId = makeId('tr');
    const transferNumber = `TR-${fromFac.factoryCode}-${toFac.factoryCode}-${String(100 + state.transfers.length).padStart(3, '0')}`;
    const txNum = nextSequenceNumber(state, `TO-${fromFac.factoryCode}`);

    const newTx: StockTransaction = {
      id: txId,
      transactionNumber: txNum,
      factoryId: body.fromFactory,
      transactionType: 'transfer_out',
      status: 'submitted',
      transactionDate: today,
      referenceNumber: transferNumber,
      customerId: null,
      supplierId: null,
      createdBy: body.userId,
      submittedAt: now,
      approvedBy: null,
      approvedAt: null,
      remarks: body.remarks || `Inter-factory transfer to ${toFac.factoryName}`,
      createdAt: now,
    };

    const newLine: StockTransactionLine = {
      id: makeId('txl'),
      transactionId: txId,
      productId: null,
      materialId: body.materialId,
      direction: 'out',
      quantity: round3(body.sentQuantity),
      unitPrice: mat.weightedAvgCost,
      totalValue: round2(body.sentQuantity * mat.weightedAvgCost),
      remarks: `Transfer out to ${toFac.factoryCode}`,
    };

    const docs = [...state.documents];
    if (body.document) {
      docs.unshift({
        id: makeId('doc'),
        transactionId: txId,
        filePath: `${body.fromFactory}/${txId}/${body.document.fileName}`,
        fileName: body.document.fileName,
        mimeType: body.document.mimeType,
        documentType: body.document.documentType,
        fileSizeBytes: body.document.fileSizeBytes,
        previewDataUrl: body.document.previewDataUrl,
        uploadedBy: body.userId,
        uploadedAt: now,
      });
    }

    state = {
      ...state,
      transactions: [newTx, ...state.transactions],
      transactionLines: [newLine, ...state.transactionLines],
      documents: docs,
      transfers: [
        {
          id: trId,
          transferNumber,
          fromFactory: body.fromFactory,
          toFactory: body.toFactory,
          materialId: body.materialId,
          sentQuantity: round3(body.sentQuantity),
          unitCost: mat.weightedAvgCost,
          transferOutTransactionId: txId,
          transferInTransactionId: null,
          transferStatus: 'submitted',
          createdBy: body.userId,
          createdAt: now,
        },
        ...state.transfers,
      ],
      auditLogs: [
        {
          id: makeId('aud'),
          userId: body.userId,
          factoryId: body.fromFactory,
          action: 'CREATE_TRANSFER',
          tableName: 'transfers',
          recordId: trId,
          summary: `Created transfer ${transferNumber} (${body.sentQuantity} kg ${mat.materialCode}) to ${toFac.factoryCode}.`,
          createdAt: now,
        },
        ...state.auditLogs,
      ],
    };

    saveState(state);
    res.json({ state, transferId: trId });
  });

  // API: Receive Inter-Factory Transfer (Actual Quantity & Discrepancy Logging)
  app.post('/api/transfers/:id/receive', (req, res) => {
    const { id } = req.params;
    const { userId, actualQuantity, remarks } = req.body as {
      userId: string;
      actualQuantity: number;
      remarks?: string;
    };
    const result = createTransferReceiptTransaction(
      state,
      id,
      userId,
      Number(actualQuantity),
      remarks || ''
    );
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    state = result.nextState;
    saveState(state);
    res.json({ state, discrepancy: result.discrepancy });
  });

  // API: Physical Stock Count & Variance Adjustment
  app.post('/api/stock-counts', (req, res) => {
    const body = req.body as {
      userId: string;
      factoryId: string;
      countDate: string;
      remarks?: string;
      lines: Array<{
        productId: string | null;
        materialId: string | null;
        actualQuantity: number;
      }>;
    };

    if (!hasFactoryAccess(state, body.userId, body.factoryId)) {
      res.status(403).json({ error: 'Access denied for this factory.' });
      return;
    }

    const now = new Date().toISOString();
    const scId = makeId('sc');
    const countLines: StockCountLine[] = body.lines.map((l) => {
      const kind = l.productId ? 'product' : 'material';
      const itemId = (l.productId ?? l.materialId)!;
      const sysQty = getAvailableStock(state.balances, body.factoryId, kind, itemId);
      return {
        id: makeId('scl'),
        stockCountId: scId,
        productId: l.productId,
        materialId: l.materialId,
        systemQuantity: sysQty,
        actualQuantity: round3(l.actualQuantity),
        variance: round3(l.actualQuantity - sysQty),
      };
    });

    const varianceLines = countLines.filter((l) => Math.abs(l.variance) > 0.0001);
    const factory = state.factories.find((f) => f.id === body.factoryId)!;
    const newTransactions = [...state.transactions];
    const newTxLines = [...state.transactionLines];

    if (varianceLines.length > 0) {
      const txId = makeId('tx');
      const txNum = nextSequenceNumber(state, `ADJ-${factory.factoryCode}`);
      newTransactions.unshift({
        id: txId,
        transactionNumber: txNum,
        factoryId: body.factoryId,
        transactionType: 'adjustment',
        status: 'submitted',
        transactionDate: body.countDate,
        referenceNumber: `COUNT-${body.countDate}`,
        customerId: null,
        supplierId: null,
        createdBy: body.userId,
        submittedAt: now,
        approvedBy: null,
        approvedAt: null,
        remarks: body.remarks || 'Physical stocktaking variance adjustment',
        createdAt: now,
      });

      for (const vl of varianceLines) {
        const unitPrice = vl.materialId
          ? state.rawMaterials.find((m) => m.id === vl.materialId)?.weightedAvgCost ?? 0
          : 0;
        newTxLines.unshift({
          id: makeId('txl'),
          transactionId: txId,
          productId: vl.productId,
          materialId: vl.materialId,
          direction: vl.variance > 0 ? 'in' : 'out',
          quantity: Math.abs(vl.variance),
          unitPrice,
          totalValue: round2(Math.abs(vl.variance) * unitPrice),
          remarks: `Stock count variance: system ${vl.systemQuantity}, actual ${vl.actualQuantity}`,
        });
      }
    }

    state = {
      ...state,
      transactions: newTransactions,
      transactionLines: newTxLines,
      stockCounts: [
        {
          id: scId,
          factoryId: body.factoryId,
          countDate: body.countDate,
          status: 'posted',
          countedBy: body.userId,
          remarks: body.remarks || '',
          createdAt: now,
        },
        ...state.stockCounts,
      ],
      stockCountLines: [...countLines, ...state.stockCountLines],
      auditLogs: [
        {
          id: makeId('aud'),
          userId: body.userId,
          factoryId: body.factoryId,
          action: 'RECORD_STOCK_COUNT',
          tableName: 'stock_counts',
          recordId: scId,
          summary: `Recorded physical stock count for ${factory.factoryCode} (${varianceLines.length} variance item(s)).`,
          createdAt: now,
        },
        ...state.auditLogs,
      ],
    };

    saveState(state);
    res.json({ state, varianceCount: varianceLines.length });
  });

  // API: Master Data — Add Factory
  app.post('/api/master/factories', (req, res) => {
    const { userId, factoryCode, factoryName, address } = req.body as {
      userId: string;
      factoryCode: string;
      factoryName: string;
      address: string;
    };
    if (!isSuperAdmin(state, userId)) {
      res.status(403).json({ error: 'Only Super Admin can create factories.' });
      return;
    }
    if (!factoryCode.trim() || !factoryName.trim()) {
      res.status(400).json({ error: 'Factory code and name are required.' });
      return;
    }
    const now = new Date().toISOString();
    const newFac: Factory = {
      id: makeId('fac'),
      factoryCode: factoryCode.trim().toUpperCase(),
      factoryName: factoryName.trim(),
      address: address.trim(),
      isActive: true,
      createdAt: now,
    };
    state = {
      ...state,
      factories: [...state.factories, newFac],
      auditLogs: [
        {
          id: makeId('aud'),
          userId,
          factoryId: newFac.id,
          action: 'CREATE_FACTORY',
          tableName: 'factories',
          recordId: newFac.id,
          summary: `Added factory ${newFac.factoryCode} – ${newFac.factoryName}.`,
          createdAt: now,
        },
        ...state.auditLogs,
      ],
    };
    saveState(state);
    res.json({ state });
  });

  // API: Master Data — Update Selling Price (Appends Price History, preserves past orders)
  app.post('/api/master/prices', (req, res) => {
    const { userId, productId, factoryId, sellingPrice, effectiveFrom } = req.body as {
      userId: string;
      productId: string;
      factoryId: string | null;
      sellingPrice: number;
      effectiveFrom: string;
    };
    if (!isSuperAdmin(state, userId)) {
      res.status(403).json({ error: 'Only Super Admin can update selling price history.' });
      return;
    }
    if (sellingPrice < 0) {
      res.status(400).json({ error: 'Selling price must be non-negative.' });
      return;
    }
    const now = new Date().toISOString();
    const prod = state.products.find((p) => p.id === productId);
    const entryId = makeId('ph');
    state = {
      ...state,
      priceHistory: [
        {
          id: entryId,
          productId,
          factoryId: factoryId || null,
          sellingPrice: round2(sellingPrice),
          effectiveFrom,
          effectiveTo: null,
          createdBy: userId,
          createdAt: now,
        },
        ...state.priceHistory,
      ],
      auditLogs: [
        {
          id: makeId('aud'),
          userId,
          factoryId: factoryId || null,
          action: 'UPDATE_SELLING_PRICE',
          tableName: 'price_history',
          recordId: entryId,
          summary: `Updated selling price for ${prod?.productName ?? productId} to Rs. ${sellingPrice} effective ${effectiveFrom}.`,
          createdAt: now,
        },
        ...state.auditLogs,
      ],
    };
    saveState(state);
    res.json({ state });
  });

  // API: Master Data — Add Machine, Customer, Supplier, Product, Material, or User
  app.post('/api/master/entities', (req, res) => {
    const body = req.body as {
      userId: string;
      entityType: 'machine' | 'customer' | 'supplier' | 'product' | 'material' | 'user';
      payload: Record<string, unknown>;
    };
    if (!isSuperAdmin(state, body.userId)) {
      res.status(403).json({ error: 'Only Super Admin can manage master records.' });
      return;
    }

    const now = new Date().toISOString();
    const p = body.payload;

    if (body.entityType === 'machine') {
      const mac: Machine = {
        id: makeId('mac'),
        factoryId: String(p.factoryId),
        machineCode: String(p.machineCode).toUpperCase(),
        machineName: String(p.machineName),
        machineType: String(p.machineType || 'Extrusion'),
        isActive: true,
      };
      state = { ...state, machines: [...state.machines, mac] };
    } else if (body.entityType === 'customer') {
      state = {
        ...state,
        customers: [
          ...state.customers,
          {
            id: makeId('cust'),
            customerCode: String(p.customerCode).toUpperCase(),
            customerName: String(p.customerName),
            phone: String(p.phone || ''),
            address: String(p.address || ''),
            isActive: true,
          },
        ],
      };
    } else if (body.entityType === 'supplier') {
      state = {
        ...state,
        suppliers: [
          ...state.suppliers,
          {
            id: makeId('sup'),
            supplierCode: String(p.supplierCode).toUpperCase(),
            supplierName: String(p.supplierName),
            phone: String(p.phone || ''),
            address: String(p.address || ''),
            isActive: true,
          },
        ],
      };
    } else if (body.entityType === 'product') {
      const prod: Product = {
        id: makeId('prod'),
        productCode: String(p.productCode).toUpperCase(),
        productName: String(p.productName),
        productCategory: (p.productCategory as Product['productCategory']) || 'PP Pellets',
        unitCode: (p.unitCode as Product['unitCode']) || 'KG',
        isActive: true,
        createdAt: now,
      };
      state = {
        ...state,
        products: [...state.products, prod],
        priceHistory: [
          {
            id: makeId('ph'),
            productId: prod.id,
            factoryId: null,
            sellingPrice: Number(p.sellingPrice || 300),
            effectiveFrom: now.slice(0, 10),
            effectiveTo: null,
            createdBy: body.userId,
            createdAt: now,
          },
          ...state.priceHistory,
        ],
      };
    } else if (body.entityType === 'material') {
      const mat: RawMaterial = {
        id: makeId('mat'),
        materialCode: String(p.materialCode).toUpperCase(),
        materialName: String(p.materialName),
        unitCode: 'KG',
        weightedAvgCost: Number(p.weightedAvgCost || 200),
        reorderLevel: Number(p.reorderLevel || 2000),
        isActive: true,
      };
      state = { ...state, rawMaterials: [...state.rawMaterials, mat] };
    } else if (body.entityType === 'user') {
      const uid = makeId('u');
      state = {
        ...state,
        profiles: [
          ...state.profiles,
          {
            id: uid,
            fullName: String(p.fullName),
            email: String(p.email).toLowerCase(),
            phone: String(p.phone || ''),
            passwordHash: String(p.password || 'wayamba123'),
            isActive: true,
            createdAt: now,
          },
        ],
        memberships: [
          ...state.memberships,
          {
            id: makeId('mem'),
            userId: uid,
            factoryId: String(p.factoryId),
            role: p.role as AppRole,
            isActive: true,
            createdAt: now,
          },
        ],
      };
    }

    state = {
      ...state,
      auditLogs: [
        {
          id: makeId('aud'),
          userId: body.userId,
          factoryId: (p.factoryId as string) || null,
          action: `CREATE_${body.entityType.toUpperCase()}`,
          tableName: body.entityType,
          recordId: 'master',
          summary: `Added new ${body.entityType} record.`,
          createdAt: now,
        },
        ...state.auditLogs,
      ],
    };

    saveState(state);
    res.json({ state });
  });

  // API: Products CRUD (Add, Edit, Delete)
  app.post('/api/master/products', (req, res) => {
    const { userId, productCode, productName, productCategory, unitCode } = req.body as {
      userId: string;
      productCode: string;
      productName: string;
      productCategory: string;
      unitCode: 'KG' | 'PCS';
    };
    const result = createProductRecord(state, userId, {
      productCode: productCode || '',
      productName: productName || '',
      productCategory: productCategory || 'PP Pellets',
      unitCode: unitCode || 'KG',
    });
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    state = result.nextState;
    saveState(state);
    res.json({ state, product: result.product });
  });

  app.put('/api/master/products/:id', (req, res) => {
    const { id } = req.params;
    const { userId, productCode, productName, productCategory, unitCode, isActive } = req.body as {
      userId: string;
      productCode: string;
      productName: string;
      productCategory: string;
      unitCode: 'KG' | 'PCS';
      isActive?: boolean;
    };
    const result = updateProductRecord(state, userId, id, {
      productCode: productCode || '',
      productName: productName || '',
      productCategory: productCategory || 'PP Pellets',
      unitCode: unitCode || 'KG',
      isActive,
    });
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    state = result.nextState;
    saveState(state);
    res.json({ state });
  });

  app.delete('/api/master/products/:id', (req, res) => {
    const { id } = req.params;
    const userId = String((req.body as { userId?: string })?.userId || req.query.userId || '');
    const result = deleteProductRecord(state, userId, id);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    state = result.nextState;
    saveState(state);
    res.json({ state });
  });

  // API: Users & Roles CRUD (Add, Edit, Delete)
  app.post('/api/master/users', (req, res) => {
    const { userId, fullName, email, phone, password, factoryIds, factoryId, role } = req.body as {
      userId: string;
      fullName: string;
      email: string;
      phone?: string;
      password?: string;
      factoryIds?: string[];
      factoryId?: string;
      role: AppRole;
    };
    const resolvedFactories =
      Array.isArray(factoryIds) && factoryIds.length > 0
        ? factoryIds
        : factoryId
        ? [factoryId]
        : state.factories[0]?.id
        ? [state.factories[0].id]
        : [];
    const result = createUserAccount(state, userId, {
      fullName: fullName || '',
      email: email || '',
      phone,
      password,
      factoryIds: resolvedFactories,
      role: role || 'operator',
    });
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    state = result.nextState;
    saveState(state);
    res.json({ state, createdUserId: result.userId });
  });

  app.put('/api/master/users/:id', (req, res) => {
    const { id } = req.params;
    const { userId, fullName, email, phone, password, factoryIds, factoryId, role, isActive } =
      req.body as {
        userId: string;
        fullName: string;
        email: string;
        phone?: string;
        password?: string;
        factoryIds?: string[];
        factoryId?: string;
        role: AppRole;
        isActive?: boolean;
      };
    const resolvedFactories =
      Array.isArray(factoryIds) && factoryIds.length > 0
        ? factoryIds
        : factoryId
        ? [factoryId]
        : state.factories[0]?.id
        ? [state.factories[0].id]
        : [];
    const result = updateUserAccount(state, userId, id, {
      fullName: fullName || '',
      email: email || '',
      phone,
      password,
      factoryIds: resolvedFactories,
      role: role || 'operator',
      isActive,
    });
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    state = result.nextState;
    saveState(state);
    res.json({ state });
  });

  app.delete('/api/master/users/:id', (req, res) => {
    const { id } = req.params;
    const userId = String((req.body as { userId?: string })?.userId || req.query.userId || '');
    const result = deleteUserAccount(state, userId, id);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    state = result.nextState;
    saveState(state);
    res.json({ state });
  });

  // API: Update System Settings
  app.post('/api/settings', (req, res) => {
    const { userId, settings } = req.body as {
      userId: string;
      settings: ErpState['settings'];
    };
    if (!isSuperAdmin(state, userId)) {
      res.status(403).json({ error: 'Only Super Admin can change system settings.' });
      return;
    }
    state = {
      ...state,
      settings,
      auditLogs: [
        {
          id: makeId('aud'),
          userId,
          factoryId: null,
          action: 'UPDATE_SETTINGS',
          tableName: 'settings',
          recordId: 'global',
          summary: `Updated system governance settings (Self-approval block: ${settings.preventSelfApproval ? 'ON' : 'OFF'}).`,
          createdAt: new Date().toISOString(),
        },
        ...state.auditLogs,
      ],
    };
    saveState(state);
    res.json({ state });
  });

  // API: Reset Demo Data
  app.post('/api/reset-demo', (_req, res) => {
    state = createSeedState();
    saveState(state);
    res.json({ state });
  });

  // Vite Dev Middleware or Static Prod Serving
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`WAYAMBA PLASTIC ERP running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Server failed to start:', err);
  process.exit(1);
});
