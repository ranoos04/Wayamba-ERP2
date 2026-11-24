import { AlertTriangle, CheckCircle2, Clock, FileText, Truck, XCircle } from 'lucide-react';
import type { TransactionStatus, TransferStatus } from '../domain/types.ts';

interface StatusLabelProps {
  status: TransactionStatus | TransferStatus;
}

export function StatusLabel({ status }: StatusLabelProps) {
  switch (status) {
    case 'approved':
    case 'received':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 whitespace-nowrap">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          {status === 'approved' ? 'Approved' : 'Received'}
        </span>
      );
    case 'submitted':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 whitespace-nowrap">
          <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          Pending Approval
        </span>
      );
    case 'in_transit':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 whitespace-nowrap">
          <Truck className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          In Transit
        </span>
      );
    case 'discrepancy':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 whitespace-nowrap">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          Discrepancy
        </span>
      );
    case 'rejected':
    case 'cancelled':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 whitespace-nowrap">
          <XCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          {status === 'rejected' ? 'Rejected' : 'Cancelled'}
        </span>
      );
    case 'draft':
    default:
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 whitespace-nowrap">
          <FileText className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          Draft
        </span>
      );
  }
}

export const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  factory_manager: 'Factory Manager',
  production_supervisor: 'Production Supervisor',
  storekeeper: 'Storekeeper',
  dispatch_officer: 'Dispatch Officer',
  accounts_user: 'Accounts User',
  operator: 'Machine Operator',
};
