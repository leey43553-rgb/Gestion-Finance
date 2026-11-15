import React, { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Archive,
  ArrowUpDown,
  FileText,
  Plus,
  Printer,
  Search,
  Wallet,
  X,
} from 'lucide-react';
import { db, recordAudit } from '../db/database';
import type { Contact, ContactType } from '../db/types';
import { saveContact } from '../services/financeActions';
import { useAppStore } from '../store/useAppStore';
import {
  computeContactAccountSummary,
  computeInvoicePaidCentimes,
  computeInvoiceRemainingCentimes,
  computeInvoiceStatus,
  computePaymentUnallocatedCentimes,
} from '../utils/finance';
import { formatMoney } from '../utils/money';
import { InvoiceFormModal } from '../components/InvoiceFormModal';
import { PaymentModal } from '../components/PaymentModal';
import { PrintDocumentModal } from '../components/PrintDocumentModal';

interface ContactsPageProps {
  mode: 'client' | 'fournisseur';
}

type SortField = 'company' | 'name' | 'invoiced' | 'unpaid';

export const ContactsPage: React.FC<ContactsPageProps> = ({ mode }) => {
  const pushToast = useAppStore((s) => s.pushToast);
  const settings = useLiveQuery(() => db.settings.get('company_settings'));
  const contacts = useLiveQuery(() => db.contacts.toArray(), [], []);
  const customerInvoices = useLiveQuery(() => db.customerInvoices.toArray(), [], []);
  const supplierInvoices = useLiveQuery(() => db.supplierInvoices.toArray(), [], []);
  const payments = useLiveQuery(() => db.payments.toArray(), [], []);
  const allocations = useLiveQuery(() => db.paymentAllocations.toArray(), [], []);
  const incomingCheques = useLiveQuery(() => db.incomingCheques.toArray(), [], []);
  const outgoingCheques = useLiveQuery(() => db.outgoingCheques.toArray(), [], []);

  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState<'actifs' | 'tous' | 'mixtes' | 'archives'>('actifs');
  const [sortField, setSortField] = useState<SortField>('company');
  const [sortAsc, setSortAsc] = useState(true);

  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<'factures' | 'paiements' | 'cheques'>('factures');

  // Édition rapide façon tableur
  const [editingCell, setEditingCell] = useState<{
    id: string;
    field: 'company' | 'name' | 'phone' | 'email' | 'nif';
    value: string;
  } | null>(null);

  // Ligne d'ajout rapide en bas de grille
  const [quickCompany, setQuickCompany] = useState('');
  const [quickName, setQuickName] = useState('');
  const [quickPhone, setQuickPhone] = useState('');
  const [quickEmail, setQuickEmail] = useState('');
  const [quickType, setQuickType] = useState<ContactType>(mode);

  // Modales complètes
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | undefined>(undefined);
  const [formType, setFormType] = useState<ContactType>(mode);
  const [formName, setFormName] = useState('');
  const [formCompany, setFormCompany] = useState('');
  const [formAddress, setFormAddress] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formNif, setFormNif] = useState('');
  const [formNis, setFormNis] = useState('');
  const [formRc, setFormRc] = useState('');
  const [formAi, setFormAi] = useState('');
  const [formNotes, setFormNotes] = useState('');

  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);
  const [statementPrintOpen, setStatementPrintOpen] = useState(false);

  const defaultCurrency = settings?.defaultCurrency || 'DZD';
  const currencies = settings?.enabledCurrencies;

  const relevantInvoices = useMemo(() => {
    if (mode === 'client') {
      return customerInvoices.map((i) => ({
        id: i.id,
        invoiceNumber: i.invoiceNumber,
        contactId: i.clientId,
        issueDate: i.issueDate,
        dueDate: i.dueDate,
        currency: i.currency,
        totalTtcCentimes: i.totalTtcCentimes,
        baseDzdTtcCentimes: i.baseDzdTtcCentimes,
        status: i.status,
      }));
    }
    return supplierInvoices.map((i) => ({
      id: i.id,
      invoiceNumber: i.invoiceNumber,
      contactId: i.supplierId,
      issueDate: i.issueDate,
      dueDate: i.dueDate,
      currency: i.currency,
      totalTtcCentimes: i.totalTtcCentimes,
      baseDzdTtcCentimes: i.baseDzdTtcCentimes,
      status: i.status,
    }));
  }, [mode, customerInvoices, supplierInvoices]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = contacts
      .filter((c) => {
        if (mode === 'client' && c.type !== 'client' && c.type !== 'les_deux') return false;
        if (mode === 'fournisseur' && c.type !== 'fournisseur' && c.type !== 'les_deux') return false;
        if (filterMode === 'actifs' && c.archived) return false;
        if (filterMode === 'archives' && !c.archived) return false;
        if (filterMode === 'mixtes' && c.type !== 'les_deux') return false;
        if (q) {
          const hay = `${c.company} ${c.name} ${c.phone} ${c.email} ${c.nif}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .map((contact) => {
        const summary = computeContactAccountSummary({
          contactId: contact.id,
          direction: mode,
          invoices: relevantInvoices,
          payments,
          allocations,
        });
        return { contact, summary };
      });

    list.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'company') {
        cmp = (a.contact.company || a.contact.name).localeCompare(
          b.contact.company || b.contact.name,
          'fr'
        );
      } else if (sortField === 'name') {
        cmp = a.contact.name.localeCompare(b.contact.name, 'fr');
      } else if (sortField === 'invoiced') {
        cmp = a.summary.totalInvoicedBaseDzd - b.summary.totalInvoicedBaseDzd;
      } else if (sortField === 'unpaid') {
        cmp = a.summary.totalUnpaidBaseDzd - b.summary.totalUnpaidBaseDzd;
      }
      return sortAsc ? cmp : -cmp;
    });

    return list;
  }, [contacts, mode, filterMode, search, relevantInvoices, payments, allocations, sortField, sortAsc]);

  const selectedRow = useMemo(
    () => rows.find((r) => r.contact.id === selectedContactId) || null,
    [rows, selectedContactId]
  );

  const selectedContactDetail = useMemo(() => {
    if (!selectedRow) return null;
    const cid = selectedRow.contact.id;
    const validPaymentIds = new Set(
      payments.filter((p) => p.status === 'valide').map((p) => p.id)
    );

    const contactInvoices = relevantInvoices
      .filter((i) => i.contactId === cid)
      .map((i) => {
        const paid = computeInvoicePaidCentimes(i.id, allocations, validPaymentIds);
        const remaining = computeInvoiceRemainingCentimes(i.totalTtcCentimes, paid, i.status);
        const computedStatus = computeInvoiceStatus({
          storedStatus: i.status,
          totalTtcCentimes: i.totalTtcCentimes,
          paidCentimes: paid,
          dueDate: i.dueDate,
        });
        return { ...i, paid, remaining, computedStatus };
      })
      .sort((a, b) => b.issueDate.localeCompare(a.issueDate));

    const contactPayments = payments
      .filter(
        (p) =>
          p.contactId === cid &&
          p.direction === (mode === 'client' ? 'entrant' : 'sortant')
      )
      .map((p) => ({
        ...p,
        unallocated: computePaymentUnallocatedCentimes(p, allocations),
      }))
      .sort((a, b) => b.date.localeCompare(a.date));

    const contactCheques =
      mode === 'client'
        ? incomingCheques.filter((c) => c.clientId === cid)
        : outgoingCheques.filter((c) => c.contactId === cid);

    return { contactInvoices, contactPayments, contactCheques };
  }, [selectedRow, relevantInvoices, payments, allocations, incomingCheques, outgoingCheques, mode]);

  const openModal = (contact?: Contact) => {
    setEditingContact(contact);
    setFormType(contact?.type || mode);
    setFormName(contact?.name || '');
    setFormCompany(contact?.company || '');
    setFormAddress(contact?.address || '');
    setFormPhone(contact?.phone || '');
    setFormEmail(contact?.email || '');
    setFormNif(contact?.nif || '');
    setFormNis(contact?.nis || '');
    setFormRc(contact?.rc || '');
    setFormAi(contact?.ai || '');
    setFormNotes(contact?.notes || '');
    setFormModalOpen(true);
  };

  const handleSaveModal = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const saved = await saveContact({
        existingId: editingContact?.id,
        type: formType,
        name: formName,
        company: formCompany,
        address: formAddress,
        phone: formPhone,
        email: formEmail,
        nif: formNif,
        nis: formNis,
        rc: formRc,
        ai: formAi,
        notes: formNotes,
      });
      setFormModalOpen(false);
      setSelectedContactId(saved.id);
      pushToast({
        type: 'success',
        title: editingContact ? 'Fiche mise à jour' : 'Fiche enregistrée',
        message: saved.company || saved.name,
      });
    } catch (err) {
      pushToast({
        type: 'error',
        title: 'Erreur de validation',
        message: err instanceof Error ? err.message : 'Erreur inconnue',
      });
    }
  };

  const handleQuickAddRow = async () => {
    if (!quickCompany.trim() && !quickName.trim()) {
      pushToast({
        type: 'error',
        title: 'Saisie incomplète',
        message: 'Saisissez au moins la société ou le nom.',
      });
      return;
    }
    try {
      const created = await saveContact({
        type: quickType,
        name: quickName,
        company: quickCompany,
        address: '',
        phone: quickPhone,
        email: quickEmail,
        nif: '',
        nis: '',
        rc: '',
        ai: '',
        notes: '',
      });
      setQuickCompany('');
      setQuickName('');
      setQuickPhone('');
      setQuickEmail('');
      setSelectedContactId(created.id);
      pushToast({ type: 'success', title: 'Contact ajouté', message: created.company || created.name });
    } catch (err) {
      pushToast({
        type: 'error',
        title: 'Erreur',
        message: err instanceof Error ? err.message : 'Impossible d’ajouter.',
      });
    }
  };

  const commitInlineEdit = async (moveNextField?: 'company' | 'name' | 'phone' | 'email' | 'nif') => {
    if (!editingCell) return;
    const current = contacts.find((c) => c.id === editingCell.id);
    if (!current) {
      setEditingCell(null);
      return;
    }

    const updatedVal = editingCell.value.trim();
    if (current[editingCell.field] !== updatedVal) {
      await db.contacts.update(current.id, {
        [editingCell.field]: updatedVal,
        updatedAt: new Date().toISOString(),
      });
      await recordAudit({
        action: 'MODIFICATION',
        entityType: 'contact',
        entityId: current.id,
        summary: `Modification rapide (${editingCell.field}) sur ${current.company || current.name}`,
      });
    }

    if (moveNextField) {
      setEditingCell({
        id: current.id,
        field: moveNextField,
        value: current[moveNextField] || '',
      });
    } else {
      setEditingCell(null);
    }
  };

  const handleToggleArchive = async (contact: Contact) => {
    const nextArchived = !contact.archived;
    await db.contacts.update(contact.id, {
      archived: nextArchived,
      updatedAt: new Date().toISOString(),
    });
    await recordAudit({
      action: 'MODIFICATION',
      entityType: 'contact',
      entityId: contact.id,
      summary: `${nextArchived ? 'Archivage' : 'Réactivation'} de ${contact.company || contact.name}`,
    });
    pushToast({
      type: 'info',
      title: nextArchived ? 'Fiche archivée' : 'Fiche réactivée',
    });
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  const labelSingular = mode === 'client' ? 'client' : 'fournisseur';
  const labelPlural = mode === 'client' ? 'clients' : 'fournisseurs';

  return (
    <div className="space-y-5">
      {/* Barre d'actions et filtres */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Rechercher un ${labelSingular} (nom, société, NIF, tél)...`}
              className="w-72 rounded-md border border-slate-300 py-1.5 pr-3 pl-9 text-sm focus:border-[#1D4ED8] focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1 rounded-md bg-slate-100 p-1">
            {(
              [
                { id: 'actifs', label: 'Actifs' },
                { id: 'mixtes', label: 'Client & Fournisseur' },
                { id: 'archives', label: 'Archivés' },
                { id: 'tous', label: 'Tous' },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilterMode(f.id)}
                className={`rounded px-3 py-1 text-xs font-medium whitespace-nowrap ${
                  filterMode === f.id
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => openModal()}
          className="inline-flex items-center gap-2 rounded-md bg-[#0F1E36] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a2f52] whitespace-nowrap"
        >
          <Plus className="h-4 w-4" />
          <span>Ajouter un {labelSingular}</span>
        </button>
      </div>

      {/* Grille principale façon tableur + fiche compte latérale */}
      <div className={`grid gap-5 ${selectedRow ? 'grid-cols-1 xl:grid-cols-12' : 'grid-cols-1'}`}>
        <div className={selectedRow ? 'xl:col-span-7' : ''}>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
                <tr>
                  <th className="px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => toggleSort('company')}
                      className="inline-flex items-center gap-1 hover:text-slate-900"
                    >
                      <span>Société / Raison sociale</span>
                      <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => toggleSort('name')}
                      className="inline-flex items-center gap-1 hover:text-slate-900"
                    >
                      <span>Contact</span>
                      <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="px-3 py-2.5">Téléphone</th>
                  <th className="px-3 py-2.5">Email</th>
                  {settings?.uiMode === 'avance' && <th className="px-3 py-2.5">NIF</th>}
                  <th className="px-3 py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => toggleSort('invoiced')}
                      className="inline-flex items-center gap-1 hover:text-slate-900"
                    >
                      <span>Facturé</span>
                      <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="px-3 py-2.5 text-right">Payé</th>
                  <th className="px-3 py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => toggleSort('unpaid')}
                      className="inline-flex items-center gap-1 hover:text-slate-900"
                    >
                      <span>Reste dû</span>
                      <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={settings?.uiMode === 'avance' ? 8 : 7}
                      className="px-4 py-8 text-center text-sm text-slate-500"
                    >
                      Aucun {labelSingular} trouvé. Utilisez la ligne d’ajout rapide ci-dessous ou le bouton « Ajouter ».
                    </td>
                  </tr>
                ) : (
                  rows.map(({ contact, summary }) => {
                    const isSelected = selectedContactId === contact.id;
                    const renderEditable = (
                      field: 'company' | 'name' | 'phone' | 'email' | 'nif',
                      nextField?: 'company' | 'name' | 'phone' | 'email' | 'nif'
                    ) => {
                      const active =
                        editingCell?.id === contact.id && editingCell.field === field;
                      if (active) {
                        return (
                          <input
                            type="text"
                            autoFocus
                            value={editingCell.value}
                            onChange={(e) =>
                              setEditingCell({ ...editingCell, value: e.target.value })
                            }
                            onBlur={() => commitInlineEdit()}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                commitInlineEdit();
                              } else if (e.key === 'Tab') {
                                e.preventDefault();
                                commitInlineEdit(nextField);
                              } else if (e.key === 'Escape') {
                                setEditingCell(null);
                              }
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="w-full rounded border border-[#1D4ED8] bg-white px-1.5 py-0.5 text-xs focus:outline-none"
                          />
                        );
                      }
                      return (
                        <span
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            setEditingCell({
                              id: contact.id,
                              field,
                              value: contact[field] || '',
                            });
                          }}
                          title="Double-cliquez pour modifier dans la cellule"
                          className="block min-h-[18px] cursor-text"
                        >
                          {contact[field] || '—'}
                        </span>
                      );
                    };

                    return (
                      <tr
                        key={contact.id}
                        onClick={() => setSelectedContactId(contact.id)}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="px-3 py-2.5 font-medium text-slate-900">
                          {renderEditable('company', 'name')}
                          {contact.type === 'les_deux' && (
                            <span className="text-[11px] font-normal text-slate-500">
                              Client & Fournisseur
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-slate-700">
                          {renderEditable('name', 'phone')}
                        </td>
                        <td className="px-3 py-2.5 text-slate-600 tabular-nums">
                          {renderEditable('phone', 'email')}
                        </td>
                        <td className="px-3 py-2.5 text-slate-600">
                          {renderEditable('email', settings?.uiMode === 'avance' ? 'nif' : undefined)}
                        </td>
                        {settings?.uiMode === 'avance' && (
                          <td className="px-3 py-2.5 text-slate-600 tabular-nums">
                            {renderEditable('nif')}
                          </td>
                        )}
                        <td className="px-3 py-2.5 text-right text-slate-700 tabular-nums whitespace-nowrap">
                          {formatMoney(summary.totalInvoicedBaseDzd, defaultCurrency, currencies)}
                        </td>
                        <td className="px-3 py-2.5 text-right text-emerald-700 tabular-nums whitespace-nowrap">
                          {formatMoney(summary.totalAllocatedToInvoicesBaseDzd, defaultCurrency, currencies)}
                        </td>
                        <td
                          className={`px-3 py-2.5 text-right font-semibold tabular-nums whitespace-nowrap ${
                            summary.totalUnpaidBaseDzd > 0 ? 'text-red-700' : 'text-slate-600'
                          }`}
                        >
                          {formatMoney(summary.totalUnpaidBaseDzd, defaultCurrency, currencies)}
                        </td>
                      </tr>
                    );
                  })
                )}

                {/* Ligne d'ajout rapide en bas façon Excel */}
                <tr className="bg-slate-50/80 border-t border-slate-200">
                  <td className="p-2">
                    <input
                      type="text"
                      value={quickCompany}
                      onChange={(e) => setQuickCompany(e.target.value)}
                      placeholder="+ Société..."
                      onKeyDown={(e) => e.key === 'Enter' && handleQuickAddRow()}
                      className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                    />
                  </td>
                  <td className="p-2">
                    <input
                      type="text"
                      value={quickName}
                      onChange={(e) => setQuickName(e.target.value)}
                      placeholder="Nom contact..."
                      onKeyDown={(e) => e.key === 'Enter' && handleQuickAddRow()}
                      className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                    />
                  </td>
                  <td className="p-2">
                    <input
                      type="text"
                      value={quickPhone}
                      onChange={(e) => setQuickPhone(e.target.value)}
                      placeholder="Tél..."
                      onKeyDown={(e) => e.key === 'Enter' && handleQuickAddRow()}
                      className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                    />
                  </td>
                  <td className="p-2">
                    <input
                      type="email"
                      value={quickEmail}
                      onChange={(e) => setQuickEmail(e.target.value)}
                      placeholder="Email..."
                      onKeyDown={(e) => e.key === 'Enter' && handleQuickAddRow()}
                      className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                    />
                  </td>
                  {settings?.uiMode === 'avance' && (
                    <td className="p-2">
                      <select
                        value={quickType}
                        onChange={(e) => setQuickType(e.target.value as ContactType)}
                        className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-xs"
                      >
                        <option value={mode}>{mode === 'client' ? 'Client' : 'Fournisseur'}</option>
                        <option value="les_deux">Les deux</option>
                      </select>
                    </td>
                  )}
                  <td colSpan={3} className="p-2 text-right">
                    <button
                      type="button"
                      onClick={handleQuickAddRow}
                      className="inline-flex items-center gap-1 rounded bg-[#0F1E36] px-3 py-1 text-xs font-medium text-white hover:bg-[#1a2f52]"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>Ajouter ligne</span>
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Astuce tableur : double-cliquez sur une cellule pour modifier, utilisez Tab pour passer à la colonne suivante, ou cliquez sur une ligne pour ouvrir le compte détaillé du {labelSingular}.
          </p>
        </div>

        {/* Panneau détaillé du compte sélectionné */}
        {selectedRow && selectedContactDetail && (
          <div className="xl:col-span-5 rounded-lg border border-slate-200 bg-white p-5 space-y-5">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  {selectedRow.contact.company || selectedRow.contact.name}
                </h2>
                <div className="mt-0.5 text-xs text-slate-500">
                  {[
                    selectedRow.contact.name,
                    selectedRow.contact.phone,
                    selectedRow.contact.email,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
                {settings?.uiMode === 'avance' &&
                  (selectedRow.contact.nif || selectedRow.contact.rc) && (
                    <div className="mt-1 text-[11px] text-slate-500">
                      {[
                        selectedRow.contact.nif ? `NIF : ${selectedRow.contact.nif}` : '',
                        selectedRow.contact.nis ? `NIS : ${selectedRow.contact.nis}` : '',
                        selectedRow.contact.rc ? `RC : ${selectedRow.contact.rc}` : '',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  )}
              </div>
              <button
                type="button"
                onClick={() => setSelectedContactId(null)}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Synthèse du compte : ce qu'il a payé et ce qu'il n'a pas payé */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <div className="text-[11px] text-slate-500">Total facturé</div>
                <div className="mt-0.5 text-sm font-bold text-slate-900 tabular-nums">
                  {formatMoney(selectedRow.summary.totalInvoicedBaseDzd, defaultCurrency, currencies)}
                </div>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <div className="text-[11px] text-slate-500">Total payé sur factures</div>
                <div className="mt-0.5 text-sm font-bold text-emerald-700 tabular-nums">
                  {formatMoney(
                    selectedRow.summary.totalAllocatedToInvoicesBaseDzd,
                    defaultCurrency,
                    currencies
                  )}
                </div>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <div className="text-[11px] text-slate-500">Reste impayé</div>
                <div className="mt-0.5 text-sm font-bold text-red-700 tabular-nums">
                  {formatMoney(selectedRow.summary.totalUnpaidBaseDzd, defaultCurrency, currencies)}
                </div>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <div className="text-[11px] text-slate-500">Avances disponibles</div>
                <div className="mt-0.5 text-sm font-bold text-amber-700 tabular-nums">
                  {formatMoney(
                    selectedRow.summary.availableAdvanceBaseDzd,
                    defaultCurrency,
                    currencies
                  )}
                </div>
              </div>
            </div>

            {/* Actions rapides du compte */}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setPaymentModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
              >
                <Wallet className="h-3.5 w-3.5" />
                <span>{mode === 'client' ? 'Enregistrer paiement' : 'Régler fournisseur'}</span>
              </button>
              <button
                type="button"
                onClick={() => setInvoiceModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-md bg-[#0F1E36] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1a2f52]"
              >
                <FileText className="h-3.5 w-3.5" />
                <span>Nouvelle facture</span>
              </button>
              <button
                type="button"
                onClick={() => setStatementPrintOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <Printer className="h-3.5 w-3.5" />
                <span>Relevé de compte</span>
              </button>
              <button
                type="button"
                onClick={() => openModal(selectedRow.contact)}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Modifier fiche
              </button>
              <button
                type="button"
                onClick={() => handleToggleArchive(selectedRow.contact)}
                className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <Archive className="h-3.5 w-3.5" />
                <span>{selectedRow.contact.archived ? 'Désarchiver' : 'Archiver'}</span>
              </button>
            </div>

            {/* Sous-onglets historiques */}
            <div className="flex gap-1 rounded-md bg-slate-100 p-1">
              {(
                [
                  {
                    id: 'factures',
                    label: `Factures (${selectedContactDetail.contactInvoices.length})`,
                  },
                  {
                    id: 'paiements',
                    label: `Paiements (${selectedContactDetail.contactPayments.length})`,
                  },
                  {
                    id: 'cheques',
                    label: `Chèques (${selectedContactDetail.contactCheques.length})`,
                  },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setDetailTab(t.id)}
                  className={`flex-1 rounded py-1 text-xs font-medium ${
                    detailTab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {detailTab === 'factures' && (
              <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 rounded border border-slate-200">
                {selectedContactDetail.contactInvoices.length === 0 ? (
                  <div className="p-4 text-center text-xs text-slate-500">Aucune facture.</div>
                ) : (
                  selectedContactDetail.contactInvoices.map((inv) => (
                    <div key={inv.id} className="flex items-center justify-between px-3 py-2 text-xs">
                      <div>
                        <div className="font-medium text-slate-900">{inv.invoiceNumber}</div>
                        <div className="text-slate-500 tabular-nums">
                          {inv.issueDate} · Éch. {inv.dueDate}
                        </div>
                      </div>
                      <div className="text-right tabular-nums">
                        <div className="font-semibold text-slate-900">
                          {formatMoney(inv.totalTtcCentimes, inv.currency)}
                        </div>
                        <div
                          className={
                            inv.remaining > 0 ? 'text-red-600' : 'text-emerald-700'
                          }
                        >
                          {inv.computedStatus === 'annulee'
                            ? 'Annulée'
                            : inv.remaining > 0
                            ? `Reste : ${formatMoney(inv.remaining, inv.currency)}`
                            : 'Payée'}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {detailTab === 'paiements' && (
              <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 rounded border border-slate-200">
                {selectedContactDetail.contactPayments.length === 0 ? (
                  <div className="p-4 text-center text-xs text-slate-500">Aucun paiement enregistré.</div>
                ) : (
                  selectedContactDetail.contactPayments.map((p) => (
                    <div key={p.id} className="flex items-center justify-between px-3 py-2 text-xs">
                      <div>
                        <div className="font-medium text-slate-900">
                          {p.date} · {p.method.toUpperCase()}
                        </div>
                        <div className="text-slate-500">{p.reference || p.notes || 'Règlement'}</div>
                      </div>
                      <div className="text-right tabular-nums">
                        <div
                          className={`font-semibold ${
                            p.status === 'annule' ? 'line-through text-slate-400' : 'text-emerald-700'
                          }`}
                        >
                          {formatMoney(p.amountCentimes, p.currency)}
                        </div>
                        {p.unallocated > 0 && p.status === 'valide' && (
                          <div className="text-amber-700">
                            Avance : {formatMoney(p.unallocated, p.currency)}
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {detailTab === 'cheques' && (
              <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 rounded border border-slate-200">
                {selectedContactDetail.contactCheques.length === 0 ? (
                  <div className="p-4 text-center text-xs text-slate-500">Aucun chèque enregistré.</div>
                ) : (
                  selectedContactDetail.contactCheques.map((c) => (
                    <div key={c.id} className="flex items-center justify-between px-3 py-2 text-xs">
                      <div>
                        <div className="font-medium text-slate-900">Chèque N° {c.chequeNumber}</div>
                        <div className="text-slate-500">Statut : {c.status}</div>
                      </div>
                      <div className="font-semibold text-slate-900 tabular-nums">
                        {formatMoney(c.amountCentimes, c.currency)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal Fiche Contact */}
      {formModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-2xl rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-[#0F1E36] px-6 py-4 text-white">
              <h2 className="text-base font-semibold">
                {editingContact ? `Modifier ${labelSingular}` : `Nouveau ${labelSingular}`}
              </h2>
              <button
                type="button"
                onClick={() => setFormModalOpen(false)}
                className="rounded p-1 text-slate-300 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleSaveModal} className="p-6 space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700">Type de contact</label>
                  <select
                    value={formType}
                    onChange={(e) => setFormType(e.target.value as ContactType)}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="client">Client uniquement</option>
                    <option value="fournisseur">Fournisseur uniquement</option>
                    <option value="les_deux">Client & Fournisseur</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Société / Raison sociale</label>
                  <input
                    type="text"
                    value={formCompany}
                    onChange={(e) => setFormCompany(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Nom du contact</label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Téléphone</label>
                  <input
                    type="text"
                    value={formPhone}
                    onChange={(e) => setFormPhone(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Email</label>
                  <input
                    type="email"
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Adresse</label>
                  <input
                    type="text"
                    value={formAddress}
                    onChange={(e) => setFormAddress(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">NIF</label>
                  <input
                    type="text"
                    value={formNif}
                    onChange={(e) => setFormNif(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">NIS</label>
                  <input
                    type="text"
                    value={formNis}
                    onChange={(e) => setFormNis(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">Registre de Commerce (RC)</label>
                  <input
                    type="text"
                    value={formRc}
                    onChange={(e) => setFormRc(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">AI</label>
                  <input
                    type="text"
                    value={formAi}
                    onChange={(e) => setFormAi(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700">Notes</label>
                  <textarea
                    rows={2}
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={() => setFormModalOpen(false)}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
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

      {/* Modales Paiement, Facture, Relevé de compte A4 */}
      {selectedRow && (
        <>
          <PaymentModal
            open={paymentModalOpen}
            direction={mode === 'client' ? 'entrant' : 'sortant'}
            preselectedContactId={selectedRow.contact.id}
            onClose={() => setPaymentModalOpen(false)}
          />
          <InvoiceFormModal
            open={invoiceModalOpen}
            mode={mode}
            preselectedContactId={selectedRow.contact.id}
            onClose={() => setInvoiceModalOpen(false)}
          />
          <PrintDocumentModal
            open={statementPrintOpen}
            title={`Relevé de compte — ${selectedRow.contact.company || selectedRow.contact.name}`}
            fileName={`releve-${labelSingular}-${(selectedRow.contact.company || selectedRow.contact.name).replace(/\s+/g, '-')}.pdf`}
            settings={settings}
            onClose={() => setStatementPrintOpen(false)}
          >
            <div className="space-y-6">
              <div className="flex items-start justify-between rounded border border-slate-300 p-4">
                <div>
                  <div className="text-xs font-semibold text-slate-500">
                    RELEVÉ DE COMPTE {mode === 'client' ? 'CLIENT' : 'FOURNISSEUR'}
                  </div>
                  <div className="mt-1 text-base font-bold text-slate-900">
                    {selectedRow.contact.company || selectedRow.contact.name}
                  </div>
                  <div className="text-xs text-slate-600">{selectedRow.contact.address}</div>
                  <div className="text-xs text-slate-600">
                    {[selectedRow.contact.phone, selectedRow.contact.email].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div className="text-right text-xs tabular-nums space-y-1">
                  <div>
                    Total facturé :{' '}
                    <strong>
                      {formatMoney(selectedRow.summary.totalInvoicedBaseDzd, defaultCurrency, currencies)}
                    </strong>
                  </div>
                  <div>
                    Total payé :{' '}
                    <strong className="text-emerald-700">
                      {formatMoney(
                        selectedRow.summary.totalAllocatedToInvoicesBaseDzd,
                        defaultCurrency,
                        currencies
                      )}
                    </strong>
                  </div>
                  <div>
                    Reste dû :{' '}
                    <strong className="text-red-700">
                      {formatMoney(selectedRow.summary.totalUnpaidBaseDzd, defaultCurrency, currencies)}
                    </strong>
                  </div>
                  <div>
                    Avances disponibles :{' '}
                    <strong>
                      {formatMoney(
                        selectedRow.summary.availableAdvanceBaseDzd,
                        defaultCurrency,
                        currencies
                      )}
                    </strong>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="mb-2 text-xs font-bold uppercase text-slate-700">
                  Détail des factures
                </h3>
                <table className="w-full border-collapse border border-slate-300 text-xs">
                  <thead className="bg-slate-100">
                    <tr>
                      <th className="border border-slate-300 px-2.5 py-1.5 text-left">N° Facture</th>
                      <th className="border border-slate-300 px-2.5 py-1.5 text-left">Date</th>
                      <th className="border border-slate-300 px-2.5 py-1.5 text-left">Échéance</th>
                      <th className="border border-slate-300 px-2.5 py-1.5 text-right">Total TTC</th>
                      <th className="border border-slate-300 px-2.5 py-1.5 text-right">Payé</th>
                      <th className="border border-slate-300 px-2.5 py-1.5 text-right">Reste dû</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedContactDetail?.contactInvoices.map((inv) => (
                      <tr key={inv.id}>
                        <td className="border border-slate-300 px-2.5 py-1.5 font-medium">
                          {inv.invoiceNumber}
                        </td>
                        <td className="border border-slate-300 px-2.5 py-1.5 tabular-nums">
                          {inv.issueDate}
                        </td>
                        <td className="border border-slate-300 px-2.5 py-1.5 tabular-nums">
                          {inv.dueDate}
                        </td>
                        <td className="border border-slate-300 px-2.5 py-1.5 text-right tabular-nums">
                          {formatMoney(inv.totalTtcCentimes, inv.currency)}
                        </td>
                        <td className="border border-slate-300 px-2.5 py-1.5 text-right tabular-nums">
                          {formatMoney(inv.paid, inv.currency)}
                        </td>
                        <td className="border border-slate-300 px-2.5 py-1.5 text-right font-semibold tabular-nums">
                          {formatMoney(inv.remaining, inv.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div>
                <h3 className="mb-2 text-xs font-bold uppercase text-slate-700">
                  Historique des paiements
                </h3>
                <table className="w-full border-collapse border border-slate-300 text-xs">
                  <thead className="bg-slate-100">
                    <tr>
                      <th className="border border-slate-300 px-2.5 py-1.5 text-left">Date</th>
                      <th className="border border-slate-300 px-2.5 py-1.5 text-left">Mode</th>
                      <th className="border border-slate-300 px-2.5 py-1.5 text-left">Référence</th>
                      <th className="border border-slate-300 px-2.5 py-1.5 text-right">Montant</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedContactDetail?.contactPayments
                      .filter((p) => p.status === 'valide')
                      .map((p) => (
                        <tr key={p.id}>
                          <td className="border border-slate-300 px-2.5 py-1.5 tabular-nums">
                            {p.date}
                          </td>
                          <td className="border border-slate-300 px-2.5 py-1.5 uppercase">
                            {p.method}
                          </td>
                          <td className="border border-slate-300 px-2.5 py-1.5">
                            {p.reference || '—'}
                          </td>
                          <td className="border border-slate-300 px-2.5 py-1.5 text-right font-semibold tabular-nums">
                            {formatMoney(p.amountCentimes, p.currency)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </PrintDocumentModal>
        </>
      )}
    </div>
  );
};
