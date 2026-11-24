import type { AppRole, DocumentRecord, ErpState, Profile, UnitCode } from '../domain/types.ts';

async function requestJson<T>(url: string, method: 'POST' | 'PUT' | 'DELETE', body: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Request failed');
  }
  return data as T;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  return requestJson<T>(url, 'POST', body);
}

export async function fetchErpState(): Promise<ErpState> {
  const res = await fetch('/api/state');
  if (!res.ok) throw new Error('Failed to load ERP data');
  return res.json();
}

export async function loginEmployee(email: string, password: string): Promise<Profile> {
  const res = await postJson<{ user: Profile }>('/api/auth/login', { email, password });
  return res.user;
}

export async function createProductionOrder(payload: {
  userId: string;
  factoryId: string;
  productionDate: string;
  shiftId: string;
  machineId: string;
  operatorIds: string[];
  outputs: Array<{ productId: string; quantity: number; sellingPrice?: number }>;
  consumptions: Array<{ materialId: string; quantity: number }>;
  remarks?: string;
  submitNow?: boolean;
}): Promise<{ state: ErpState; transactionId: string }> {
  return postJson('/api/transactions/production', payload);
}

export async function createRawReceipt(payload: {
  userId: string;
  factoryId: string;
  supplierId: string;
  materialId: string;
  quantity: number;
  unitCost?: number;
  receiptDate: string;
  referenceNumber?: string;
  remarks?: string;
  document?: {
    fileName: string;
    mimeType: string;
    fileSizeBytes: number;
    documentType: DocumentRecord['documentType'];
    previewDataUrl?: string;
  };
}): Promise<{ state: ErpState; transactionId: string }> {
  return postJson('/api/transactions/receipt', payload);
}

export async function createCustomerDispatch(payload: {
  userId: string;
  factoryId: string;
  customerId: string;
  dispatchDate: string;
  vehicleNumber?: string;
  deliveryNote?: string;
  invoiceNumber?: string;
  productId: string;
  quantity: number;
  unitPrice?: number;
  remarks?: string;
  document?: {
    fileName: string;
    mimeType: string;
    fileSizeBytes: number;
    documentType: DocumentRecord['documentType'];
    previewDataUrl?: string;
  };
}): Promise<{ state: ErpState; transactionId: string }> {
  return postJson('/api/transactions/dispatch', payload);
}

export async function submitDraftTransaction(
  transactionId: string,
  userId: string
): Promise<{ state: ErpState }> {
  return postJson(`/api/transactions/${transactionId}/submit`, { userId });
}

export async function approveTransactionApi(
  transactionId: string,
  userId: string,
  remarks?: string
): Promise<{ state: ErpState }> {
  return postJson(`/api/transactions/${transactionId}/approve`, { userId, remarks });
}

export async function rejectTransactionApi(
  transactionId: string,
  userId: string,
  remarks: string
): Promise<{ state: ErpState }> {
  return postJson(`/api/transactions/${transactionId}/reject`, { userId, remarks });
}

export async function attachTransactionDocument(
  transactionId: string,
  payload: {
    userId: string;
    fileName: string;
    mimeType: string;
    fileSizeBytes: number;
    documentType: DocumentRecord['documentType'];
    previewDataUrl?: string;
  }
): Promise<{ state: ErpState; document: DocumentRecord }> {
  return postJson(`/api/transactions/${transactionId}/documents`, payload);
}

export async function createInterFactoryTransfer(payload: {
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
}): Promise<{ state: ErpState; transferId: string }> {
  return postJson('/api/transfers', payload);
}

export async function receiveInterFactoryTransfer(
  transferId: string,
  payload: { userId: string; actualQuantity: number; remarks?: string }
): Promise<{ state: ErpState; discrepancy: number }> {
  return postJson(`/api/transfers/${transferId}/receive`, payload);
}

export async function recordPhysicalStockCount(payload: {
  userId: string;
  factoryId: string;
  countDate: string;
  remarks?: string;
  lines: Array<{ productId: string | null; materialId: string | null; actualQuantity: number }>;
}): Promise<{ state: ErpState; varianceCount: number }> {
  return postJson('/api/stock-counts', payload);
}

export async function createFactoryApi(payload: {
  userId: string;
  factoryCode: string;
  factoryName: string;
  address: string;
}): Promise<{ state: ErpState }> {
  return postJson('/api/master/factories', payload);
}

export async function updateSellingPriceApi(payload: {
  userId: string;
  productId: string;
  factoryId: string | null;
  sellingPrice: number;
  effectiveFrom: string;
}): Promise<{ state: ErpState }> {
  return postJson('/api/master/prices', payload);
}

export async function createMasterEntityApi(payload: {
  userId: string;
  entityType: 'machine' | 'customer' | 'supplier' | 'product' | 'material' | 'user';
  payload: Record<string, unknown>;
}): Promise<{ state: ErpState }> {
  return postJson('/api/master/entities', payload);
}

export async function createProductApi(payload: {
  userId: string;
  productCode: string;
  productName: string;
  productCategory: string;
  unitCode: UnitCode;
}): Promise<{ state: ErpState }> {
  return postJson('/api/master/products', payload);
}

export async function updateProductApi(
  productId: string,
  payload: {
    userId: string;
    productCode: string;
    productName: string;
    productCategory: string;
    unitCode: UnitCode;
    isActive?: boolean;
  }
): Promise<{ state: ErpState }> {
  return requestJson(`/api/master/products/${productId}`, 'PUT', payload);
}

export async function deleteProductApi(
  productId: string,
  userId: string
): Promise<{ state: ErpState }> {
  return requestJson(`/api/master/products/${productId}`, 'DELETE', { userId });
}

export async function createUserApi(payload: {
  userId: string;
  fullName: string;
  email: string;
  phone?: string;
  password?: string;
  factoryIds: string[];
  role: AppRole;
}): Promise<{ state: ErpState; createdUserId?: string }> {
  return postJson('/api/master/users', payload);
}

export async function updateUserApi(
  targetUserId: string,
  payload: {
    userId: string;
    fullName: string;
    email: string;
    phone?: string;
    password?: string;
    factoryIds: string[];
    role: AppRole;
    isActive?: boolean;
  }
): Promise<{ state: ErpState }> {
  return requestJson(`/api/master/users/${targetUserId}`, 'PUT', payload);
}

export async function deleteUserApi(
  targetUserId: string,
  userId: string
): Promise<{ state: ErpState }> {
  return requestJson(`/api/master/users/${targetUserId}`, 'DELETE', { userId });
}

export async function updateErpSettingsApi(
  userId: string,
  settings: ErpState['settings']
): Promise<{ state: ErpState }> {
  return postJson('/api/settings', { userId, settings });
}

export async function resetDemoDataApi(): Promise<{ state: ErpState }> {
  return postJson('/api/reset-demo', {});
}
