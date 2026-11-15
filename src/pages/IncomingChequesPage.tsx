import React, { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { CheckCircle2, Plus, Search, X } from 'lucide-react';
import { db } from '../db/database';
import type { IncomingCheque, IncomingChequeStatus } from '../db/types';
import { createIncomingCheque, updateIncomingChequeStatus } from '../services/treasuryActions';
import { useAppStore } from '../store/useAppStore';
import { computeInvoicePaidCentimes, computeInvoiceRemainingCentimes } from '../utils/finance';
import { addMoney, formatMoney, parseMoneyInputToCentimes } from '../utils/money';

const INCOMING_STATUS_META: Record<
  IncomingChequeStatus,
  { label: string; className: string }
> = {
  recu: { label: 'Reçu', className: 'text-slate-700' },
  depose: { label: 'Déposé', className: 'text-amber-700' },
  en_attente: { label: 'En attente', className: 'text-amber-700' },
  encaisse: { label: 'Encaissé', className: 'text-emerald-700 font-semibold' },
  rejete: { label: 'Rejeté', className: 'text-red-700 font-semibold' },
  annule: { label: 'Annulé', className: 'text-slate-400 line-through' },
};

export const IncomingChequesPage: React.FC = () => {
  const pushToast = useAppStore((s) => s.pushToast);
  const settings = useLiveQuery(() => db.settings.get('company_settings'));
  const incomingCheques = useLiveQuery(() => db.incomingCheques.toArray(), [], []);
  const contacts = useLiveQuery(() => db.contacts.toArray(), [], []);
  const bankAccounts = useLiveQuery(() => db.bankAccounts.toArray(), [], []);
  const customerInvoices = useLiveQuery(() => db.customerInvoices.toArray(), [], []);
  const payments = useLiveQuery(() => db.payments.toArray(), [], []);
  const allocations = useLiveQuery(() => db.paymentAllocations.toArray(), [], []);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'tous' | IncomingChequeStatus>('tous');

  // Modale ajout chèque reçu
  const [modalOpen, setModalOpen] = useState(false);
  const [cClientId, setCClientId] = useState('');
  const [cIssuerBank, setCIssuerBank] = useState('');
  const [cNumber, setCNumber] = useState('');
  const [cChequeDate, setCChequeDate] = useState(new Date().toISOString().slice(0, 10));
  const [cEntryDate, setCEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [cAmountText, setCAmountText] = useState('0,00');
  const [cCurrency, setCCurrency] = useState('DZD');
  const [cExchangeRate, setCExchangeRate] = useState('1');
  const [cTargetBankId, setCTargetBankId] = useState('');
  const [cInvoiceIds, setCInvoiceIds] = useState<string[]>([]);
  const [cNotes, setCNotes] = useState('');

  // Modale changement de statut / encaissement
  const [statusTarget, setStatusTarget] = useState<{
    cheque: IncomingCheque;
    nextStatus: IncomingChequeStatus;
  } | null>(null);
  const [tBankId, setTBankId] = useState('');
  const [tDate, setTDate] = useState(new Date().toISOString().slice(0, 10));
  const [tReason, setTReason] = useState('');

  const defaultCurrency = settings?.defaultCurrency || 'DZD';
  const currencies = settings?.enabledCurrencies;

  const contactMap = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);
  const bankMap = useMemo(() => new Map(bankAccounts.map((b) => [b.id, b])), [bankAccounts]);
  const invoiceMap = useMemo(
    () => new Map(customerInvoices.map((i) => [i.id, i])),
    [customerInvoices]
  );

  const clientOptions = useMemo(
    () =>
      contacts.filter(
        (c) => !c.archived && (c.type === 'client' || c.type === 'les_deux')
      ),
    [contacts]
  );

  const clientUnpaidInvoices = useMemo(() => {
    if (!cClientId) return [];
    const validIds = new Set(payments.filter((p) => p.status === 'valide').map((p) => p.id));
    return customerInvoices
      .filter((inv) => inv.clientId === cClientId && inv.status !== 'annulee')
      .map((inv) => {
        const paid = computeInvoicePaidCentimes(inv.id, allocations, validIds);
        const rem = computeInvoiceRemainingCentimes(inv.totalTtcCentimes, paid, inv.status);
        return { inv, rem };
      })
      .filter((x) => x.rem > 0);
  }, [cClientId, customerInvoices, payments, allocations]);

  const filteredCheques = useMemo(() => {
    const q = search.trim().toLowerCase();
    return incomingCheques
      .filter((c) => {
        if (statusFilter !== 'tous' && c.status !== statusFilter) return false;
        const client = contactMap.get(c.clientId);
        const clientName = client ? client.company || client.name : '';
        if (q) {
          const hay = `${c.chequeNumber} ${clientName} ${c.issuerBank} ${c.notes}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => b.entryDate.localeCompare(a.entryDate));
  }, [incomingCheques, statusFilter, search, contactMap]);

  const totals = useMemo(() => {
    let pending = 0;
    let cleared = 0;
    for (const c of filteredCheques) {
      if (c.status === 'encaisse') cleared = addMoney(cleared, c.baseDzdAmountCentimes);
      else if (c.status !== 'annule' && c.status !== 'rejete')
        pending = addMoney(pending, c.baseDzdAmountCentimes);
    }
    return { pending, cleared };
  }, [filteredCheques]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseMoneyInputToCentimes(cAmountText);
    if (Number.isNaN(amount) || amount <= 0) {
      pushToast({ type: 'error', title: 'Montant invalide' });
      return;
    }
    const rate = parseFloat(cExchangeRate.replace(',', '.'));
    try {
      await createIncomingCheque({
        clientId: cClientId,
        issuerBank: cIssuerBank,
        chequeNumber: cNumber,
        chequeDate: cChequeDate,
        entryDate: cEntryDate,
        amountCentimes: amount,
        currency: cCurrency,
        exchangeRate: Number.isFinite(rate) && rate > 0 ? rate : 1,
        targetBankAccountId: cTargetBankId || null,
        allocatedInvoiceIds: cInvoiceIds,
        notes: cNotes,
      });
      setModalOpen(false);
      pushToast({
        type: 'success',
        title: 'Chèque reçu enregistré',
        message: 'Le montant n’entrera en trésorerie qu’une fois le chèque encaissé.',
      });
    } catch (err) {
      pushToast({
        type: 'error',
        title: 'Erreur de validation',
        message: err instanceof Error ? err.message : 'Erreur',
      });
    }
  };

  const handleConfirmStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!statusTarget) return;
    try {
      await updateIncomingChequeStatus({
        chequeId: statusTarget.cheque.id,
        nextStatus: statusTarget.nextStatus,
        targetBankAccountId: tBankId || statusTarget.cheque.targetBankAccountId,
        depositDate: statusTarget.nextStatus === 'depose' ? tDate : undefined,
        clearingDate: statusTarget.nextStatus === 'encaisse' ? tDate : undefined,
        reason: tReason || undefined,
      });
      pushToast({
        type: 'success',
        title: 'Statut du chèque mis à jour',
        message:
          statusTarget.nextStatus === 'encaisse'
            ? 'Le grand livre et les factures associées ont été mis à jour.'
            : undefined,
      });
      setStatusTarget(null);
      setTReason('');
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
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="N° chèque, client, banque..."
              className="w-60 rounded-md border border-slate-300 py-1.5 pr-3 pl-9 text-sm"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'tous' | IncomingChequeStatus)}
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
          >
            <option value="tous">Tous statuts</option>
            {Object.entries(INCOMING_STATUS_META).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={() => {
            const today = new Date().toISOString().slice(0, 10);
            setCClientId('');
            setCIssuerBank('');
            setCNumber('');
            setCChequeDate(today);
            setCEntryDate(today);
            setCAmountText('0,00');
            setCCurrency(defaultCurrency);
            setCExchangeRate('1');
            setCTargetBankId(bankAccounts[0]?.id || '');
            setCInvoiceIds([]);
            setCNotes('');
            setModalOpen(true);
          }}
          className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
        >
          <Plus className="h-4 w-4" />
          <span>Ajouter un chèque reçu</span>
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">
            Chèques reçus en attente d’encaissement
          </div>
          <div className="mt-1 text-lg font-bold text-amber-700 tabular-nums">
            {formatMoney(totals.pending, defaultCurrency, currencies)}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">Chèques reçus encaissés (trésorerie réelle)</div>
          <div className="mt-1 text-lg font-bold text-emerald-700 tabular-nums">
            {formatMoney(totals.cleared, defaultCurrency, currencies)}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
            <tr>
              <th className="px-3 py-2.5">N° Chèque</th>
              <th className="px-3 py-2.5">Client</th>
              <th className="px-3 py-2.5">Banque émettrice</th>
              <th className="px-3 py-2.5">Date entrée</th>
              <th className="px-3 py-2.5">Date chèque</th>
              <th className="px-3 py-2.5">Facture(s) payée(s)</th>
              <th className="px-3 py-2.5 text-right">Montant</th>
              <th className="px-3 py-2.5">Statut</th>
              <th className="px-3 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {filteredCheques.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-sm text-slate-500">
                  Aucun chèque reçu enregistré.
                </td>
              </tr>
            ) : (
              filteredCheques.map((c) => {
                const client = contactMap.get(c.clientId);
                const clientName = client ? client.company || client.name : 'Client';
                const invList = c.allocatedInvoiceIds
                  .map((id) => invoiceMap.get(id)?.invoiceNumber || id)
                  .join(', ');
                const meta = INCOMING_STATUS_META[c.status];
                const isTerminal = c.status === 'annule' || c.status === 'rejete';
                const targetBank = c.targetBankAccountId
                  ? bankMap.get(c.targetBankAccountId)
                  : null;

                return (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2.5 font-mono font-semibold text-slate-900 whitespace-nowrap">
                      {c.chequeNumber}
                    </td>
                    <td className="px-3 py-2.5 font-medium text-slate-900">{clientName}</td>
                    <td className="px-3 py-2.5 text-slate-700">{c.issuerBank}</td>
                    <td className="px-3 py-2.5 text-slate-600 tabular-nums whitespace-nowrap">
                      {c.entryDate}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 tabular-nums whitespace-nowrap">
                      {c.chequeDate}
                    </td>
                    <td className="px-3 py-2.5 text-slate-700">{invList || 'Avance / Libre'}</td>
                    <td className="px-3 py-2.5 text-right font-semibold text-emerald-700 tabular-nums whitespace-nowrap">
                      {formatMoney(c.amountCentimes, c.currency, currencies)}
                    </td>
                    <td className={`px-3 py-2.5 whitespace-nowrap ${meta.className}`}>
                      {meta.label}
                      {c.status === 'encaisse' && c.clearingDate && (
                        <div className="text-[10px] font-normal text-slate-500">
                          {c.clearingDate} {targetBank ? `· ${targetBank.bankName}` : ''}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      {!isTerminal && (
                        <div className="inline-flex items-center gap-1.5">
                          {c.status !== 'encaisse' && (
                            <button
                              type="button"
                              onClick={() => {
                                setTBankId(c.targetBankAccountId || bankAccounts[0]?.id || '');
                                setTDate(new Date().toISOString().slice(0, 10));
                                setTReason('');
                                setStatusTarget({ cheque: c, nextStatus: 'encaisse' });
                              }}
                              className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800 hover:bg-emerald-100"
                            >
                              <CheckCircle2 className="h-3 w-3" />
                              <span>Encaisser</span>
                            </button>
                          )}
                          <select
                            value={c.status}
                            onChange={(e) => {
                              const next = e.target.value as IncomingChequeStatus;
                              if (next === c.status) return;
                              if (
                                next === 'encaisse' ||
                                next === 'depose' ||
                                next === 'rejete' ||
                                next === 'annule'
                              ) {
                                setTBankId(c.targetBankAccountId || bankAccounts[0]?.id || '');
                                setTDate(new Date().toISOString().slice(0, 10));
                                setTReason('');
                                setStatusTarget({ cheque: c, nextStatus: next });
                              } else {
                                updateIncomingChequeStatus({ chequeId: c.id, nextStatus: next });
                              }
                            }}
                            className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px]"
                          >
                            {Object.entries(INCOMING_STATUS_META).map(([k, v]) => (
                              <option key={k} value={k}>
                                {v.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Modale Ajout Chèque Reçu */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-[#0F1E36] px-6 py-4 text-white">
              <h2 className="text-base font-semibold">Nouveau chèque reçu (client)</h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded p-1 text-slate-300 hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="flex-1 overflow-y-auto p-6 space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Client *</label>
                  <select
                    required
                    value={cClientId}
                    onChange={(e) => {
                      setCClientId(e.target.value);
                      setCInvoiceIds([]);
                    }}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">— Sélectionner un client —</option>
                    {clientOptions.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.company || c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700">Banque émettrice *</label>
                  <input
                    type="text"
                    required
                    value={cIssuerBank}
                    onChange={(e) => setCIssuerBank(e.target.value)}
                    placeholder="Ex : BEA, BNA, CPA, Société Générale..."
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    N° de chèque (texte) *
                  </label>
                  <input
                    type="text"
                    required
                    value={cNumber}
                    onChange={(e) => setCNumber(e.target.value)}
                    placeholder="0045891"
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700">Montant *</label>
                  <input
                    type="text"
                    required
                    value={cAmountText}
                    onChange={(e) => setCAmountText(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-right font-semibold tabular-nums"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700">Date d’entrée *</label>
                  <input
                    type="date"
                    required
                    value={cEntryDate}
                    onChange={(e) => setCEntryDate(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700">Date du chèque *</label>
                  <input
                    type="date"
                    required
                    value={cChequeDate}
                    onChange={(e) => setCChequeDate(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Banque destinataire (dépôt)
                  </label>
                  <select
                    value={cTargetBankId}
                    onChange={(e) => setCTargetBankId(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">— À définir lors de la remise —</option>
                    {bankAccounts
                      .filter((b) => b.active)
                      .map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.bankName} — {b.accountName}
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700">Notes</label>
                  <input
                    type="text"
                    value={cNotes}
                    onChange={(e) => setCNotes(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              {cClientId && (
                <div className="space-y-2 border-t border-slate-200 pt-3">
                  <label className="block text-xs font-semibold text-slate-800">
                    Facture(s) réglée(s) par ce chèque
                  </label>
                  {clientUnpaidInvoices.length === 0 ? (
                    <div className="rounded bg-slate-50 p-2.5 text-xs text-slate-500">
                      Aucune facture impayée pour ce client (sera compté en avance lors de l’encaissement).
                    </div>
                  ) : (
                    <div className="max-h-40 overflow-y-auto divide-y divide-slate-200 rounded border border-slate-200">
                      {clientUnpaidInvoices.map(({ inv, rem }) => {
                        const checked = cInvoiceIds.includes(inv.id);
                        return (
                          <label
                            key={inv.id}
                            className="flex cursor-pointer items-center justify-between px-3 py-2 text-xs hover:bg-slate-50"
                          >
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) =>
                                  setCInvoiceIds((prev) =>
                                    e.target.checked
                                      ? [...prev, inv.id]
                                      : prev.filter((x) => x !== inv.id)
                                  )
                                }
                              />
                              <span className="font-medium text-slate-900">{inv.invoiceNumber}</span>
                              <span className="text-slate-500">{inv.issueDate}</span>
                            </div>
                            <span className="font-semibold text-red-700 tabular-nums">
                              Reste : {formatMoney(rem, inv.currency)}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

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
                  className="rounded-md bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700"
                >
                  Enregistrer le chèque reçu
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modale mise à jour statut / encaissement */}
      {statusTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form
            onSubmit={handleConfirmStatus}
            className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-xl space-y-4"
          >
            <h3 className="text-base font-semibold text-slate-900">
              Chèque N° {statusTarget.cheque.chequeNumber} →{' '}
              {INCOMING_STATUS_META[statusTarget.nextStatus].label}
            </h3>

            {(statusTarget.nextStatus === 'encaisse' || statusTarget.nextStatus === 'depose') && (
              <>
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Banque destinataire *
                  </label>
                  <select
                    required
                    value={tBankId}
                    onChange={(e) => setTBankId(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">— Choisir une banque —</option>
                    {bankAccounts
                      .filter((b) => b.active)
                      .map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.bankName} — {b.accountName}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    {statusTarget.nextStatus === 'encaisse'
                      ? 'Date d’encaissement *'
                      : 'Date de dépôt *'}
                  </label>
                  <input
                    type="date"
                    required
                    value={tDate}
                    onChange={(e) => setTDate(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </>
            )}

            {(statusTarget.nextStatus === 'rejete' || statusTarget.nextStatus === 'annule') && (
              <div>
                <label className="block text-xs font-medium text-slate-700">Motif *</label>
                <input
                  type="text"
                  required
                  value={tReason}
                  onChange={(e) => setTReason(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setStatusTarget(null)}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700"
              >
                Fermer
              </button>
              <button
                type="submit"
                className="rounded-md bg-[#0F1E36] px-4 py-2 text-xs font-medium text-white"
              >
                Valider
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
