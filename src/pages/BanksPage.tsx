import React, { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Archive, Edit3, Landmark, Plus, Wallet, X } from 'lucide-react';
import { db, recordAudit } from '../db/database';
import type { BankAccount } from '../db/types';
import { saveBankAccount } from '../services/treasuryActions';
import { useAppStore } from '../store/useAppStore';
import { addMoney, centimesToInputString, formatMoney, parseMoneyInputToCentimes, subtractMoney } from '../utils/money';

export const BanksPage: React.FC = () => {
  const pushToast = useAppStore((s) => s.pushToast);
  const settings = useLiveQuery(() => db.settings.get('company_settings'));
  const bankAccounts = useLiveQuery(() => db.bankAccounts.toArray(), [], []);
  const ledgerEntries = useLiveQuery(() => db.ledgerEntries.toArray(), [], []);

  const [selectedAccountId, setSelectedAccountId] = useState<string | 'cash'>('cash');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingBank, setEditingBank] = useState<BankAccount | undefined>(undefined);

  const [bankName, setBankName] = useState('');
  const [accountName, setAccountName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [rib, setRib] = useState('');
  const [currency, setCurrency] = useState('DZD');
  const [openingBalanceText, setOpeningBalanceText] = useState('0,00');
  const [openingDate, setOpeningDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');

  const defaultCurrency = settings?.defaultCurrency || 'DZD';
  const currencies = settings?.enabledCurrencies;

  const accountBalances = useMemo(() => {
    const map = new Map<string, { native: number; baseDzd: number; inflows: number; outflows: number; txCount: number }>();

    const init = () => ({ native: 0, baseDzd: 0, inflows: 0, outflows: 0, txCount: 0 });
    map.set('cash', init());
    for (const b of bankAccounts) {
      map.set(b.id, init());
    }

    for (const e of ledgerEntries) {
      if (e.status !== 'valide') continue;
      const key = e.bankAccountId === null ? 'cash' : e.bankAccountId;
      const cur = map.get(key) || init();
      if (e.direction === 'entree') {
        cur.native = addMoney(cur.native, e.amountCentimes);
        cur.baseDzd = addMoney(cur.baseDzd, e.baseDzdAmountCentimes);
        cur.inflows = addMoney(cur.inflows, e.amountCentimes);
      } else {
        cur.native = subtractMoney(cur.native, e.amountCentimes);
        cur.baseDzd = subtractMoney(cur.baseDzd, e.baseDzdAmountCentimes);
        cur.outflows = addMoney(cur.outflows, e.amountCentimes);
      }
      cur.txCount += 1;
      map.set(key, cur);
    }

    return map;
  }, [bankAccounts, ledgerEntries]);

  const selectedHistory = useMemo(() => {
    return ledgerEntries
      .filter((e) => {
        if (e.status !== 'valide') return false;
        if (selectedAccountId === 'cash') return e.bankAccountId === null;
        return e.bankAccountId === selectedAccountId;
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [ledgerEntries, selectedAccountId]);

  const selectedAccount =
    selectedAccountId === 'cash'
      ? null
      : bankAccounts.find((b) => b.id === selectedAccountId) || null;

  const openModal = (bank?: BankAccount) => {
    setEditingBank(bank);
    setBankName(bank?.bankName || '');
    setAccountName(bank?.accountName || '');
    setAccountNumber(bank?.accountNumber || '');
    setRib(bank?.rib || '');
    setCurrency(bank?.currency || defaultCurrency);
    setOpeningBalanceText(bank ? centimesToInputString(bank.openingBalanceCentimes) : '0,00');
    setOpeningDate(bank?.openingDate || new Date().toISOString().slice(0, 10));
    setNotes(bank?.notes || '');
    setModalOpen(true);
  };

  const handleSaveBank = async (e: React.FormEvent) => {
    e.preventDefault();
    const opening = parseMoneyInputToCentimes(openingBalanceText);
    if (Number.isNaN(opening)) {
      pushToast({ type: 'error', title: 'Montant invalide', message: 'Solde d’ouverture incorrect.' });
      return;
    }

    const currCfg = currencies?.find((c) => c.code === currency);
    try {
      const saved = await saveBankAccount({
        existingId: editingBank?.id,
        bankName,
        accountName,
        accountNumber,
        rib,
        currency,
        openingBalanceCentimes: opening,
        openingDate,
        notes,
        exchangeRateToDzd: currCfg?.rateToDzd || 1,
      });
      setModalOpen(false);
      setSelectedAccountId(saved.id);
      pushToast({
        type: 'success',
        title: editingBank ? 'Compte mis à jour' : 'Compte bancaire créé',
        message: `${saved.bankName} — ${saved.accountName}`,
      });
    } catch (err) {
      pushToast({
        type: 'error',
        title: 'Erreur',
        message: err instanceof Error ? err.message : 'Erreur',
      });
    }
  };

  const handleToggleActive = async (bank: BankAccount) => {
    await db.bankAccounts.update(bank.id, {
      active: !bank.active,
      updatedAt: new Date().toISOString(),
    });
    await recordAudit({
      action: 'MODIFICATION',
      entityType: 'compte_bancaire',
      entityId: bank.id,
      summary: `${bank.active ? 'Désactivation' : 'Réactivation'} compte ${bank.bankName} — ${bank.accountName}`,
    });
    pushToast({
      type: 'info',
      title: bank.active ? 'Compte désactivé' : 'Compte réactivé',
    });
  };

  const cashBal = accountBalances.get('cash');

  return (
    <div className="space-y-5">
      {/* En-tête */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Caisse espèces & Comptes bancaires
          </h2>
          <p className="text-xs text-slate-500">
            Les soldes actuels sont calculés uniquement depuis les mouvements réels validés du grand livre.
          </p>
        </div>
        <button
          type="button"
          onClick={() => openModal()}
          className="inline-flex items-center gap-2 rounded-md bg-[#0F1E36] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a2f52]"
        >
          <Plus className="h-4 w-4" />
          <span>Ajouter un compte bancaire</span>
        </button>
      </div>

      {/* Grille des comptes + historique */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="lg:col-span-5 space-y-3">
          {/* Caisse espèces */}
          <div
            onClick={() => setSelectedAccountId('cash')}
            className={`cursor-pointer rounded-lg border p-4 transition-colors ${
              selectedAccountId === 'cash'
                ? 'border-[#1D4ED8] bg-blue-50/50'
                : 'border-slate-200 bg-white hover:bg-slate-50'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Wallet className="h-5 w-5 text-slate-700" />
                <div>
                  <div className="text-sm font-semibold text-slate-900">Caisse espèces</div>
                  <div className="text-xs text-slate-500">
                    {cashBal?.txCount || 0} mouvement(s) enregistré(s)
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-base font-bold text-slate-900 tabular-nums">
                  {formatMoney(cashBal?.baseDzd || 0, defaultCurrency, currencies)}
                </div>
                <div className="text-[11px] text-slate-500">Solde réel</div>
              </div>
            </div>
          </div>

          {/* Comptes bancaires */}
          {bankAccounts.map((bank) => {
            const bal = accountBalances.get(bank.id);
            const isSelected = selectedAccountId === bank.id;
            return (
              <div
                key={bank.id}
                onClick={() => setSelectedAccountId(bank.id)}
                className={`cursor-pointer rounded-lg border p-4 transition-colors ${
                  isSelected
                    ? 'border-[#1D4ED8] bg-blue-50/50'
                    : 'border-slate-200 bg-white hover:bg-slate-50'
                } ${!bank.active ? 'opacity-65' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2.5">
                    <Landmark className="mt-0.5 h-5 w-5 text-[#0F1E36]" />
                    <div>
                      <div className="text-sm font-semibold text-slate-900">
                        {bank.bankName} — {bank.accountName}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        {[bank.currency, bank.accountNumber || bank.rib].filter(Boolean).join(' · ')}
                      </div>
                      <div className="mt-1 text-[11px] text-slate-500 tabular-nums">
                        Ouverture ({bank.openingDate}) :{' '}
                        {formatMoney(bank.openingBalanceCentimes, bank.currency, currencies)}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-base font-bold text-slate-900 tabular-nums">
                      {formatMoney(bal?.native || 0, bank.currency, currencies)}
                    </div>
                    {bank.currency !== defaultCurrency && (
                      <div className="text-[11px] text-slate-500 tabular-nums">
                        ≈ {formatMoney(bal?.baseDzd || 0, defaultCurrency, currencies)}
                      </div>
                    )}
                    <div className="mt-2 flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openModal(bank);
                        }}
                        title="Modifier le compte"
                        className="rounded p-1 text-slate-500 hover:bg-slate-200/70 hover:text-slate-800"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleActive(bank);
                        }}
                        title={bank.active ? 'Désactiver' : 'Réactiver'}
                        className="rounded p-1 text-slate-500 hover:bg-slate-200/70 hover:text-slate-800"
                      >
                        <Archive className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Historique des mouvements du compte sélectionné */}
        <div className="lg:col-span-7 rounded-lg border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200 pb-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                {selectedAccount
                  ? `Historique — ${selectedAccount.bankName} (${selectedAccount.accountName})`
                  : 'Historique — Caisse espèces'}
              </h3>
              <p className="text-xs text-slate-500">
                {selectedHistory.length} mouvement(s) réel(s) validé(s)
              </p>
            </div>
            {selectedAccount && (
              <div className="text-right text-xs text-slate-600">
                {selectedAccount.rib && <div>RIB : {selectedAccount.rib}</div>}
                <div>Devise : {selectedAccount.currency}</div>
              </div>
            )}
          </div>

          {selectedHistory.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-500">
              Aucun mouvement enregistré sur ce compte.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
                  <tr>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Libellé</th>
                    <th className="px-3 py-2">Sens</th>
                    <th className="px-3 py-2 text-right">Montant</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {selectedHistory.map((entry) => (
                    <tr key={entry.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 text-slate-600 tabular-nums whitespace-nowrap">
                        {entry.date}
                      </td>
                      <td className="px-3 py-2 text-slate-800">{entry.label}</td>
                      <td className="px-3 py-2 text-slate-500">
                        {entry.direction === 'entree' ? 'Entrée' : 'Sortie'}
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-semibold tabular-nums whitespace-nowrap ${
                          entry.direction === 'entree' ? 'text-emerald-700' : 'text-red-700'
                        }`}
                      >
                        {entry.direction === 'entree' ? '+' : '-'}
                        {formatMoney(entry.amountCentimes, entry.currency, currencies)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Modale Ajout / Modification Banque */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-[#0F1E36] px-6 py-4 text-white">
              <h2 className="text-base font-semibold">
                {editingBank ? 'Modifier le compte bancaire' : 'Nouveau compte bancaire'}
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded p-1 text-slate-300 hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveBank} className="p-6 space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Banque *</label>
                  <input
                    type="text"
                    required
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                    placeholder="Ex : BNA, CPA, BEA, BDL, AGB..."
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Intitulé du compte *</label>
                  <input
                    type="text"
                    required
                    value={accountName}
                    onChange={(e) => setAccountName(e.target.value)}
                    placeholder="Ex : Compte courant Alger"
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">N° de compte</label>
                  <input
                    type="text"
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">RIB</label>
                  <input
                    type="text"
                    value={rib}
                    onChange={(e) => setRib(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Devise du compte</label>
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    {(currencies || []).map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.code} — {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Solde d’ouverture</label>
                  <input
                    type="text"
                    value={openingBalanceText}
                    onChange={(e) => setOpeningBalanceText(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-right tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Date d’ouverture *</label>
                  <input
                    type="date"
                    required
                    value={openingDate}
                    onChange={(e) => setOpeningDate(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Notes</label>
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
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
                  className="rounded-md bg-[#0F1E36] px-5 py-2 text-sm font-medium text-white hover:bg-[#1a2f52]"
                >
                  Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
