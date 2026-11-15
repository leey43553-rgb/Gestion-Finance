import React, { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowUpDown,
  Ban,
  Edit3,
  Plus,
  Printer,
  Search,
  Wallet,
} from 'lucide-react';
import { db } from '../db/database';
import type { ComputedInvoiceStatus, CustomerInvoice, SupplierInvoice } from '../db/types';
import { cancelInvoice } from '../services/financeActions';
import { useAppStore } from '../store/useAppStore';
import {
  computeInvoicePaidCentimes,
  computeInvoiceRemainingCentimes,
  computeInvoiceStatus,
} from '../utils/finance';
import { addMoney, formatMoney } from '../utils/money';
import { InvoiceFormModal } from '../components/InvoiceFormModal';
import { PaymentModal } from '../components/PaymentModal';
import { PrintDocumentModal } from '../components/PrintDocumentModal';

interface InvoicesPageProps {
  mode: 'client' | 'fournisseur';
}

const STATUS_LABELS: Record<ComputedInvoiceStatus, { label: string; colorClass: string }> = {
  impayee: { label: 'Impayée', colorClass: 'text-slate-700' },
  partielle: { label: 'Partielle', colorClass: 'text-amber-700' },
  payee: { label: 'Payée', colorClass: 'text-emerald-700' },
  en_retard: { label: 'En retard', colorClass: 'text-red-700 font-semibold' },
  annulee: { label: 'Annulée', colorClass: 'text-slate-400 line-through' },
};

export const InvoicesPage: React.FC<InvoicesPageProps> = ({ mode }) => {
  const pushToast = useAppStore((s) => s.pushToast);
  const settings = useLiveQuery(() => db.settings.get('company_settings'));
  const contacts = useLiveQuery(() => db.contacts.toArray(), [], []);
  const customerInvoices = useLiveQuery(() => db.customerInvoices.toArray(), [], []);
  const supplierInvoices = useLiveQuery(() => db.supplierInvoices.toArray(), [], []);
  const payments = useLiveQuery(() => db.payments.toArray(), [], []);
  const allocations = useLiveQuery(() => db.paymentAllocations.toArray(), [], []);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'toutes' | ComputedInvoiceStatus>('toutes');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortBy, setSortBy] = useState<'date' | 'number' | 'ttc' | 'remaining'>('date');
  const [sortAsc, setSortAsc] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<
    CustomerInvoice | SupplierInvoice | undefined
  >(undefined);
  const [paymentTarget, setPaymentTarget] = useState<{
    contactId: string;
    invoiceId: string;
  } | null>(null);
  const [printInvoiceId, setPrintInvoiceId] = useState<string | null>(null);

  const [cancelTarget, setCancelTarget] = useState<{
    id: string;
    number: string;
  } | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  // Édition rapide inline sur N° BC / Réf / Notes
  const [inlineEdit, setInlineEdit] = useState<{
    id: string;
    field: 'bcNumber' | 'campaignRef' | 'supplierRef' | 'dueDate';
    value: string;
  } | null>(null);

  const defaultCurrency = settings?.defaultCurrency || 'DZD';
  const currencies = settings?.enabledCurrencies;

  const contactMap = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);

  const enrichedRows = useMemo(() => {
    const validPaymentIds = new Set(
      payments.filter((p) => p.status === 'valide').map((p) => p.id)
    );
    const rawList = mode === 'client' ? customerInvoices : supplierInvoices;
    const q = search.trim().toLowerCase();

    const mapped = rawList
      .map((inv) => {
        const contactId =
          mode === 'client'
            ? (inv as CustomerInvoice).clientId
            : (inv as SupplierInvoice).supplierId;
        const contact = contactMap.get(contactId);
        const contactLabel = contact ? contact.company || contact.name : 'Inconnu';
        const paid = computeInvoicePaidCentimes(inv.id, allocations, validPaymentIds);
        const remaining = computeInvoiceRemainingCentimes(
          inv.totalTtcCentimes,
          paid,
          inv.status
        );
        const computedStatus = computeInvoiceStatus({
          storedStatus: inv.status,
          totalTtcCentimes: inv.totalTtcCentimes,
          paidCentimes: paid,
          dueDate: inv.dueDate,
        });
        return { inv, contactId, contactLabel, paid, remaining, computedStatus };
      })
      .filter((row) => {
        if (statusFilter !== 'toutes' && row.computedStatus !== statusFilter) return false;
        if (dateFrom && row.inv.issueDate < dateFrom) return false;
        if (dateTo && row.inv.issueDate > dateTo) return false;
        if (q) {
          const extra =
            mode === 'client'
              ? `${(row.inv as CustomerInvoice).bcNumber} ${(row.inv as CustomerInvoice).campaignRef}`
              : (row.inv as SupplierInvoice).supplierRef;
          const hay = `${row.inv.invoiceNumber} ${row.contactLabel} ${row.inv.description} ${extra}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });

    mapped.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'date') cmp = a.inv.issueDate.localeCompare(b.inv.issueDate);
      else if (sortBy === 'number') cmp = a.inv.invoiceNumber.localeCompare(b.inv.invoiceNumber);
      else if (sortBy === 'ttc') cmp = a.inv.baseDzdTtcCentimes - b.inv.baseDzdTtcCentimes;
      else if (sortBy === 'remaining') cmp = a.remaining - b.remaining;
      return sortAsc ? cmp : -cmp;
    });

    return mapped;
  }, [
    mode,
    customerInvoices,
    supplierInvoices,
    contacts,
    contactMap,
    payments,
    allocations,
    search,
    statusFilter,
    dateFrom,
    dateTo,
    sortBy,
    sortAsc,
  ]);

  const totals = useMemo(() => {
    let ht = 0;
    let tva = 0;
    let ttc = 0;
    let paid = 0;
    let remaining = 0;
    for (const r of enrichedRows) {
      if (r.computedStatus === 'annulee') continue;
      ht = addMoney(ht, Math.round(r.inv.totalHtCentimes * r.inv.exchangeRate));
      tva = addMoney(tva, Math.round(r.inv.totalTvaCentimes * r.inv.exchangeRate));
      ttc = addMoney(ttc, r.inv.baseDzdTtcCentimes);
      paid = addMoney(paid, Math.round(r.paid * r.inv.exchangeRate));
      remaining = addMoney(remaining, Math.round(r.remaining * r.inv.exchangeRate));
    }
    return { ht, tva, ttc, paid, remaining };
  }, [enrichedRows]);

  const printTarget = useMemo(
    () => enrichedRows.find((r) => r.inv.id === printInvoiceId) || null,
    [enrichedRows, printInvoiceId]
  );

  const commitInlineEdit = async () => {
    if (!inlineEdit) return;
    const val = inlineEdit.value.trim();
    const now = new Date().toISOString();
    if (mode === 'client') {
      const patch: Partial<CustomerInvoice> = { updatedAt: now };
      if (inlineEdit.field === 'bcNumber') patch.bcNumber = val;
      else if (inlineEdit.field === 'campaignRef') patch.campaignRef = val;
      else if (inlineEdit.field === 'dueDate') patch.dueDate = val;
      await db.customerInvoices.update(inlineEdit.id, patch);
    } else {
      const patch: Partial<SupplierInvoice> = { updatedAt: now };
      if (inlineEdit.field === 'supplierRef') patch.supplierRef = val;
      else if (inlineEdit.field === 'dueDate') patch.dueDate = val;
      await db.supplierInvoices.update(inlineEdit.id, patch);
    }
    setInlineEdit(null);
  };

  const handleConfirmCancel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancelTarget) return;
    try {
      await cancelInvoice({
        invoiceType: mode,
        invoiceId: cancelTarget.id,
        reason: cancelReason,
      });
      pushToast({
        type: 'info',
        title: 'Facture annulée',
        message: `${cancelTarget.number} conservée dans le journal d’audit.`,
      });
      setCancelTarget(null);
      setCancelReason('');
    } catch (err) {
      pushToast({
        type: 'error',
        title: 'Annulation impossible',
        message: err instanceof Error ? err.message : 'Erreur',
      });
    }
  };

  const toggleSort = (col: typeof sortBy) => {
    if (sortBy === col) setSortAsc(!sortAsc);
    else {
      setSortBy(col);
      setSortAsc(col !== 'date');
    }
  };

  return (
    <div className="space-y-5">
      {/* Filtres & Bouton création */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher N°, tiers, BC, campagne..."
              className="w-64 rounded-md border border-slate-300 py-1.5 pr-3 pl-9 text-sm"
            />
          </div>

          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            title="Date de début"
            className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            title="Date de fin"
            className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs"
          />

          <div className="flex flex-wrap items-center gap-1 rounded-md bg-slate-100 p-1">
            {(
              [
                { id: 'toutes', label: 'Toutes' },
                { id: 'impayee', label: 'Impayées' },
                { id: 'partielle', label: 'Partielles' },
                { id: 'en_retard', label: 'En retard' },
                { id: 'payee', label: 'Payées' },
                { id: 'annulee', label: 'Annulées' },
              ] as const
            ).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setStatusFilter(s.id)}
                className={`rounded px-2.5 py-1 text-xs font-medium whitespace-nowrap ${
                  statusFilter === s.id
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            setEditingInvoice(undefined);
            setFormOpen(true);
          }}
          className="inline-flex items-center gap-2 rounded-md bg-[#0F1E36] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a2f52] whitespace-nowrap"
        >
          <Plus className="h-4 w-4" />
          <span>
            {mode === 'client' ? 'Nouvelle facture client' : 'Nouvelle facture fournisseur'}
          </span>
        </button>
      </div>

      {/* Synthèse rapide */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <div className="rounded-lg border border-slate-200 bg-white p-3.5">
          <div className="text-xs text-slate-500">Total HT</div>
          <div className="mt-1 text-sm font-bold text-slate-900 tabular-nums">
            {formatMoney(totals.ht, defaultCurrency, currencies)}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3.5">
          <div className="text-xs text-slate-500">Total TVA</div>
          <div className="mt-1 text-sm font-bold text-slate-900 tabular-nums">
            {formatMoney(totals.tva, defaultCurrency, currencies)}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3.5">
          <div className="text-xs text-slate-500">Total TTC</div>
          <div className="mt-1 text-sm font-bold text-slate-900 tabular-nums">
            {formatMoney(totals.ttc, defaultCurrency, currencies)}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3.5">
          <div className="text-xs text-slate-500">Payé (validé)</div>
          <div className="mt-1 text-sm font-bold text-emerald-700 tabular-nums">
            {formatMoney(totals.paid, defaultCurrency, currencies)}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3.5">
          <div className="text-xs text-slate-500">Reste à {mode === 'client' ? 'encaisser' : 'payer'}</div>
          <div className="mt-1 text-sm font-bold text-red-700 tabular-nums">
            {formatMoney(totals.remaining, defaultCurrency, currencies)}
          </div>
        </div>
      </div>

      {/* Tableau des factures */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
            <tr>
              <th className="px-3 py-2.5">
                <button
                  type="button"
                  onClick={() => toggleSort('number')}
                  className="inline-flex items-center gap-1 hover:text-slate-900"
                >
                  <span>N° Facture</span>
                  <ArrowUpDown className="h-3 w-3" />
                </button>
              </th>
              <th className="px-3 py-2.5">{mode === 'client' ? 'Client' : 'Fournisseur'}</th>
              <th className="px-3 py-2.5">
                <button
                  type="button"
                  onClick={() => toggleSort('date')}
                  className="inline-flex items-center gap-1 hover:text-slate-900"
                >
                  <span>Date</span>
                  <ArrowUpDown className="h-3 w-3" />
                </button>
              </th>
              <th className="px-3 py-2.5">Échéance</th>
              <th className="px-3 py-2.5">{mode === 'client' ? 'N° BC / Campagne' : 'Réf. fournisseur'}</th>
              <th className="px-3 py-2.5 text-right">HT</th>
              <th className="px-3 py-2.5 text-right">TVA</th>
              <th className="px-3 py-2.5 text-right">
                <button
                  type="button"
                  onClick={() => toggleSort('ttc')}
                  className="inline-flex items-center gap-1 hover:text-slate-900"
                >
                  <span>TTC</span>
                  <ArrowUpDown className="h-3 w-3" />
                </button>
              </th>
              <th className="px-3 py-2.5 text-right">Payé</th>
              <th className="px-3 py-2.5 text-right">
                <button
                  type="button"
                  onClick={() => toggleSort('remaining')}
                  className="inline-flex items-center gap-1 hover:text-slate-900"
                >
                  <span>Reste</span>
                  <ArrowUpDown className="h-3 w-3" />
                </button>
              </th>
              <th className="px-3 py-2.5">Statut</th>
              <th className="px-3 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {enrichedRows.length === 0 ? (
              <tr>
                <td colSpan={12} className="px-4 py-8 text-center text-sm text-slate-500">
                  Aucune facture trouvée pour ces critères.
                </td>
              </tr>
            ) : (
              enrichedRows.map(({ inv, contactId, contactLabel, paid, remaining, computedStatus }) => {
                const statusMeta = STATUS_LABELS[computedStatus];
                const isCancelled = computedStatus === 'annulee';
                return (
                  <tr key={inv.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2.5 font-semibold text-slate-900 whitespace-nowrap">
                      {inv.invoiceNumber}
                    </td>
                    <td className="px-3 py-2.5 text-slate-800">{contactLabel}</td>
                    <td className="px-3 py-2.5 text-slate-600 tabular-nums whitespace-nowrap">
                      {inv.issueDate}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 tabular-nums whitespace-nowrap">
                      {inlineEdit?.id === inv.id && inlineEdit.field === 'dueDate' ? (
                        <input
                          type="date"
                          autoFocus
                          value={inlineEdit.value}
                          onChange={(e) =>
                            setInlineEdit({ ...inlineEdit, value: e.target.value })
                          }
                          onBlur={commitInlineEdit}
                          onKeyDown={(e) => e.key === 'Enter' && commitInlineEdit()}
                          className="rounded border border-[#1D4ED8] px-1 py-0.5 text-xs"
                        />
                      ) : (
                        <span
                          onDoubleClick={() =>
                            !isCancelled &&
                            setInlineEdit({ id: inv.id, field: 'dueDate', value: inv.dueDate })
                          }
                          title="Double-cliquez pour modifier l’échéance"
                          className="cursor-text"
                        >
                          {inv.dueDate}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">
                      {mode === 'client' ? (
                        inlineEdit?.id === inv.id && inlineEdit.field === 'bcNumber' ? (
                          <input
                            type="text"
                            autoFocus
                            value={inlineEdit.value}
                            onChange={(e) =>
                              setInlineEdit({ ...inlineEdit, value: e.target.value })
                            }
                            onBlur={commitInlineEdit}
                            onKeyDown={(e) => e.key === 'Enter' && commitInlineEdit()}
                            className="w-28 rounded border border-[#1D4ED8] px-1.5 py-0.5 text-xs"
                          />
                        ) : (
                          <span
                            onDoubleClick={() =>
                              !isCancelled &&
                              setInlineEdit({
                                id: inv.id,
                                field: 'bcNumber',
                                value: (inv as CustomerInvoice).bcNumber,
                              })
                            }
                            title="Double-cliquez pour modifier N° BC"
                            className="cursor-text"
                          >
                            {[(inv as CustomerInvoice).bcNumber, (inv as CustomerInvoice).campaignRef]
                              .filter(Boolean)
                              .join(' · ') || '—'}
                          </span>
                        )
                      ) : (
                        (inv as SupplierInvoice).supplierRef || '—'
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right text-slate-600 tabular-nums whitespace-nowrap">
                      {formatMoney(inv.totalHtCentimes, inv.currency)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-slate-600 tabular-nums whitespace-nowrap">
                      {formatMoney(inv.totalTvaCentimes, inv.currency)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                      {formatMoney(inv.totalTtcCentimes, inv.currency)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-emerald-700 tabular-nums whitespace-nowrap">
                      {formatMoney(paid, inv.currency)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold text-red-700 tabular-nums whitespace-nowrap">
                      {formatMoney(remaining, inv.currency)}
                    </td>
                    <td className={`px-3 py-2.5 whitespace-nowrap ${statusMeta.colorClass}`}>
                      {statusMeta.label}
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        {!isCancelled && remaining > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              setPaymentTarget({ contactId, invoiceId: inv.id })
                            }
                            title={mode === 'client' ? 'Enregistrer paiement' : 'Régler facture'}
                            className="rounded p-1 text-emerald-700 hover:bg-emerald-50"
                          >
                            <Wallet className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setPrintInvoiceId(inv.id)}
                          title="Aperçu & Impression PDF A4"
                          className="rounded p-1 text-slate-600 hover:bg-slate-100"
                        >
                          <Printer className="h-3.5 w-3.5" />
                        </button>
                        {!isCancelled && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingInvoice(inv);
                                setFormOpen(true);
                              }}
                              title="Modifier"
                              className="rounded p-1 text-slate-600 hover:bg-slate-100"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                            </button>
                            {paid === 0 && (
                              <button
                                type="button"
                                onClick={() =>
                                  setCancelTarget({ id: inv.id, number: inv.invoiceNumber })
                                }
                                title="Annuler la facture"
                                className="rounded p-1 text-red-600 hover:bg-red-50"
                              >
                                <Ban className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Modale Création / Édition */}
      <InvoiceFormModal
        open={formOpen}
        mode={mode}
        existingInvoice={editingInvoice}
        onClose={() => {
          setFormOpen(false);
          setEditingInvoice(undefined);
        }}
      />

      {/* Modale Paiement rapide */}
      {paymentTarget && (
        <PaymentModal
          open={Boolean(paymentTarget)}
          direction={mode === 'client' ? 'entrant' : 'sortant'}
          preselectedContactId={paymentTarget.contactId}
          preselectedInvoiceId={paymentTarget.invoiceId}
          onClose={() => setPaymentTarget(null)}
        />
      )}

      {/* Modale Annulation avec motif obligatoire */}
      {cancelTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form
            onSubmit={handleConfirmCancel}
            className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-xl space-y-4"
          >
            <h3 className="text-base font-semibold text-slate-900">
              Annuler la facture {cancelTarget.number} ?
            </h3>
            <p className="text-xs text-slate-600">
              Une facture annulée n’est jamais supprimée définitivement : elle reste archivée dans l’historique et le journal d’audit.
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
                placeholder="Ex : Erreur de saisie client, commande annulée..."
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

      {/* Aperçu impression A4 */}
      {printTarget && (
        <PrintDocumentModal
          open={Boolean(printTarget)}
          title={`Facture ${printTarget.inv.invoiceNumber}`}
          fileName={`${printTarget.inv.invoiceNumber}.pdf`}
          settings={settings}
          onClose={() => setPrintInvoiceId(null)}
        >
          <div className="space-y-6">
            <div className="flex items-start justify-between rounded border border-slate-300 p-4">
              <div>
                <div className="text-sm font-bold text-slate-900">
                  {mode === 'client' ? 'FACTURE CLIENT' : 'FACTURE FOURNISSEUR'} N°{' '}
                  {printTarget.inv.invoiceNumber}
                </div>
                <div className="mt-1 text-xs text-slate-600">
                  Date : {printTarget.inv.issueDate} · Échéance : {printTarget.inv.dueDate}
                </div>
                {mode === 'client' && (printTarget.inv as CustomerInvoice).bcNumber && (
                  <div className="text-xs text-slate-600">
                    N° BC : {(printTarget.inv as CustomerInvoice).bcNumber}
                  </div>
                )}
              </div>
              <div className="text-right">
                <div className="text-xs font-semibold text-slate-500">
                  {mode === 'client' ? 'CLIENT' : 'FOURNISSEUR'}
                </div>
                <div className="text-sm font-bold text-slate-900">{printTarget.contactLabel}</div>
                <div className="text-xs text-slate-600">
                  {contactMap.get(printTarget.contactId)?.address || ''}
                </div>
                <div className="text-[11px] text-slate-500">
                  {[
                    contactMap.get(printTarget.contactId)?.nif
                      ? `NIF : ${contactMap.get(printTarget.contactId)?.nif}`
                      : '',
                    contactMap.get(printTarget.contactId)?.rc
                      ? `RC : ${contactMap.get(printTarget.contactId)?.rc}`
                      : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
            </div>

            <table className="w-full border-collapse border border-slate-300 text-xs">
              <thead className="bg-slate-100">
                <tr>
                  <th className="border border-slate-300 px-2.5 py-2 text-left">Désignation</th>
                  <th className="border border-slate-300 px-2.5 py-2 text-right">Qté</th>
                  <th className="border border-slate-300 px-2.5 py-2 text-right">P.U. HT</th>
                  <th className="border border-slate-300 px-2.5 py-2 text-right">Remise</th>
                  <th className="border border-slate-300 px-2.5 py-2 text-right">TVA</th>
                  <th className="border border-slate-300 px-2.5 py-2 text-right">Total HT</th>
                  <th className="border border-slate-300 px-2.5 py-2 text-right">Total TTC</th>
                </tr>
              </thead>
              <tbody>
                {printTarget.inv.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="border border-slate-300 px-2.5 py-1.5">{l.description}</td>
                    <td className="border border-slate-300 px-2.5 py-1.5 text-right tabular-nums">
                      {l.quantity}
                    </td>
                    <td className="border border-slate-300 px-2.5 py-1.5 text-right tabular-nums">
                      {formatMoney(l.unitPriceCentimes, printTarget.inv.currency)}
                    </td>
                    <td className="border border-slate-300 px-2.5 py-1.5 text-right tabular-nums">
                      {l.discountPercent} %
                    </td>
                    <td className="border border-slate-300 px-2.5 py-1.5 text-right tabular-nums">
                      {l.tvaRate} %
                    </td>
                    <td className="border border-slate-300 px-2.5 py-1.5 text-right tabular-nums">
                      {formatMoney(l.htCentimes, printTarget.inv.currency)}
                    </td>
                    <td className="border border-slate-300 px-2.5 py-1.5 text-right font-semibold tabular-nums">
                      {formatMoney(l.ttcCentimes, printTarget.inv.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="ml-auto w-72 space-y-1 rounded border border-slate-300 p-3 text-xs tabular-nums">
              <div className="flex justify-between">
                <span>Total HT :</span>
                <strong>{formatMoney(printTarget.inv.totalHtCentimes, printTarget.inv.currency)}</strong>
              </div>
              <div className="flex justify-between">
                <span>Total TVA :</span>
                <strong>{formatMoney(printTarget.inv.totalTvaCentimes, printTarget.inv.currency)}</strong>
              </div>
              <div className="flex justify-between border-t border-slate-300 pt-1.5 text-sm font-bold">
                <span>Total TTC :</span>
                <span>{formatMoney(printTarget.inv.totalTtcCentimes, printTarget.inv.currency)}</span>
              </div>
              <div className="flex justify-between pt-1 text-emerald-700">
                <span>Déjà payé :</span>
                <strong>{formatMoney(printTarget.paid, printTarget.inv.currency)}</strong>
              </div>
              <div className="flex justify-between text-red-700">
                <span>Reste à payer :</span>
                <strong>{formatMoney(printTarget.remaining, printTarget.inv.currency)}</strong>
              </div>
            </div>
          </div>
        </PrintDocumentModal>
      )}
    </div>
  );
};
