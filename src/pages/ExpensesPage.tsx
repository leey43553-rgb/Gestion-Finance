import React, { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowUpDown,
  Ban,
  Check,
  PieChart,
  Plus,
  Search,
  Tag,
  X,
} from 'lucide-react';
import { createId, db, recordAudit } from '../db/database';
import type { Expense, PaymentMethod } from '../db/types';
import { cancelExpense, saveExpense } from '../services/financeActions';
import { useAppStore } from '../store/useAppStore';
import {
  addMoney,
  centimesToInputString,
  formatMoney,
  parseMoneyInputToCentimes,
} from '../utils/money';

const METHOD_LABELS: Record<PaymentMethod, string> = {
  especes: 'Espèces',
  cheque: 'Chèque',
  virement: 'Virement',
  carte: 'Carte',
};

export const ExpensesPage: React.FC = () => {
  const pushToast = useAppStore((s) => s.pushToast);
  const settings = useLiveQuery(() => db.settings.get('company_settings'));
  const expenses = useLiveQuery(() => db.expenses.toArray(), [], []);
  const categories = useLiveQuery(() => db.expenseCategories.toArray(), [], []);
  const bankAccounts = useLiveQuery(() => db.bankAccounts.toArray(), [], []);
  const chequeLeaves = useLiveQuery(() => db.chequeLeaves.toArray(), [], []);

  const [viewTab, setViewTab] = useState<'liste' | 'mensuel'>('liste');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('toutes');
  const [monthFilter, setMonthFilter] = useState(new Date().toISOString().slice(0, 7)); // YYYY-MM
  const [showCancelled, setShowCancelled] = useState(false);
  const [sortBy, setSortBy] = useState<'date' | 'amount' | 'beneficiary'>('date');
  const [sortAsc, setSortAsc] = useState(false);

  // Édition rapide inline façon tableur
  const [editingCell, setEditingCell] = useState<{
    id: string;
    field: 'date' | 'beneficiary' | 'description' | 'reference' | 'amount';
    value: string;
  } | null>(null);

  // Ligne d'ajout rapide en bas de grille
  const today = new Date().toISOString().slice(0, 10);
  const [qDate, setQDate] = useState(today);
  const [qBeneficiary, setQBeneficiary] = useState('');
  const [qCategoryId, setQCategoryId] = useState('cat-autres');
  const [qDescription, setQDescription] = useState('');
  const [qAmountText, setQAmountText] = useState('');
  const [qMethod, setQMethod] = useState<PaymentMethod>('especes');
  const [qBankId, setQBankId] = useState('');

  // Modale complète (dépense détaillée ou chèque)
  const [modalOpen, setModalOpen] = useState(false);
  const [mDate, setMDate] = useState(today);
  const [mBeneficiary, setMBeneficiary] = useState('');
  const [mCategoryId, setMCategoryId] = useState('cat-autres');
  const [mDescription, setMDescription] = useState('');
  const [mAmountText, setMAmountText] = useState('0,00');
  const [mCurrency, setMCurrency] = useState('DZD');
  const [mExchangeRate, setMExchangeRate] = useState('1');
  const [mMethod, setMMethod] = useState<PaymentMethod>('especes');
  const [mBankId, setMBankId] = useState('');
  const [mChequeLeafId, setMChequeLeafId] = useState('');
  const [mChequeNumber, setMChequeNumber] = useState('');
  const [mReference, setMReference] = useState('');
  const [mNotes, setMNotes] = useState('');

  // Catégories personnalisables
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatColor, setNewCatColor] = useState('#0F1E36');

  // Annulation
  const [cancelTarget, setCancelTarget] = useState<Expense | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  const defaultCurrency = settings?.defaultCurrency || 'DZD';
  const currencies = settings?.enabledCurrencies;

  const bankMap = useMemo(() => new Map(bankAccounts.map((b) => [b.id, b])), [bankAccounts]);
  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const availableLeavesForModalBank = useMemo(() => {
    if (!mBankId) return [];
    return chequeLeaves.filter((l) => l.bankAccountId === mBankId && l.status === 'disponible');
  }, [chequeLeaves, mBankId]);

  const filteredExpenses = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = expenses.filter((e) => {
      if (!showCancelled && e.status === 'annule') return false;
      if (categoryFilter !== 'toutes' && e.categoryId !== categoryFilter) return false;
      if (q) {
        const hay = `${e.beneficiary} ${e.description} ${e.categoryName} ${e.reference}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    list.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'date') cmp = a.date.localeCompare(b.date);
      else if (sortBy === 'amount') cmp = a.baseDzdAmountCentimes - b.baseDzdAmountCentimes;
      else if (sortBy === 'beneficiary') cmp = a.beneficiary.localeCompare(b.beneficiary, 'fr');
      return sortAsc ? cmp : -cmp;
    });
    return list;
  }, [expenses, showCancelled, categoryFilter, search, sortBy, sortAsc]);

  const totalFilteredValid = useMemo(() => {
    let sum = 0;
    for (const e of filteredExpenses) {
      if (e.status === 'valide') sum = addMoney(sum, e.baseDzdAmountCentimes);
    }
    return sum;
  }, [filteredExpenses]);

  // Rapport mensuel
  const monthlyReport = useMemo(() => {
    const inMonth = expenses.filter(
      (e) => e.status === 'valide' && e.date.startsWith(monthFilter)
    );
    let total = 0;
    const byCategory = new Map<string, { name: string; total: number; count: number }>();
    const byMethod = new Map<PaymentMethod, number>();

    for (const e of inMonth) {
      total = addMoney(total, e.baseDzdAmountCentimes);
      const prevCat = byCategory.get(e.categoryName) || {
        name: e.categoryName,
        total: 0,
        count: 0,
      };
      byCategory.set(e.categoryName, {
        name: e.categoryName,
        total: addMoney(prevCat.total, e.baseDzdAmountCentimes),
        count: prevCat.count + 1,
      });
      byMethod.set(
        e.paymentMethod,
        addMoney(byMethod.get(e.paymentMethod) || 0, e.baseDzdAmountCentimes)
      );
    }

    return {
      count: inMonth.length,
      total,
      categories: Array.from(byCategory.values()).sort((a, b) => b.total - a.total),
      methods: Array.from(byMethod.entries()),
    };
  }, [expenses, monthFilter]);

  const commitInlineEdit = async (
    nextField?: 'date' | 'beneficiary' | 'description' | 'reference' | 'amount'
  ) => {
    if (!editingCell) return;
    const exp = expenses.find((x) => x.id === editingCell.id);
    if (!exp || exp.status === 'annule') {
      setEditingCell(null);
      return;
    }

    try {
      if (editingCell.field === 'amount') {
        const parsed = parseMoneyInputToCentimes(editingCell.value);
        if (Number.isNaN(parsed) || parsed <= 0) {
          pushToast({ type: 'error', title: 'Montant invalide' });
          setEditingCell(null);
          return;
        }
        if (parsed !== exp.amountCentimes) {
          await saveExpense({
            existingId: exp.id,
            date: exp.date,
            beneficiary: exp.beneficiary,
            categoryId: exp.categoryId,
            categoryName: exp.categoryName,
            description: exp.description,
            amountCentimes: parsed,
            currency: exp.currency,
            exchangeRate: exp.exchangeRate,
            paymentMethod: exp.paymentMethod,
            bankAccountId: exp.bankAccountId,
            reference: exp.reference,
            notes: exp.notes,
          });
        }
      } else {
        const val = editingCell.value.trim();
        if ((editingCell.field === 'beneficiary' || editingCell.field === 'description') && !val) {
          setEditingCell(null);
          return;
        }
        await saveExpense({
          existingId: exp.id,
          date: editingCell.field === 'date' ? val : exp.date,
          beneficiary: editingCell.field === 'beneficiary' ? val : exp.beneficiary,
          categoryId: exp.categoryId,
          categoryName: exp.categoryName,
          description: editingCell.field === 'description' ? val : exp.description,
          amountCentimes: exp.amountCentimes,
          currency: exp.currency,
          exchangeRate: exp.exchangeRate,
          paymentMethod: exp.paymentMethod,
          bankAccountId: exp.bankAccountId,
          reference: editingCell.field === 'reference' ? val : exp.reference,
          notes: exp.notes,
        });
      }
    } catch (err) {
      pushToast({
        type: 'error',
        title: 'Modification impossible',
        message: err instanceof Error ? err.message : 'Erreur',
      });
    }

    if (nextField) {
      const nextVal =
        nextField === 'amount'
          ? centimesToInputString(exp.amountCentimes)
          : String(exp[nextField] || '');
      setEditingCell({ id: exp.id, field: nextField, value: nextVal });
    } else {
      setEditingCell(null);
    }
  };

  const handleQuickAdd = async () => {
    const amount = parseMoneyInputToCentimes(qAmountText);
    if (Number.isNaN(amount) || amount <= 0) {
      pushToast({ type: 'error', title: 'Montant invalide' });
      return;
    }
    const cat = catMap.get(qCategoryId) || categories[0];
    try {
      await saveExpense({
        date: qDate,
        beneficiary: qBeneficiary,
        categoryId: cat?.id || 'cat-autres',
        categoryName: cat?.name || 'Autres dépenses',
        description: qDescription,
        amountCentimes: amount,
        currency: defaultCurrency,
        exchangeRate: 1,
        paymentMethod: qMethod,
        bankAccountId: qMethod === 'especes' ? null : qBankId || bankAccounts[0]?.id || null,
        reference: '',
        notes: '',
      });
      setQBeneficiary('');
      setQDescription('');
      setQAmountText('');
      pushToast({ type: 'success', title: 'Dépense enregistrée' });
    } catch (err) {
      pushToast({
        type: 'error',
        title: 'Erreur',
        message: err instanceof Error ? err.message : 'Erreur',
      });
    }
  };

  const handleSaveModal = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseMoneyInputToCentimes(mAmountText);
    if (Number.isNaN(amount) || amount <= 0) {
      pushToast({ type: 'error', title: 'Montant invalide' });
      return;
    }
    const cat = catMap.get(mCategoryId) || categories[0];
    const rate = parseFloat(mExchangeRate.replace(',', '.'));
    try {
      await saveExpense({
        date: mDate,
        beneficiary: mBeneficiary,
        categoryId: cat?.id || 'cat-autres',
        categoryName: cat?.name || 'Autres dépenses',
        description: mDescription,
        amountCentimes: amount,
        currency: mCurrency,
        exchangeRate: Number.isFinite(rate) && rate > 0 ? rate : 1,
        paymentMethod: mMethod,
        bankAccountId: mMethod === 'especes' ? null : mBankId || null,
        reference: mReference,
        notes: mNotes,
        chequeLeafId: mChequeLeafId || undefined,
        chequeNumber: mChequeNumber || undefined,
      });
      setModalOpen(false);
      pushToast({
        type: 'success',
        title: 'Dépense enregistrée',
        message:
          mMethod === 'cheque'
            ? 'Le chèque émis a été créé ; la trésorerie ne sera débitée qu’à son encaissement.'
            : undefined,
      });
    } catch (err) {
      pushToast({
        type: 'error',
        title: 'Erreur de validation',
        message: err instanceof Error ? err.message : 'Erreur',
      });
    }
  };

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatName.trim()) return;
    await db.expenseCategories.put({
      id: createId('cat'),
      name: newCatName.trim(),
      color: newCatColor,
      isDefault: false,
      createdAt: new Date().toISOString(),
    });
    await recordAudit({
      action: 'CREATION',
      entityType: 'categorie_depense',
      entityId: newCatName.trim(),
      summary: `Nouvelle catégorie de dépense : ${newCatName.trim()}`,
    });
    setNewCatName('');
    pushToast({ type: 'success', title: 'Catégorie ajoutée' });
  };

  const handleConfirmCancel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancelTarget) return;
    try {
      await cancelExpense(cancelTarget.id, cancelReason);
      setCancelTarget(null);
      setCancelReason('');
      pushToast({ type: 'info', title: 'Dépense annulée' });
    } catch (err) {
      pushToast({
        type: 'error',
        title: 'Erreur',
        message: err instanceof Error ? err.message : 'Erreur',
      });
    }
  };

  return (
    <div className="space-y-5">
      {/* Barre supérieure */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 rounded-md bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setViewTab('liste')}
              className={`rounded px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                viewTab === 'liste' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              Saisie & Grille des dépenses
            </button>
            <button
              type="button"
              onClick={() => setViewTab('mensuel')}
              className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                viewTab === 'mensuel' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              <PieChart className="h-3.5 w-3.5" />
              <span>Rapport mensuel</span>
            </button>
          </div>

          {viewTab === 'liste' && (
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Rechercher bénéficiaire, libellé..."
                  className="w-60 rounded-md border border-slate-300 py-1.5 pr-3 pl-9 text-sm"
                />
              </div>

              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
              >
                <option value="toutes">Toutes catégories</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>

              <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={showCancelled}
                  onChange={(e) => setShowCancelled(e.target.checked)}
                />
                <span>Voir annulées</span>
              </label>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCatModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <Tag className="h-3.5 w-3.5" />
            <span>Catégories</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMDate(today);
              setMBeneficiary('');
              setMCategoryId(categories[0]?.id || 'cat-autres');
              setMDescription('');
              setMAmountText('0,00');
              setMCurrency(defaultCurrency);
              setMExchangeRate('1');
              setMMethod('especes');
              setMBankId(bankAccounts[0]?.id || '');
              setMChequeLeafId('');
              setMChequeNumber('');
              setMReference('');
              setMNotes('');
              setModalOpen(true);
            }}
            className="inline-flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 whitespace-nowrap"
          >
            <Plus className="h-4 w-4" />
            <span>Nouvelle dépense</span>
          </button>
        </div>
      </div>

      {viewTab === 'liste' ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
            <span className="text-slate-600">
              {filteredExpenses.filter((e) => e.status === 'valide').length} dépense(s) valide(s)
            </span>
            <span className="font-bold text-red-700 tabular-nums">
              Total : {formatMoney(totalFilteredValid, defaultCurrency, currencies)}
            </span>
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
                <tr>
                  <th className="px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        if (sortBy === 'date') setSortAsc(!sortAsc);
                        else {
                          setSortBy('date');
                          setSortAsc(false);
                        }
                      }}
                      className="inline-flex items-center gap-1"
                    >
                      <span>Date</span>
                      <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        if (sortBy === 'beneficiary') setSortAsc(!sortAsc);
                        else {
                          setSortBy('beneficiary');
                          setSortAsc(true);
                        }
                      }}
                      className="inline-flex items-center gap-1"
                    >
                      <span>Bénéficiaire</span>
                      <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="px-3 py-2.5">Catégorie</th>
                  <th className="px-3 py-2.5">Description</th>
                  <th className="px-3 py-2.5">Mode / Compte</th>
                  <th className="px-3 py-2.5">Référence</th>
                  <th className="px-3 py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => {
                        if (sortBy === 'amount') setSortAsc(!sortAsc);
                        else {
                          setSortBy('amount');
                          setSortAsc(false);
                        }
                      }}
                      className="inline-flex items-center gap-1"
                    >
                      <span>Montant</span>
                      <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="px-3 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredExpenses.map((e) => {
                  const isCancelled = e.status === 'annule';
                  const bank = e.bankAccountId ? bankMap.get(e.bankAccountId) : null;
                  return (
                    <tr key={e.id} className={isCancelled ? 'bg-slate-50 text-slate-400' : 'hover:bg-slate-50'}>
                      <td className="px-3 py-2 tabular-nums whitespace-nowrap">
                        {editingCell?.id === e.id && editingCell.field === 'date' ? (
                          <input
                            type="date"
                            autoFocus
                            value={editingCell.value}
                            onChange={(ev) =>
                              setEditingCell({ ...editingCell, value: ev.target.value })
                            }
                            onBlur={() => commitInlineEdit()}
                            onKeyDown={(ev) => {
                              if (ev.key === 'Enter') commitInlineEdit();
                              else if (ev.key === 'Tab') {
                                ev.preventDefault();
                                commitInlineEdit('beneficiary');
                              }
                            }}
                            className="rounded border border-[#1D4ED8] px-1 py-0.5 text-xs"
                          />
                        ) : (
                          <span
                            onDoubleClick={() =>
                              !isCancelled &&
                              setEditingCell({ id: e.id, field: 'date', value: e.date })
                            }
                          >
                            {e.date}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-medium text-slate-900">
                        {editingCell?.id === e.id && editingCell.field === 'beneficiary' ? (
                          <input
                            type="text"
                            autoFocus
                            value={editingCell.value}
                            onChange={(ev) =>
                              setEditingCell({ ...editingCell, value: ev.target.value })
                            }
                            onBlur={() => commitInlineEdit()}
                            onKeyDown={(ev) => {
                              if (ev.key === 'Enter') commitInlineEdit();
                              else if (ev.key === 'Tab') {
                                ev.preventDefault();
                                commitInlineEdit('description');
                              }
                            }}
                            className="w-full rounded border border-[#1D4ED8] px-1.5 py-0.5 text-xs"
                          />
                        ) : (
                          <span
                            onDoubleClick={() =>
                              !isCancelled &&
                              setEditingCell({
                                id: e.id,
                                field: 'beneficiary',
                                value: e.beneficiary,
                              })
                            }
                          >
                            {e.beneficiary}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-700">{e.categoryName}</td>
                      <td className="px-3 py-2 text-slate-700">
                        {editingCell?.id === e.id && editingCell.field === 'description' ? (
                          <input
                            type="text"
                            autoFocus
                            value={editingCell.value}
                            onChange={(ev) =>
                              setEditingCell({ ...editingCell, value: ev.target.value })
                            }
                            onBlur={() => commitInlineEdit()}
                            onKeyDown={(ev) => {
                              if (ev.key === 'Enter') commitInlineEdit();
                              else if (ev.key === 'Tab') {
                                ev.preventDefault();
                                commitInlineEdit('reference');
                              }
                            }}
                            className="w-full rounded border border-[#1D4ED8] px-1.5 py-0.5 text-xs"
                          />
                        ) : (
                          <span
                            onDoubleClick={() =>
                              !isCancelled &&
                              setEditingCell({
                                id: e.id,
                                field: 'description',
                                value: e.description,
                              })
                            }
                          >
                            {e.description}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {METHOD_LABELS[e.paymentMethod]}
                        {bank ? ` · ${bank.bankName}` : ' · Caisse'}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{e.reference || '—'}</td>
                      <td
                        className={`px-3 py-2 text-right font-semibold tabular-nums whitespace-nowrap ${
                          isCancelled ? 'line-through text-slate-400' : 'text-red-700'
                        }`}
                      >
                        {editingCell?.id === e.id && editingCell.field === 'amount' ? (
                          <input
                            type="text"
                            autoFocus
                            value={editingCell.value}
                            onChange={(ev) =>
                              setEditingCell({ ...editingCell, value: ev.target.value })
                            }
                            onBlur={() => commitInlineEdit()}
                            onKeyDown={(ev) => ev.key === 'Enter' && commitInlineEdit()}
                            className="w-28 rounded border border-[#1D4ED8] px-1.5 py-0.5 text-right text-xs tabular-nums"
                          />
                        ) : (
                          <span
                            onDoubleClick={() =>
                              !isCancelled &&
                              setEditingCell({
                                id: e.id,
                                field: 'amount',
                                value: centimesToInputString(e.amountCentimes),
                              })
                            }
                          >
                            {formatMoney(e.amountCentimes, e.currency)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {!isCancelled ? (
                          <button
                            type="button"
                            onClick={() => setCancelTarget(e)}
                            title="Annuler cette dépense"
                            className="rounded p-1 text-red-600 hover:bg-red-50"
                          >
                            <Ban className="h-3.5 w-3.5" />
                          </button>
                        ) : (
                          <span className="text-[11px]">Annulée</span>
                        )}
                      </td>
                    </tr>
                  );
                })}

                {/* Ligne d'ajout rapide en bas de grille */}
                <tr className="border-t border-slate-200 bg-slate-50">
                  <td className="p-1.5">
                    <input
                      type="date"
                      value={qDate}
                      onChange={(e) => setQDate(e.target.value)}
                      className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-xs"
                    />
                  </td>
                  <td className="p-1.5">
                    <input
                      type="text"
                      value={qBeneficiary}
                      onChange={(e) => setQBeneficiary(e.target.value)}
                      placeholder="+ Bénéficiaire..."
                      className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                    />
                  </td>
                  <td className="p-1.5">
                    <select
                      value={qCategoryId}
                      onChange={(e) => setQCategoryId(e.target.value)}
                      className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-xs"
                    >
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="p-1.5">
                    <input
                      type="text"
                      value={qDescription}
                      onChange={(e) => setQDescription(e.target.value)}
                      placeholder="Description..."
                      className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                    />
                  </td>
                  <td className="p-1.5">
                    <div className="flex gap-1">
                      <select
                        value={qMethod}
                        onChange={(e) => setQMethod(e.target.value as PaymentMethod)}
                        className="rounded border border-slate-300 bg-white px-1.5 py-1 text-xs"
                      >
                        <option value="especes">Espèces</option>
                        <option value="virement">Virement</option>
                        <option value="carte">Carte</option>
                      </select>
                      {qMethod !== 'especes' && (
                        <select
                          value={qBankId}
                          onChange={(e) => setQBankId(e.target.value)}
                          className="rounded border border-slate-300 bg-white px-1.5 py-1 text-xs"
                        >
                          {bankAccounts.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.bankName}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </td>
                  <td className="p-1.5 text-center text-slate-400 text-[11px]">—</td>
                  <td className="p-1.5">
                    <input
                      type="text"
                      value={qAmountText}
                      onChange={(e) => setQAmountText(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleQuickAdd()}
                      placeholder="0,00"
                      className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-right text-xs tabular-nums"
                    />
                  </td>
                  <td className="p-1.5 text-right">
                    <button
                      type="button"
                      onClick={handleQuickAdd}
                      className="inline-flex items-center gap-1 rounded bg-[#0F1E36] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#1a2f52]"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>Ajouter</span>
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">
            Astuce : double-cliquez sur une cellule pour la modifier (Tab / Entrée). Pour une dépense réglée par chèque, utilisez le bouton « Nouvelle dépense ».
          </p>
        </div>
      ) : (
        /* Rapport mensuel des dépenses */
        <div className="rounded-lg border border-slate-200 bg-white p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Rapport mensuel des dépenses
              </h2>
              <p className="text-xs text-slate-500">
                Synthèse des dépenses engagées sur le mois sélectionné (hors dépenses annulées).
              </p>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-slate-600">Mois :</label>
              <input
                type="month"
                value={monthFilter}
                onChange={(e) => setMonthFilter(e.target.value)}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs text-slate-500">Total du mois ({monthlyReport.count} dépense(s))</div>
              <div className="mt-1 text-2xl font-bold text-red-700 tabular-nums">
                {formatMoney(monthlyReport.total, defaultCurrency, currencies)}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-1 text-xs">
              <div className="font-semibold text-slate-700">Par mode de règlement</div>
              {monthlyReport.methods.length === 0 ? (
                <div className="text-slate-500">Aucune dépense sur ce mois.</div>
              ) : (
                monthlyReport.methods.map(([m, amt]) => (
                  <div key={m} className="flex justify-between tabular-nums">
                    <span className="text-slate-600">{METHOD_LABELS[m]}</span>
                    <span className="font-semibold text-slate-900">
                      {formatMoney(amt, defaultCurrency, currencies)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <tr>
                  <th className="px-4 py-2.5">Catégorie</th>
                  <th className="px-4 py-2.5 text-right">Nombre</th>
                  <th className="px-4 py-2.5 text-right">Total</th>
                  <th className="px-4 py-2.5 text-right">Part (%)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {monthlyReport.categories.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-sm text-slate-500">
                      Aucune dépense enregistrée pour ce mois.
                    </td>
                  </tr>
                ) : (
                  monthlyReport.categories.map((cat) => {
                    const pct =
                      monthlyReport.total > 0
                        ? ((cat.total / monthlyReport.total) * 100).toFixed(1)
                        : '0.0';
                    return (
                      <tr key={cat.name}>
                        <td className="px-4 py-2.5 font-medium text-slate-900">{cat.name}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                          {cat.count}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-red-700 tabular-nums">
                          {formatMoney(cat.total, defaultCurrency, currencies)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-slate-600 tabular-nums">
                          {pct} %
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modale nouvelle dépense détaillée (avec chèque possible) */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-2xl rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-[#0F1E36] px-6 py-4 text-white">
              <h2 className="text-base font-semibold">Nouvelle dépense</h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded p-1 text-slate-300 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleSaveModal} className="p-6 space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Date *</label>
                  <input
                    type="date"
                    value={mDate}
                    onChange={(e) => setMDate(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Catégorie *</label>
                  <select
                    value={mCategoryId}
                    onChange={(e) => setMCategoryId(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Bénéficiaire (à qui vous payez) *
                  </label>
                  <input
                    type="text"
                    value={mBeneficiary}
                    onChange={(e) => setMBeneficiary(e.target.value)}
                    placeholder="Ex : Sonelgaz, Naftal, Bailleur..."
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Montant *</label>
                  <input
                    type="text"
                    value={mAmountText}
                    onChange={(e) => setMAmountText(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-right font-semibold tabular-nums"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700">Description *</label>
                  <input
                    type="text"
                    value={mDescription}
                    onChange={(e) => setMDescription(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-700">Devise</label>
                    <select
                      value={mCurrency}
                      onChange={(e) => {
                        const code = e.target.value;
                        setMCurrency(code);
                        const cfg = settings?.enabledCurrencies.find((c) => c.code === code);
                        setMExchangeRate(String(cfg?.rateToDzd || 1));
                      }}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm"
                    >
                      {(settings?.enabledCurrencies || []).map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.code}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700">Taux DZD</label>
                    <input
                      type="text"
                      disabled={mCurrency === 'DZD'}
                      value={mExchangeRate}
                      onChange={(e) => setMExchangeRate(e.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm text-right tabular-nums disabled:bg-slate-100"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Mode de paiement</label>
                  <select
                    value={mMethod}
                    onChange={(e) => setMMethod(e.target.value as PaymentMethod)}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="especes">Espèces (Caisse)</option>
                    <option value="virement">Virement bancaire</option>
                    <option value="cheque">Chèque émis</option>
                    <option value="carte">Carte bancaire</option>
                  </select>
                </div>

                {mMethod !== 'especes' && (
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-700">Compte bancaire *</label>
                    <select
                      value={mBankId}
                      onChange={(e) => {
                        setMBankId(e.target.value);
                        setMChequeLeafId('');
                      }}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                    >
                      <option value="">— Choisir une banque —</option>
                      {bankAccounts
                        .filter((b) => b.active)
                        .map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.bankName} — {b.accountName} ({b.currency})
                          </option>
                        ))}
                    </select>
                  </div>
                )}

                {mMethod === 'cheque' && (
                  <div className="sm:col-span-2 rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
                    <div className="text-xs font-medium text-amber-900">
                      Dépense par chèque : aucun doublon dans le grand livre. La sortie d’argent sera enregistrée uniquement à l’encaissement du chèque.
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {availableLeavesForModalBank.length > 0 && (
                        <div>
                          <label className="block text-xs text-slate-700">Choisir du chéquier</label>
                          <select
                            value={mChequeLeafId}
                            onChange={(e) => {
                              const leaf = availableLeavesForModalBank.find(
                                (l) => l.id === e.target.value
                              );
                              setMChequeLeafId(e.target.value);
                              if (leaf) setMChequeNumber(leaf.chequeNumber);
                            }}
                            className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
                          >
                            <option value="">— Saisie manuelle —</option>
                            {availableLeavesForModalBank.map((l) => (
                              <option key={l.id} value={l.id}>
                                {l.chequeNumber}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                      <div>
                        <label className="block text-xs text-slate-700">N° de chèque *</label>
                        <input
                          type="text"
                          value={mChequeNumber}
                          onChange={(e) => setMChequeNumber(e.target.value)}
                          placeholder="0012347"
                          className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
                        />
                      </div>
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-slate-700">Référence pièce</label>
                  <input
                    type="text"
                    value={mReference}
                    onChange={(e) => setMReference(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Notes</label>
                  <input
                    type="text"
                    value={mNotes}
                    onChange={(e) => setMNotes(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 rounded-md bg-red-600 px-5 py-2 text-sm font-medium text-white hover:bg-red-700"
                >
                  <Check className="h-4 w-4" />
                  <span>Enregistrer la dépense</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modale Catégories */}
      {catModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">Catégories de dépenses</h3>
              <button
                type="button"
                onClick={() => setCatModalOpen(false)}
                className="rounded p-1 text-slate-400 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleAddCategory} className="flex gap-2">
              <input
                type="text"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                placeholder="Nouvelle catégorie..."
                className="flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              />
              <input
                type="color"
                value={newCatColor}
                onChange={(e) => setNewCatColor(e.target.value)}
                className="h-9 w-10 rounded border border-slate-300 p-0.5"
              />
              <button
                type="submit"
                className="rounded-md bg-[#0F1E36] px-3 py-1.5 text-xs font-medium text-white"
              >
                Ajouter
              </button>
            </form>

            <div className="max-h-64 overflow-y-auto divide-y divide-slate-200 rounded border border-slate-200">
              {categories.map((c) => (
                <div key={c.id} className="flex items-center justify-between px-3 py-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block h-3 w-3 rounded"
                      style={{ backgroundColor: c.color }}
                    />
                    <span className="font-medium text-slate-800">{c.name}</span>
                  </div>
                  <span className="text-slate-400">{c.isDefault ? 'Par défaut' : 'Personnalisée'}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Modale Annulation */}
      {cancelTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form
            onSubmit={handleConfirmCancel}
            className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-xl space-y-4"
          >
            <h3 className="text-base font-semibold text-slate-900">Annuler cette dépense ?</h3>
            <p className="text-xs text-slate-600">
              {cancelTarget.beneficiary} — {cancelTarget.description}. La dépense restera archivée dans le journal d’audit.
            </p>
            <div>
              <label className="block text-xs font-medium text-slate-700">
                Motif d’annulation *
              </label>
              <input
                type="text"
                required
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setCancelTarget(null);
                  setCancelReason('');
                }}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700"
              >
                Fermer
              </button>
              <button
                type="submit"
                className="rounded-md bg-red-600 px-4 py-2 text-xs font-medium text-white"
              >
                Confirmer l’annulation
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
