import { db, DEFAULT_EXPENSE_CATEGORIES, ensureDatabaseInitialized, recordAudit } from '../db/database';
import { generateChequeSerialSequence } from '../utils/cheque';
import { computeInvoiceDocumentTotals } from '../utils/finance';

export async function loadDemoData(): Promise<void> {
  const settings = await ensureDatabaseInitialized();
  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  const bankBnaId = 'demo_bank_bna';
  const bankCpaId = 'demo_bank_cpa';
  const client1Id = 'demo_contact_c1';
  const client2Id = 'demo_contact_c2';
  const supplier1Id = 'demo_contact_s1';
  const both1Id = 'demo_contact_b1';

  const bookId = 'demo_chequebook_1';
  const serials = generateChequeSerialSequence('0012345', 25);
  const leaves = serials.map((num, idx) => ({
    id: `demo_leaf_${idx + 1}`,
    chequeBookId: bookId,
    bankAccountId: bankBnaId,
    chequeNumber: num,
    status: (idx === 0 ? 'encaisse' : idx === 1 ? 'remis' : 'disponible') as
      | 'encaisse'
      | 'remis'
      | 'disponible',
    outgoingChequeId: idx === 0 ? 'demo_ochq_1' : idx === 1 ? 'demo_ochq_2' : undefined,
    createdAt: now,
  }));

  const inv1Totals = computeInvoiceDocumentTotals([
    {
      id: 'l1',
      description: 'Maintenance groupe électrogène 150 kVA',
      quantity: 1,
      unitPriceCentimes: 10000000, // 100 000,00 DA
      discountPercent: 0,
      tvaRate: 19,
    },
  ]);

  const inv2Totals = computeInvoiceDocumentTotals([
    {
      id: 'l2',
      description: 'Fourniture câbles industriels 4x25mm',
      quantity: 200,
      unitPriceCentimes: 145000, // 1 450,00 DA
      discountPercent: 5,
      tvaRate: 19,
    },
  ]);

  const supInv1Totals = computeInvoiceDocumentTotals([
    {
      id: 'sl1',
      description: 'Lot pièces détachées hydrauliques',
      quantity: 10,
      unitPriceCentimes: 1850000, // 18 500,00 DA
      discountPercent: 0,
      tvaRate: 19,
    },
  ]);

  await db.transaction(
    'rw',
    [
      db.settings,
      db.contacts,
      db.bankAccounts,
      db.chequeBooks,
      db.chequeLeaves,
      db.customerInvoices,
      db.supplierInvoices,
      db.payments,
      db.paymentAllocations,
      db.expenseCategories,
      db.expenses,
      db.incomingCheques,
      db.outgoingCheques,
      db.ledgerEntries,
      db.auditLogs,
    ],
    async () => {
      await db.settings.put({
        ...settings,
        companyName: settings.companyName || 'SARL Numidia Services (Démo)',
        address: settings.address || 'Zone Industrielle Oued Smar, Lot 14, Alger',
        phone: settings.phone || '023 82 41 10',
        email: settings.email || 'contact@numidia-services.example',
        nif: settings.nif || '001916099123456',
        nis: settings.nis || '001916099123400',
        rc: settings.rc || '16/00-0991234B19',
        ai: settings.ai || '16240991234',
        cashOpeningBalanceCentimes: 35000000, // 350 000,00 DA
        cashOpeningDate: '2026-01-01',
        invoiceNextSeq: 3,
        supplierInvoiceNextSeq: 2,
        onboardingCompleted: true,
        isDemoDataLoaded: true,
        updatedAt: now,
      });

      await db.contacts.bulkPut([
        {
          id: client1Id,
          type: 'client',
          name: 'Karim Benali',
          company: 'EURL Maghreb Bâtiment (Démo)',
          address: 'Cité 1200 Logements, Bab Ezzouar, Alger',
          phone: '0550 12 34 56',
          email: 'k.benali@maghreb-batiment.example',
          nif: '002016011223344',
          nis: '002016011223300',
          rc: '16/00-0112233B20',
          ai: '16240112233',
          notes: 'Client historique — règlement à 30 jours',
          archived: false,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: client2Id,
          type: 'client',
          name: 'Nadia Mansouri',
          company: 'SPA Hydra Logistique (Démo)',
          address: 'Route de Dar El Beïda, Alger',
          phone: '0661 45 78 90',
          email: 'comptabilite@hydra-logistique.example',
          nif: '001816055443322',
          nis: '001816055443300',
          rc: '16/00-0554433B18',
          ai: '16240554433',
          notes: '',
          archived: false,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: supplier1Id,
          type: 'fournisseur',
          name: 'Sofiane Khelifi',
          company: 'SARL Méca Import (Démo)',
          address: 'Zone d’activité Rouïba, Alger',
          phone: '0770 88 99 11',
          email: 'ventes@meca-import.example',
          nif: '001716077889900',
          nis: '001716077889911',
          rc: '16/00-0778899B17',
          ai: '16240778899',
          notes: 'Fournisseur pièces hydrauliques',
          archived: false,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: both1Id,
          type: 'les_deux',
          name: 'Yacine Haddad',
          company: 'SNC El Djazaïr Fournitures (Démo)',
          address: 'Blida Centre, Wilaya de Blida',
          phone: '0552 33 44 55',
          email: 'contact@eldjazair-fournitures.example',
          nif: '002109033445566',
          nis: '002109033445500',
          rc: '09/00-0334455B21',
          ai: '09010334455',
          notes: 'Client et fournisseur de consommables',
          archived: false,
          createdAt: now,
          updatedAt: now,
        },
      ]);

      await db.bankAccounts.bulkPut([
        {
          id: bankBnaId,
          bankName: 'BNA',
          accountName: 'BNA Agence Oued Smar (DZD)',
          accountNumber: '00100642030012456789',
          rib: '001 00642 0300124567 89',
          currency: 'DZD',
          openingBalanceCentimes: 245000000, // 2 450 000,00 DA
          openingDate: '2026-01-01',
          notes: 'Compte courant principal',
          active: true,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: bankCpaId,
          bankName: 'CPA',
          accountName: 'CPA Agence Bab Ezzouar (DZD)',
          accountNumber: '00400188410009876512',
          rib: '004 00188 4100098765 12',
          currency: 'DZD',
          openingBalanceCentimes: 98000000, // 980 000,00 DA
          openingDate: '2026-01-01',
          notes: 'Compte secondaire',
          active: true,
          createdAt: now,
          updatedAt: now,
        },
      ]);

      await db.chequeBooks.put({
        id: bookId,
        bankAccountId: bankBnaId,
        startSerial: '0012345',
        count: 25,
        notes: 'Carnet BNA principal',
        createdAt: now,
      });

      await db.chequeLeaves.bulkPut(leaves);

      await db.customerInvoices.bulkPut([
        {
          id: 'demo_cinv_1',
          invoiceNumber: 'FAC-2026-0001',
          clientId: client1Id,
          issueDate: '2026-10-15',
          dueDate: '2026-11-14',
          bcNumber: 'BC-442/26',
          campaignRef: 'Campagne T4',
          currency: 'DZD',
          exchangeRate: 1,
          description: 'Maintenance préventive site Alger',
          lines: inv1Totals.lines,
          totalHtCentimes: inv1Totals.totalHtCentimes,
          totalTvaCentimes: inv1Totals.totalTvaCentimes,
          totalTtcCentimes: inv1Totals.totalTtcCentimes,
          baseDzdTtcCentimes: inv1Totals.totalTtcCentimes,
          status: 'partielle',
          notes: '',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'demo_cinv_2',
          invoiceNumber: 'FAC-2026-0002',
          clientId: client2Id,
          issueDate: today,
          dueDate: '2026-12-15',
          bcNumber: 'BC-819/26',
          campaignRef: 'Chantier Dar El Beïda',
          currency: 'DZD',
          exchangeRate: 1,
          description: 'Livraison lot câbles industriels',
          lines: inv2Totals.lines,
          totalHtCentimes: inv2Totals.totalHtCentimes,
          totalTvaCentimes: inv2Totals.totalTvaCentimes,
          totalTtcCentimes: inv2Totals.totalTtcCentimes,
          baseDzdTtcCentimes: inv2Totals.totalTtcCentimes,
          status: 'impayee',
          notes: '',
          createdAt: now,
          updatedAt: now,
        },
      ]);

      await db.supplierInvoices.put({
        id: 'demo_sinv_1',
        invoiceNumber: 'FF-2026-0001',
        supplierRef: 'MI-908/2026',
        supplierId: supplier1Id,
        issueDate: '2026-10-20',
        dueDate: '2026-11-20',
        currency: 'DZD',
        exchangeRate: 1,
        description: 'Pièces détachées hydrauliques',
        lines: supInv1Totals.lines,
        totalHtCentimes: supInv1Totals.totalHtCentimes,
        totalTvaCentimes: supInv1Totals.totalTvaCentimes,
        totalTtcCentimes: supInv1Totals.totalTtcCentimes,
        baseDzdTtcCentimes: supInv1Totals.totalTtcCentimes,
        status: 'payee',
        notes: '',
        createdAt: now,
        updatedAt: now,
      });

      await db.payments.bulkPut([
        {
          id: 'demo_pay_1',
          direction: 'entrant',
          contactId: client1Id,
          date: '2026-10-25',
          amountCentimes: 7000000, // 70 000,00 DA (paiement partiel sur 119 000,00 DA)
          currency: 'DZD',
          exchangeRate: 1,
          baseDzdAmountCentimes: 7000000,
          method: 'virement',
          bankAccountId: bankBnaId,
          reference: 'VIR-BNA-8821',
          notes: 'Acompte sur FAC-2026-0001',
          isAdvance: false,
          status: 'valide',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'demo_pay_2',
          direction: 'sortant',
          contactId: supplier1Id,
          date: '2026-10-28',
          amountCentimes: supInv1Totals.totalTtcCentimes,
          currency: 'DZD',
          exchangeRate: 1,
          baseDzdAmountCentimes: supInv1Totals.totalTtcCentimes,
          method: 'cheque',
          bankAccountId: bankBnaId,
          chequeId: 'demo_ochq_1',
          reference: 'CHQ 0012345',
          notes: 'Règlement intégral FF-2026-0001',
          isAdvance: false,
          status: 'valide',
          createdAt: now,
          updatedAt: now,
        },
      ]);

      await db.paymentAllocations.bulkPut([
        {
          id: 'demo_alloc_1',
          paymentId: 'demo_pay_1',
          invoiceType: 'client',
          invoiceId: 'demo_cinv_1',
          amountCentimes: 7000000,
          createdAt: now,
        },
        {
          id: 'demo_alloc_2',
          paymentId: 'demo_pay_2',
          invoiceType: 'fournisseur',
          invoiceId: 'demo_sinv_1',
          amountCentimes: supInv1Totals.totalTtcCentimes,
          createdAt: now,
        },
      ]);

      await db.outgoingCheques.bulkPut([
        {
          id: 'demo_ochq_1',
          bankAccountId: bankBnaId,
          chequeBookId: bookId,
          chequeLeafId: 'demo_leaf_1',
          chequeNumber: '0012345',
          beneficiary: 'SARL Méca Import (Démo)',
          contactId: supplier1Id,
          issueDate: '2026-10-28',
          amountCentimes: supInv1Totals.totalTtcCentimes,
          currency: 'DZD',
          exchangeRate: 1,
          baseDzdAmountCentimes: supInv1Totals.totalTtcCentimes,
          purpose: 'Règlement facture fournisseur MI-908/2026',
          linkedType: 'fournisseur_facture',
          linkedId: 'demo_sinv_1',
          clearingDate: '2026-11-02',
          status: 'encaisse',
          notes: '',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'demo_ochq_2',
          bankAccountId: bankBnaId,
          chequeBookId: bookId,
          chequeLeafId: 'demo_leaf_2',
          chequeNumber: '0012346',
          beneficiary: 'Propriétaire Entrepôt Oued Smar',
          issueDate: '2026-11-05',
          amountCentimes: 12000000, // 120 000,00 DA
          currency: 'DZD',
          exchangeRate: 1,
          baseDzdAmountCentimes: 12000000,
          purpose: 'Loyer entrepôt novembre 2026',
          linkedType: 'depense',
          linkedId: 'demo_exp_2',
          status: 'remis',
          notes: 'Chèque remis, en attente d’encaissement',
          createdAt: now,
          updatedAt: now,
        },
      ]);

      await db.incomingCheques.put({
        id: 'demo_ichq_1',
        clientId: client2Id,
        issuerBank: 'BEA',
        chequeNumber: '0077891',
        chequeDate: '2026-11-10',
        entryDate: '2026-11-11',
        amountCentimes: 15000000, // 150 000,00 DA
        currency: 'DZD',
        exchangeRate: 1,
        baseDzdAmountCentimes: 15000000,
        targetBankAccountId: bankCpaId,
        depositDate: '2026-11-12',
        status: 'depose',
        allocatedInvoiceIds: ['demo_cinv_2'],
        notes: 'En attente de compensation',
        createdAt: now,
        updatedAt: now,
      });

      await db.expenses.bulkPut([
        {
          id: 'demo_exp_1',
          date: '2026-11-03',
          beneficiary: 'Station Naftal Oued Smar',
          categoryId: 'cat-transport',
          categoryName: 'Transport & carburant',
          description: 'Carburant véhicules utilitaires',
          amountCentimes: 1850000, // 18 500,00 DA
          currency: 'DZD',
          exchangeRate: 1,
          baseDzdAmountCentimes: 1850000,
          paymentMethod: 'especes',
          bankAccountId: null,
          reference: 'BON-NAF-112',
          notes: '',
          status: 'valide',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'demo_exp_2',
          date: '2026-11-05',
          beneficiary: 'Propriétaire Entrepôt Oued Smar',
          categoryId: 'cat-loyer',
          categoryName: 'Loyer & charges',
          description: 'Loyer mensuel entrepôt novembre 2026',
          amountCentimes: 12000000, // 120 000,00 DA
          currency: 'DZD',
          exchangeRate: 1,
          baseDzdAmountCentimes: 12000000,
          paymentMethod: 'cheque',
          bankAccountId: bankBnaId,
          chequeLeafId: 'demo_leaf_2',
          outgoingChequeId: 'demo_ochq_2',
          reference: 'CHQ 0012346',
          notes: 'Payé par chèque — non débité tant que non encaissé',
          status: 'valide',
          createdAt: now,
          updatedAt: now,
        },
      ]);

      // Grand livre : soldes d'ouverture + mouvements réels encaissés uniquement
      await db.ledgerEntries.bulkPut([
        {
          id: 'demo_led_open_cash',
          date: '2026-01-01',
          direction: 'entree',
          sourceType: 'solde_ouverture',
          sourceId: 'cash_opening',
          bankAccountId: null,
          label: 'Solde d’ouverture Caisse espèces',
          amountCentimes: 35000000,
          currency: 'DZD',
          exchangeRate: 1,
          baseDzdAmountCentimes: 35000000,
          status: 'valide',
          createdAt: now,
        },
        {
          id: 'demo_led_open_bna',
          date: '2026-01-01',
          direction: 'entree',
          sourceType: 'solde_ouverture',
          sourceId: bankBnaId,
          bankAccountId: bankBnaId,
          label: 'Solde d’ouverture BNA Agence Oued Smar',
          amountCentimes: 245000000,
          currency: 'DZD',
          exchangeRate: 1,
          baseDzdAmountCentimes: 245000000,
          status: 'valide',
          createdAt: now,
        },
        {
          id: 'demo_led_open_cpa',
          date: '2026-01-01',
          direction: 'entree',
          sourceType: 'solde_ouverture',
          sourceId: bankCpaId,
          bankAccountId: bankCpaId,
          label: 'Solde d’ouverture CPA Agence Bab Ezzouar',
          amountCentimes: 98000000,
          currency: 'DZD',
          exchangeRate: 1,
          baseDzdAmountCentimes: 98000000,
          status: 'valide',
          createdAt: now,
        },
        {
          id: 'demo_led_pay_1',
          date: '2026-10-25',
          direction: 'entree',
          sourceType: 'paiement_client',
          sourceId: 'demo_pay_1',
          bankAccountId: bankBnaId,
          contactId: client1Id,
          label: 'Virement reçu EURL Maghreb Bâtiment (FAC-2026-0001)',
          amountCentimes: 7000000,
          currency: 'DZD',
          exchangeRate: 1,
          baseDzdAmountCentimes: 7000000,
          status: 'valide',
          createdAt: now,
        },
        {
          id: 'demo_led_ochq_1',
          date: '2026-11-02',
          direction: 'sortie',
          sourceType: 'cheque_emis_encaisse',
          sourceId: 'demo_ochq_1',
          bankAccountId: bankBnaId,
          contactId: supplier1Id,
          label: 'Chèque émis encaissé 0012345 — SARL Méca Import',
          amountCentimes: supInv1Totals.totalTtcCentimes,
          currency: 'DZD',
          exchangeRate: 1,
          baseDzdAmountCentimes: supInv1Totals.totalTtcCentimes,
          status: 'valide',
          createdAt: now,
        },
        {
          id: 'demo_led_exp_1',
          date: '2026-11-03',
          direction: 'sortie',
          sourceType: 'depense',
          sourceId: 'demo_exp_1',
          bankAccountId: null,
          label: 'Dépense espèces — Carburant véhicules utilitaires',
          amountCentimes: 1850000,
          currency: 'DZD',
          exchangeRate: 1,
          baseDzdAmountCentimes: 1850000,
          status: 'valide',
          createdAt: now,
        },
      ]);
    }
  );

  await recordAudit({
    action: 'CREATION',
    entityType: 'donnees_demo',
    entityId: 'demo_dataset',
    summary: 'Chargement des données de démonstration fictives',
  });
}

export async function clearDemoData(): Promise<void> {
  const settings = await ensureDatabaseInitialized();
  const now = new Date().toISOString();

  await db.transaction(
    'rw',
    [
      db.settings,
      db.contacts,
      db.bankAccounts,
      db.chequeBooks,
      db.chequeLeaves,
      db.customerInvoices,
      db.supplierInvoices,
      db.payments,
      db.paymentAllocations,
      db.expenseCategories,
      db.expenses,
      db.incomingCheques,
      db.outgoingCheques,
      db.ledgerEntries,
      db.auditLogs,
    ],
    async () => {
      await Promise.all([
        db.contacts.where('id').startsWith('demo_').delete(),
        db.bankAccounts.where('id').startsWith('demo_').delete(),
        db.chequeBooks.where('id').startsWith('demo_').delete(),
        db.chequeLeaves.where('id').startsWith('demo_').delete(),
        db.customerInvoices.where('id').startsWith('demo_').delete(),
        db.supplierInvoices.where('id').startsWith('demo_').delete(),
        db.payments.where('id').startsWith('demo_').delete(),
        db.paymentAllocations.where('id').startsWith('demo_').delete(),
        db.expenses.where('id').startsWith('demo_').delete(),
        db.incomingCheques.where('id').startsWith('demo_').delete(),
        db.outgoingCheques.where('id').startsWith('demo_').delete(),
        db.ledgerEntries.where('id').startsWith('demo_').delete(),
      ]);

      // S'assurer que les catégories par défaut restent intactes
      const catCount = await db.expenseCategories.count();
      if (catCount === 0) {
        await db.expenseCategories.bulkPut(
          DEFAULT_EXPENSE_CATEGORIES.map((c) => ({ ...c, createdAt: now }))
        );
      }

      const remainingClientInvoices = await db.customerInvoices
        .where('id')
        .noneOf(['demo_cinv_1', 'demo_cinv_2'])
        .count();
      const remainingSupplierInvoices = await db.supplierInvoices
        .where('id')
        .noneOf(['demo_sinv_1'])
        .count();

      const wasDemoCompany = settings.companyName === 'SARL Numidia Services (Démo)';

      await db.settings.put({
        ...settings,
        companyName: wasDemoCompany ? '' : settings.companyName,
        address:
          settings.address === 'Zone Industrielle Oued Smar, Lot 14, Alger' ? '' : settings.address,
        phone: settings.phone === '023 82 41 10' ? '' : settings.phone,
        email:
          settings.email === 'contact@numidia-services.example' ? '' : settings.email,
        nif: settings.nif === '001916099123456' ? '' : settings.nif,
        nis: settings.nis === '001916099123400' ? '' : settings.nis,
        rc: settings.rc === '16/00-0991234B19' ? '' : settings.rc,
        ai: settings.ai === '16240991234' ? '' : settings.ai,
        cashOpeningBalanceCentimes:
          wasDemoCompany && settings.cashOpeningBalanceCentimes === 35000000
            ? 0
            : settings.cashOpeningBalanceCentimes,
        invoiceNextSeq: remainingClientInvoices === 0 ? 1 : settings.invoiceNextSeq,
        supplierInvoiceNextSeq: remainingSupplierInvoices === 0 ? 1 : settings.supplierInvoiceNextSeq,
        isDemoDataLoaded: false,
        updatedAt: now,
      });
    }
  );

  await recordAudit({
    action: 'ANNULATION',
    entityType: 'donnees_demo',
    entityId: 'demo_dataset',
    summary: 'Suppression des données de démonstration fictives',
  });
}
