import { useState } from 'react';
import { Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import type { AppRole, ErpState, Profile, UnitCode } from '../domain/types.ts';
import { isSuperAdmin } from '../domain/stockEngine.ts';
import {
  createFactoryApi,
  createMasterEntityApi,
  createProductApi,
  createUserApi,
  deleteProductApi,
  deleteUserApi,
  resetDemoDataApi,
  updateErpSettingsApi,
  updateProductApi,
  updateUserApi,
} from '../api/erpClient.ts';
import { ROLE_LABELS } from './StatusLabel.tsx';

interface AdminViewProps {
  state: ErpState;
  currentUser: Profile;
  onStateUpdated: (next: ErpState) => void;
}

type AdminTab = 'products' | 'users' | 'factories' | 'partners' | 'audit' | 'settings';

export function AdminView({ state, currentUser, onStateUpdated }: AdminViewProps) {
  const [tab, setTab] = useState<AdminTab>('products');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canManage = isSuperAdmin(state, currentUser.id);
  const canManageProducts =
    canManage ||
    state.memberships.some(
      (m) => m.userId === currentUser.id && m.role === 'factory_manager' && m.isActive
    );

  // Product Add / Edit / Delete state
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [prodCode, setProdCode] = useState('');
  const [prodName, setProdName] = useState('');
  const [prodCategory, setProdCategory] = useState('PP Pellets');
  const [prodUnit, setProdUnit] = useState<UnitCode>('KG');
  const [prodActive, setProdActive] = useState(true);
  const [confirmDeleteProductId, setConfirmDeleteProductId] = useState<string | null>(null);

  // User / Operator / Role Add / Edit / Delete state
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [userPhone, setUserPhone] = useState('');
  const [userPassword, setUserPassword] = useState('wayamba123');
  const [userRole, setUserRole] = useState<AppRole>('operator');
  const [userFactoryIds, setUserFactoryIds] = useState<string[]>(
    state.factories[0]?.id ? [state.factories[0].id] : []
  );
  const [userActive, setUserActive] = useState(true);
  const [confirmDeleteUserId, setConfirmDeleteUserId] = useState<string | null>(null);

  // Add Factory form
  const [facCode, setFacCode] = useState('');
  const [facName, setFacName] = useState('');
  const [facAddress, setFacAddress] = useState('');

  // Quick Add Machine
  const [macFactoryId, setMacFactoryId] = useState(state.factories[0]?.id ?? '');
  const [macCode, setMacCode] = useState('');
  const [macName, setMacName] = useState('');

  // Quick Add Customer & Supplier
  const [custCode, setCustCode] = useState('');
  const [custName, setCustName] = useState('');
  const [supCode, setSupCode] = useState('');
  const [supName, setSupName] = useState('');

  function resetProductForm() {
    setEditingProductId(null);
    setProdCode('');
    setProdName('');
    setProdCategory('PP Pellets');
    setProdUnit('KG');
    setProdActive(true);
  }

  function startEditProduct(productId: string) {
    const prod = state.products.find((p) => p.id === productId);
    if (!prod) return;
    setError(null);
    setNotice(null);
    setEditingProductId(prod.id);
    setProdCode(prod.productCode);
    setProdName(prod.productName);
    setProdCategory(prod.productCategory);
    setProdUnit(prod.unitCode);
    setProdActive(prod.isActive);
  }

  async function handleSaveProduct(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      if (editingProductId) {
        const res = await updateProductApi(editingProductId, {
          userId: currentUser.id,
          productCode: prodCode,
          productName: prodName,
          productCategory: prodCategory,
          unitCode: prodUnit,
          isActive: prodActive,
        });
        onStateUpdated(res.state);
        setNotice(`Updated product ${prodCode.trim().toUpperCase()} — ${prodName.trim()}.`);
        resetProductForm();
      } else {
        const res = await createProductApi({
          userId: currentUser.id,
          productCode: prodCode,
          productName: prodName,
          productCategory: prodCategory,
          unitCode: prodUnit,
        });
        onStateUpdated(res.state);
        setNotice(`Added product ${prodCode.trim().toUpperCase()} — ${prodName.trim()}.`);
        resetProductForm();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save product');
    }
  }

  async function handleConfirmDeleteProduct(productId: string) {
    setError(null);
    setNotice(null);
    try {
      const target = state.products.find((p) => p.id === productId);
      const res = await deleteProductApi(productId, currentUser.id);
      onStateUpdated(res.state);
      setConfirmDeleteProductId(null);
      if (editingProductId === productId) {
        resetProductForm();
      }
      setNotice(`Deleted product ${target?.productName ?? productId}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete product');
    }
  }

  function resetUserForm() {
    setEditingUserId(null);
    setUserName('');
    setUserEmail('');
    setUserPhone('');
    setUserPassword('wayamba123');
    setUserRole('operator');
    setUserFactoryIds(state.factories[0]?.id ? [state.factories[0].id] : []);
    setUserActive(true);
  }

  function startEditUser(userId: string) {
    const profile = state.profiles.find((p) => p.id === userId);
    if (!profile) return;
    const mems = state.memberships.filter((m) => m.userId === userId && m.isActive);
    const assignedIds = Array.from(new Set(mems.map((m) => m.factoryId)));
    const primaryRole: AppRole = mems[0]?.role ?? 'operator';

    setError(null);
    setNotice(null);
    setEditingUserId(profile.id);
    setUserName(profile.fullName);
    setUserEmail(profile.email);
    setUserPhone(profile.phone);
    setUserPassword('');
    setUserRole(primaryRole);
    setUserFactoryIds(
      assignedIds.length > 0 ? assignedIds : state.factories[0]?.id ? [state.factories[0].id] : []
    );
    setUserActive(profile.isActive);
  }

  function toggleUserFactory(factoryId: string) {
    setUserFactoryIds((prev) =>
      prev.includes(factoryId) ? prev.filter((id) => id !== factoryId) : [...prev, factoryId]
    );
  }

  function handleRoleChange(nextRole: AppRole) {
    setUserRole(nextRole);
    if (nextRole === 'super_admin' && !editingUserId) {
      setUserFactoryIds(state.factories.map((f) => f.id));
    }
  }

  async function handleSaveUser(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const assignedFactories =
      userFactoryIds.length > 0
        ? userFactoryIds
        : state.factories[0]?.id
        ? [state.factories[0].id]
        : [];
    try {
      if (editingUserId) {
        const res = await updateUserApi(editingUserId, {
          userId: currentUser.id,
          fullName: userName,
          email: userEmail,
          phone: userPhone,
          password: userPassword || undefined,
          factoryIds: assignedFactories,
          role: userRole,
          isActive: userActive,
        });
        onStateUpdated(res.state);
        setNotice(`Updated account for ${userName.trim()} (${ROLE_LABELS[userRole]}).`);
        resetUserForm();
      } else {
        const res = await createUserApi({
          userId: currentUser.id,
          fullName: userName,
          email: userEmail,
          phone: userPhone,
          password: userPassword || 'wayamba123',
          factoryIds: assignedFactories,
          role: userRole,
        });
        onStateUpdated(res.state);
        setNotice(`Created ${ROLE_LABELS[userRole]} account for ${userName.trim()}.`);
        resetUserForm();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save user account');
    }
  }

  async function handleConfirmDeleteUser(targetUserId: string) {
    setError(null);
    setNotice(null);
    try {
      const target = state.profiles.find((p) => p.id === targetUserId);
      const res = await deleteUserApi(targetUserId, currentUser.id);
      onStateUpdated(res.state);
      setConfirmDeleteUserId(null);
      if (editingUserId === targetUserId) {
        resetUserForm();
      }
      setNotice(`Removed user account ${target?.fullName ?? targetUserId}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete user');
    }
  }

  async function handleAddFactory(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      const res = await createFactoryApi({
        userId: currentUser.id,
        factoryCode: facCode,
        factoryName: facName,
        address: facAddress,
      });
      onStateUpdated(res.state);
      setFacCode('');
      setFacName('');
      setFacAddress('');
      setNotice('New factory added.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add factory');
    }
  }

  async function handleAddMachine(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      const res = await createMasterEntityApi({
        userId: currentUser.id,
        entityType: 'machine',
        payload: { factoryId: macFactoryId, machineCode: macCode, machineName: macName },
      });
      onStateUpdated(res.state);
      setMacCode('');
      setMacName('');
      setNotice('Machine added.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add machine');
    }
  }

  async function handleAddCustomer(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      const res = await createMasterEntityApi({
        userId: currentUser.id,
        entityType: 'customer',
        payload: { customerCode: custCode, customerName: custName },
      });
      onStateUpdated(res.state);
      setCustCode('');
      setCustName('');
      setNotice('Customer added.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add customer');
    }
  }

  async function handleAddSupplier(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      const res = await createMasterEntityApi({
        userId: currentUser.id,
        entityType: 'supplier',
        payload: { supplierCode: supCode, supplierName: supName },
      });
      onStateUpdated(res.state);
      setSupCode('');
      setSupName('');
      setNotice('Supplier added.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add supplier');
    }
  }

  async function handleToggleSetting(key: 'preventSelfApproval' | 'requireDispatchDocument') {
    setError(null);
    setNotice(null);
    try {
      const nextSettings = {
        ...state.settings,
        [key]: !state.settings[key],
      };
      const res = await updateErpSettingsApi(currentUser.id, nextSettings);
      onStateUpdated(res.state);
      setNotice('Governance settings updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update settings');
    }
  }

  async function handleResetDemo() {
    setError(null);
    setNotice(null);
    const res = await resetDemoDataApi();
    onStateUpdated(res.state);
    resetProductForm();
    resetUserForm();
    setNotice('Demo dataset restored to initial state.');
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-900">
            Master Data, Users &amp; Stock Governance
          </h1>
          <p className="text-sm text-slate-500">
            Manage products, operators, employee roles, factories, machines, partners, and audit logs.
          </p>
        </div>
        {!canManage && (
          <span className="text-xs text-amber-700 font-medium">
            Read-only view (switch Acting User to Super Admin to edit users, roles, or factories)
          </span>
        )}
      </div>

      {error && (
        <div role="alert" className="p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg">
          {error}
        </div>
      )}
      {notice && (
        <div className="p-3 text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg">
          {notice}
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-lg w-fit">
        {(
          [
            { id: 'products', label: 'Products' },
            { id: 'users', label: 'Users & Roles' },
            { id: 'factories', label: 'Factories & Machines' },
            { id: 'partners', label: 'Customers & Suppliers' },
            { id: 'audit', label: 'Audit History' },
            { id: 'settings', label: 'Governance Settings' },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setTab(t.id);
              setError(null);
              setNotice(null);
            }}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              tab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab: Products (Add / Edit / Delete) */}
      {tab === 'products' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="font-display text-sm font-semibold text-slate-900">
                  Product Catalog ({state.products.length})
                </h2>
                <p className="text-xs text-slate-500">
                  Stock-only catalog for finished goods tracked across production and dispatch.
                </p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="py-2.5 px-4">Code</th>
                    <th className="py-2.5 px-4">Product Name</th>
                    <th className="py-2.5 px-4">Category</th>
                    <th className="py-2.5 px-4">Unit</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {state.products.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-500">
                        No products configured. Add your first product using the form.
                      </td>
                    </tr>
                  ) : (
                    state.products.map((p) => (
                      <tr
                        key={p.id}
                        className={editingProductId === p.id ? 'bg-blue-50/50' : undefined}
                      >
                        <td className="py-2.5 px-4 font-mono text-slate-700 whitespace-nowrap">
                          {p.productCode}
                        </td>
                        <td className="py-2.5 px-4 font-medium text-slate-900">{p.productName}</td>
                        <td className="py-2.5 px-4 text-slate-600">{p.productCategory}</td>
                        <td className="py-2.5 px-4 font-mono text-slate-700">{p.unitCode}</td>
                        <td className="py-2.5 px-4">
                          <span
                            className={`text-xs font-medium ${
                              p.isActive ? 'text-emerald-700' : 'text-slate-400'
                            }`}
                          >
                            {p.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-right whitespace-nowrap">
                          {confirmDeleteProductId === p.id ? (
                            <span className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                aria-label={`Confirm delete ${p.productName}`}
                                onClick={() => handleConfirmDeleteProduct(p.id)}
                                className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-[11px] font-semibold cursor-pointer"
                              >
                                Confirm Delete
                              </button>
                              <button
                                type="button"
                                aria-label={`Cancel delete ${p.productName}`}
                                onClick={() => setConfirmDeleteProductId(null)}
                                className="px-2 py-1 border border-slate-300 text-slate-700 rounded text-[11px] cursor-pointer"
                              >
                                Cancel
                              </button>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                aria-label={`Edit ${p.productName}`}
                                disabled={!canManageProducts}
                                onClick={() => startEditProduct(p.id)}
                                className="px-2 py-1 border border-slate-300 hover:bg-slate-50 disabled:opacity-40 text-slate-700 rounded inline-flex items-center gap-1 cursor-pointer"
                              >
                                <Pencil className="w-3 h-3" aria-hidden="true" />
                                <span>Edit</span>
                              </button>
                              <button
                                type="button"
                                aria-label={`Delete ${p.productName}`}
                                disabled={!canManageProducts}
                                onClick={() => setConfirmDeleteProductId(p.id)}
                                className="px-2 py-1 border border-red-200 hover:bg-red-50 disabled:opacity-40 text-red-700 rounded inline-flex items-center gap-1 cursor-pointer"
                              >
                                <Trash2 className="w-3 h-3" aria-hidden="true" />
                                <span>Delete</span>
                              </button>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4 h-fit">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-sm font-semibold text-slate-900">
                {editingProductId ? 'Edit Product' : 'Add New Product'}
              </h2>
              {editingProductId && (
                <button
                  type="button"
                  onClick={resetProductForm}
                  className="text-xs text-blue-700 hover:underline cursor-pointer"
                >
                  Cancel Edit
                </button>
              )}
            </div>
            <form onSubmit={handleSaveProduct} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Product Code
                </label>
                <input
                  type="text"
                  required
                  disabled={!canManageProducts}
                  placeholder="PP-CRATE-01"
                  value={prodCode}
                  onChange={(e) => setProdCode(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Product Name
                </label>
                <input
                  type="text"
                  required
                  disabled={!canManageProducts}
                  placeholder="PP Industrial Crate"
                  value={prodName}
                  onChange={(e) => setProdName(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Category
                  </label>
                  <input
                    type="text"
                    required
                    list="product-categories"
                    disabled={!canManageProducts}
                    value={prodCategory}
                    onChange={(e) => setProdCategory(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded"
                  />
                  <datalist id="product-categories">
                    <option value="PP Pellets" />
                    <option value="PP Pallets" />
                    <option value="PP Crates" />
                    <option value="HDPE Regrind" />
                    <option value="Finished Goods" />
                  </datalist>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Unit</label>
                  <select
                    aria-label="Product unit"
                    disabled={!canManageProducts}
                    value={prodUnit}
                    onChange={(e) => setProdUnit(e.target.value as UnitCode)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded"
                  >
                    <option value="KG">KG (Kilograms)</option>
                    <option value="PCS">PCS (Pieces)</option>
                  </select>
                </div>
              </div>

              {editingProductId && (
                <label className="flex items-center gap-2 text-xs text-slate-700 pt-1 cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={!canManageProducts}
                    checked={prodActive}
                    onChange={(e) => setProdActive(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-blue-700"
                  />
                  <span>Active in Production &amp; Dispatch</span>
                </label>
              )}

              <button
                type="submit"
                disabled={!canManageProducts}
                className="w-full py-2 bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{editingProductId ? 'Save Product Changes' : 'Add Product'}</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Tab: Users, Operators & Roles (Add / Edit / Delete) */}
      {tab === 'users' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200">
              <h2 className="font-display text-sm font-semibold text-slate-900">
                Admin, Operators &amp; Factory Staff ({state.profiles.length})
              </h2>
              <p className="text-xs text-slate-500">
                Super Admin email, machine operators, supervisors, storekeepers, and dispatch roles.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="py-2.5 px-4">Employee</th>
                    <th className="py-2.5 px-4">Email</th>
                    <th className="py-2.5 px-4">Factory Access &amp; Role</th>
                    <th className="py-2.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {state.profiles.map((p) => {
                    const mems = state.memberships.filter((m) => m.userId === p.id && m.isActive);
                    const primaryRole = mems[0]?.role;
                    const factoryCodes = mems
                      .map((m) => state.factories.find((fac) => fac.id === m.factoryId)?.factoryCode)
                      .filter(Boolean)
                      .join(' · ');
                    const isSelf = p.id === currentUser.id;
                    return (
                      <tr
                        key={p.id}
                        className={editingUserId === p.id ? 'bg-blue-50/50' : undefined}
                      >
                        <td className="py-2.5 px-4">
                          <div className="font-medium text-slate-900">
                            {p.fullName}
                            {!p.isActive && (
                              <span className="ml-1.5 text-[11px] text-slate-400">(Inactive)</span>
                            )}
                          </div>
                          {p.phone && <div className="text-[11px] text-slate-500">{p.phone}</div>}
                        </td>
                        <td className="py-2.5 px-4 font-mono text-slate-600">{p.email}</td>
                        <td className="py-2.5 px-4 text-slate-700">
                          <div className="font-medium">
                            {primaryRole ? ROLE_LABELS[primaryRole] : 'No Role'}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {factoryCodes || 'No Factory'}
                          </div>
                        </td>
                        <td className="py-2.5 px-4 text-right whitespace-nowrap">
                          {confirmDeleteUserId === p.id ? (
                            <span className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                aria-label={`Confirm delete ${p.fullName}`}
                                onClick={() => handleConfirmDeleteUser(p.id)}
                                className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-[11px] font-semibold cursor-pointer"
                              >
                                Confirm Delete
                              </button>
                              <button
                                type="button"
                                aria-label={`Cancel delete ${p.fullName}`}
                                onClick={() => setConfirmDeleteUserId(null)}
                                className="px-2 py-1 border border-slate-300 text-slate-700 rounded text-[11px] cursor-pointer"
                              >
                                Cancel
                              </button>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                aria-label={`Edit ${p.fullName}`}
                                disabled={!canManage}
                                onClick={() => startEditUser(p.id)}
                                className="px-2 py-1 border border-slate-300 hover:bg-slate-50 disabled:opacity-40 text-slate-700 rounded inline-flex items-center gap-1 cursor-pointer"
                              >
                                <Pencil className="w-3 h-3" aria-hidden="true" />
                                <span>Edit</span>
                              </button>
                              <button
                                type="button"
                                aria-label={`Delete ${p.fullName}`}
                                disabled={!canManage || isSelf}
                                title={isSelf ? 'Cannot delete active Super Admin session' : undefined}
                                onClick={() => setConfirmDeleteUserId(p.id)}
                                className="px-2 py-1 border border-red-200 hover:bg-red-50 disabled:opacity-40 text-red-700 rounded inline-flex items-center gap-1 cursor-pointer"
                              >
                                <Trash2 className="w-3 h-3" aria-hidden="true" />
                                <span>Delete</span>
                              </button>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3 h-fit">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-sm font-semibold text-slate-900">
                {editingUserId ? 'Edit Account & Role' : 'Add Operator / Role Account'}
              </h2>
              {editingUserId && (
                <button
                  type="button"
                  onClick={resetUserForm}
                  className="text-xs text-blue-700 hover:underline cursor-pointer"
                >
                  Cancel Edit
                </button>
              )}
            </div>
            <form onSubmit={handleSaveUser} className="space-y-2.5">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  disabled={!canManage}
                  placeholder="Saman Operator"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Email</label>
                <input
                  type="email"
                  required
                  disabled={!canManage}
                  placeholder="operator@wayambaplastic.lk"
                  value={userEmail}
                  onChange={(e) => setUserEmail(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Phone</label>
                  <input
                    type="text"
                    disabled={!canManage}
                    placeholder="+94 77 000 0000"
                    value={userPhone}
                    onChange={(e) => setUserPhone(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Password</label>
                  <input
                    type="text"
                    disabled={!canManage}
                    required={!editingUserId}
                    placeholder={editingUserId ? 'Keep current' : 'wayamba123'}
                    value={userPassword}
                    onChange={(e) => setUserPassword(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Role</label>
                <select
                  aria-label="Assign role"
                  disabled={!canManage}
                  value={userRole}
                  onChange={(e) => handleRoleChange(e.target.value as AppRole)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded"
                >
                  {Object.entries(ROLE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-slate-700">Assigned Factories</label>
                  <button
                    type="button"
                    disabled={!canManage}
                    onClick={() => setUserFactoryIds(state.factories.map((f) => f.id))}
                    className="text-[11px] text-blue-700 hover:underline cursor-pointer"
                  >
                    Select All
                  </button>
                </div>
                <div className="space-y-1.5 border border-slate-200 rounded p-2.5 bg-slate-50/60">
                  {state.factories.map((f) => (
                    <label
                      key={f.id}
                      className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        disabled={!canManage}
                        checked={userFactoryIds.includes(f.id)}
                        onChange={() => toggleUserFactory(f.id)}
                        className="h-3.5 w-3.5 rounded border-slate-300 text-blue-700"
                      />
                      <span>
                        <span className="font-mono font-semibold">{f.factoryCode}</span> —{' '}
                        {f.factoryName}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {editingUserId && (
                <label className="flex items-center gap-2 text-xs text-slate-700 pt-1 cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={!canManage}
                    checked={userActive}
                    onChange={(e) => setUserActive(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-blue-700"
                  />
                  <span>Account Active</span>
                </label>
              )}

              <button
                type="submit"
                disabled={!canManage}
                className="w-full py-2 bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white text-xs font-semibold rounded-lg cursor-pointer"
              >
                {editingUserId ? 'Save Account Changes' : 'Create Account'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Tab: Factories & Machines */}
      {tab === 'factories' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
            <h2 className="font-display text-base font-semibold text-slate-900">Factories</h2>
            <div className="divide-y divide-slate-100">
              {state.factories.map((f) => (
                <div key={f.id} className="py-2.5 flex items-center justify-between text-sm">
                  <div>
                    <div className="font-medium text-slate-900">
                      <span className="font-mono text-xs text-slate-500 mr-2">{f.factoryCode}</span>
                      {f.factoryName}
                    </div>
                    <div className="text-xs text-slate-500">{f.address}</div>
                  </div>
                </div>
              ))}
            </div>
            {canManage && (
              <form onSubmit={handleAddFactory} className="pt-4 border-t border-slate-200 space-y-2.5">
                <div className="text-xs font-semibold text-slate-700">Add New Factory</div>
                <div className="grid grid-cols-3 gap-2">
                  <input
                    type="text"
                    required
                    placeholder="F04"
                    value={facCode}
                    onChange={(e) => setFacCode(e.target.value)}
                    className="px-2.5 py-1.5 text-xs border border-slate-300 rounded"
                  />
                  <input
                    type="text"
                    required
                    placeholder="Factory 04 – Name"
                    value={facName}
                    onChange={(e) => setFacName(e.target.value)}
                    className="col-span-2 px-2.5 py-1.5 text-xs border border-slate-300 rounded"
                  />
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Factory Address"
                    value={facAddress}
                    onChange={(e) => setFacAddress(e.target.value)}
                    className="flex-1 px-2.5 py-1.5 text-xs border border-slate-300 rounded"
                  />
                  <button
                    type="submit"
                    className="px-3 py-1.5 bg-blue-700 text-white text-xs font-semibold rounded flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                    Add
                  </button>
                </div>
              </form>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
            <h2 className="font-display text-base font-semibold text-slate-900">Machines</h2>
            <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
              {state.machines.map((m) => {
                const fac = state.factories.find((f) => f.id === m.factoryId);
                return (
                  <div key={m.id} className="py-2 flex items-center justify-between text-xs">
                    <div>
                      <span className="font-mono text-slate-500 mr-2">{m.machineCode}</span>
                      <span className="font-medium text-slate-900">{m.machineName}</span>
                    </div>
                    <span className="text-slate-500">{fac?.factoryCode}</span>
                  </div>
                );
              })}
            </div>
            {canManage && (
              <form onSubmit={handleAddMachine} className="pt-4 border-t border-slate-200 space-y-2.5">
                <div className="text-xs font-semibold text-slate-700">Add Machine</div>
                <div className="grid grid-cols-3 gap-2">
                  <select
                    aria-label="Machine factory"
                    value={macFactoryId}
                    onChange={(e) => setMacFactoryId(e.target.value)}
                    className="px-2 py-1.5 text-xs border border-slate-300 rounded"
                  >
                    {state.factories.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.factoryCode}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    required
                    placeholder="F1-IM-02"
                    value={macCode}
                    onChange={(e) => setMacCode(e.target.value)}
                    className="px-2.5 py-1.5 text-xs border border-slate-300 rounded"
                  />
                  <input
                    type="text"
                    required
                    placeholder="Machine Name"
                    value={macName}
                    onChange={(e) => setMacName(e.target.value)}
                    className="px-2.5 py-1.5 text-xs border border-slate-300 rounded"
                  />
                </div>
                <button
                  type="submit"
                  className="px-3 py-1.5 bg-blue-700 text-white text-xs font-semibold rounded cursor-pointer"
                >
                  Add Machine
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Tab: Customers & Suppliers */}
      {tab === 'partners' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
            <h2 className="font-display text-base font-semibold text-slate-900">Customers</h2>
            <div className="divide-y divide-slate-100">
              {state.customers.map((c) => (
                <div key={c.id} className="py-2 text-xs">
                  <div className="font-medium text-slate-900">
                    <span className="font-mono text-slate-500 mr-2">{c.customerCode}</span>
                    {c.customerName}
                  </div>
                  <div className="text-slate-500">{c.address || c.phone}</div>
                </div>
              ))}
            </div>
            {canManage && (
              <form onSubmit={handleAddCustomer} className="pt-3 border-t border-slate-200 flex gap-2">
                <input
                  type="text"
                  required
                  placeholder="CUST-005"
                  value={custCode}
                  onChange={(e) => setCustCode(e.target.value)}
                  className="w-24 px-2.5 py-1.5 text-xs border border-slate-300 rounded"
                />
                <input
                  type="text"
                  required
                  placeholder="Customer Name"
                  value={custName}
                  onChange={(e) => setCustName(e.target.value)}
                  className="flex-1 px-2.5 py-1.5 text-xs border border-slate-300 rounded"
                />
                <button
                  type="submit"
                  className="px-3 py-1.5 bg-blue-700 text-white text-xs font-semibold rounded cursor-pointer"
                >
                  Add
                </button>
              </form>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
            <h2 className="font-display text-base font-semibold text-slate-900">Suppliers</h2>
            <div className="divide-y divide-slate-100">
              {state.suppliers.map((s) => (
                <div key={s.id} className="py-2 text-xs">
                  <div className="font-medium text-slate-900">
                    <span className="font-mono text-slate-500 mr-2">{s.supplierCode}</span>
                    {s.supplierName}
                  </div>
                  <div className="text-slate-500">{s.address || s.phone}</div>
                </div>
              ))}
            </div>
            {canManage && (
              <form onSubmit={handleAddSupplier} className="pt-3 border-t border-slate-200 flex gap-2">
                <input
                  type="text"
                  required
                  placeholder="SUP-004"
                  value={supCode}
                  onChange={(e) => setSupCode(e.target.value)}
                  className="w-24 px-2.5 py-1.5 text-xs border border-slate-300 rounded"
                />
                <input
                  type="text"
                  required
                  placeholder="Supplier Name"
                  value={supName}
                  onChange={(e) => setSupName(e.target.value)}
                  className="flex-1 px-2.5 py-1.5 text-xs border border-slate-300 rounded"
                />
                <button
                  type="submit"
                  className="px-3 py-1.5 bg-blue-700 text-white text-xs font-semibold rounded cursor-pointer"
                >
                  Add
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Tab: Audit History */}
      {tab === 'audit' && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="py-2.5 px-4">Timestamp</th>
                  <th className="py-2.5 px-4">Employee</th>
                  <th className="py-2.5 px-4">Factory</th>
                  <th className="py-2.5 px-4">Action</th>
                  <th className="py-2.5 px-4">Summary</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {state.auditLogs.map((log) => {
                  const usr = state.profiles.find((p) => p.id === log.userId);
                  const fac = state.factories.find((f) => f.id === log.factoryId);
                  return (
                    <tr key={log.id}>
                      <td className="py-2.5 px-4 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                        {log.createdAt.slice(0, 19).replace('T', ' ')}
                      </td>
                      <td className="py-2.5 px-4 font-medium text-slate-900">
                        {usr?.fullName ?? 'System'}
                      </td>
                      <td className="py-2.5 px-4 text-slate-600">{fac?.factoryCode ?? 'Global'}</td>
                      <td className="py-2.5 px-4 font-mono text-slate-700">{log.action}</td>
                      <td className="py-2.5 px-4 text-slate-700">{log.summary}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab: Governance Settings */}
      {tab === 'settings' && (
        <div className="bg-white border border-slate-200 rounded-lg p-6 max-w-2xl space-y-5">
          <h2 className="font-display text-base font-semibold text-slate-900">
            Stock Governance &amp; Controls
          </h2>

          <label className="flex items-start justify-between gap-4 py-3 border-b border-slate-100 cursor-pointer">
            <div>
              <div className="text-sm font-medium text-slate-900">Prevent Self-Approval</div>
              <div className="text-xs text-slate-500">
                Blocks employees from approving stock transactions they created themselves.
              </div>
            </div>
            <input
              type="checkbox"
              disabled={!canManage}
              checked={state.settings.preventSelfApproval}
              onChange={() => handleToggleSetting('preventSelfApproval')}
              className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-700"
            />
          </label>

          <div className="pt-2 flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-slate-900">Reset Sample Dataset</div>
              <div className="text-xs text-slate-500">
                Restore Wayamba Plastic factories, Super Admin ({'waseemmw6521334@gmail.com'}), and
                opening stock balances.
              </div>
            </div>
            <button
              type="button"
              onClick={handleResetDemo}
              className="px-3.5 py-2 border border-slate-300 hover:bg-slate-50 text-xs font-medium text-slate-800 rounded-lg flex items-center gap-1.5 shrink-0 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Reset Demo Data</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
