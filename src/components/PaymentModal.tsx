import React, { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, X } from 'lucide-react';
import { db } from '../db/database';
import type { PaymentMethod } from '../db/types';
import {
  allocateExistingAdvanceToInvoices,
  recordPaymentOrCheque,
} from '../services/financeActions';
import { computeInvoicePaidCentimes, computeInvoiceRemainingCentimes } from '../utils/finance';
import {
  centimesToInputString,
  formatMoney,
  parseMoneyInputToCentimes,
} from '../utils/money';
import { useAppStore } from '../store/useAppStore';

interface PaymentModalProps {
  open: boolean;
  direction: 'entrant' | 'sortant';
  preselectedContactId?: string;
  preselectedInvoiceId?: string;
  existingAdvancePaymentId?: string;
  onClose: () => void;
}

export const PaymentModal: React.FC<PaymentModalProps> = ({
  open,
  direction,
  preselectedContactId,
  preselectedInvoiceId,
  existingAdvancePaymentId,
  onClose,
}) => {
  const pushToast = useAppStore((s) => s.pushToast);
  const settings = useLiveQuery(() => db.settings.get('company_settings'));
  const contacts = useLiveQuery(() => db.contacts.toArray(), [], []);
  const bankAccounts = useLiveQuery(() => db.bankAccounts.toArray(), [], []);
  const customerInvoices = useLiveQuery(() => db.customerInvoices.toArray(), [], []);
  const supplierInvoices = useLiveQuery(() => db.supplierInvoices.toArray(), [], []);
  const payments = useLiveQuery(() => db.payments.toArray(), [], []);
  const allocations = useLiveQuery(() => db.paymentAllocations.toArray(), [], []);
  const chequeLeaves = useLiveQuery(() => db.chequeLeaves.toArray(), [], []);

  const [contactId, setContactId] = useState(preselectedContactId || '');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amountText, setAmountText] = useState('0,00');
  const [currency, setCurrency] = useState('DZD');
  const [exchangeRate, setExchangeRate] = useState('1');
  const [method, setMethod] = useState<PaymentMethod>('especes');
  const [bankAccountId, setBankAccountId] = useState<string>('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');

  // Chèque
  const [chequeNumber, setChequeNumber] = useState('');
  const [issuerBank, setIssuerBank] = useState('');
  const [chequeDate, setChequeDate] = useState(new Date().toISOString().slice(0, 10));
  const [chequeClearedImmediately, setChequeClearedImmediately] = useState(false);
  const [chequeLeafId, setChequeLeafId] = useState('');

  // Allocations par facture (en chaîne saisie)
  const [allocInputs, setAllocInputs] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const advancePayment = useMemo(
    () =>
      existingAdvancePaymentId
        ? payments.find((p) => p.id === existingAdvancePaymentId)
        : undefined,
    [existingAdvancePaymentId, payments]
  );

  const availableAdvanceCentimes = useMemo(() => {
    if (!advancePayment) return 0;
    const used = allocations
      .filter((a) => a.paymentId === advancePayment.id)
      .reduce((s, a) => s + a.amountCentimes, 0);
    return Math.max(0, advancePayment.amountCentimes - used);
  }, [advancePayment, allocations]);

  useEffect(() => {
    if (!open) return;
    setError('');
    const today = new Date().toISOString().slice(0, 10);
    setDate(today);
    setChequeDate(today);
    setMethod('especes');
    setChequeNumber('');
    setIssuerBank('');
    setChequeClearedImmediately(false);
    setChequeLeafId('');
    setReference('');
    setNotes('');

    const defCurr = settings?.defaultCurrency || 'DZD';
    setCurrency(advancePayment?.currency || defCurr);
    setExchangeRate(String(advancePayment?.exchangeRate || 1));

    if (advancePayment) {
      setContactId(advancePayment.contactId);
      setAmountText(centimesToInputString(availableAdvanceCentimes));
    } else if (preselectedContactId) {
      setContactId(preselectedContactId);
    } else {
      setContactId('');
    }

    if (bankAccounts.length > 0 && !bankAccountId) {
      setBankAccountId(bankAccounts[0].id);
    }
  }, [open, preselectedContactId, advancePayment, settings, bankAccounts]);

  const filteredContacts = useMemo(() => {
    return contacts.filter((c) => {
      if (c.archived) return false;
      if (direction === 'entrant') return c.type === 'client' || c.type === 'les_deux';
      return c.type === 'fournisseur' || c.type === 'les_deux';
    });
  }, [contacts, direction]);

  const unpaidInvoices = useMemo(() => {
    if (!contactId) return [];
    const validPaymentIds = new Set(
      payments.filter((p) => p.status === 'valide').map((p) => p.id)
    );
    const sourceList = direction === 'entrant' ? customerInvoices : supplierInvoices;

    return sourceList
      .filter((inv) => {
        const ownerId =
          direction === 'entrant'
            ? (inv as (typeof customerInvoices)[number]).clientId
            : (inv as (typeof supplierInvoices)[number]).supplierId;
        return ownerId === contactId && inv.status !== 'annulee';
      })
      .map((inv) => {
        const paid = computeInvoicePaidCentimes(inv.id, allocations, validPaymentIds);
        const remaining = computeInvoiceRemainingCentimes(inv.totalTtcCentimes, paid, inv.status);
        return { inv, paid, remaining };
      })
      .filter((x) => x.remaining > 0)
      .sort((a, b) => a.inv.issueDate.localeCompare(b.inv.issueDate));
  }, [contactId, direction, customerInvoices, supplierInvoices, payments, allocations]);

  // Pré-remplir si facture présélectionnée
  useEffect(() => {
    if (!open) return;
    if (preselectedInvoiceId && unpaidInvoices.length > 0) {
      const target = unpaidInvoices.find((u) => u.inv.id === preselectedInvoiceId);
      if (target) {
        setAllocInputs({ [target.inv.id]: centimesToInputString(target.remaining) });
        if (!advancePayment) {
          setAmountText(centimesToInputString(target.remaining));
          setCurrency(target.inv.currency);
          setExchangeRate(String(target.inv.exchangeRate));
        }
        return;
      }
    }
    setAllocInputs({});
    if (!advancePayment && !preselectedInvoiceId) {
      setAmountText('0,00');
    }
  }, [open, preselectedInvoiceId, contactId, advancePayment]);

  const availableLeavesForBank = useMemo(() => {
    if (!bankAccountId) return [];
    return chequeLeaves.filter(
      (l) => l.bankAccountId === bankAccountId && l.status === 'disponible'
    );
  }, [chequeLeaves, bankAccountId]);

  if (!open) return null;

  const parsedAmount = advancePayment
    ? availableAdvanceCentimes
    : parseMoneyInputToCentimes(amountText);

  const parsedAllocations = Object.entries(allocInputs)
    .map(([invoiceId, raw]) => ({
      invoiceId,
      amountCentimes: parseMoneyInputToCentimes(raw),
    }))
    .filter((a) => !Number.isNaN(a.amountCentimes) && a.amountCentimes > 0);

  const totalAllocated = parsedAllocations.reduce((s, a) => s + a.amountCentimes, 0);
  const unallocatedBalance = Math.max(0, (Number.isNaN(parsedAmount) ? 0 : parsedAmount) - totalAllocated);

  const handleAutoAllocate = () => {
    let budget = Number.isNaN(parsedAmount) ? 0 : parsedAmount;
    const next: Record<string, string> = {};
    for (const item of unpaidInvoices) {
      if (budget <= 0) break;
      const take = Math.min(budget, item.remaining);
      next[item.inv.id] = centimesToInputString(take);
      budget -= take;
    }
    setAllocInputs(next);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (Number.isNaN(parsedAmount) || parsedAmount <= 0) {
      setError('Veuillez saisir un montant valide supérieur à zéro.');
      return;
    }

    for (const item of parsedAllocations) {
      const target = unpaidInvoices.find((u) => u.inv.id === item.invoiceId);
      if (target && item.amountCentimes > target.remaining) {
        setError(
          `Le montant affecté à la facture ${target.inv.invoiceNumber} dépasse son reste à payer.`
        );
        return;
      }
    }

    if (totalAllocated > parsedAmount) {
      setError('Le total affecté aux factures dépasse le montant du paiement.');
      return;
    }

    setBusy(true);
    try {
      if (advancePayment) {
        await allocateExistingAdvanceToInvoices({
          paymentId: advancePayment.id,
          invoiceType: direction === 'entrant' ? 'client' : 'fournisseur',
          allocations: parsedAllocations,
        });
        pushToast({
          type: 'success',
          title: 'Avance affectée aux factures',
        });
      } else {
        const rate = Number(exchangeRate.replace(',', '.'));
        const res = await recordPaymentOrCheque({
          direction,
          contactId,
          date,
          amountCentimes: parsedAmount,
          currency,
          exchangeRate: Number.isFinite(rate) && rate > 0 ? rate : 1,
          method,
          bankAccountId: method === 'especes' ? null : bankAccountId || null,
          reference,
          notes,
          allocations: parsedAllocations,
          chequeNumber: chequeNumber || undefined,
          issuerBank: issuerBank || undefined,
          chequeDate: chequeDate || date,
          chequeClearedImmediately,
          chequeLeafId: chequeLeafId || undefined,
        });
        pushToast({
          type: 'success',
          title:
            res.kind === 'cheque_pending'
              ? 'Chèque enregistré en attente'
              : 'Règlement enregistré',
          message:
            res.kind === 'cheque_pending'
              ? 'Le solde réel sera mis à jour lors de l’encaissement du chèque.'
              : unallocatedBalance > 0
              ? `Dont ${formatMoney(unallocatedBalance, currency)} conservé en avance.`
              : undefined,
        });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de l’enregistrement.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 bg-[#0F1E36] px-6 py-4 text-white">
          <h2 className="text-base font-semibold">
            {advancePayment
              ? 'Affecter une avance existante aux factures'
              : direction === 'entrant'
              ? 'Enregistrer un paiement client (Recette)'
              : 'Enregistrer un règlement fournisseur'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-700">
                {direction === 'entrant' ? 'Client *' : 'Fournisseur *'}
              </label>
              <select
                value={contactId}
                disabled={Boolean(advancePayment)}
                onChange={(e) => setContactId(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100"
              >
                <option value="">— Sélectionner —</option>
                {filteredContacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.company ? `${c.company} (${c.name || 'Contact'})` : c.name}
                  </option>
                ))}
              </select>
            </div>

            {!advancePayment && (
              <>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Date *</label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700">Montant *</label>
                  <input
                    type="text"
                    value={amountText}
                    onChange={(e) => setAmountText(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-right font-semibold tabular-nums"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-700">Devise</label>
                    <select
                      value={currency}
                      onChange={(e) => {
                        const code = e.target.value;
                        setCurrency(code);
                        const cfg = settings?.enabledCurrencies.find((c) => c.code === code);
                        setExchangeRate(String(cfg?.rateToDzd || 1));
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
                    <label className="block text-xs font-medium text-slate-700">Taux vers DZD</label>
                    <input
                      type="text"
                      disabled={currency === 'DZD'}
                      value={exchangeRate}
                      onChange={(e) => setExchangeRate(e.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm text-right tabular-nums disabled:bg-slate-100"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700">Mode de règlement</label>
                  <select
                    value={method}
                    onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="especes">Espèces (Caisse)</option>
                    <option value="virement">Virement bancaire</option>
                    <option value="cheque">Chèque</option>
                    <option value="carte">Carte bancaire</option>
                  </select>
                </div>

                {method !== 'especes' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-700">
                      {direction === 'entrant' ? 'Compte bancaire destinataire' : 'Compte bancaire émetteur'}
                    </label>
                    <select
                      value={bankAccountId}
                      onChange={(e) => setBankAccountId(e.target.value)}
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

                {method === 'cheque' && (
                  <div className="sm:col-span-2 rounded-lg border border-amber-200 bg-amber-50/70 p-4 space-y-3">
                    <div className="text-xs font-medium text-amber-900">
                      Détails du chèque (n’affecte le grand livre qu’une fois encaissé)
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      {direction === 'sortant' && availableLeavesForBank.length > 0 ? (
                        <div>
                          <label className="block text-xs text-slate-700">N° chèque (chéquier)</label>
                          <select
                            value={chequeLeafId}
                            onChange={(e) => {
                              const leaf = availableLeavesForBank.find((l) => l.id === e.target.value);
                              setChequeLeafId(e.target.value);
                              if (leaf) setChequeNumber(leaf.chequeNumber);
                            }}
                            className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
                          >
                            <option value="">— Saisie manuelle —</option>
                            {availableLeavesForBank.map((l) => (
                              <option key={l.id} value={l.id}>
                                {l.chequeNumber}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : null}

                      <div>
                        <label className="block text-xs text-slate-700">Numéro de chèque *</label>
                        <input
                          type="text"
                          value={chequeNumber}
                          onChange={(e) => setChequeNumber(e.target.value)}
                          placeholder="0012345"
                          className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
                        />
                      </div>

                      {direction === 'entrant' && (
                        <div>
                          <label className="block text-xs text-slate-700">Banque émettrice</label>
                          <input
                            type="text"
                            value={issuerBank}
                            onChange={(e) => setIssuerBank(e.target.value)}
                            placeholder="Ex : BEA, BNA, AGB..."
                            className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
                          />
                        </div>
                      )}

                      <div>
                        <label className="block text-xs text-slate-700">Date du chèque</label>
                        <input
                          type="date"
                          value={chequeDate}
                          onChange={(e) => setChequeDate(e.target.value)}
                          className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
                        />
                      </div>
                    </div>
                    <label className="inline-flex items-center gap-2 text-xs text-slate-700">
                      <input
                        type="checkbox"
                        checked={chequeClearedImmediately}
                        onChange={(e) => setChequeClearedImmediately(e.target.checked)}
                      />
                      <span>Chèque déjà encaissé en banque (mouvement immédiat)</span>
                    </label>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-slate-700">Référence</label>
                  <input
                    type="text"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder="N° virement, reçu..."
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
              </>
            )}
          </div>

          {/* Répartition sur factures */}
          {contactId && (
            <div className="space-y-2 border-t border-slate-200 pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Affectation aux factures impayées
                  </h3>
                  <p className="text-xs text-slate-500">
                    Laissez à 0 pour conserver le montant en tant qu’avance.
                  </p>
                </div>
                {unpaidInvoices.length > 0 && (
                  <button
                    type="button"
                    onClick={handleAutoAllocate}
                    className="rounded border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Répartir automatiquement
                  </button>
                )}
              </div>

              {unpaidInvoices.length === 0 ? (
                <div className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                  Aucune facture impayée pour ce tiers : le règlement sera enregistré comme <strong>avance disponible</strong>.
                </div>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
                      <tr>
                        <th className="px-3 py-2">N° Facture</th>
                        <th className="px-3 py-2">Date</th>
                        <th className="px-3 py-2 text-right">Total TTC</th>
                        <th className="px-3 py-2 text-right">Reste dû</th>
                        <th className="px-3 py-2 text-right">Montant affecté</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {unpaidInvoices.map(({ inv, remaining }) => (
                        <tr key={inv.id}>
                          <td className="px-3 py-2 font-medium text-slate-900">{inv.invoiceNumber}</td>
                          <td className="px-3 py-2 text-slate-600 tabular-nums">{inv.issueDate}</td>
                          <td className="px-3 py-2 text-right text-slate-600 tabular-nums">
                            {formatMoney(inv.totalTtcCentimes, inv.currency)}
                          </td>
                          <td className="px-3 py-2 text-right font-medium text-red-700 tabular-nums">
                            {formatMoney(remaining, inv.currency)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <input
                              type="text"
                              value={allocInputs[inv.id] ?? ''}
                              placeholder="0,00"
                              onChange={(e) =>
                                setAllocInputs((prev) => ({
                                  ...prev,
                                  [inv.id]: e.target.value,
                                }))
                              }
                              className="w-32 rounded border border-slate-300 px-2 py-1 text-right text-xs tabular-nums"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-4 rounded bg-slate-50 px-3 py-2 text-xs">
                <span>
                  Total affecté :{' '}
                  <strong className="tabular-nums">{formatMoney(totalAllocated, currency)}</strong>
                </span>
                <span>
                  Solde non affecté (Avance) :{' '}
                  <strong className="text-emerald-700 tabular-nums">
                    {formatMoney(unallocatedBalance, currency)}
                  </strong>
                </span>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 border-t border-slate-200 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              <Check className="h-4 w-4" />
              <span>{busy ? 'Enregistrement...' : 'Valider le règlement'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
