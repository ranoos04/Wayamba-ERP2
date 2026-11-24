export type AppRole =
  | 'super_admin'
  | 'factory_manager'
  | 'production_supervisor'
  | 'storekeeper'
  | 'dispatch_officer'
  | 'accounts_user'
  | 'operator';

export type TransactionType =
  | 'opening'
  | 'raw_receipt'
  | 'production'
  | 'dispatch'
  | 'material_consumption'
  | 'transfer_out'
  | 'transfer_in'
  | 'adjustment'
  | 'return';

export type TransactionStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'cancelled';

export type MovementDirection = 'in' | 'out';

export type UnitCode = 'KG' | 'PCS';

export type TransferStatus =
  | 'draft'
  | 'submitted'
  | 'in_transit'
  | 'received'
  | 'discrepancy'
  | 'rejected';

export interface Factory {
  id: string;
  factoryCode: string;
  factoryName: string;
  address: string;
  isActive: boolean;
  createdAt: string;
}

export interface Profile {
  id: string;
  fullName: string;
  phone: string;
  email: string;
  passwordHash: string;
  isActive: boolean;
  createdAt: string;
}

export interface FactoryMembership {
  id: string;
  userId: string;
  factoryId: string;
  role: AppRole;
  isActive: boolean;
  createdAt: string;
}

export interface Product {
  id: string;
  productCode: string;
  productName: string;
  productCategory: string;
  unitCode: UnitCode;
  isActive: boolean;
  createdAt: string;
}

export interface RawMaterial {
  id: string;
  materialCode: string;
  materialName: string;
  unitCode: UnitCode;
  weightedAvgCost: number;
  reorderLevel: number;
  isActive: boolean;
}

export interface Customer {
  id: string;
  customerCode: string;
  customerName: string;
  phone: string;
  address: string;
  isActive: boolean;
}

export interface Supplier {
  id: string;
  supplierCode: string;
  supplierName: string;
  phone: string;
  address: string;
  isActive: boolean;
}

export interface Machine {
  id: string;
  factoryId: string;
  machineCode: string;
  machineName: string;
  machineType: string;
  isActive: boolean;
}

export interface Shift {
  id: string;
  shiftName: 'Day' | 'Night';
  startTime: string;
  endTime: string;
}

export interface PriceHistoryEntry {
  id: string;
  productId: string;
  factoryId: string | null;
  sellingPrice: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdBy: string;
  createdAt: string;
}

export interface StockTransaction {
  id: string;
  transactionNumber: string;
  factoryId: string;
  transactionType: TransactionType;
  status: TransactionStatus;
  transactionDate: string;
  referenceNumber: string;
  customerId: string | null;
  supplierId: string | null;
  createdBy: string;
  submittedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  remarks: string;
  createdAt: string;
}

export interface StockTransactionLine {
  id: string;
  transactionId: string;
  productId: string | null;
  materialId: string | null;
  direction: MovementDirection;
  quantity: number;
  unitPrice: number;
  totalValue: number;
  remarks: string;
}

export interface StockMovement {
  id: string;
  transactionId: string;
  transactionLineId: string;
  factoryId: string;
  productId: string | null;
  materialId: string | null;
  direction: MovementDirection;
  quantity: number;
  unitValue: number;
  movementDate: string;
  createdAt: string;
}

export interface StockBalance {
  id: string;
  factoryId: string;
  productId: string | null;
  materialId: string | null;
  quantityOnHand: number;
  updatedAt: string;
}

export interface ProductionOrder {
  id: string;
  transactionId: string;
  machineId: string;
  shiftId: string;
  productionDate: string;
  remarks: string;
}

export interface ProductionLine {
  id: string;
  productionId: string;
  productId: string;
  quantity: number;
  sellingPrice: number;
  productionValue: number;
}

export interface ProductionOperator {
  id: string;
  productionId: string;
  operatorId: string;
  operatorRole: string;
}

export interface MaterialConsumption {
  id: string;
  productionId: string;
  materialId: string;
  quantity: number;
  unitCost: number;
}

export interface DispatchRecord {
  id: string;
  transactionId: string;
  customerId: string;
  dispatchDate: string;
  vehicleNumber: string;
  deliveryNote: string;
}

export interface Transfer {
  id: string;
  transferNumber: string;
  fromFactory: string;
  toFactory: string;
  materialId: string;
  sentQuantity: number;
  unitCost: number;
  transferOutTransactionId: string;
  transferInTransactionId: string | null;
  transferStatus: TransferStatus;
  createdBy: string;
  createdAt: string;
}

export interface TransferReceipt {
  id: string;
  transferId: string;
  actualQuantity: number;
  discrepancyQuantity: number;
  receivedBy: string;
  receivedAt: string;
  receivingRemarks: string;
}

export interface DocumentRecord {
  id: string;
  transactionId: string;
  filePath: string;
  fileName: string;
  mimeType: string;
  documentType: 'Customer Bill' | 'Supplier Bill' | 'Delivery Note' | 'Transfer Bill' | 'Weighbridge Ticket';
  fileSizeBytes: number;
  previewDataUrl?: string;
  uploadedBy: string;
  uploadedAt: string;
}

export interface ApprovalRecord {
  id: string;
  transactionId: string;
  approvedBy: string;
  decision: 'approved' | 'rejected';
  remarks: string;
  decidedAt: string;
}

export interface AuditLogEntry {
  id: string;
  userId: string;
  factoryId: string | null;
  action: string;
  tableName: string;
  recordId: string;
  summary: string;
  createdAt: string;
}

export interface StockCount {
  id: string;
  factoryId: string;
  countDate: string;
  status: 'draft' | 'posted';
  countedBy: string;
  remarks: string;
  createdAt: string;
}

export interface StockCountLine {
  id: string;
  stockCountId: string;
  productId: string | null;
  materialId: string | null;
  systemQuantity: number;
  actualQuantity: number;
  variance: number;
}

export interface ErpSettings {
  companyName: string;
  currency: 'LKR';
  preventSelfApproval: boolean;
  requireDispatchDocument: boolean;
  stockOnlyMode: boolean;
  discrepancyAlertThresholdKg: number;
}

export interface ErpState {
  factories: Factory[];
  profiles: Profile[];
  memberships: FactoryMembership[];
  products: Product[];
  rawMaterials: RawMaterial[];
  customers: Customer[];
  suppliers: Supplier[];
  machines: Machine[];
  shifts: Shift[];
  priceHistory: PriceHistoryEntry[];
  transactions: StockTransaction[];
  transactionLines: StockTransactionLine[];
  movements: StockMovement[];
  balances: StockBalance[];
  productionOrders: ProductionOrder[];
  productionLines: ProductionLine[];
  productionOperators: ProductionOperator[];
  materialConsumptions: MaterialConsumption[];
  dispatches: DispatchRecord[];
  transfers: Transfer[];
  transferReceipts: TransferReceipt[];
  documents: DocumentRecord[];
  approvals: ApprovalRecord[];
  auditLogs: AuditLogEntry[];
  stockCounts: StockCount[];
  stockCountLines: StockCountLine[];
  settings: ErpSettings;
}
