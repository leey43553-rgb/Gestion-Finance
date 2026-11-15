import { createId, db, ensureDatabaseInitialized, recordAudit } from '../db/database';
import type {
  Contact,
  CustomerInvoice,
  Expense,
  IncomingCheque,
  LedgerEntry,
  OutgoingCheque,
  Payment,
  PaymentAllocation,
  PaymentMethod,
  SupplierInvoice,
} from '../db/types';
import {
  computeInvoiceDocumentTotals,
  computeInvoicePaidCentimes,
  computeInvoiceStatus,
  shouldCreateImmediateLedgerEntryForExpense,
} from '../utils/finance';
import { convertToBaseDzd } from '../utils/money';

export async function generateNextInvoiceNumber(type: 'client' | 'fournisseur'): Promise<string> {
  const settings = await ensureDatabaseInitialized();
  const year = new Date().getFullYear();
  if (type === 'client') {
    const seq = String(settings.invoiceNextSeq || 1).padStart(4, '0');
    return `${settings.invoicePrefix || 'FAC-'}${year}-${seq}`;
  }
  const seq = String(settings.supplierInvoiceNextSeq || 1).padStart(4, '0');
  return `${settings.supplierInvoicePrefix || 'FF-'}${year}-${seq}`;
}

export async function saveCustomerInvoice(params: {
  existingId?: string;
  invoiceNumber: string;
  clientId: string;
  issueDate: string;
  dueDate: string;
  bcNumber: string;
  campaignRef: string;
  currency: string;
  exchangeRate: number;
  description: string;
  notes: string;
  lines: Array<{
    id?: string;
    description: string;
    quantity: number;
    unitPriceCentimes: number;
    discountPercent: number;
    tvaRate: number;
  }>;
}): Promise<CustomerInvoice> {
  if (!params.invoiceNumber.trim()) {
    throw new Error('Le numéro de facture est obligatoire.');
  }
  if (!params.clientId) {
    throw new Error('Veuillez sélectionner un client.');
  }
  if (!params.issueDate) {
    throw new Error('La date de facture est obligatoire.');
  }
  if (!params.lines.length || params.lines.every((l) => !l.description.trim())) {
    throw new Error('Veuillez saisir au moins une ligne de facturation.');
  }
  if (!Number.isFinite(params.exchangeRate) || params.exchangeRate <= 0) {
    throw new Error('Le taux de change doit être supérieur à zéro.');
  }

  const normalizedNumber = params.invoiceNumber.trim();
  const existingDuplicate = await db.customerInvoices
    .where('invoiceNumber')
    .equals(normalizedNumber)
    .first();
  if (existingDuplicate && existingDuplicate.id !== params.existingId) {
    throw new Error(`Le numéro de facture « ${normalizedNumber} » existe déjà.`);
  }

  const computed = computeInvoiceDocumentTotals(params.lines);
  if (computed.totalTtcCentimes <= 0) {
    throw new Error('Le montant total TTC de la facture doit être supérieur à zéro.');
  }

  const baseDzdTtcCentimes = convertToBaseDzd(computed.totalTtcCentimes, params.exchangeRate);
  const now = new Date().toISOString();

  const existing = params.existingId
    ? await db.customerInvoices.get(params.existingId)
    : undefined;

  if (existing?.status === 'annulee') {
    throw new Error('Une facture annulée ne peut pas être modifiée.');
  }

  const allocations = existing
    ? await db.paymentAllocations.where('invoiceId').equals(existing.id).toArray()
    : [];
  const allPayments = allocations.length ? await db.payments.toArray() : [];
  const validIds = new Set(allPayments.filter((p) => p.status === 'valide').map((p) => p.id));
  const paid = existing ? computeInvoicePaidCentimes(existing.id, allocations, validIds) : 0;

  let storedStatus: CustomerInvoice['status'] = 'impayee';
  if (paid >= computed.totalTtcCentimes && computed.totalTtcCentimes > 0) {
    storedStatus = 'payee';
  } else if (paid > 0) {
    storedStatus = 'partielle';
  }

  const record: CustomerInvoice = {
    id: existing?.id || createId('cinv'),
    invoiceNumber: normalizedNumber,
    clientId: params.clientId,
    issueDate: params.issueDate,
    dueDate: params.dueDate || params.issueDate,
    bcNumber: params.bcNumber.trim(),
    campaignRef: params.campaignRef.trim(),
    currency: params.currency,
    exchangeRate: params.exchangeRate,
    description: params.description.trim(),
    lines: computed.lines,
    totalHtCentimes: computed.totalHtCentimes,
    totalTvaCentimes: computed.totalTvaCentimes,
    totalTtcCentimes: computed.totalTtcCentimes,
    baseDzdTtcCentimes,
    status: storedStatus,
    notes: params.notes.trim(),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  await db.transaction('rw', [db.customerInvoices, db.settings, db.auditLogs], async () => {
    await db.customerInvoices.put(record);
    if (!existing) {
      const settings = await db.settings.get('company_settings');
      if (settings) {
        await db.settings.update('company_settings', {
          invoiceNextSeq: (settings.invoiceNextSeq || 1) + 1,
          updatedAt: now,
        });
      }
    }
  });

  await recordAudit({
    action: existing ? 'MODIFICATION' : 'CREATION',
    entityType: 'facture_client',
    entityId: record.id,
    summary: `${existing ? 'Modification' : 'Création'} facture client ${record.invoiceNumber}`,
    before: existing,
    after: record,
  });

  return record;
}

export async function saveSupplierInvoice(params: {
  existingId?: string;
  invoiceNumber: string;
  supplierRef: string;
  supplierId: string;
  issueDate: string;
  dueDate: string;
  currency: string;
  exchangeRate: number;
  description: string;
  notes: string;
  lines: Array<{
    id?: string;
    description: string;
    quantity: number;
    unitPriceCentimes: number;
    discountPercent: number;
    tvaRate: number;
  }>;
}): Promise<SupplierInvoice> {
  if (!params.invoiceNumber.trim()) {
    throw new Error('Le numéro interne de facture est obligatoire.');
  }
  if (!params.supplierId) {
    throw new Error('Veuillez sélectionner un fournisseur.');
  }
  if (!params.issueDate) {
    throw new Error('La date de facture est obligatoire.');
  }
  if (!params.lines.length || params.lines.every((l) => !l.description.trim())) {
    throw new Error('Veuillez saisir au moins une ligne.');
  }
  if (!Number.isFinite(params.exchangeRate) || params.exchangeRate <= 0) {
    throw new Error('Le taux de change doit être supérieur à zéro.');
  }

  const normalizedNumber = params.invoiceNumber.trim();
  const existingDuplicate = await db.supplierInvoices
    .where('invoiceNumber')
    .equals(normalizedNumber)
    .first();
  if (existingDuplicate && existingDuplicate.id !== params.existingId) {
    throw new Error(`Le numéro de facture fournisseur « ${normalizedNumber} » existe déjà.`);
  }

  const computed = computeInvoiceDocumentTotals(params.lines);
  if (computed.totalTtcCentimes <= 0) {
    throw new Error('Le montant total TTC doit être supérieur à zéro.');
  }

  const baseDzdTtcCentimes = convertToBaseDzd(computed.totalTtcCentimes, params.exchangeRate);
  const now = new Date().toISOString();
  const existing = params.existingId
    ? await db.supplierInvoices.get(params.existingId)
    : undefined;

  if (existing?.status === 'annulee') {
    throw new Error('Une facture annulée ne peut pas être modifiée.');
  }

  const allocations = existing
    ? await db.paymentAllocations.where('invoiceId').equals(existing.id).toArray()
    : [];
  const allPayments = allocations.length ? await db.payments.toArray() : [];
  const validIds = new Set(allPayments.filter((p) => p.status === 'valide').map((p) => p.id));
  const paid = existing ? computeInvoicePaidCentimes(existing.id, allocations, validIds) : 0;

  let storedStatus: SupplierInvoice['status'] = 'impayee';
  if (paid >= computed.totalTtcCentimes && computed.totalTtcCentimes > 0) {
    storedStatus = 'payee';
  } else if (paid > 0) {
    storedStatus = 'partielle';
  }

  const record: SupplierInvoice = {
    id: existing?.id || createId('sinv'),
    invoiceNumber: normalizedNumber,
    supplierRef: params.supplierRef.trim(),
    supplierId: params.supplierId,
    issueDate: params.issueDate,
    dueDate: params.dueDate || params.issueDate,
    currency: params.currency,
    exchangeRate: params.exchangeRate,
    description: params.description.trim(),
    lines: computed.lines,
    totalHtCentimes: computed.totalHtCentimes,
    totalTvaCentimes: computed.totalTvaCentimes,
    totalTtcCentimes: computed.totalTtcCentimes,
    baseDzdTtcCentimes,
    status: storedStatus,
    notes: params.notes.trim(),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  await db.transaction('rw', [db.supplierInvoices, db.settings, db.auditLogs], async () => {
    await db.supplierInvoices.put(record);
    if (!existing) {
      const settings = await db.settings.get('company_settings');
      if (settings) {
        await db.settings.update('company_settings', {
          supplierInvoiceNextSeq: (settings.supplierInvoiceNextSeq || 1) + 1,
          updatedAt: now,
        });
      }
    }
  });

  await recordAudit({
    action: existing ? 'MODIFICATION' : 'CREATION',
    entityType: 'facture_fournisseur',
    entityId: record.id,
    summary: `${existing ? 'Modification' : 'Création'} facture fournisseur ${record.invoiceNumber}`,
    before: existing,
    after: record,
  });

  return record;
}

export async function cancelInvoice(params: {
  invoiceType: 'client' | 'fournisseur';
  invoiceId: string;
  reason: string;
}): Promise<void> {
  if (!params.reason.trim()) {
    throw new Error('Un motif d’annulation est obligatoire.');
  }

  const now = new Date().toISOString();
  const allocations = await db.paymentAllocations
    .where('invoiceId')
    .equals(params.invoiceId)
    .toArray();
  const allPayments = allocations.length ? await db.payments.toArray() : [];
  const validIds = new Set(allPayments.filter((p) => p.status === 'valide').map((p) => p.id));
  const paid = computeInvoicePaidCentimes(params.invoiceId, allocations, validIds);
  if (paid > 0) {
    throw new Error(
      'Cette facture possède déjà des règlements actifs. Annulez d’abord les paiements associés.'
    );
  }

  if (params.invoiceType === 'client') {
    const existing = await db.customerInvoices.get(params.invoiceId);
    if (!existing) throw new Error('Facture introuvable.');
    if (existing.status === 'annulee') throw new Error('Facture déjà annulée.');

    const updated: CustomerInvoice = {
      ...existing,
      status: 'annulee',
      cancelReason: params.reason.trim(),
      cancelledAt: now,
      updatedAt: now,
    };
    await db.customerInvoices.put(updated);
    await recordAudit({
      action: 'ANNULATION',
      entityType: 'facture_client',
      entityId: existing.id,
      summary: `Annulation facture client ${existing.invoiceNumber}`,
      before: existing,
      after: updated,
      reason: params.reason.trim(),
    });
  } else {
    const existing = await db.supplierInvoices.get(params.invoiceId);
    if (!existing) throw new Error('Facture introuvable.');
    if (existing.status === 'annulee') throw new Error('Facture déjà annulée.');

    const updated: SupplierInvoice = {
      ...existing,
      status: 'annulee',
      cancelReason: params.reason.trim(),
      cancelledAt: now,
      updatedAt: now,
    };
    await db.supplierInvoices.put(updated);
    await recordAudit({
      action: 'ANNULATION',
      entityType: 'facture_fournisseur',
      entityId: existing.id,
      summary: `Annulation facture fournisseur ${existing.invoiceNumber}`,
      before: existing,
      after: updated,
      reason: params.reason.trim(),
    });
  }
}

async function refreshInvoiceStoredStatus(
  invoiceType: 'client' | 'fournisseur',
  invoiceId: string
): Promise<void> {
  const allocations = await db.paymentAllocations.where('invoiceId').equals(invoiceId).toArray();
  const payments = await db.payments.toArray();
  const validIds = new Set(payments.filter((p) => p.status === 'valide').map((p) => p.id));
  const paid = computeInvoicePaidCentimes(invoiceId, allocations, validIds);

  if (invoiceType === 'client') {
    const inv = await db.customerInvoices.get(invoiceId);
    if (!inv || inv.status === 'annulee') return;
    const computed = computeInvoiceStatus({
      storedStatus: inv.status,
      totalTtcCentimes: inv.totalTtcCentimes,
      paidCentimes: paid,
      dueDate: inv.dueDate,
    });
    const nextStored: CustomerInvoice['status'] =
      computed === 'en_retard' ? (paid > 0 ? 'partielle' : 'impayee') : computed;
    if (nextStored !== inv.status) {
      await db.customerInvoices.update(inv.id, {
        status: nextStored,
        updatedAt: new Date().toISOString(),
      });
    }
  } else {
    const inv = await db.supplierInvoices.get(invoiceId);
    if (!inv || inv.status === 'annulee') return;
    const computed = computeInvoiceStatus({
      storedStatus: inv.status,
      totalTtcCentimes: inv.totalTtcCentimes,
      paidCentimes: paid,
      dueDate: inv.dueDate,
    });
    const nextStored: SupplierInvoice['status'] =
      computed === 'en_retard' ? (paid > 0 ? 'partielle' : 'impayee') : computed;
    if (nextStored !== inv.status) {
      await db.supplierInvoices.update(inv.id, {
        status: nextStored,
        updatedAt: new Date().toISOString(),
      });
    }
  }
}

/**
 * Enregistre un paiement client/fournisseur (ou un chèque en attente s'il n'est pas encore encaissé).
 * Un paiement direct (espèces, virement, carte) ou un chèque déjà encaissé génère immédiatement
 * les allocations et UNE seule écriture dans le grand livre.
 */
export async function recordPaymentOrCheque(params: {
  direction: 'entrant' | 'sortant';
  contactId: string;
  date: string;
  amountCentimes: number;
  currency: string;
  exchangeRate: number;
  method: PaymentMethod;
  bankAccountId: string | null;
  reference: string;
  notes: string;
  allocations: Array<{ invoiceId: string; amountCentimes: number }>;
  // Options chèque
  chequeNumber?: string;
  issuerBank?: string;
  chequeDate?: string;
  chequeClearedImmediately?: boolean;
  chequeLeafId?: string;
}): Promise<{ kind: 'payment' | 'cheque_pending'; id: string }> {
  if (!params.contactId) throw new Error('Veuillez sélectionner un tiers.');
  if (!params.date) throw new Error('La date du règlement est obligatoire.');
  if (params.amountCentimes <= 0) {
    throw new Error('Le montant du paiement doit être supérieur à zéro.');
  }
  if ((params.method === 'virement' || params.method === 'carte') && !params.bankAccountId) {
    throw new Error('Veuillez sélectionner le compte bancaire concerné.');
  }

  const totalAllocated = params.allocations.reduce((s, a) => s + a.amountCentimes, 0);
  if (totalAllocated > params.amountCentimes) {
    throw new Error('Le total affecté aux factures dépasse le montant du paiement.');
  }

  const contact = await db.contacts.get(params.contactId);
  const contactLabel = contact ? contact.company || contact.name : 'Tiers';
  const now = new Date().toISOString();
  const baseDzdAmountCentimes = convertToBaseDzd(params.amountCentimes, params.exchangeRate);
  const invoiceType = params.direction === 'entrant' ? 'client' : 'fournisseur';

  // Cas particulier : chèque NON encore encaissé => on crée uniquement le chèque en attente (aucune écriture grand livre !)
  if (params.method === 'cheque' && !params.chequeClearedImmediately) {
    if (!params.chequeNumber?.trim()) {
      throw new Error('Veuillez indiquer le numéro du chèque.');
    }

    if (params.direction === 'entrant') {
      const chequeId = createId('ichq');
      const incoming: IncomingCheque = {
        id: chequeId,
        clientId: params.contactId,
        issuerBank: (params.issuerBank || '').trim() || 'Banque émettrice',
        chequeNumber: params.chequeNumber.trim(),
        chequeDate: params.chequeDate || params.date,
        entryDate: params.date,
        amountCentimes: params.amountCentimes,
        currency: params.currency,
        exchangeRate: params.exchangeRate,
        baseDzdAmountCentimes,
        targetBankAccountId: params.bankAccountId,
        status: 'recu',
        allocatedInvoiceIds: params.allocations.map((a) => a.invoiceId),
        notes: params.notes.trim(),
        createdAt: now,
        updatedAt: now,
      };
      await db.incomingCheques.put(incoming);
      await recordAudit({
        action: 'CREATION',
        entityType: 'cheque_recu',
        entityId: chequeId,
        summary: `Chèque reçu ${incoming.chequeNumber} (${contactLabel}) en attente d’encaissement`,
        after: incoming,
      });
      return { kind: 'cheque_pending', id: chequeId };
    }

    // Chèque émis fournisseur en attente
    if (!params.bankAccountId) {
      throw new Error('Veuillez sélectionner la banque émettrice du chèque.');
    }
    const chequeId = createId('ochq');
    let bookId = '';
    if (params.chequeLeafId) {
      const leaf = await db.chequeLeaves.get(params.chequeLeafId);
      if (!leaf || leaf.status !== 'disponible') {
        throw new Error('Ce numéro de chèque n’est plus disponible dans le chéquier.');
      }
      bookId = leaf.chequeBookId;
      await db.chequeLeaves.update(leaf.id, {
        status: 'remis',
        outgoingChequeId: chequeId,
      });
    }

    const outgoing: OutgoingCheque = {
      id: chequeId,
      bankAccountId: params.bankAccountId,
      chequeBookId: bookId,
      chequeLeafId: params.chequeLeafId || '',
      chequeNumber: params.chequeNumber.trim(),
      beneficiary: contactLabel,
      contactId: params.contactId,
      issueDate: params.date,
      amountCentimes: params.amountCentimes,
      currency: params.currency,
      exchangeRate: params.exchangeRate,
      baseDzdAmountCentimes,
      purpose: params.notes.trim() || 'Règlement fournisseur',
      linkedType: params.allocations.length === 1 ? 'fournisseur_facture' : 'paiement',
      linkedId: params.allocations[0]?.invoiceId,
      status: 'remis',
      notes: params.notes.trim(),
      createdAt: now,
      updatedAt: now,
    };
    await db.outgoingCheques.put(outgoing);
    await recordAudit({
      action: 'CREATION',
      entityType: 'cheque_emis',
      entityId: chequeId,
      summary: `Chèque émis ${outgoing.chequeNumber} (${contactLabel}) en attente d’encaissement`,
      after: outgoing,
    });
    return { kind: 'cheque_pending', id: chequeId };
  }

  // Paiement effectif (espèces, virement, carte, ou chèque déjà encaissé)
  const paymentId = createId('pay');
  const isAdvance = totalAllocated < params.amountCentimes;
  const effectiveBankId = params.method === 'especes' ? null : params.bankAccountId;

  const payment: Payment = {
    id: paymentId,
    direction: params.direction,
    contactId: params.contactId,
    date: params.date,
    amountCentimes: params.amountCentimes,
    currency: params.currency,
    exchangeRate: params.exchangeRate,
    baseDzdAmountCentimes,
    method: params.method,
    bankAccountId: effectiveBankId,
    reference: params.reference.trim() || (params.chequeNumber ? `CHQ ${params.chequeNumber.trim()}` : ''),
    notes: params.notes.trim(),
    isAdvance,
    status: 'valide',
    createdAt: now,
    updatedAt: now,
  };

  const allocRecords: PaymentAllocation[] = params.allocations
    .filter((a) => a.amountCentimes > 0)
    .map((a) => ({
      id: createId('alloc'),
      paymentId,
      invoiceType,
      invoiceId: a.invoiceId,
      amountCentimes: a.amountCentimes,
      createdAt: now,
    }));

  const ledger: LedgerEntry = {
    id: createId('led'),
    date: params.date,
    direction: params.direction === 'entrant' ? 'entree' : 'sortie',
    sourceType: params.direction === 'entrant' ? 'paiement_client' : 'paiement_fournisseur',
    sourceId: paymentId,
    bankAccountId: effectiveBankId,
    contactId: params.contactId,
    label: `${params.direction === 'entrant' ? 'Règlement reçu' : 'Règlement versé'} — ${contactLabel}${
      payment.reference ? ` (${payment.reference})` : ''
    }`,
    amountCentimes: params.amountCentimes,
    currency: params.currency,
    exchangeRate: params.exchangeRate,
    baseDzdAmountCentimes,
    status: 'valide',
    createdAt: now,
  };

  await db.transaction(
    'rw',
    [db.payments, db.paymentAllocations, db.ledgerEntries, db.customerInvoices, db.supplierInvoices],
    async () => {
      await db.payments.put(payment);
      if (allocRecords.length) {
        await db.paymentAllocations.bulkPut(allocRecords);
      }
      await db.ledgerEntries.put(ledger);
    }
  );

  for (const a of allocRecords) {
    await refreshInvoiceStoredStatus(invoiceType, a.invoiceId);
  }

  await recordAudit({
    action: 'CREATION',
    entityType: params.direction === 'entrant' ? 'paiement_client' : 'paiement_fournisseur',
    entityId: paymentId,
    summary: `${params.direction === 'entrant' ? 'Encaissement' : 'Décaissement'} ${contactLabel} (${
      allocRecords.length
    } facture(s) affectée(s))`,
    after: { payment, allocations: allocRecords },
  });

  return { kind: 'payment', id: paymentId };
}

export async function allocateExistingAdvanceToInvoices(params: {
  paymentId: string;
  invoiceType: 'client' | 'fournisseur';
  allocations: Array<{ invoiceId: string; amountCentimes: number }>;
}): Promise<void> {
  const payment = await db.payments.get(params.paymentId);
  if (!payment || payment.status !== 'valide') {
    throw new Error('Paiement introuvable ou annulé.');
  }

  const existingAllocs = await db.paymentAllocations
    .where('paymentId')
    .equals(params.paymentId)
    .toArray();
  const alreadyAllocated = existingAllocs.reduce((s, a) => s + a.amountCentimes, 0);
  const available = payment.amountCentimes - alreadyAllocated;
  const requested = params.allocations.reduce((s, a) => s + a.amountCentimes, 0);

  if (requested <= 0) {
    throw new Error('Veuillez saisir un montant à affecter.');
  }
  if (requested > available) {
    throw new Error('Le montant dépasse le solde d’avance disponible sur ce paiement.');
  }

  const now = new Date().toISOString();
  const newAllocs: PaymentAllocation[] = params.allocations
    .filter((a) => a.amountCentimes > 0)
    .map((a) => ({
      id: createId('alloc'),
      paymentId: params.paymentId,
      invoiceType: params.invoiceType,
      invoiceId: a.invoiceId,
      amountCentimes: a.amountCentimes,
      createdAt: now,
    }));

  await db.paymentAllocations.bulkPut(newAllocs);
  if (requested === available) {
    await db.payments.update(payment.id, { isAdvance: false, updatedAt: now });
  }

  for (const a of newAllocs) {
    await refreshInvoiceStoredStatus(params.invoiceType, a.invoiceId);
  }

  await recordAudit({
    action: 'MODIFICATION',
    entityType: 'allocation_avance',
    entityId: payment.id,
    summary: `Affectation d’avance sur ${newAllocs.length} facture(s)`,
    after: newAllocs,
  });
}

export async function cancelPayment(paymentId: string, reason: string): Promise<void> {
  if (!reason.trim()) {
    throw new Error('Le motif d’annulation est obligatoire.');
  }
  const payment = await db.payments.get(paymentId);
  if (!payment) throw new Error('Paiement introuvable.');
  if (payment.status === 'annule') throw new Error('Ce paiement est déjà annulé.');

  const now = new Date().toISOString();
  const allocs = await db.paymentAllocations.where('paymentId').equals(paymentId).toArray();

  await db.transaction('rw', [db.payments, db.ledgerEntries], async () => {
    await db.payments.update(paymentId, {
      status: 'annule',
      cancelReason: reason.trim(),
      cancelledAt: now,
      updatedAt: now,
    });

    const relatedLedger = await db.ledgerEntries
      .where('sourceId')
      .equals(paymentId)
      .toArray();
    for (const l of relatedLedger) {
      await db.ledgerEntries.update(l.id, { status: 'annule' });
    }
  });

  const invType = payment.direction === 'entrant' ? 'client' : 'fournisseur';
  for (const a of allocs) {
    await refreshInvoiceStoredStatus(invType, a.invoiceId);
  }

  await recordAudit({
    action: 'ANNULATION',
    entityType: payment.direction === 'entrant' ? 'paiement_client' : 'paiement_fournisseur',
    entityId: paymentId,
    summary: `Annulation du paiement ${payment.reference || payment.id}`,
    before: payment,
    reason: reason.trim(),
  });
}

export async function saveExpense(params: {
  existingId?: string;
  date: string;
  beneficiary: string;
  contactId?: string;
  categoryId: string;
  categoryName: string;
  description: string;
  amountCentimes: number;
  currency: string;
  exchangeRate: number;
  paymentMethod: PaymentMethod;
  bankAccountId: string | null;
  reference: string;
  notes: string;
  chequeNumber?: string;
  chequeLeafId?: string;
}): Promise<Expense> {
  if (!params.date) throw new Error('La date est obligatoire.');
  if (!params.beneficiary.trim()) throw new Error('Le bénéficiaire est obligatoire.');
  if (!params.description.trim()) throw new Error('La description est obligatoire.');
  if (params.amountCentimes <= 0) throw new Error('Le montant doit être supérieur à zéro.');
  if (
    (params.paymentMethod === 'virement' ||
      params.paymentMethod === 'carte' ||
      params.paymentMethod === 'cheque') &&
    !params.bankAccountId
  ) {
    throw new Error('Veuillez sélectionner le compte bancaire pour ce mode de règlement.');
  }

  const now = new Date().toISOString();
  const baseDzdAmountCentimes = convertToBaseDzd(params.amountCentimes, params.exchangeRate);
  const existing = params.existingId ? await db.expenses.get(params.existingId) : undefined;
  if (existing?.status === 'annule') {
    throw new Error('Une dépense annulée ne peut pas être modifiée.');
  }

  const effectiveBankId = params.paymentMethod === 'especes' ? null : params.bankAccountId;
  const expenseId = existing?.id || createId('exp');

  let outgoingChequeId = existing?.outgoingChequeId;

  // Création d'un chèque émis si nouvelle dépense par chèque
  if (!existing && params.paymentMethod === 'cheque') {
    if (!params.chequeNumber?.trim() && !params.chequeLeafId) {
      throw new Error('Veuillez indiquer le numéro du chèque ou choisir un feuillet du chéquier.');
    }
    let finalChequeNumber = (params.chequeNumber || '').trim();
    let chequeBookId = '';
    if (params.chequeLeafId) {
      const leaf = await db.chequeLeaves.get(params.chequeLeafId);
      if (!leaf || leaf.status !== 'disponible') {
        throw new Error('Ce feuillet de chèque n’est plus disponible.');
      }
      finalChequeNumber = leaf.chequeNumber;
      chequeBookId = leaf.chequeBookId;
      outgoingChequeId = createId('ochq');
      await db.chequeLeaves.update(leaf.id, {
        status: 'remis',
        outgoingChequeId,
      });
    } else {
      outgoingChequeId = createId('ochq');
    }

    const outgoing: OutgoingCheque = {
      id: outgoingChequeId,
      bankAccountId: effectiveBankId!,
      chequeBookId,
      chequeLeafId: params.chequeLeafId || '',
      chequeNumber: finalChequeNumber,
      beneficiary: params.beneficiary.trim(),
      contactId: params.contactId,
      issueDate: params.date,
      amountCentimes: params.amountCentimes,
      currency: params.currency,
      exchangeRate: params.exchangeRate,
      baseDzdAmountCentimes,
      purpose: params.description.trim(),
      linkedType: 'depense',
      linkedId: expenseId,
      status: 'remis',
      notes: params.notes.trim(),
      createdAt: now,
      updatedAt: now,
    };
    await db.outgoingCheques.put(outgoing);
  }

  const record: Expense = {
    id: expenseId,
    date: params.date,
    beneficiary: params.beneficiary.trim(),
    contactId: params.contactId,
    categoryId: params.categoryId,
    categoryName: params.categoryName,
    description: params.description.trim(),
    amountCentimes: params.amountCentimes,
    currency: params.currency,
    exchangeRate: params.exchangeRate,
    baseDzdAmountCentimes,
    paymentMethod: params.paymentMethod,
    bankAccountId: effectiveBankId,
    chequeLeafId: params.chequeLeafId || existing?.chequeLeafId,
    outgoingChequeId,
    reference:
      params.reference.trim() ||
      (params.chequeNumber ? `CHQ ${params.chequeNumber.trim()}` : ''),
    notes: params.notes.trim(),
    status: 'valide',
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  await db.transaction('rw', [db.expenses, db.ledgerEntries], async () => {
    await db.expenses.put(record);

    // Règle anti-double-comptage : une dépense par chèque n'entre au grand livre qu'à l'encaissement du chèque
    if (shouldCreateImmediateLedgerEntryForExpense(params.paymentMethod)) {
      const existingLed = await db.ledgerEntries
        .where('sourceId')
        .equals(expenseId)
        .first();
      const ledgerRecord: LedgerEntry = {
        id: existingLed?.id || createId('led'),
        date: params.date,
        direction: 'sortie',
        sourceType: 'depense',
        sourceId: expenseId,
        bankAccountId: effectiveBankId,
        contactId: params.contactId,
        label: `Dépense (${params.categoryName}) — ${params.beneficiary.trim()} : ${params.description.trim()}`,
        amountCentimes: params.amountCentimes,
        currency: params.currency,
        exchangeRate: params.exchangeRate,
        baseDzdAmountCentimes,
        status: 'valide',
        createdAt: existingLed?.createdAt || now,
      };
      await db.ledgerEntries.put(ledgerRecord);
    }
  });

  await recordAudit({
    action: existing ? 'MODIFICATION' : 'CREATION',
    entityType: 'depense',
    entityId: expenseId,
    summary: `${existing ? 'Modification' : 'Création'} dépense — ${record.beneficiary} (${record.categoryName})`,
    before: existing,
    after: record,
  });

  return record;
}

export async function cancelExpense(expenseId: string, reason: string): Promise<void> {
  if (!reason.trim()) throw new Error('Le motif d’annulation est obligatoire.');
  const expense = await db.expenses.get(expenseId);
  if (!expense) throw new Error('Dépense introuvable.');
  if (expense.status === 'annule') throw new Error('Dépense déjà annulée.');

  const now = new Date().toISOString();
  await db.transaction('rw', [db.expenses, db.ledgerEntries], async () => {
    await db.expenses.update(expenseId, {
      status: 'annule',
      cancelReason: reason.trim(),
      cancelledAt: now,
      updatedAt: now,
    });
    const ledgers = await db.ledgerEntries.where('sourceId').equals(expenseId).toArray();
    for (const l of ledgers) {
      await db.ledgerEntries.update(l.id, { status: 'annule' });
    }
  });

  await recordAudit({
    action: 'ANNULATION',
    entityType: 'depense',
    entityId: expenseId,
    summary: `Annulation dépense — ${expense.beneficiary} : ${expense.description}`,
    before: expense,
    reason: reason.trim(),
  });
}

export async function saveContact(params: {
  existingId?: string;
  type: Contact['type'];
  name: string;
  company: string;
  address: string;
  phone: string;
  email: string;
  nif: string;
  nis: string;
  rc: string;
  ai: string;
  notes: string;
}): Promise<Contact> {
  if (!params.name.trim() && !params.company.trim()) {
    throw new Error('Veuillez saisir au moins un nom ou une raison sociale.');
  }
  const now = new Date().toISOString();
  const existing = params.existingId ? await db.contacts.get(params.existingId) : undefined;

  const record: Contact = {
    id: existing?.id || createId('cnt'),
    type: params.type,
    name: params.name.trim(),
    company: params.company.trim(),
    address: params.address.trim(),
    phone: params.phone.trim(),
    email: params.email.trim(),
    nif: params.nif.trim(),
    nis: params.nis.trim(),
    rc: params.rc.trim(),
    ai: params.ai.trim(),
    notes: params.notes.trim(),
    archived: existing?.archived || false,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  await db.contacts.put(record);
  await recordAudit({
    action: existing ? 'MODIFICATION' : 'CREATION',
    entityType: 'contact',
    entityId: record.id,
    summary: `${existing ? 'Modification' : 'Création'} fiche ${record.company || record.name}`,
    before: existing,
    after: record,
  });

  return record;
}
