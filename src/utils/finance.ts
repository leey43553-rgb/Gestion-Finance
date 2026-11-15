import type {
  ComputedInvoiceStatus,
  InvoiceLine,
  LedgerEntry,
  Payment,
  PaymentAllocation,
  StoredInvoiceStatus,
} from '../db/types';
import { addMoney, computeInvoiceLineTotals, subtractMoney } from './money';

export function computeInvoiceDocumentTotals(lines: Array<{
  quantity: number;
  unitPriceCentimes: number;
  discountPercent: number;
  tvaRate: number;
  id?: string;
  description?: string;
}>): {
  lines: InvoiceLine[];
  totalHtCentimes: number;
  totalTvaCentimes: number;
  totalTtcCentimes: number;
} {
  let totalHtCentimes = 0;
  let totalTvaCentimes = 0;
  let totalTtcCentimes = 0;

  const computedLines: InvoiceLine[] = lines.map((line, index) => {
    const { htCentimes, tvaCentimes, ttcCentimes } = computeInvoiceLineTotals({
      quantity: line.quantity,
      unitPriceCentimes: line.unitPriceCentimes,
      discountPercent: line.discountPercent,
      tvaRate: line.tvaRate,
    });

    totalHtCentimes = addMoney(totalHtCentimes, htCentimes);
    totalTvaCentimes = addMoney(totalTvaCentimes, tvaCentimes);
    totalTtcCentimes = addMoney(totalTtcCentimes, ttcCentimes);

    return {
      id: line.id || `line-${index + 1}`,
      description: line.description || '',
      quantity: line.quantity,
      unitPriceCentimes: Math.round(line.unitPriceCentimes),
      discountPercent: line.discountPercent,
      tvaRate: line.tvaRate,
      htCentimes,
      tvaCentimes,
      ttcCentimes,
    };
  });

  return {
    lines: computedLines,
    totalHtCentimes,
    totalTvaCentimes,
    totalTtcCentimes,
  };
}

/**
 * Calcule le montant payé sur une facture uniquement à partir des allocations de paiements valides.
 * Ne jamais lire un champ "paidAmount" modifiable sur la facture.
 */
export function computeInvoicePaidCentimes(
  invoiceId: string,
  allocations: PaymentAllocation[],
  validPaymentIds: Set<string>
): number {
  let paid = 0;
  for (const alloc of allocations) {
    if (alloc.invoiceId === invoiceId && validPaymentIds.has(alloc.paymentId)) {
      paid = addMoney(paid, alloc.amountCentimes);
    }
  }
  return paid;
}

export function computeInvoiceRemainingCentimes(
  totalTtcCentimes: number,
  paidCentimes: number,
  status: StoredInvoiceStatus
): number {
  if (status === 'annulee') return 0;
  return Math.max(0, subtractMoney(totalTtcCentimes, paidCentimes));
}

export function computeInvoiceStatus(params: {
  storedStatus: StoredInvoiceStatus;
  totalTtcCentimes: number;
  paidCentimes: number;
  dueDate: string;
  referenceDate?: string;
}): ComputedInvoiceStatus {
  if (params.storedStatus === 'annulee') return 'annulee';

  const remaining = Math.max(0, subtractMoney(params.totalTtcCentimes, params.paidCentimes));
  if (params.totalTtcCentimes > 0 && remaining === 0) {
    return 'payee';
  }

  const today = params.referenceDate || new Date().toISOString().slice(0, 10);
  if (params.dueDate && params.dueDate < today && remaining > 0) {
    return 'en_retard';
  }

  if (params.paidCentimes > 0 && remaining > 0) {
    return 'partielle';
  }

  return 'impayee';
}

/**
 * Calcule la part non allouée (avance disponible) d'un paiement valide.
 */
export function computePaymentUnallocatedCentimes(
  payment: Payment,
  allocations: PaymentAllocation[]
): number {
  if (payment.status === 'annule') return 0;
  let allocated = 0;
  for (const alloc of allocations) {
    if (alloc.paymentId === payment.id) {
      allocated = addMoney(allocated, alloc.amountCentimes);
    }
  }
  return Math.max(0, subtractMoney(payment.amountCentimes, allocated));
}

/**
 * Calcule le solde complet d'un contact (client ou fournisseur) en centimes (dans sa devise principale / base DZD).
 */
export function computeContactAccountSummary(params: {
  contactId: string;
  direction: 'client' | 'fournisseur';
  invoices: Array<{
    id: string;
    contactId: string;
    totalTtcCentimes: number;
    baseDzdTtcCentimes: number;
    status: StoredInvoiceStatus;
  }>;
  payments: Payment[];
  allocations: PaymentAllocation[];
}): {
  totalInvoicedBaseDzd: number;
  totalAllocatedToInvoicesBaseDzd: number;
  totalUnpaidBaseDzd: number;
  totalPaymentsReceivedBaseDzd: number;
  availableAdvanceBaseDzd: number;
} {
  const validPayments = params.payments.filter(
    (p) =>
      p.status === 'valide' &&
      p.contactId === params.contactId &&
      p.direction === (params.direction === 'client' ? 'entrant' : 'sortant')
  );
  const validPaymentMap = new Map(validPayments.map((p) => [p.id, p]));
  const validPaymentIds = new Set(validPayments.map((p) => p.id));

  let totalInvoicedBaseDzd = 0;
  let totalAllocatedToInvoicesBaseDzd = 0;

  const activeInvoices = params.invoices.filter(
    (inv) => inv.contactId === params.contactId && inv.status !== 'annulee'
  );

  for (const inv of activeInvoices) {
    totalInvoicedBaseDzd = addMoney(totalInvoicedBaseDzd, inv.baseDzdTtcCentimes);
    const paidNative = computeInvoicePaidCentimes(inv.id, params.allocations, validPaymentIds);
    // Proportion en base DZD selon le taux de la facture si multi-devises
    const ratio = inv.totalTtcCentimes > 0 ? paidNative / inv.totalTtcCentimes : 0;
    const paidDzd =
      inv.totalTtcCentimes === inv.baseDzdTtcCentimes
        ? paidNative
        : Math.round(inv.baseDzdTtcCentimes * ratio);
    totalAllocatedToInvoicesBaseDzd = addMoney(totalAllocatedToInvoicesBaseDzd, paidDzd);
  }

  let totalPaymentsReceivedBaseDzd = 0;
  let availableAdvanceBaseDzd = 0;

  for (const pay of validPayments) {
    totalPaymentsReceivedBaseDzd = addMoney(totalPaymentsReceivedBaseDzd, pay.baseDzdAmountCentimes);
    const unallocatedNative = computePaymentUnallocatedCentimes(pay, params.allocations);
    const unallocatedDzd =
      pay.amountCentimes === pay.baseDzdAmountCentimes
        ? unallocatedNative
        : Math.round((pay.baseDzdAmountCentimes * unallocatedNative) / Math.max(1, pay.amountCentimes));
    availableAdvanceBaseDzd = addMoney(availableAdvanceBaseDzd, unallocatedDzd);
  }

  const totalUnpaidBaseDzd = Math.max(0, subtractMoney(totalInvoicedBaseDzd, totalAllocatedToInvoicesBaseDzd));

  return {
    totalInvoicedBaseDzd,
    totalAllocatedToInvoicesBaseDzd,
    totalUnpaidBaseDzd,
    totalPaymentsReceivedBaseDzd,
    availableAdvanceBaseDzd,
  };
}

/**
 * Vérifie qu'une dépense payée par chèque ne crée PAS d'écriture de trésorerie immédiate
 * tant que le chèque n'est pas encaissé, garantissant l'absence de double comptage dans le grand livre.
 */
export function shouldCreateImmediateLedgerEntryForExpense(paymentMethod: Payment['method']): boolean {
  return paymentMethod !== 'cheque';
}

export function computeLedgerTotals(entries: LedgerEntry[]): {
  totalInflowsBaseDzd: number;
  totalOutflowsBaseDzd: number;
  netBalanceBaseDzd: number;
} {
  let totalInflowsBaseDzd = 0;
  let totalOutflowsBaseDzd = 0;

  for (const entry of entries) {
    if (entry.status !== 'valide') continue;
    if (entry.direction === 'entree') {
      totalInflowsBaseDzd = addMoney(totalInflowsBaseDzd, entry.baseDzdAmountCentimes);
    } else {
      totalOutflowsBaseDzd = addMoney(totalOutflowsBaseDzd, entry.baseDzdAmountCentimes);
    }
  }

  return {
    totalInflowsBaseDzd,
    totalOutflowsBaseDzd,
    netBalanceBaseDzd: subtractMoney(totalInflowsBaseDzd, totalOutflowsBaseDzd),
  };
}
