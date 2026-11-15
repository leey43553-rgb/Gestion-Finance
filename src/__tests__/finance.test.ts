import { describe, expect, it } from 'vitest';
import type { LedgerEntry, Payment, PaymentAllocation } from '../db/types';
import { findDuplicateChequeNumbers, generateChequeSerialSequence } from '../utils/cheque';
import {
  computeContactAccountSummary,
  computeInvoiceDocumentTotals,
  computeInvoicePaidCentimes,
  computeInvoiceRemainingCentimes,
  computeInvoiceStatus,
  computeLedgerTotals,
  computePaymentUnallocatedCentimes,
  shouldCreateImmediateLedgerEntryForExpense,
} from '../utils/finance';
import {
  computeInvoiceLineTotals,
  formatMoney,
  parseMoneyInputToCentimes,
} from '../utils/money';

describe('Règles monétaires en centimes et formatage fr-DZ', () => {
  it('formate les centimes entiers sans flottants au format algérien', () => {
    expect(formatMoney(123456750, 'DZD')).toBe('1 234 567,50 DA');
    expect(formatMoney(0, 'DZD')).toBe('0,00 DA');
    expect(formatMoney(-50025, 'EUR')).toBe('-500,25 €');
  });

  it('parse proprement les saisies utilisateur avec virgule ou point et arrondi demi-supérieur', () => {
    expect(parseMoneyInputToCentimes('100 000,00')).toBe(10000000);
    expect(parseMoneyInputToCentimes('1234.565')).toBe(123457);
    expect(parseMoneyInputToCentimes('1234.564')).toBe(123456);
  });
});

describe('TVA et totaux de factures', () => {
  it('calcule exactement HT 100 000,00 -> TVA 19 000,00 -> TTC 119 000,00', () => {
    const line = computeInvoiceLineTotals({
      quantity: 1,
      unitPriceCentimes: 10000000,
      discountPercent: 0,
      tvaRate: 19,
    });
    expect(line.htCentimes).toBe(10000000);
    expect(line.tvaCentimes).toBe(1900000);
    expect(line.ttcCentimes).toBe(11900000);
    expect(formatMoney(line.htCentimes)).toBe('100 000,00 DA');
    expect(formatMoney(line.tvaCentimes)).toBe('19 000,00 DA');
    expect(formatMoney(line.ttcCentimes)).toBe('119 000,00 DA');
  });

  it('calcule une facture multi-lignes avec remise et taux de TVA différents', () => {
    const doc = computeInvoiceDocumentTotals([
      {
        quantity: 2,
        unitPriceCentimes: 5000000, // 50 000 DA
        discountPercent: 10, // -10% -> 90 000 DA HT
        tvaRate: 19, // 17 100 DA TVA
      },
      {
        quantity: 1,
        unitPriceCentimes: 1000000, // 10 000 DA HT
        discountPercent: 0,
        tvaRate: 9, // 900 DA TVA
      },
    ]);
    expect(doc.totalHtCentimes).toBe(10000000);
    expect(doc.totalTvaCentimes).toBe(1800000);
    expect(doc.totalTtcCentimes).toBe(11800000);
  });
});

describe('Paiements partiels, ventilation multi-factures, avances et solde client', () => {
  const payments: Payment[] = [
    {
      id: 'p1',
      direction: 'entrant',
      contactId: 'c1',
      date: '2026-10-10',
      amountCentimes: 15000000, // 150 000 DA
      currency: 'DZD',
      exchangeRate: 1,
      baseDzdAmountCentimes: 15000000,
      method: 'virement',
      bankAccountId: 'b1',
      reference: 'VIR-1',
      notes: '',
      isAdvance: false,
      status: 'valide',
      createdAt: '2026-10-10T10:00:00Z',
      updatedAt: '2026-10-10T10:00:00Z',
    },
    {
      id: 'p2',
      direction: 'entrant',
      contactId: 'c1',
      date: '2026-10-20',
      amountCentimes: 5000000, // 50 000 DA (avance pure)
      currency: 'DZD',
      exchangeRate: 1,
      baseDzdAmountCentimes: 5000000,
      method: 'especes',
      bankAccountId: null,
      reference: 'AV-1',
      notes: '',
      isAdvance: true,
      status: 'valide',
      createdAt: '2026-10-20T10:00:00Z',
      updatedAt: '2026-10-20T10:00:00Z',
    },
  ];

  // p1 (150 000 DA) réparti sur inv1 (119 000 DA intégral) et inv2 (31 000 DA partiel sur 100 000 DA)
  const allocations: PaymentAllocation[] = [
    {
      id: 'a1',
      paymentId: 'p1',
      invoiceType: 'client',
      invoiceId: 'inv1',
      amountCentimes: 11900000,
      createdAt: '2026-10-10T10:00:00Z',
    },
    {
      id: 'a2',
      paymentId: 'p1',
      invoiceType: 'client',
      invoiceId: 'inv2',
      amountCentimes: 3100000,
      createdAt: '2026-10-10T10:00:00Z',
    },
  ];

  it('calcule le montant payé, le reste dû et le statut automatique des factures', () => {
    const validIds = new Set(['p1', 'p2']);
    const paid1 = computeInvoicePaidCentimes('inv1', allocations, validIds);
    const paid2 = computeInvoicePaidCentimes('inv2', allocations, validIds);

    expect(paid1).toBe(11900000);
    expect(computeInvoiceRemainingCentimes(11900000, paid1, 'impayee')).toBe(0);
    expect(
      computeInvoiceStatus({
        storedStatus: 'impayee',
        totalTtcCentimes: 11900000,
        paidCentimes: paid1,
        dueDate: '2026-10-01',
        referenceDate: '2026-11-15',
      })
    ).toBe('payee');

    expect(paid2).toBe(3100000);
    expect(computeInvoiceRemainingCentimes(10000000, paid2, 'impayee')).toBe(6900000);
    expect(
      computeInvoiceStatus({
        storedStatus: 'impayee',
        totalTtcCentimes: 10000000,
        paidCentimes: paid2,
        dueDate: '2026-12-30',
        referenceDate: '2026-11-15',
      })
    ).toBe('partielle');

    expect(
      computeInvoiceStatus({
        storedStatus: 'impayee',
        totalTtcCentimes: 10000000,
        paidCentimes: paid2,
        dueDate: '2026-11-01',
        referenceDate: '2026-11-15',
      })
    ).toBe('en_retard');
  });

  it('calcule correctement le solde non alloué (avance) et le relevé client complet', () => {
    expect(computePaymentUnallocatedCentimes(payments[0], allocations)).toBe(0);
    expect(computePaymentUnallocatedCentimes(payments[1], allocations)).toBe(5000000);

    const summary = computeContactAccountSummary({
      contactId: 'c1',
      direction: 'client',
      invoices: [
        {
          id: 'inv1',
          contactId: 'c1',
          totalTtcCentimes: 11900000,
          baseDzdTtcCentimes: 11900000,
          status: 'payee',
        },
        {
          id: 'inv2',
          contactId: 'c1',
          totalTtcCentimes: 10000000,
          baseDzdTtcCentimes: 10000000,
          status: 'partielle',
        },
      ],
      payments,
      allocations,
    });

    expect(summary.totalInvoicedBaseDzd).toBe(21900000);
    expect(summary.totalAllocatedToInvoicesBaseDzd).toBe(15000000);
    expect(summary.totalUnpaidBaseDzd).toBe(6900000);
    expect(summary.totalPaymentsReceivedBaseDzd).toBe(20000000);
    expect(summary.availableAdvanceBaseDzd).toBe(5000000);
  });
});

describe('Chéquiers : zéros initiaux et unicité par banque', () => {
  it('génère un carnet entier en conservant les zéros initiaux', () => {
    const serials = generateChequeSerialSequence('0012345', 25);
    expect(serials).toHaveLength(25);
    expect(serials[0]).toBe('0012345');
    expect(serials[24]).toBe('0012369');
  });

  it('détecte les numéros déjà utilisés sur la même banque même après annulation', () => {
    const duplicates = findDuplicateChequeNumbers(['0012345', '0012350'], ['0012349', '0012350', '0012351']);
    expect(duplicates).toEqual(['0012350']);
  });
});

describe('Absence de double comptage entre dépense, chèque et grand livre', () => {
  it('empêche une dépense payée par chèque de générer une écriture immédiate dans le grand livre', () => {
    expect(shouldCreateImmediateLedgerEntryForExpense('especes')).toBe(true);
    expect(shouldCreateImmediateLedgerEntryForExpense('virement')).toBe(true);
    expect(shouldCreateImmediateLedgerEntryForExpense('carte')).toBe(true);
    expect(shouldCreateImmediateLedgerEntryForExpense('cheque')).toBe(false);
  });

  it('additionne uniquement les mouvements valides du grand livre', () => {
    const entries: LedgerEntry[] = [
      {
        id: 'l1',
        date: '2026-11-01',
        direction: 'entree',
        sourceType: 'solde_ouverture',
        sourceId: 'open',
        bankAccountId: 'b1',
        label: 'Ouverture',
        amountCentimes: 50000000,
        currency: 'DZD',
        exchangeRate: 1,
        baseDzdAmountCentimes: 50000000,
        status: 'valide',
        createdAt: '2026-11-01T00:00:00Z',
      },
      {
        id: 'l2',
        date: '2026-11-02',
        direction: 'sortie',
        sourceType: 'cheque_emis_encaisse',
        sourceId: 'chq1',
        bankAccountId: 'b1',
        label: 'Loyer par chèque encaissé',
        amountCentimes: 12000000,
        currency: 'DZD',
        exchangeRate: 1,
        baseDzdAmountCentimes: 12000000,
        status: 'valide',
        createdAt: '2026-11-02T00:00:00Z',
      },
      {
        id: 'l3',
        date: '2026-11-03',
        direction: 'sortie',
        sourceType: 'depense',
        sourceId: 'exp_cancelled',
        bankAccountId: null,
        label: 'Annulée',
        amountCentimes: 5000000,
        currency: 'DZD',
        exchangeRate: 1,
        baseDzdAmountCentimes: 5000000,
        status: 'annule',
        createdAt: '2026-11-03T00:00:00Z',
      },
    ];

    const totals = computeLedgerTotals(entries);
    expect(totals.totalInflowsBaseDzd).toBe(50000000);
    expect(totals.totalOutflowsBaseDzd).toBe(12000000);
    expect(totals.netBalanceBaseDzd).toBe(38000000);
  });
});

import * as XLSX from 'xlsx';
import {
  autoDetectColumnMapping,
  normalizeImportedDate,
  parseExcelBuffer,
  validateImportRows,
} from '../services/excelService';

describe('Import Excel : détection en-têtes français, zéros initiaux et doublons', () => {
  it('détecte automatiquement les colonnes françaises des factures et chèques', () => {
    const invMap = autoDetectColumnMapping('factures_clients', [
      'Date',
      'N° Facture',
      'N° BC',
      'Campagne',
      'Client',
      'Montant HT',
      'TVA',
      'TTC',
    ]);
    expect(invMap.issueDate).toBe('Date');
    expect(invMap.invoiceNumber).toBe('N° Facture');
    expect(invMap.bcNumber).toBe('N° BC');
    expect(invMap.campaignRef).toBe('Campagne');
    expect(invMap.clientName).toBe('Client');
    expect(invMap.htAmount).toBe('Montant HT');
    expect(invMap.tvaAmount).toBe('TVA');
    expect(invMap.ttcAmount).toBe('TTC');

    const chqMap = autoDetectColumnMapping('cheques_emis', [
      'Banque',
      'N° chèque',
      'Bénéficiaire',
      'Date de sortie',
      'Montant',
      'Objet',
    ]);
    expect(chqMap.bankName).toBe('Banque');
    expect(chqMap.chequeNumber).toBe('N° chèque');
    expect(chqMap.beneficiary).toBe('Bénéficiaire');
    expect(chqMap.issueDate).toBe('Date de sortie');
    expect(chqMap.amount).toBe('Montant');
    expect(chqMap.purpose).toBe('Objet');
  });

  it('préserve les zéros initiaux des numéros de chèques à la lecture Excel', async () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Banque', 'N° Chèque', 'Bénéficiaire', 'Date de sortie', 'Montant', 'Objet'],
      ['BNA', '0012345', 'SARL Test', '15/11/2026', '50 000,00', 'Loyer'],
    ]);
    ws['B2'] = { t: 's', v: '0012345', z: '@' };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Chèques');
    const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;

    const parsed = await parseExcelBuffer(out);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]['N° Chèque']).toBe('0012345');
    expect(normalizeImportedDate(parsed.rows[0]['Date de sortie'])).toBe('2026-11-15');
  });

  it('bloque les doublons de chèques émis sur une même banque et signale les erreurs', () => {
    const validated = validateImportRows({
      type: 'cheques_emis',
      rows: [
        {
          Banque: 'BNA',
          'N° Chèque': '0012345',
          Bénéficiaire: 'Fournisseur A',
          'Date de sortie': '2026-11-15',
          Montant: '25000,00',
          Objet: 'Achat',
        },
        {
          Banque: 'BNA',
          'N° Chèque': '0012399',
          Bénéficiaire: 'Fournisseur B',
          'Date de sortie': '2026-11-15',
          Montant: '30000,00',
          Objet: 'Transport',
        },
        {
          Banque: 'BNA',
          'N° Chèque': '0012399',
          Bénéficiaire: 'Fournisseur B bis',
          'Date de sortie': '2026-11-16',
          Montant: '10000,00',
          Objet: 'Doublon fichier',
        },
      ],
      mapping: {
        bankName: 'Banque',
        chequeNumber: 'N° Chèque',
        beneficiary: 'Bénéficiaire',
        issueDate: 'Date de sortie',
        amount: 'Montant',
        purpose: 'Objet',
      },
      ctx: {
        contacts: [],
        customerInvoices: [],
        supplierInvoices: [],
        expenses: [],
        incomingCheques: [],
        outgoingCheques: [],
        chequeLeafKeys: new Set(['bank_bna::0012345']),
        bankAccounts: [{ id: 'bank_bna', bankName: 'BNA', accountName: 'Compte principal' }],
        defaultTvaRate: 19,
        defaultCurrency: 'DZD',
      },
    });

    expect(validated[0].status).toBe('doublon');
    expect(validated[1].status).toBe('valide');
    expect(validated[2].status).toBe('doublon');
  });
});
