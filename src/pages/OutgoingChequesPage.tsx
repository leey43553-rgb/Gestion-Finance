import React, { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Ban, BookOpen, CheckCircle2, Plus, Search, X } from 'lucide-react';
import { db } from '../db/database';
import type { OutgoingCheque, OutgoingChequeStatus } from '../db/types';
import {
  cancelUnusedChequeLeaf,
  createChequeBook,
  createOutgoingCheque,
  updateOutgoingChequeStatus,
} from '../services/treasuryActions';
import { useAppStore } from '../store/useAppStore';
import { generateChequeSerialSequence } from '../utils/cheque';
import { addMoney, formatMoney, parseMoneyInputToCentimes } from '../utils/money';

const OUTGOING_STATUS_META: Record<
  OutgoingChequeStatus,
  { label: string; className: string }
> = {
  prepare: { label: 'Préparé', className: 'text-slate-700' },
  remis: { label: 'Remis', className: 'text-amber-700' },
  depose: { label: 'Déposé', className: 'text-amber-700' },
  en_attente: { label: 'En attente', className: 'text-amber-700' },
  encaisse: { label: 'Encaissé', className: 'text-emerald-700 font-semibold' },
  rejete: { label: 'Rejeté', className: 'text-red-700 font-semibold' },
  annule: { label: 'Annulé', className: 'text-slate-400 line-through' },
};

export const OutgoingChequesPage: React.FC = () => {
  const pushToast = useAppStore((s) => s.pushToast);
  const settings = useLiveQuery(() => db.settings.get('company_settings'));
  const bankAccounts = useLiveQuery(() => db.bankAccounts.toArray(), [], []);
  const chequeBooks = useLiveQuery(() => db.chequeBooks.toArray(), [], []);
  const chequeLeaves = useLiveQuery(() => db.chequeLeaves.toArray(), [], []);
  const outgoingCheques = useLiveQuery(() => db.outgoingCheques.toArray(), [], []);
  const contacts = useLiveQuery(() => db.contacts.toArray(), [], []);
  const supplierInvoices = useLiveQuery(() => db.supplierInvoices.toArray(), [], []);

  const [activeTab, setActiveTab] = useState<'cheques' | 'chequiers'>('cheques');
  const [search, setSearch] = useState('');
  const [bankFilter, setBankFilter] = useState('toutes');
  const [statusFilter, setStatusFilter] = useState<'tous' | OutgoingChequeStatus>('tous');

  // Modale émission chèque
  const [issueOpen, setIssueOpen] = useState(false);
  const [fBankId, setFBankId] = useState('');
  const [fLeafId, setFLeafId] = useState('');
  const [fManualNum, setFManualNum] = useState('');
  const [fBeneficiary, setFBeneficiary] = useState('');
  const [fContactId, setFContactId] = useState('');
  const [fIssueDate, setFIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [fAmountText, setFAmountText] = useState('0,00');
  const [fCurrency, setFCurrency] = useState('DZD');
  const [fExchangeRate, setFExchangeRate] = useState('1');
  const [fPurpose, setFPurpose] = useState('');
  const [fLinkedType, setFLinkedType] = useState<OutgoingCheque['linkedType']>('autre');
  const [fLinkedId, setFLinkedId] = useState('');
  const [fInitialStatus, setFInitialStatus] = useState<'prepare' | 'remis' | 'depose' | 'en_attente'>('remis');
  const [fNotes, setFNotes] = useState('');

  // Modale création chéquier
  const [bookOpen, setBookOpen] = useState(false);
  const [bBankId, setBBankId] = useState('');
  const [bStartSerial, setBStartSerial] = useState('');
  const [bCount, setBCount] = useState('25');
  const [bNotes, setBNotes] = useState('');

  // Inspecter les feuillets d'un chéquier
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);

  // Action changement statut chèque
  const [statusTarget, setStatusTarget] = useState<{
    cheque: OutgoingCheque;
    nextStatus: OutgoingChequeStatus;
  } | null>(null);
  const [clearingDate, setClearingDate] = useState(new Date().toISOString().slice(0, 10));
  const [statusReason, setStatusReason] = useState('');

  // Annulation feuillet vierge
  const [cancelLeafTarget, setCancelLeafTarget] = useState<{ id: string; num: string } | null>(null);
  const [cancelLeafReason, setCancelLeafReason] = useState('');

  const defaultCurrency = settings?.defaultCurrency || 'DZD';
  const currencies = settings?.enabledCurrencies;

  const bankMap = useMemo(() => new Map(bankAccounts.map((b) => [b.id, b])), [bankAccounts]);

  const availableLeavesForIssueBank = useMemo(() => {
    if (!fBankId) return [];
    return chequeLeaves
      .filter((l) => l.bankAccountId === fBankId && l.status === 'disponible')
      .sort((a, b) => a.chequeNumber.localeCompare(b.chequeNumber));
  }, [chequeLeaves, fBankId]);

  const bookPreviewRange = useMemo(() => {
    try {
      const cnt = parseInt(bCount, 10);
      if (!bStartSerial.trim() || !Number.isInteger(cnt) || cnt < 1 || cnt > 500) return null;
      const seq = generateChequeSerialSequence(bStartSerial, cnt);
      return { first: seq[0], last: seq[seq.length - 1], count: seq.length };
    } catch {
      return null;
    }
  }, [bStartSerial, bCount]);

  const filteredCheques = useMemo(() => {
    const q = search.trim().toLowerCase();
    return outgoingCheques
      .filter((c) => {
        if (bankFilter !== 'toutes' && c.bankAccountId !== bankFilter) return false;
        if (statusFilter !== 'tous' && c.status !== statusFilter) return false;
        if (q) {
          const hay = `${c.chequeNumber} ${c.beneficiary} ${c.purpose} ${c.notes}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => b.issueDate.localeCompare(a.issueDate));
  }, [outgoingCheques, bankFilter, statusFilter, search]);

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

  const booksWithStats = useMemo(() => {
    return chequeBooks
      .map((book) => {
        const leaves = chequeLeaves
          .filter((l) => l.chequeBookId === book.id)
          .sort((a, b) => a.chequeNumber.localeCompare(b.chequeNumber));
        const availableCount = leaves.filter((l) => l.status === 'disponible').length;
        const firstNum = leaves[0]?.chequeNumber || book.startSerial;
        const lastNum = leaves[leaves.length - 1]?.chequeNumber || '';
        return {
          book,
          bank: bankMap.get(book.bankAccountId),
          leaves,
          availableCount,
          firstNum,
          lastNum,
        };
      })
      .sort((a, b) => b.book.createdAt.localeCompare(a.book.createdAt));
  }, [chequeBooks, chequeLeaves, bankMap]);

  const selectedBook = useMemo(
    () => booksWithStats.find((b) => b.book.id === selectedBookId) || null,
    [booksWithStats, selectedBookId]
  );

  const openIssueModal = () => {
    const firstBank = bankAccounts.find((b) => b.active);
    setFBankId(firstBank?.id || '');
    setFLeafId('');
    setFManualNum('');
    setFBeneficiary('');
    setFContactId('');
    setFIssueDate(new Date().toISOString().slice(0, 10));
    setFAmountText('0,00');
    setFCurrency(firstBank?.currency || defaultCurrency);
    setFExchangeRate('1');
    setFPurpose('');
    setFLinkedType('autre');
    setFLinkedId('');
    setFInitialStatus('remis');
    setFNotes('');
    setIssueOpen(true);
  };

  const handleCreateBook = async (e: React.FormEvent) => {
    e.preventDefault();
    const count = parseInt(bCount, 10);
    try {
      const res = await createChequeBook({
        bankAccountId: bBankId,
        startSerial: bStartSerial,
        count,
        notes: bNotes,
      });
      setBookOpen(false);
      setSelectedBookId(res.book.id);
      pushToast({
        type: 'success',
        title: 'Chéquier généré automatiquement',
        message: `${res.leaves.length} chèques créés (${res.leaves[0].chequeNumber} → ${res.leaves[res.leaves.length - 1].chequeNumber}).`,
      });
    } catch (err) {
      pushToast({
        type: 'error',
        title: 'Création impossible',
        message: err instanceof Error ? err.message : 'Erreur',
      });
    }
  };

  const handleCreateOutgoingCheque = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseMoneyInputToCentimes(fAmountText);
    if (Number.isNaN(amount) || amount <= 0) {
      pushToast({ type: 'error', title: 'Montant invalide' });
      return;
    }
    const rate = parseFloat(fExchangeRate.replace(',', '.'));
    try {
      await createOutgoingCheque({
        bankAccountId: fBankId,
        chequeLeafId: fLeafId || undefined,
        chequeNumber: fLeafId ? undefined : fManualNum,
        beneficiary: fBeneficiary,
        contactId: fContactId || undefined,
        issueDate: fIssueDate,
        amountCentimes: amount,
        currency: fCurrency,
        exchangeRate: Number.isFinite(rate) && rate > 0 ? rate : 1,
        purpose: fPurpose,
        linkedType: fLinkedType,
        linkedId: fLinkedId || undefined,
        initialStatus: fInitialStatus,
        notes: fNotes,
      });
      setIssueOpen(false);
      pushToast({
        type: 'success',
        title: 'Chèque émis enregistré',
        message: 'En attente d’encaissement (la trésorerie sera débitée au statut Encaissé).',
      });
    } catch (err) {
      pushToast({
        type: 'error',
        title: 'Erreur de validation',
        message: err instanceof Error ? err.message : 'Erreur',
      });
    }
  };

  const handleConfirmStatusChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!statusTarget) return;
    try {
      await updateOutgoingChequeStatus({
        chequeId: statusTarget.cheque.id,
        nextStatus: statusTarget.nextStatus,
        clearingDate: statusTarget.nextStatus === 'encaisse' ? clearingDate : undefined,
        reason: statusReason || undefined,
      });
      pushToast({
        type: 'success',
        title: 'Statut du chèque mis à jour',
        message:
          statusTarget.nextStatus === 'encaisse'
            ? 'Le mouvement a été enregistré au grand livre.'
            : undefined,
      });
      setStatusTarget(null);
      setStatusReason('');
    } catch (err) {
      pushToast({
        type: 'error',
        title: 'Erreur',
        message: err instanceof Error ? err.message : 'Erreur',
      });
    }
  };

  const handleCancelUnusedLeaf = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancelLeafTarget) return;
    try {
      await cancelUnusedChequeLeaf(cancelLeafTarget.id, cancelLeafReason);
      pushToast({
        type: 'info',
        title: `Chèque N° ${cancelLeafTarget.num} annulé`,
        message: 'Ce numéro reste définitivement bloqué et ne pourra jamais être réutilisé.',
      });
      setCancelLeafTarget(null);
      setCancelLeafReason('');
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
              onClick={() => setActiveTab('cheques')}
              className={`rounded px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                activeTab === 'cheques' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              Chèques émis ({outgoingCheques.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('chequiers')}
              className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                activeTab === 'chequiers' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              <BookOpen className="h-3.5 w-3.5" />
              <span>Chéquiers ({chequeBooks.length})</span>
            </button>
          </div>

          {activeTab === 'cheques' && (
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="N° chèque, bénéficiaire, motif..."
                  className="w-60 rounded-md border border-slate-300 py-1.5 pr-3 pl-9 text-sm"
                />
              </div>
              <select
                value={bankFilter}
                onChange={(e) => setBankFilter(e.target.value)}
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
              >
                <option value="toutes">Toutes banques</option>
                {bankAccounts.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.bankName} — {b.accountName}
                  </option>
                ))}
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as 'tous' | OutgoingChequeStatus)}
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
              >
                <option value="tous">Tous statuts</option>
                {Object.entries(OUTGOING_STATUS_META).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setBBankId(bankAccounts[0]?.id || '');
              setBStartSerial('');
              setBCount('25');
              setBNotes('');
              setBookOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            <BookOpen className="h-4 w-4" />
            <span>Nouveau chéquier</span>
          </button>
          <button
            type="button"
            onClick={openIssueModal}
            className="inline-flex items-center gap-2 rounded-md bg-[#0F1E36] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a2f52] whitespace-nowrap"
          >
            <Plus className="h-4 w-4" />
            <span>Émettre un chèque</span>
          </button>
        </div>
      </div>

      {activeTab === 'cheques' ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="text-xs text-slate-500">
                Chèques émis en attente (non encore débités de la banque)
              </div>
              <div className="mt-1 text-lg font-bold text-amber-700 tabular-nums">
                {formatMoney(totals.pending, defaultCurrency, currencies)}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="text-xs text-slate-500">Chèques émis encaissés (sorties réelles)</div>
              <div className="mt-1 text-lg font-bold text-slate-900 tabular-nums">
                {formatMoney(totals.cleared, defaultCurrency, currencies)}
              </div>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
                <tr>
                  <th className="px-3 py-2.5">N° Chèque</th>
                  <th className="px-3 py-2.5">Banque</th>
                  <th className="px-3 py-2.5">Date sortie</th>
                  <th className="px-3 py-2.5">Bénéficiaire</th>
                  <th className="px-3 py-2.5">Objet / Motif</th>
                  <th className="px-3 py-2.5 text-right">Montant</th>
                  <th className="px-3 py-2.5">Statut</th>
                  <th className="px-3 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredCheques.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-500">
                      Aucun chèque émis enregistré.
                    </td>
                  </tr>
                ) : (
                  filteredCheques.map((c) => {
                    const bank = bankMap.get(c.bankAccountId);
                    const meta = OUTGOING_STATUS_META[c.status];
                    const isTerminal = c.status === 'annule' || c.status === 'rejete';
                    return (
                      <tr key={c.id} className="hover:bg-slate-50">
                        <td className="px-3 py-2.5 font-mono font-semibold text-slate-900 whitespace-nowrap">
                          {c.chequeNumber}
                        </td>
                        <td className="px-3 py-2.5 text-slate-700">
                          {bank ? `${bank.bankName} — ${bank.accountName}` : 'Banque'}
                        </td>
                        <td className="px-3 py-2.5 text-slate-600 tabular-nums whitespace-nowrap">
                          {c.issueDate}
                        </td>
                        <td className="px-3 py-2.5 font-medium text-slate-900">{c.beneficiary}</td>
                        <td className="px-3 py-2.5 text-slate-600">{c.purpose}</td>
                        <td className="px-3 py-2.5 text-right font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                          {formatMoney(c.amountCentimes, c.currency, currencies)}
                        </td>
                        <td className={`px-3 py-2.5 whitespace-nowrap ${meta.className}`}>
                          {meta.label}
                          {c.clearingDate && c.status === 'encaisse' && (
                            <div className="text-[10px] font-normal text-slate-500">
                              Encaissé le {c.clearingDate}
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
                                    setClearingDate(new Date().toISOString().slice(0, 10));
                                    setStatusReason('');
                                    setStatusTarget({ cheque: c, nextStatus: 'encaisse' });
                                  }}
                                  className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800 hover:bg-emerald-100"
                                >
                                  <CheckCircle2 className="h-3 w-3" />
                                  <span>Marquer encaissé</span>
                                </button>
                              )}
                              <select
                                value={c.status}
                                onChange={(e) => {
                                  const next = e.target.value as OutgoingChequeStatus;
                                  if (next === c.status) return;
                                  if (next === 'encaisse' || next === 'rejete' || next === 'annule') {
                                    setClearingDate(new Date().toISOString().slice(0, 10));
                                    setStatusReason('');
                                    setStatusTarget({ cheque: c, nextStatus: next });
                                  } else {
                                    updateOutgoingChequeStatus({ chequeId: c.id, nextStatus: next });
                                  }
                                }}
                                className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px]"
                              >
                                {Object.entries(OUTGOING_STATUS_META).map(([k, v]) => (
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
        </div>
      ) : (
        /* Onglet Chéquiers */
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          <div className="lg:col-span-5 space-y-3">
            {booksWithStats.length === 0 ? (
              <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
                Aucun chéquier enregistré. Cliquez sur « Nouveau chéquier » pour générer automatiquement toute une série avec zéros initiaux.
              </div>
            ) : (
              booksWithStats.map(({ book, bank, availableCount, firstNum, lastNum }) => (
                <div
                  key={book.id}
                  onClick={() => setSelectedBookId(book.id)}
                  className={`cursor-pointer rounded-lg border p-4 transition-colors ${
                    selectedBookId === book.id
                      ? 'border-[#1D4ED8] bg-blue-50/50'
                      : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">
                        {bank ? `${bank.bankName} — ${bank.accountName}` : 'Banque'}
                      </div>
                      <div className="mt-1 font-mono text-xs text-slate-700">
                        Série : {firstNum} → {lastNum} ({book.count} chèques)
                      </div>
                      {book.notes && <div className="mt-1 text-xs text-slate-500">{book.notes}</div>}
                    </div>
                    <div className="text-right">
                      <div className="text-base font-bold text-emerald-700 tabular-nums">
                        {availableCount} / {book.count}
                      </div>
                      <div className="text-[11px] text-slate-500">restants</div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="lg:col-span-7 rounded-lg border border-slate-200 bg-white p-5">
            {!selectedBook ? (
              <div className="py-12 text-center text-sm text-slate-500">
                Sélectionnez un chéquier à gauche pour consulter l’état de chaque feuillet.
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">
                      Feuillets du chéquier {selectedBook.firstNum} → {selectedBook.lastNum}
                    </h3>
                    <p className="text-xs text-slate-500">
                      {selectedBook.availableCount} disponible(s) sur {selectedBook.book.count} · Aucun numéro ne peut être réutilisé même après annulation.
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {selectedBook.leaves.map((leaf) => (
                    <div
                      key={leaf.id}
                      className={`flex items-center justify-between rounded border px-2.5 py-2 text-xs ${
                        leaf.status === 'disponible'
                          ? 'border-emerald-200 bg-emerald-50/60 text-emerald-900'
                          : leaf.status === 'annule' || leaf.status === 'rejete'
                          ? 'border-red-200 bg-red-50/50 text-red-700'
                          : 'border-slate-200 bg-slate-50 text-slate-700'
                      }`}
                    >
                      <div>
                        <div className="font-mono font-semibold">{leaf.chequeNumber}</div>
                        <div className="text-[10px]">
                          {leaf.status === 'disponible'
                            ? 'Disponible'
                            : OUTGOING_STATUS_META[leaf.status as OutgoingChequeStatus]?.label || leaf.status}
                        </div>
                      </div>
                      {leaf.status === 'disponible' && (
                        <button
                          type="button"
                          onClick={() =>
                            setCancelLeafTarget({ id: leaf.id, num: leaf.chequeNumber })
                          }
                          title="Annuler ce feuillet définitivement"
                          className="rounded p-1 text-slate-400 hover:bg-red-100 hover:text-red-700"
                        >
                          <Ban className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modale Création Chéquier en série */}
      {bookOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-[#0F1E36] px-6 py-4 text-white">
              <h2 className="text-base font-semibold">Nouveau chéquier (génération automatique)</h2>
              <button
                type="button"
                onClick={() => setBookOpen(false)}
                className="rounded p-1 text-slate-300 hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleCreateBook} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700">Compte bancaire *</label>
                <select
                  required
                  value={bBankId}
                  onChange={(e) => setBBankId(e.target.value)}
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
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Premier numéro (avec zéros) *
                  </label>
                  <input
                    type="text"
                    required
                    value={bStartSerial}
                    onChange={(e) => setBStartSerial(e.target.value)}
                    placeholder="Ex : 0012345"
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Nombre de chèques *
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    required
                    value={bCount}
                    onChange={(e) => setBCount(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm tabular-nums"
                  />
                </div>
              </div>

              {bookPreviewRange && (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                  Aperçu de la série générée :{' '}
                  <strong className="font-mono">
                    {bookPreviewRange.first} → {bookPreviewRange.last}
                  </strong>{' '}
                  ({bookPreviewRange.count} chèques avec zéros initiaux conservés)
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700">Notes</label>
                <input
                  type="text"
                  value={bNotes}
                  onChange={(e) => setBNotes(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div className="flex justify-end gap-3 border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={() => setBookOpen(false)}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="rounded-md bg-[#0F1E36] px-5 py-2 text-sm font-medium text-white hover:bg-[#1a2f52]"
                >
                  Générer le chéquier
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modale Émission Chèque */}
      {issueOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-2xl rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-[#0F1E36] px-6 py-4 text-white">
              <h2 className="text-base font-semibold">Émettre un chèque</h2>
              <button
                type="button"
                onClick={() => setIssueOpen(false)}
                className="rounded p-1 text-slate-300 hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleCreateOutgoingCheque} className="p-6 space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Banque émettrice *</label>
                  <select
                    required
                    value={fBankId}
                    onChange={(e) => {
                      const bank = bankAccounts.find((b) => b.id === e.target.value);
                      setFBankId(e.target.value);
                      setFLeafId('');
                      if (bank) setFCurrency(bank.currency);
                    }}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">— Sélectionner —</option>
                    {bankAccounts
                      .filter((b) => b.active)
                      .map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.bankName} — {b.accountName} ({b.currency})
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Numéro disponible du chéquier *
                  </label>
                  {availableLeavesForIssueBank.length > 0 ? (
                    <select
                      required
                      value={fLeafId}
                      onChange={(e) => setFLeafId(e.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm"
                    >
                      <option value="">— Choisir un N° disponible —</option>
                      {availableLeavesForIssueBank.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.chequeNumber}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      required
                      value={fManualNum}
                      onChange={(e) => setFManualNum(e.target.value)}
                      placeholder="Aucun chéquier : saisir N°"
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm"
                    />
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700">Bénéficiaire *</label>
                  <input
                    type="text"
                    required
                    value={fBeneficiary}
                    onChange={(e) => setFBeneficiary(e.target.value)}
                    placeholder="Nom ou société"
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700">
                    Fournisseur lié (optionnel)
                  </label>
                  <select
                    value={fContactId}
                    onChange={(e) => {
                      setFContactId(e.target.value);
                      const c = contacts.find((x) => x.id === e.target.value);
                      if (c && !fBeneficiary) setFBeneficiary(c.company || c.name);
                    }}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">— Aucun —</option>
                    {contacts
                      .filter((c) => c.type === 'fournisseur' || c.type === 'les_deux')
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.company || c.name}
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700">Date de sortie *</label>
                  <input
                    type="date"
                    required
                    value={fIssueDate}
                    onChange={(e) => setFIssueDate(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700">Montant *</label>
                  <input
                    type="text"
                    required
                    value={fAmountText}
                    onChange={(e) => setFAmountText(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-right font-semibold tabular-nums"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700">
                    Objet / Ce que vous avez réglé avec ce chèque *
                  </label>
                  <input
                    type="text"
                    required
                    value={fPurpose}
                    onChange={(e) => setFPurpose(e.target.value)}
                    placeholder="Ex : Règlement loyer entrepôt, acompte fournisseur..."
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700">Lier à</label>
                  <select
                    value={fLinkedType}
                    onChange={(e) => {
                      setFLinkedType(e.target.value as OutgoingCheque['linkedType']);
                      setFLinkedId('');
                    }}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="autre">Autre / Libre</option>
                    <option value="fournisseur_facture">Facture fournisseur</option>
                    <option value="depense">Dépense</option>
                    <option value="paiement">Règlement</option>
                  </select>
                </div>

                {fLinkedType === 'fournisseur_facture' ? (
                  <div>
                    <label className="block text-xs font-medium text-slate-700">Facture fournisseur</label>
                    <select
                      value={fLinkedId}
                      onChange={(e) => setFLinkedId(e.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                    >
                      <option value="">— Choisir —</option>
                      {supplierInvoices
                        .filter((inv) => inv.status !== 'annulee')
                        .map((inv) => (
                          <option key={inv.id} value={inv.id}>
                            {inv.invoiceNumber} ({formatMoney(inv.totalTtcCentimes, inv.currency)})
                          </option>
                        ))}
                    </select>
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-medium text-slate-700">Statut initial</label>
                    <select
                      value={fInitialStatus}
                      onChange={(e) =>
                        setFInitialStatus(
                          e.target.value as 'prepare' | 'remis' | 'depose' | 'en_attente'
                        )
                      }
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                    >
                      <option value="prepare">Préparé</option>
                      <option value="remis">Remis</option>
                      <option value="depose">Déposé</option>
                      <option value="en_attente">En attente</option>
                    </select>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-3 border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={() => setIssueOpen(false)}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="rounded-md bg-[#0F1E36] px-5 py-2 text-sm font-medium text-white hover:bg-[#1a2f52]"
                >
                  Enregistrer le chèque
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modale confirmation encaissement / rejet / annulation */}
      {statusTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form
            onSubmit={handleConfirmStatusChange}
            className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-xl space-y-4"
          >
            <h3 className="text-base font-semibold text-slate-900">
              Chèque N° {statusTarget.cheque.chequeNumber} →{' '}
              {OUTGOING_STATUS_META[statusTarget.nextStatus].label}
            </h3>
            {statusTarget.nextStatus === 'encaisse' ? (
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Date d’encaissement en banque *
                </label>
                <input
                  type="date"
                  required
                  value={clearingDate}
                  onChange={(e) => setClearingDate(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
                <p className="mt-2 text-xs text-slate-500">
                  Cette action débitera réellement le compte bancaire dans le grand livre.
                </p>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-medium text-slate-700">Motif *</label>
                <input
                  type="text"
                  required
                  value={statusReason}
                  onChange={(e) => setStatusReason(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
                <p className="mt-2 text-xs text-slate-500">
                  Le numéro {statusTarget.cheque.chequeNumber} restera bloqué et ne pourra jamais être réutilisé.
                </p>
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

      {/* Modale annulation feuillet vierge */}
      {cancelLeafTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form
            onSubmit={handleCancelUnusedLeaf}
            className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-xl space-y-4"
          >
            <h3 className="text-base font-semibold text-slate-900">
              Annuler le feuillet N° {cancelLeafTarget.num} ?
            </h3>
            <p className="text-xs text-slate-600">
              Le feuillet sera marqué « Annulé » de façon permanente et ce numéro ne pourra plus jamais être réutilisé.
            </p>
            <div>
              <label className="block text-xs font-medium text-slate-700">Motif *</label>
              <input
                type="text"
                required
                value={cancelLeafReason}
                onChange={(e) => setCancelLeafReason(e.target.value)}
                placeholder="Ex : Chèque abîmé ou annulé avant signature"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCancelLeafTarget(null)}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700"
              >
                Fermer
              </button>
              <button
                type="submit"
                className="rounded-md bg-red-600 px-4 py-2 text-xs font-medium text-white"
              >
                Annuler le feuillet
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
