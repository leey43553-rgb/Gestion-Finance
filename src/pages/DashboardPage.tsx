import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Database,
  FileText,
  Landmark,
  Plus,
  Truck,
  Users,
  Wallet,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { db } from '../db/database';
import {
  computeInvoicePaidCentimes,
  computeInvoiceRemainingCentimes,
  computeInvoiceStatus,
  computeLedgerTotals,
} from '../utils/finance';
import { addMoney, formatMoney } from '../utils/money';
import { InvoiceFormModal } from '../components/InvoiceFormModal';
import { PaymentModal } from '../components/PaymentModal';

const CHART_COLORS = ['#0F1E36', '#1D4ED8', '#15803D', '#D97706', '#DC2626', '#6D28D9', '#0F766E', '#475569'];

export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const settings = useLiveQuery(() => db.settings.get('company_settings'));
  const ledgerEntries = useLiveQuery(() => db.ledgerEntries.toArray(), [], []);
  const customerInvoices = useLiveQuery(() => db.customerInvoices.toArray(), [], []);
  const supplierInvoices = useLiveQuery(() => db.supplierInvoices.toArray(), [], []);
  const payments = useLiveQuery(() => db.payments.toArray(), [], []);
  const allocations = useLiveQuery(() => db.paymentAllocations.toArray(), [], []);
  const incomingCheques = useLiveQuery(() => db.incomingCheques.toArray(), [], []);
  const outgoingCheques = useLiveQuery(() => db.outgoingCheques.toArray(), [], []);
  const expenses = useLiveQuery(() => db.expenses.toArray(), [], []);
  const bankAccounts = useLiveQuery(() => db.bankAccounts.toArray(), [], []);
  const contacts = useLiveQuery(() => db.contacts.toArray(), [], []);

  const [quickInvoiceOpen, setQuickInvoiceOpen] = useState(false);
  const [quickPaymentOpen, setQuickPaymentOpen] = useState(false);

  const defaultCurrency = settings?.defaultCurrency || 'DZD';
  const currencies = settings?.enabledCurrencies;
  const contactMap = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);

  const currentMonth = new Date().toISOString().slice(0, 7);
  const today = new Date().toISOString().slice(0, 10);

  const stats = useMemo(() => {
    const ledgerSummary = computeLedgerTotals(ledgerEntries);

    let cashBalance = 0;
    let bankBalance = 0;
    let monthlyIncome = 0;
    let monthlyExpenses = 0;

    for (const e of ledgerEntries) {
      if (e.status !== 'valide') continue;
      const signed = e.direction === 'entree' ? e.baseDzdAmountCentimes : -e.baseDzdAmountCentimes;
      if (e.bankAccountId === null) cashBalance = addMoney(cashBalance, signed);
      else bankBalance = addMoney(bankBalance, signed);

      if (e.sourceType !== 'solde_ouverture' && e.date.startsWith(currentMonth)) {
        if (e.direction === 'entree') monthlyIncome = addMoney(monthlyIncome, e.baseDzdAmountCentimes);
        else monthlyExpenses = addMoney(monthlyExpenses, e.baseDzdAmountCentimes);
      }
    }

    const validPaymentIds = new Set(
      payments.filter((p) => p.status === 'valide').map((p) => p.id)
    );

    let unpaidClientTotal = 0;
    let unpaidClientCount = 0;
    const upcomingInvoices: Array<{
      id: string;
      kind: 'client' | 'fournisseur';
      number: string;
      contactName: string;
      dueDate: string;
      remaining: number;
      currency: string;
      overdue: boolean;
    }> = [];

    for (const inv of customerInvoices) {
      if (inv.status === 'annulee') continue;
      const paid = computeInvoicePaidCentimes(inv.id, allocations, validPaymentIds);
      const rem = computeInvoiceRemainingCentimes(inv.totalTtcCentimes, paid, inv.status);
      if (rem > 0) {
        unpaidClientCount += 1;
        const ratio = inv.totalTtcCentimes > 0 ? rem / inv.totalTtcCentimes : 0;
        unpaidClientTotal = addMoney(unpaidClientTotal, Math.round(inv.baseDzdTtcCentimes * ratio));
        const st = computeInvoiceStatus({
          storedStatus: inv.status,
          totalTtcCentimes: inv.totalTtcCentimes,
          paidCentimes: paid,
          dueDate: inv.dueDate,
          referenceDate: today,
        });
        const c = contactMap.get(inv.clientId);
        upcomingInvoices.push({
          id: inv.id,
          kind: 'client',
          number: inv.invoiceNumber,
          contactName: c ? c.company || c.name : 'Client',
          dueDate: inv.dueDate,
          remaining: rem,
          currency: inv.currency,
          overdue: st === 'en_retard',
        });
      }
    }

    let unpaidSupplierTotal = 0;
    let unpaidSupplierCount = 0;
    for (const inv of supplierInvoices) {
      if (inv.status === 'annulee') continue;
      const paid = computeInvoicePaidCentimes(inv.id, allocations, validPaymentIds);
      const rem = computeInvoiceRemainingCentimes(inv.totalTtcCentimes, paid, inv.status);
      if (rem > 0) {
        unpaidSupplierCount += 1;
        const ratio = inv.totalTtcCentimes > 0 ? rem / inv.totalTtcCentimes : 0;
        unpaidSupplierTotal = addMoney(
          unpaidSupplierTotal,
          Math.round(inv.baseDzdTtcCentimes * ratio)
        );
        const st = computeInvoiceStatus({
          storedStatus: inv.status,
          totalTtcCentimes: inv.totalTtcCentimes,
          paidCentimes: paid,
          dueDate: inv.dueDate,
          referenceDate: today,
        });
        const c = contactMap.get(inv.supplierId);
        upcomingInvoices.push({
          id: inv.id,
          kind: 'fournisseur',
          number: inv.invoiceNumber,
          contactName: c ? c.company || c.name : 'Fournisseur',
          dueDate: inv.dueDate,
          remaining: rem,
          currency: inv.currency,
          overdue: st === 'en_retard',
        });
      }
    }

    upcomingInvoices.sort((a, b) => a.dueDate.localeCompare(b.dueDate));

    let incomingChequesTotal = 0;
    let pendingIncomingCheques = 0;
    let pendingIncomingCount = 0;
    for (const chq of incomingCheques) {
      if (chq.status !== 'annule' && chq.status !== 'rejete') {
        incomingChequesTotal = addMoney(incomingChequesTotal, chq.baseDzdAmountCentimes);
      }
      if (chq.status === 'recu' || chq.status === 'depose' || chq.status === 'en_attente') {
        pendingIncomingCount += 1;
        pendingIncomingCheques = addMoney(pendingIncomingCheques, chq.baseDzdAmountCentimes);
      }
    }

    let outgoingChequesTotal = 0;
    let pendingOutgoingCheques = 0;
    let pendingOutgoingCount = 0;
    for (const chq of outgoingCheques) {
      if (chq.status !== 'annule' && chq.status !== 'rejete') {
        outgoingChequesTotal = addMoney(outgoingChequesTotal, chq.baseDzdAmountCentimes);
      }
      if (
        chq.status === 'prepare' ||
        chq.status === 'remis' ||
        chq.status === 'depose' ||
        chq.status === 'en_attente'
      ) {
        pendingOutgoingCount += 1;
        pendingOutgoingCheques = addMoney(pendingOutgoingCheques, chq.baseDzdAmountCentimes);
      }
    }

    // Graphique 6 derniers mois : Recettes vs Dépenses (unités majeures pour Recharts)
    const months: string[] = [];
    const nowDate = new Date();
    for (let i = 5; i >= 0; i -= 1) {
      const d = new Date(nowDate.getFullYear(), nowDate.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }

    const monthlySeries = months.map((ym) => {
      let recCentimes = 0;
      let depCentimes = 0;
      for (const e of ledgerEntries) {
        if (e.status !== 'valide' || e.sourceType === 'solde_ouverture') continue;
        if (!e.date.startsWith(ym)) continue;
        if (e.direction === 'entree') recCentimes = addMoney(recCentimes, e.baseDzdAmountCentimes);
        else depCentimes = addMoney(depCentimes, e.baseDzdAmountCentimes);
      }
      return {
        mois: ym,
        Recettes: Math.round(recCentimes / 100),
        Dépenses: Math.round(depCentimes / 100),
      };
    });

    // Graphique catégories de dépenses
    const catTotals = new Map<string, number>();
    for (const exp of expenses) {
      if (exp.status !== 'valide') continue;
      catTotals.set(
        exp.categoryName,
        addMoney(catTotals.get(exp.categoryName) || 0, exp.baseDzdAmountCentimes)
      );
    }
    const categorySeries = Array.from(catTotals.entries())
      .map(([name, val]) => ({ name, value: Math.round(val / 100), centimes: val }))
      .sort((a, b) => b.centimes - a.centimes);

    const recentLedger = [...ledgerEntries]
      .filter((e) => e.status === 'valide')
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 7);

    return {
      ...ledgerSummary,
      cashBalance,
      bankBalance,
      monthlyIncome,
      monthlyExpenses,
      unpaidClientTotal,
      unpaidClientCount,
      unpaidSupplierTotal,
      unpaidSupplierCount,
      incomingChequesTotal,
      pendingIncomingCheques,
      pendingIncomingCount,
      outgoingChequesTotal,
      pendingOutgoingCheques,
      pendingOutgoingCount,
      monthlySeries,
      categorySeries,
      recentLedger,
      upcomingInvoices: upcomingInvoices.slice(0, 6),
    };
  }, [
    ledgerEntries,
    customerInvoices,
    supplierInvoices,
    payments,
    allocations,
    incomingCheques,
    outgoingCheques,
    expenses,
    currentMonth,
    today,
    contactMap,
  ]);

  const isEmpty =
    ledgerEntries.length === 0 &&
    customerInvoices.length === 0 &&
    supplierInvoices.length === 0 &&
    expenses.length === 0;

  return (
    <div className="space-y-6">
      {/* 6 boutons d'actions rapides */}
      <section className="flex flex-wrap items-center gap-2.5 rounded-lg border border-slate-200 bg-white p-3.5">
        <span className="mr-2 text-xs font-semibold text-slate-500">Actions rapides :</span>
        <button
          type="button"
          onClick={() => navigate('/depenses')}
          className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Ajouter une dépense</span>
        </button>
        <button
          type="button"
          onClick={() => setQuickInvoiceOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-[#0F1E36] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1a2f52]"
        >
          <FileText className="h-3.5 w-3.5" />
          <span>Nouvelle facture</span>
        </button>
        <button
          type="button"
          onClick={() => setQuickPaymentOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
        >
          <Wallet className="h-3.5 w-3.5" />
          <span>Enregistrer un paiement</span>
        </button>
        <button
          type="button"
          onClick={() => navigate('/clients')}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          <Users className="h-3.5 w-3.5" />
          <span>Ajouter un client</span>
        </button>
        <button
          type="button"
          onClick={() => navigate('/fournisseurs')}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          <Truck className="h-3.5 w-3.5" />
          <span>Ajouter un fournisseur</span>
        </button>
        <button
          type="button"
          onClick={() => navigate('/cheques-recus')}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          <Landmark className="h-3.5 w-3.5" />
          <span>Ajouter un chèque</span>
        </button>
      </section>

      {/* Bloc 1 : Trésorerie réelle & Flux du mois */}
      <section>
        <div className="mb-2.5 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">
            Trésorerie disponible (argent réel en caisse et en banque)
          </h2>
          <span className="text-xs text-slate-500">Mois en cours : {currentMonth}</span>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-xs text-slate-500">Total disponible (Banques + Caisse)</div>
            <div className="mt-1.5 text-xl font-bold text-slate-900 tabular-nums">
              {formatMoney(stats.netBalanceBaseDzd, defaultCurrency, currencies)}
            </div>
            <div className="mt-1 text-[11px] text-slate-500 tabular-nums">
              Caisse : {formatMoney(stats.cashBalance, defaultCurrency, currencies)} · Banques (
              {bankAccounts.length}) : {formatMoney(stats.bankBalance, defaultCurrency, currencies)}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Recettes encaissées (ce mois)</span>
              <ArrowDownLeft className="h-4 w-4 text-emerald-600" />
            </div>
            <div className="mt-1.5 text-xl font-bold text-emerald-700 tabular-nums">
              {formatMoney(stats.monthlyIncome, defaultCurrency, currencies)}
            </div>
            <div className="mt-1 text-[11px] text-slate-500">Mouvements réels grand livre</div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Dépenses & sorties (ce mois)</span>
              <ArrowUpRight className="h-4 w-4 text-red-600" />
            </div>
            <div className="mt-1.5 text-xl font-bold text-red-700 tabular-nums">
              {formatMoney(stats.monthlyExpenses, defaultCurrency, currencies)}
            </div>
            <div className="mt-1 text-[11px] text-slate-500">Hors chèques non encore encaissés</div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-xs text-slate-500">Résultat net réel du mois</div>
            <div
              className={`mt-1.5 text-xl font-bold tabular-nums ${
                stats.monthlyIncome - stats.monthlyExpenses >= 0
                  ? 'text-emerald-700'
                  : 'text-red-700'
              }`}
            >
              {formatMoney(stats.monthlyIncome - stats.monthlyExpenses, defaultCurrency, currencies)}
            </div>
            <div className="mt-1 text-[11px] text-slate-500">Recettes moins sorties du mois</div>
          </div>
        </div>
      </section>

      {/* Bloc 2 : Créances, Dettes & Chèques en attente (séparés du réel) */}
      <section>
        <div className="mb-2.5 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">
            À recevoir, à payer & Chèques en attente (hors solde réel)
          </h2>
          <Link to="/tresorerie" className="text-xs font-medium text-[#1D4ED8] hover:underline">
            Voir la balance complète →
          </Link>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-xs text-slate-500">Factures clients impayées</div>
            <div className="mt-1 text-lg font-bold text-emerald-700 tabular-nums">
              {formatMoney(stats.unpaidClientTotal, defaultCurrency, currencies)}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500">
              {stats.unpaidClientCount} facture(s) à encaisser
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-xs text-slate-500">Factures fournisseurs impayées</div>
            <div className="mt-1 text-lg font-bold text-red-700 tabular-nums">
              {formatMoney(stats.unpaidSupplierTotal, defaultCurrency, currencies)}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500">
              {stats.unpaidSupplierCount} facture(s) à régler
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-xs text-slate-500">Chèques reçus en attente</div>
            <div className="mt-1 text-lg font-bold text-amber-700 tabular-nums">
              {formatMoney(stats.pendingIncomingCheques, defaultCurrency, currencies)}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500 tabular-nums">
              {stats.pendingIncomingCount} en attente · Total reçus :{' '}
              {formatMoney(stats.incomingChequesTotal, defaultCurrency, currencies)}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-xs text-slate-500">Chèques émis en attente</div>
            <div className="mt-1 text-lg font-bold text-amber-700 tabular-nums">
              {formatMoney(stats.pendingOutgoingCheques, defaultCurrency, currencies)}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500 tabular-nums">
              {stats.pendingOutgoingCount} en attente · Total émis :{' '}
              {formatMoney(stats.outgoingChequesTotal, defaultCurrency, currencies)}
            </div>
          </div>
        </div>
      </section>

      {isEmpty ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center">
          <Database className="mx-auto h-10 w-10 text-slate-400" />
          <h3 className="mt-3 text-base font-semibold text-slate-900">
            Votre base de données locale est prête
          </h3>
          <p className="mx-auto mt-1 max-w-lg text-sm text-slate-600">
            Commencez à saisir vos opérations avec les boutons ci-dessus ou chargez les données de démonstration fictives depuis <strong>Paramètres</strong>.
          </p>
        </div>
      ) : (
        <>
          {/* Graphiques Recharts */}
          <section className="grid grid-cols-1 gap-5 lg:grid-cols-12">
            <div className="lg:col-span-7 rounded-lg border border-slate-200 bg-white p-5">
              <h3 className="text-sm font-semibold text-slate-900">
                Recettes vs Dépenses (6 derniers mois, {defaultCurrency})
              </h3>
              <div className="mt-4 h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats.monthlySeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="mois" tick={{ fontSize: 11, fill: '#64748b' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#64748b' }} />
                    <Tooltip />
                    <Bar dataKey="Recettes" fill="#15803d" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="Dépenses" fill="#dc2626" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="lg:col-span-5 rounded-lg border border-slate-200 bg-white p-5">
              <h3 className="text-sm font-semibold text-slate-900">
                Répartition des dépenses par catégorie
              </h3>
              {stats.categorySeries.length === 0 ? (
                <div className="flex h-64 items-center justify-center text-xs text-slate-500">
                  Aucune dépense enregistrée.
                </div>
              ) : (
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 items-center">
                  <div className="h-56 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={stats.categorySeries}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={42}
                          outerRadius={78}
                        >
                          {stats.categorySeries.map((_, idx) => (
                            <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="space-y-1.5 text-xs">
                    {stats.categorySeries.slice(0, 6).map((cat, idx) => (
                      <div key={cat.name} className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 truncate">
                          <span
                            className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                            style={{ backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }}
                          />
                          <span className="truncate text-slate-700">{cat.name}</span>
                        </div>
                        <span className="font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                          {formatMoney(cat.centimes, defaultCurrency, currencies)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Derniers mouvements + Échéances à venir */}
          <section className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-white p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">
                  Derniers mouvements réels (Grand livre)
                </h3>
                <Link to="/tresorerie" className="text-xs font-medium text-[#1D4ED8] hover:underline">
                  Tout voir
                </Link>
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 text-slate-500">
                    <tr>
                      <th className="py-2 pr-3">Date</th>
                      <th className="py-2 pr-3">Libellé</th>
                      <th className="py-2 text-right">Montant</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {stats.recentLedger.map((e) => (
                      <tr key={e.id}>
                        <td className="py-2 pr-3 text-slate-600 tabular-nums whitespace-nowrap">
                          {e.date}
                        </td>
                        <td className="py-2 pr-3 text-slate-800">{e.label}</td>
                        <td
                          className={`py-2 text-right font-semibold tabular-nums whitespace-nowrap ${
                            e.direction === 'entree' ? 'text-emerald-700' : 'text-red-700'
                          }`}
                        >
                          {e.direction === 'entree' ? '+' : '-'}
                          {formatMoney(e.baseDzdAmountCentimes, defaultCurrency, currencies)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">
                  Factures à échéance & en retard
                </h3>
                <Link
                  to="/factures-clients"
                  className="text-xs font-medium text-[#1D4ED8] hover:underline"
                >
                  Factures
                </Link>
              </div>
              {stats.upcomingInvoices.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-500">
                  Aucune facture impayée ou à échéance.
                </div>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 text-slate-500">
                      <tr>
                        <th className="py-2 pr-3">N° Facture</th>
                        <th className="py-2 pr-3">Tiers</th>
                        <th className="py-2 pr-3">Échéance</th>
                        <th className="py-2 text-right">Reste dû</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {stats.upcomingInvoices.map((item) => (
                        <tr key={item.id}>
                          <td className="py-2 pr-3 font-medium text-slate-900">
                            {item.number}
                          </td>
                          <td className="py-2 pr-3 text-slate-700">
                            {item.contactName}{' '}
                            <span className="text-[11px] text-slate-400">
                              ({item.kind === 'client' ? 'Client' : 'Fourn.'})
                            </span>
                          </td>
                          <td
                            className={`py-2 pr-3 tabular-nums whitespace-nowrap ${
                              item.overdue ? 'font-semibold text-red-700' : 'text-slate-600'
                            }`}
                          >
                            {item.dueDate} {item.overdue ? '(En retard)' : ''}
                          </td>
                          <td className="py-2 text-right font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                            {formatMoney(item.remaining, item.currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        </>
      )}

      <InvoiceFormModal
        open={quickInvoiceOpen}
        mode="client"
        onClose={() => setQuickInvoiceOpen(false)}
      />
      <PaymentModal
        open={quickPaymentOpen}
        direction="entrant"
        onClose={() => setQuickPaymentOpen(false)}
      />
    </div>
  );
};
