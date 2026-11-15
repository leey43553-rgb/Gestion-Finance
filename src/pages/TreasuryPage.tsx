import React, { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowDownLeft, ArrowUpRight, Landmark, Search, Wallet } from 'lucide-react';
import { db } from '../db/database';
import type { LedgerSourceType } from '../db/types';
import { computeLedgerTotals } from '../utils/finance';
import { addMoney, formatMoney, subtractMoney } from '../utils/money';

const SOURCE_LABELS: Record<LedgerSourceType, string> = {
  solde_ouverture: 'Solde d’ouverture',
  paiement_client: 'Paiement client',
  paiement_fournisseur: 'Règlement fournisseur',
  depense: 'Dépense',
  cheque_recu_encaisse: 'Chèque reçu encaissé',
  cheque_emis_encaisse: 'Chèque émis encaissé',
};

export const TreasuryPage: React.FC = () => {
  const settings = useLiveQuery(() => db.settings.get('company_settings'));
  const ledgerEntries = useLiveQuery(() => db.ledgerEntries.toArray(), [], []);
  const bankAccounts = useLiveQuery(() => db.bankAccounts.toArray(), [], []);
  const incomingCheques = useLiveQuery(() => db.incomingCheques.toArray(), [], []);
  const outgoingCheques = useLiveQuery(() => db.outgoingCheques.toArray(), [], []);

  const [search, setSearch] = useState('');
  const [accountFilter, setAccountFilter] = useState<'tous' | 'cash' | string>('tous');
  const [directionFilter, setDirectionFilter] = useState<'tous' | 'entree' | 'sortie'>('tous');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const defaultCurrency = settings?.defaultCurrency || 'DZD';
  const currencies = settings?.enabledCurrencies;
  const bankMap = useMemo(() => new Map(bankAccounts.map((b) => [b.id, b])), [bankAccounts]);

  // 1. Balance réelle : argent entré vs argent sorti (hors soldes d'ouverture pour les flux, et total avec ouverture pour le disponible)
  const moneyBalance = useMemo(() => {
    const allTotals = computeLedgerTotals(ledgerEntries);
    let operationalIn = 0;
    let operationalOut = 0;

    for (const e of ledgerEntries) {
      if (e.status !== 'valide' || e.sourceType === 'solde_ouverture') continue;
      if (e.direction === 'entree') operationalIn = addMoney(operationalIn, e.baseDzdAmountCentimes);
      else operationalOut = addMoney(operationalOut, e.baseDzdAmountCentimes);
    }

    return {
      ...allTotals,
      operationalIn,
      operationalOut,
      operationalNet: subtractMoney(operationalIn, operationalOut),
    };
  }, [ledgerEntries]);

  // 2. Balance séparée des chèques reçus vs chèques émis
  const chequeBalance = useMemo(() => {
    let inPending = 0;
    let inPendingCount = 0;
    let inCleared = 0;
    let outPending = 0;
    let outPendingCount = 0;
    let outCleared = 0;

    for (const c of incomingCheques) {
      if (c.status === 'encaisse') {
        inCleared = addMoney(inCleared, c.baseDzdAmountCentimes);
      } else if (c.status === 'recu' || c.status === 'depose' || c.status === 'en_attente') {
        inPending = addMoney(inPending, c.baseDzdAmountCentimes);
        inPendingCount += 1;
      }
    }

    for (const c of outgoingCheques) {
      if (c.status === 'encaisse') {
        outCleared = addMoney(outCleared, c.baseDzdAmountCentimes);
      } else if (
        c.status === 'prepare' ||
        c.status === 'remis' ||
        c.status === 'depose' ||
        c.status === 'en_attente'
      ) {
        outPending = addMoney(outPending, c.baseDzdAmountCentimes);
        outPendingCount += 1;
      }
    }

    const pendingNet = subtractMoney(inPending, outPending);
    const clearedNet = subtractMoney(inCleared, outCleared);
    const projectedTreasury = addMoney(moneyBalance.netBalanceBaseDzd, pendingNet);

    return {
      inPending,
      inPendingCount,
      inCleared,
      outPending,
      outPendingCount,
      outCleared,
      pendingNet,
      clearedNet,
      projectedTreasury,
    };
  }, [incomingCheques, outgoingCheques, moneyBalance.netBalanceBaseDzd]);

  // Solde par compte (Caisse + chaque banque)
  const perAccount = useMemo(() => {
    const cash = { label: 'Caisse espèces', currency: defaultCurrency, native: 0, baseDzd: 0 };
    const banks = new Map<
      string,
      { id: string; label: string; currency: string; native: number; baseDzd: number }
    >();
    for (const b of bankAccounts) {
      banks.set(b.id, {
        id: b.id,
        label: `${b.bankName} — ${b.accountName}`,
        currency: b.currency,
        native: 0,
        baseDzd: 0,
      });
    }

    for (const e of ledgerEntries) {
      if (e.status !== 'valide') continue;
      if (e.bankAccountId === null) {
        cash.native =
          e.direction === 'entree'
            ? addMoney(cash.native, e.amountCentimes)
            : subtractMoney(cash.native, e.amountCentimes);
        cash.baseDzd =
          e.direction === 'entree'
            ? addMoney(cash.baseDzd, e.baseDzdAmountCentimes)
            : subtractMoney(cash.baseDzd, e.baseDzdAmountCentimes);
      } else {
        const b = banks.get(e.bankAccountId);
        if (b) {
          b.native =
            e.direction === 'entree'
              ? addMoney(b.native, e.amountCentimes)
              : subtractMoney(b.native, e.amountCentimes);
          b.baseDzd =
            e.direction === 'entree'
              ? addMoney(b.baseDzd, e.baseDzdAmountCentimes)
              : subtractMoney(b.baseDzd, e.baseDzdAmountCentimes);
        }
      }
    }

    return { cash, banks: Array.from(banks.values()) };
  }, [ledgerEntries, bankAccounts, defaultCurrency]);

  const filteredLedger = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ledgerEntries
      .filter((e) => {
        if (e.status !== 'valide') return false;
        if (accountFilter === 'cash' && e.bankAccountId !== null) return false;
        if (
          accountFilter !== 'tous' &&
          accountFilter !== 'cash' &&
          e.bankAccountId !== accountFilter
        )
          return false;
        if (directionFilter !== 'tous' && e.direction !== directionFilter) return false;
        if (dateFrom && e.date < dateFrom) return false;
        if (dateTo && e.date > dateTo) return false;
        if (q && !e.label.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [ledgerEntries, accountFilter, directionFilter, dateFrom, dateTo, search]);

  return (
    <div className="space-y-6">
      {/* Section 1 : Balance réelle argent entré vs argent sorti */}
      <section className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200 pb-3">
            <div className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-[#0F1E36]" />
              <h2 className="text-base font-semibold text-slate-900">
                Balance réelle : Argent entré vs Argent dépensé
              </h2>
            </div>
            <span className="text-xs text-slate-500">Grand livre validé</span>
          </div>

          <div className="grid grid-cols-3 gap-3 text-sm">
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Entrées d’exploitation</div>
              <div className="mt-1 font-bold text-emerald-700 tabular-nums">
                +{formatMoney(moneyBalance.operationalIn, defaultCurrency, currencies)}
              </div>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Sorties / Dépenses</div>
              <div className="mt-1 font-bold text-red-700 tabular-nums">
                -{formatMoney(moneyBalance.operationalOut, defaultCurrency, currencies)}
              </div>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Variation nette</div>
              <div
                className={`mt-1 font-bold tabular-nums ${
                  moneyBalance.operationalNet >= 0 ? 'text-emerald-700' : 'text-red-700'
                }`}
              >
                {formatMoney(moneyBalance.operationalNet, defaultCurrency, currencies)}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md bg-[#0F1E36] px-4 py-3 text-white">
            <span className="text-xs font-medium text-slate-200">
              Trésorerie disponible totale (soldes d’ouverture inclus)
            </span>
            <span className="text-lg font-bold tabular-nums">
              {formatMoney(moneyBalance.netBalanceBaseDzd, defaultCurrency, currencies)}
            </span>
          </div>
        </div>

        {/* Section 2 : Balance séparée des Chèques reçus vs Chèques émis */}
        <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200 pb-3">
            <div className="flex items-center gap-2">
              <Landmark className="h-5 w-5 text-amber-600" />
              <h2 className="text-base font-semibold text-slate-900">
                Balance des chèques : Reçus vs Émis
              </h2>
            </div>
            <span className="text-xs text-slate-500">Séparée du solde réel</span>
          </div>

          <div className="grid grid-cols-3 gap-3 text-sm">
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center gap-1 text-xs text-slate-500">
                <ArrowDownLeft className="h-3.5 w-3.5 text-emerald-600" />
                <span>Reçus en attente ({chequeBalance.inPendingCount})</span>
              </div>
              <div className="mt-1 font-bold text-emerald-700 tabular-nums">
                +{formatMoney(chequeBalance.inPending, defaultCurrency, currencies)}
              </div>
              <div className="mt-1 text-[11px] text-slate-500 tabular-nums">
                Déjà encaissés : {formatMoney(chequeBalance.inCleared, defaultCurrency, currencies)}
              </div>
            </div>

            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center gap-1 text-xs text-slate-500">
                <ArrowUpRight className="h-3.5 w-3.5 text-red-600" />
                <span>Émis en attente ({chequeBalance.outPendingCount})</span>
              </div>
              <div className="mt-1 font-bold text-red-700 tabular-nums">
                -{formatMoney(chequeBalance.outPending, defaultCurrency, currencies)}
              </div>
              <div className="mt-1 text-[11px] text-slate-500 tabular-nums">
                Déjà encaissés : {formatMoney(chequeBalance.outCleared, defaultCurrency, currencies)}
              </div>
            </div>

            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Solde net chèques en attente</div>
              <div
                className={`mt-1 font-bold tabular-nums ${
                  chequeBalance.pendingNet >= 0 ? 'text-emerald-700' : 'text-red-700'
                }`}
              >
                {formatMoney(chequeBalance.pendingNet, defaultCurrency, currencies)}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950">
            <span className="text-xs font-medium">
              Trésorerie prévisionnelle après encaissement de tous les chèques en attente
            </span>
            <span className="text-base font-bold tabular-nums">
              {formatMoney(chequeBalance.projectedTreasury, defaultCurrency, currencies)}
            </span>
          </div>
        </div>
      </section>

      {/* Soldes par compte */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">{perAccount.cash.label}</div>
          <div className="mt-1 text-base font-bold text-slate-900 tabular-nums">
            {formatMoney(perAccount.cash.baseDzd, defaultCurrency, currencies)}
          </div>
        </div>
        {perAccount.banks.map((b) => (
          <div key={b.id} className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="truncate text-xs text-slate-500">{b.label}</div>
            <div className="mt-1 text-base font-bold text-slate-900 tabular-nums">
              {formatMoney(b.native, b.currency, currencies)}
            </div>
          </div>
        ))}
      </section>

      {/* Grand livre complet */}
      <section className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Grand livre (Source unique de vérité des mouvements réels)
            </h3>
            <p className="text-xs text-slate-500">
              Aucun doublon : les chèques et dépenses par chèque n’apparaissent ici qu’à leur date d’encaissement.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-2 left-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filtrer libellé..."
                className="w-48 rounded-md border border-slate-300 py-1 pr-2.5 pl-8 text-xs"
              />
            </div>

            <select
              value={accountFilter}
              onChange={(e) => setAccountFilter(e.target.value)}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs"
            >
              <option value="tous">Tous comptes</option>
              <option value="cash">Caisse espèces</option>
              {bankAccounts.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.bankName} — {b.accountName}
                </option>
              ))}
            </select>

            <select
              value={directionFilter}
              onChange={(e) =>
                setDirectionFilter(e.target.value as 'tous' | 'entree' | 'sortie')
              }
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs"
            >
              <option value="tous">Entrées & Sorties</option>
              <option value="entree">Entrées uniquement</option>
              <option value="sortie">Sorties uniquement</option>
            </select>

            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs"
            />
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
              <tr>
                <th className="px-3 py-2.5">Date</th>
                <th className="px-3 py-2.5">Origine</th>
                <th className="px-3 py-2.5">Compte</th>
                <th className="px-3 py-2.5">Libellé</th>
                <th className="px-3 py-2.5 text-right">Entrée</th>
                <th className="px-3 py-2.5 text-right">Sortie</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredLedger.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">
                    Aucun mouvement dans le grand livre pour ces critères.
                  </td>
                </tr>
              ) : (
                filteredLedger.map((e) => {
                  const bank = e.bankAccountId ? bankMap.get(e.bankAccountId) : null;
                  return (
                    <tr key={e.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 text-slate-600 tabular-nums whitespace-nowrap">
                        {e.date}
                      </td>
                      <td className="px-3 py-2 text-slate-600 whitespace-nowrap">
                        {SOURCE_LABELS[e.sourceType]}
                      </td>
                      <td className="px-3 py-2 text-slate-700 whitespace-nowrap">
                        {bank ? `${bank.bankName} — ${bank.accountName}` : 'Caisse espèces'}
                      </td>
                      <td className="px-3 py-2 text-slate-900">{e.label}</td>
                      <td className="px-3 py-2 text-right font-semibold text-emerald-700 tabular-nums whitespace-nowrap">
                        {e.direction === 'entree'
                          ? formatMoney(e.baseDzdAmountCentimes, defaultCurrency, currencies)
                          : '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-red-700 tabular-nums whitespace-nowrap">
                        {e.direction === 'sortie'
                          ? formatMoney(e.baseDzdAmountCentimes, defaultCurrency, currencies)
                          : '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
