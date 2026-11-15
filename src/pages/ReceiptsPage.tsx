import React, { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Ban, CheckCircle2, Plus, Search, Split } from 'lucide-react';
import { db } from '../db/database';
import type { PaymentMethod } from '../db/types';
import { cancelPayment } from '../services/financeActions';
import { useAppStore } from '../store/useAppStore';
import { computePaymentUnallocatedCentimes } from '../utils/finance';
import { addMoney, formatMoney } from '../utils/money';
import { PaymentModal } from '../components/PaymentModal';

const METHOD_LABELS: Record<PaymentMethod, string> = {
  especes: 'Espèces',
  cheque: 'Chèque',
  virement: 'Virement',
  carte: 'Carte',
};

export const ReceiptsPage: React.FC = () => {
  const pushToast = useAppStore((s) => s.pushToast);
  const settings = useLiveQuery(() => db.settings.get('company_settings'));
  const payments = useLiveQuery(() => db.payments.toArray(), [], []);
  const allocations = useLiveQuery(() => db.paymentAllocations.toArray(), [], []);
  const contacts = useLiveQuery(() => db.contacts.toArray(), [], []);
  const bankAccounts = useLiveQuery(() => db.bankAccounts.toArray(), [], []);
  const customerInvoices = useLiveQuery(() => db.customerInvoices.toArray(), [], []);
  const supplierInvoices = useLiveQuery(() => db.supplierInvoices.toArray(), [], []);

  const [directionTab, setDirectionTab] = useState<'entrant' | 'sortant'>('entrant');
  const [search, setSearch] = useState('');
  const [methodFilter, setMethodFilter] = useState<'tous' | PaymentMethod>('tous');
  const [statusFilter, setStatusFilter] = useState<'valide' | 'annule' | 'tous'>('valide');

  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [allocateAdvanceId, setAllocateAdvanceId] = useState<string | undefined>(undefined);
  const [cancelTarget, setCancelTarget] = useState<{ id: string; label: string } | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  const defaultCurrency = settings?.defaultCurrency || 'DZD';
  const currencies = settings?.enabledCurrencies;

  const contactMap = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);
  const bankMap = useMemo(() => new Map(bankAccounts.map((b) => [b.id, b])), [bankAccounts]);
  const invoiceNumberMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of customerInvoices) map.set(i.id, i.invoiceNumber);
    for (const i of supplierInvoices) map.set(i.id, i.invoiceNumber);
    return map;
  }, [customerInvoices, supplierInvoices]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return payments
      .filter((p) => {
        if (p.direction !== directionTab) return false;
        if (statusFilter !== 'tous' && p.status !== statusFilter) return false;
        if (methodFilter !== 'tous' && p.method !== methodFilter) return false;
        const contact = contactMap.get(p.contactId);
        const contactName = contact ? contact.company || contact.name : '';
        if (q) {
          const hay = `${contactName} ${p.reference} ${p.notes} ${p.date}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .map((p) => {
        const contact = contactMap.get(p.contactId);
        const contactName = contact ? contact.company || contact.name : 'Inconnu';
        const bank = p.bankAccountId ? bankMap.get(p.bankAccountId) : null;
        const pAllocs = allocations.filter((a) => a.paymentId === p.id);
        const unallocated = computePaymentUnallocatedCentimes(p, allocations);
        const allocatedInvoicesText = pAllocs
          .map((a) => invoiceNumberMap.get(a.invoiceId) || a.invoiceId)
          .join(', ');
        return {
          payment: p,
          contactName,
          accountLabel: bank ? `${bank.bankName} — ${bank.accountName}` : 'Caisse espèces',
          unallocated,
          allocatedInvoicesText,
        };
      })
      .sort((a, b) => b.payment.date.localeCompare(a.payment.date));
  }, [
    payments,
    directionTab,
    statusFilter,
    methodFilter,
    search,
    contactMap,
    bankMap,
    allocations,
    invoiceNumberMap,
  ]);

  const summary = useMemo(() => {
    let validTotal = 0;
    let totalAdvances = 0;
    for (const r of rows) {
      if (r.payment.status !== 'valide') continue;
      validTotal = addMoney(validTotal, r.payment.baseDzdAmountCentimes);
      if (r.unallocated > 0) {
        const unallocDzd =
          r.payment.amountCentimes === r.payment.baseDzdAmountCentimes
            ? r.unallocated
            : Math.round(
                (r.payment.baseDzdAmountCentimes * r.unallocated) /
                  Math.max(1, r.payment.amountCentimes)
              );
        totalAdvances = addMoney(totalAdvances, unallocDzd);
      }
    }
    return { validTotal, totalAdvances };
  }, [rows]);

  const handleConfirmCancel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancelTarget) return;
    try {
      await cancelPayment(cancelTarget.id, cancelReason);
      pushToast({
        type: 'info',
        title: 'Paiement annulé',
        message: 'Les soldes des factures et le grand livre ont été mis à jour.',
      });
      setCancelTarget(null);
      setCancelReason('');
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
      {/* En-tête onglets Recettes clients / Règlements fournisseurs */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 rounded-md bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setDirectionTab('entrant')}
              className={`rounded px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                directionTab === 'entrant'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Recettes (Paiements clients)
            </button>
            <button
              type="button"
              onClick={() => setDirectionTab('sortant')}
              className={`rounded px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                directionTab === 'sortant'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Règlements fournisseurs
            </button>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher tiers, référence..."
              className="w-56 rounded-md border border-slate-300 py-1.5 pr-3 pl-9 text-sm"
            />
          </div>

          <select
            value={methodFilter}
            onChange={(e) => setMethodFilter(e.target.value as 'tous' | PaymentMethod)}
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
          >
            <option value="tous">Tous modes</option>
            <option value="especes">Espèces</option>
            <option value="virement">Virement</option>
            <option value="cheque">Chèque</option>
            <option value="carte">Carte</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'valide' | 'annule' | 'tous')}
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
          >
            <option value="valide">Valides</option>
            <option value="annule">Annulés</option>
            <option value="tous">Tous statuts</option>
          </select>
        </div>

        <button
          type="button"
          onClick={() => {
            setAllocateAdvanceId(undefined);
            setPaymentModalOpen(true);
          }}
          className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 whitespace-nowrap"
        >
          <Plus className="h-4 w-4" />
          <span>
            {directionTab === 'entrant'
              ? 'Enregistrer un paiement / avance'
              : 'Enregistrer un règlement fournisseur'}
          </span>
        </button>
      </div>

      {/* Synthèse */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">
            Total {directionTab === 'entrant' ? 'encaissé' : 'versé'} (sélection)
          </div>
          <div
            className={`mt-1 text-lg font-bold tabular-nums ${
              directionTab === 'entrant' ? 'text-emerald-700' : 'text-slate-900'
            }`}
          >
            {formatMoney(summary.validTotal, defaultCurrency, currencies)}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">Dont avances non encore affectées</div>
          <div className="mt-1 text-lg font-bold text-amber-700 tabular-nums">
            {formatMoney(summary.totalAdvances, defaultCurrency, currencies)}
          </div>
        </div>
      </div>

      {/* Liste des paiements */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
            <tr>
              <th className="px-3 py-2.5">Date</th>
              <th className="px-3 py-2.5">
                {directionTab === 'entrant' ? 'Client' : 'Fournisseur'}
              </th>
              <th className="px-3 py-2.5">Mode</th>
              <th className="px-3 py-2.5">Compte / Caisse</th>
              <th className="px-3 py-2.5">Référence</th>
              <th className="px-3 py-2.5">Factures affectées</th>
              <th className="px-3 py-2.5 text-right">Montant</th>
              <th className="px-3 py-2.5 text-right">Avance dispo.</th>
              <th className="px-3 py-2.5">Statut</th>
              <th className="px-3 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-sm text-slate-500">
                  Aucun règlement enregistré pour ces critères.
                </td>
              </tr>
            ) : (
              rows.map(({ payment, contactName, accountLabel, unallocated, allocatedInvoicesText }) => (
                <tr key={payment.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2.5 text-slate-600 tabular-nums whitespace-nowrap">
                    {payment.date}
                  </td>
                  <td className="px-3 py-2.5 font-medium text-slate-900">{contactName}</td>
                  <td className="px-3 py-2.5 text-slate-700">{METHOD_LABELS[payment.method]}</td>
                  <td className="px-3 py-2.5 text-slate-600">{accountLabel}</td>
                  <td className="px-3 py-2.5 text-slate-600">{payment.reference || '—'}</td>
                  <td className="px-3 py-2.5 text-slate-700">
                    {allocatedInvoicesText || 'Avance libre'}
                  </td>
                  <td
                    className={`px-3 py-2.5 text-right font-semibold tabular-nums whitespace-nowrap ${
                      payment.status === 'annule'
                        ? 'text-slate-400 line-through'
                        : directionTab === 'entrant'
                        ? 'text-emerald-700'
                        : 'text-slate-900'
                    }`}
                  >
                    {formatMoney(payment.amountCentimes, payment.currency)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
                    {unallocated > 0 && payment.status === 'valide' ? (
                      <span className="font-semibold text-amber-700">
                        {formatMoney(unallocated, payment.currency)}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {payment.status === 'valide' ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>Valide</span>
                      </span>
                    ) : (
                      <span className="text-red-600">Annulé</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-1.5">
                      {payment.status === 'valide' && unallocated > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setAllocateAdvanceId(payment.id);
                            setPaymentModalOpen(true);
                          }}
                          title="Affecter l'avance à une facture"
                          className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 hover:bg-amber-100"
                        >
                          <Split className="h-3 w-3" />
                          <span>Affecter</span>
                        </button>
                      )}
                      {payment.status === 'valide' && (
                        <button
                          type="button"
                          onClick={() =>
                            setCancelTarget({
                              id: payment.id,
                              label: `${contactName} (${formatMoney(payment.amountCentimes, payment.currency)})`,
                            })
                          }
                          title="Annuler le règlement"
                          className="rounded p-1 text-red-600 hover:bg-red-50"
                        >
                          <Ban className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <PaymentModal
        open={paymentModalOpen}
        direction={directionTab}
        existingAdvancePaymentId={allocateAdvanceId}
        onClose={() => {
          setPaymentModalOpen(false);
          setAllocateAdvanceId(undefined);
        }}
      />

      {cancelTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form
            onSubmit={handleConfirmCancel}
            className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-xl space-y-4"
          >
            <h3 className="text-base font-semibold text-slate-900">
              Annuler ce règlement ?
            </h3>
            <p className="text-xs text-slate-600">
              {cancelTarget.label}. L’écriture associée dans le grand livre sera annulée et les factures affectées retrouveront leur reste à payer.
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
                placeholder="Ex : Erreur de montant, doublon..."
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
                className="rounded-md bg-red-600 px-4 py-2 text-xs font-medium text-white hover:bg-red-700"
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
