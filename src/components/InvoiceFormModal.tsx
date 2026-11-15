import React, { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, Plus, Trash2, X } from 'lucide-react';
import { createId, db } from '../db/database';
import type { CustomerInvoice, SupplierInvoice } from '../db/types';
import {
  generateNextInvoiceNumber,
  saveCustomerInvoice,
  saveSupplierInvoice,
} from '../services/financeActions';
import { computeInvoiceDocumentTotals } from '../utils/finance';
import {
  centimesToInputString,
  convertToBaseDzd,
  formatMoney,
  parseMoneyInputToCentimes,
} from '../utils/money';
import { useAppStore } from '../store/useAppStore';

interface EditableLine {
  id: string;
  description: string;
  quantityText: string;
  unitPriceText: string;
  discountText: string;
  tvaRateText: string;
}

interface InvoiceFormModalProps {
  open: boolean;
  mode: 'client' | 'fournisseur';
  existingInvoice?: CustomerInvoice | SupplierInvoice;
  preselectedContactId?: string;
  onClose: () => void;
}

export const InvoiceFormModal: React.FC<InvoiceFormModalProps> = ({
  open,
  mode,
  existingInvoice,
  preselectedContactId,
  onClose,
}) => {
  const pushToast = useAppStore((s) => s.pushToast);
  const settings = useLiveQuery(() => db.settings.get('company_settings'));
  const contacts = useLiveQuery(() => db.contacts.toArray(), [], []);

  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [supplierRef, setSupplierRef] = useState('');
  const [contactId, setContactId] = useState('');
  const [issueDate, setIssueDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [bcNumber, setBcNumber] = useState('');
  const [campaignRef, setCampaignRef] = useState('');
  const [currency, setCurrency] = useState('DZD');
  const [exchangeRateText, setExchangeRateText] = useState('1');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<EditableLine[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const defaultTva = settings?.defaultTvaRate ?? 19;

  useEffect(() => {
    if (!open) return;
    setError('');
    const today = new Date().toISOString().slice(0, 10);
    const in30Days = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

    if (existingInvoice) {
      setInvoiceNumber(existingInvoice.invoiceNumber);
      setCurrency(existingInvoice.currency);
      setExchangeRateText(String(existingInvoice.exchangeRate));
      setIssueDate(existingInvoice.issueDate);
      setDueDate(existingInvoice.dueDate);
      setDescription(existingInvoice.description);
      setNotes(existingInvoice.notes);

      if (mode === 'client') {
        const ci = existingInvoice as CustomerInvoice;
        setContactId(ci.clientId);
        setBcNumber(ci.bcNumber);
        setCampaignRef(ci.campaignRef);
      } else {
        const si = existingInvoice as SupplierInvoice;
        setContactId(si.supplierId);
        setSupplierRef(si.supplierRef);
      }

      setLines(
        existingInvoice.lines.map((l) => ({
          id: l.id,
          description: l.description,
          quantityText: String(l.quantity),
          unitPriceText: centimesToInputString(l.unitPriceCentimes),
          discountText: String(l.discountPercent),
          tvaRateText: String(l.tvaRate),
        }))
      );
    } else {
      generateNextInvoiceNumber(mode).then((num) => setInvoiceNumber(num));
      setSupplierRef('');
      setContactId(preselectedContactId || '');
      setIssueDate(today);
      setDueDate(in30Days);
      setBcNumber('');
      setCampaignRef('');
      setCurrency(settings?.defaultCurrency || 'DZD');
      setExchangeRateText('1');
      setDescription('');
      setNotes('');
      setLines([
        {
          id: createId('line'),
          description: '',
          quantityText: '1',
          unitPriceText: '0,00',
          discountText: '0',
          tvaRateText: String(defaultTva),
        },
      ]);
    }
  }, [open, existingInvoice, mode, preselectedContactId, settings]);

  const contactOptions = useMemo(() => {
    return contacts.filter((c) => {
      if (c.archived && c.id !== contactId) return false;
      if (mode === 'client') return c.type === 'client' || c.type === 'les_deux';
      return c.type === 'fournisseur' || c.type === 'les_deux';
    });
  }, [contacts, mode, contactId]);

  const computedTotals = useMemo(() => {
    const parsedLines = lines.map((l) => {
      const qty = parseFloat(l.quantityText.replace(',', '.'));
      const price = parseMoneyInputToCentimes(l.unitPriceText);
      const disc = parseFloat(l.discountText.replace(',', '.'));
      const tva = parseFloat(l.tvaRateText.replace(',', '.'));
      return {
        id: l.id,
        description: l.description,
        quantity: Number.isFinite(qty) && qty >= 0 ? qty : 0,
        unitPriceCentimes: Number.isNaN(price) ? 0 : price,
        discountPercent: Number.isFinite(disc) ? disc : 0,
        tvaRate: Number.isFinite(tva) ? tva : 0,
      };
    });
    return computeInvoiceDocumentTotals(parsedLines);
  }, [lines]);

  if (!open) return null;

  const rateVal = parseFloat(exchangeRateText.replace(',', '.'));
  const safeRate = Number.isFinite(rateVal) && rateVal > 0 ? rateVal : 1;
  const baseDzdTotal = convertToBaseDzd(computedTotals.totalTtcCentimes, safeRate);

  const addEmptyLine = () => {
    setLines((prev) => [
      ...prev,
      {
        id: createId('line'),
        description: '',
        quantityText: '1',
        unitPriceText: '0,00',
        discountText: '0',
        tvaRateText: String(defaultTva),
      },
    ]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const payloadLines = lines.map((l) => ({
        id: l.id,
        description: l.description.trim(),
        quantity: parseFloat(l.quantityText.replace(',', '.')) || 0,
        unitPriceCentimes: parseMoneyInputToCentimes(l.unitPriceText) || 0,
        discountPercent: parseFloat(l.discountText.replace(',', '.')) || 0,
        tvaRate: parseFloat(l.tvaRateText.replace(',', '.')) || 0,
      }));

      if (mode === 'client') {
        await saveCustomerInvoice({
          existingId: existingInvoice?.id,
          invoiceNumber,
          clientId: contactId,
          issueDate,
          dueDate,
          bcNumber,
          campaignRef,
          currency,
          exchangeRate: safeRate,
          description,
          notes,
          lines: payloadLines,
        });
      } else {
        await saveSupplierInvoice({
          existingId: existingInvoice?.id,
          invoiceNumber,
          supplierRef,
          supplierId: contactId,
          issueDate,
          dueDate,
          currency,
          exchangeRate: safeRate,
          description,
          notes,
          lines: payloadLines,
        });
      }

      pushToast({
        type: 'success',
        title: existingInvoice ? 'Facture mise à jour' : 'Facture créée',
        message: invoiceNumber,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la sauvegarde.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 bg-[#0F1E36] px-6 py-4 text-white">
          <h2 className="text-base font-semibold">
            {existingInvoice
              ? `Modifier la facture ${existingInvoice.invoiceNumber}`
              : mode === 'client'
              ? 'Nouvelle facture client'
              : 'Nouvelle facture fournisseur'}
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

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <div>
              <label className="block text-xs font-medium text-slate-700">N° Facture *</label>
              <input
                type="text"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-medium"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700">
                {mode === 'client' ? 'Client *' : 'Fournisseur *'}
              </label>
              <select
                value={contactId}
                onChange={(e) => setContactId(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">— Sélectionner —</option>
                {contactOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.company ? `${c.company} (${c.name || 'Contact'})` : c.name}
                  </option>
                ))}
              </select>
            </div>

            {mode === 'fournisseur' ? (
              <div>
                <label className="block text-xs font-medium text-slate-700">Réf. facture fournisseur</label>
                <input
                  type="text"
                  value={supplierRef}
                  onChange={(e) => setSupplierRef(e.target.value)}
                  placeholder="Ex : F-904/26"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            ) : (
              <div>
                <label className="block text-xs font-medium text-slate-700">N° BC</label>
                <input
                  type="text"
                  value={bcNumber}
                  onChange={(e) => setBcNumber(e.target.value)}
                  placeholder="Bon de commande"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-700">Date facture *</label>
              <input
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">Date d’échéance</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            {mode === 'client' && (
              <div>
                <label className="block text-xs font-medium text-slate-700">Campagne / Référence</label>
                <input
                  type="text"
                  value={campaignRef}
                  onChange={(e) => setCampaignRef(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-700">Devise</label>
                <select
                  value={currency}
                  onChange={(e) => {
                    const code = e.target.value;
                    setCurrency(code);
                    const cfg = settings?.enabledCurrencies.find((c) => c.code === code);
                    setExchangeRateText(String(cfg?.rateToDzd || 1));
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
                  disabled={currency === 'DZD'}
                  value={exchangeRateText}
                  onChange={(e) => setExchangeRateText(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-2 text-sm text-right tabular-nums disabled:bg-slate-100"
                />
              </div>
            </div>

            <div className="sm:col-span-4">
              <label className="block text-xs font-medium text-slate-700">Objet / Description</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Résumé de la prestation ou commande"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          {/* Grille éditable façon tableur pour les lignes */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Lignes de facturation</h3>
              <button
                type="button"
                onClick={addEmptyLine}
                className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Ajouter une ligne</span>
              </button>
            </div>

            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
                  <tr>
                    <th className="px-2.5 py-2">Désignation</th>
                    <th className="w-20 px-2 py-2 text-right">Qté</th>
                    <th className="w-32 px-2 py-2 text-right">Prix unitaire HT</th>
                    <th className="w-20 px-2 py-2 text-right">Remise %</th>
                    <th className="w-20 px-2 py-2 text-right">TVA %</th>
                    <th className="w-28 px-2.5 py-2 text-right">Total HT</th>
                    <th className="w-28 px-2.5 py-2 text-right">Total TTC</th>
                    <th className="w-10 px-2 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {lines.map((line, index) => {
                    const comp = computedTotals.lines[index];
                    return (
                      <tr key={line.id}>
                        <td className="p-1.5">
                          <input
                            type="text"
                            value={line.description}
                            onChange={(e) =>
                              setLines((prev) =>
                                prev.map((l) =>
                                  l.id === line.id ? { ...l, description: e.target.value } : l
                                )
                              )
                            }
                            placeholder="Article ou service"
                            className="w-full rounded border border-slate-200 px-2 py-1.5 text-xs focus:border-[#1D4ED8] focus:outline-none"
                          />
                        </td>
                        <td className="p-1.5">
                          <input
                            type="text"
                            value={line.quantityText}
                            onChange={(e) =>
                              setLines((prev) =>
                                prev.map((l) =>
                                  l.id === line.id ? { ...l, quantityText: e.target.value } : l
                                )
                              )
                            }
                            className="w-full rounded border border-slate-200 px-2 py-1.5 text-right text-xs tabular-nums"
                          />
                        </td>
                        <td className="p-1.5">
                          <input
                            type="text"
                            value={line.unitPriceText}
                            onChange={(e) =>
                              setLines((prev) =>
                                prev.map((l) =>
                                  l.id === line.id ? { ...l, unitPriceText: e.target.value } : l
                                )
                              )
                            }
                            className="w-full rounded border border-slate-200 px-2 py-1.5 text-right text-xs tabular-nums"
                          />
                        </td>
                        <td className="p-1.5">
                          <input
                            type="text"
                            value={line.discountText}
                            onChange={(e) =>
                              setLines((prev) =>
                                prev.map((l) =>
                                  l.id === line.id ? { ...l, discountText: e.target.value } : l
                                )
                              )
                            }
                            className="w-full rounded border border-slate-200 px-2 py-1.5 text-right text-xs tabular-nums"
                          />
                        </td>
                        <td className="p-1.5">
                          <input
                            type="text"
                            value={line.tvaRateText}
                            onChange={(e) =>
                              setLines((prev) =>
                                prev.map((l) =>
                                  l.id === line.id ? { ...l, tvaRateText: e.target.value } : l
                                )
                              )
                            }
                            className="w-full rounded border border-slate-200 px-2 py-1.5 text-right text-xs tabular-nums"
                          />
                        </td>
                        <td className="px-2.5 py-2 text-right font-medium text-slate-700 tabular-nums whitespace-nowrap">
                          {formatMoney(comp?.htCentimes || 0, currency)}
                        </td>
                        <td className="px-2.5 py-2 text-right font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                          {formatMoney(comp?.ttcCentimes || 0, currency)}
                        </td>
                        <td className="p-1.5 text-center">
                          {lines.length > 1 && (
                            <button
                              type="button"
                              onClick={() =>
                                setLines((prev) => prev.filter((l) => l.id !== line.id))
                              }
                              className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                              aria-label="Supprimer la ligne"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Totaux & Notes */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-700">Notes internes</label>
              <textarea
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-600">Total HT</span>
                <span className="font-medium text-slate-900 tabular-nums">
                  {formatMoney(computedTotals.totalHtCentimes, currency)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Total TVA</span>
                <span className="font-medium text-slate-900 tabular-nums">
                  {formatMoney(computedTotals.totalTvaCentimes, currency)}
                </span>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-bold">
                <span className="text-slate-900">Total TTC</span>
                <span className="text-[#0F1E36] tabular-nums">
                  {formatMoney(computedTotals.totalTtcCentimes, currency)}
                </span>
              </div>
              {currency !== 'DZD' && (
                <div className="flex justify-between text-xs text-slate-500">
                  <span>Équivalent DZD (taux {safeRate})</span>
                  <span className="tabular-nums">{formatMoney(baseDzdTotal, 'DZD')}</span>
                </div>
              )}
            </div>
          </div>

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
              className="inline-flex items-center gap-2 rounded-md bg-[#0F1E36] px-5 py-2 text-sm font-medium text-white hover:bg-[#1a2f52] disabled:opacity-60"
            >
              <Check className="h-4 w-4" />
              <span>{busy ? 'Enregistrement...' : 'Enregistrer la facture'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
