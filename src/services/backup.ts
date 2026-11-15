import { db, ensureDatabaseInitialized, recordAudit } from '../db/database';
import type {
  AuditLog,
  BankAccount,
  ChequeBook,
  ChequeLeaf,
  CompanySettings,
  Contact,
  CustomerInvoice,
  Expense,
  ExpenseCategory,
  IncomingCheque,
  LedgerEntry,
  OutgoingCheque,
  Payment,
  PaymentAllocation,
  SupplierInvoice,
} from '../db/types';

export interface BackupDataTables {
  settings: CompanySettings[];
  contacts: Contact[];
  bankAccounts: BankAccount[];
  chequeBooks: ChequeBook[];
  chequeLeaves: ChequeLeaf[];
  customerInvoices: CustomerInvoice[];
  supplierInvoices: SupplierInvoice[];
  payments: Payment[];
  paymentAllocations: PaymentAllocation[];
  expenseCategories: ExpenseCategory[];
  expenses: Expense[];
  incomingCheques: IncomingCheque[];
  outgoingCheques: OutgoingCheque[];
  ledgerEntries: LedgerEntry[];
  auditLogs: AuditLog[];
}

export interface BackupPackage {
  app: 'Gestion Financière';
  schemaVersion: number;
  exportedAt: string;
  companyName: string;
  recordCount: number;
  checksum: string;
  data: BackupDataTables;
}

async function computeChecksum(payloadString: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
    const encoder = new TextEncoder();
    const data = encoder.encode(payloadString);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return 'sha256:' + hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // Fallback déterministe hors contexte sécurisé
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < payloadString.length; i += 1) {
    const ch = payloadString.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 'fnv:' + (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

export async function exportFullBackupJson(): Promise<{ json: string; pkg: BackupPackage }> {
  await ensureDatabaseInitialized();

  const [
    settings,
    contacts,
    bankAccounts,
    chequeBooks,
    chequeLeaves,
    customerInvoices,
    supplierInvoices,
    payments,
    paymentAllocations,
    expenseCategories,
    expenses,
    incomingCheques,
    outgoingCheques,
    ledgerEntries,
    auditLogs,
  ] = await Promise.all([
    db.settings.toArray(),
    db.contacts.toArray(),
    db.bankAccounts.toArray(),
    db.chequeBooks.toArray(),
    db.chequeLeaves.toArray(),
    db.customerInvoices.toArray(),
    db.supplierInvoices.toArray(),
    db.payments.toArray(),
    db.paymentAllocations.toArray(),
    db.expenseCategories.toArray(),
    db.expenses.toArray(),
    db.incomingCheques.toArray(),
    db.outgoingCheques.toArray(),
    db.ledgerEntries.toArray(),
    db.auditLogs.toArray(),
  ]);

  const data: BackupDataTables = {
    settings,
    contacts,
    bankAccounts,
    chequeBooks,
    chequeLeaves,
    customerInvoices,
    supplierInvoices,
    payments,
    paymentAllocations,
    expenseCategories,
    expenses,
    incomingCheques,
    outgoingCheques,
    ledgerEntries,
    auditLogs,
  };

  const recordCount = Object.values(data).reduce((acc, arr) => acc + arr.length, 0);
  const serializedData = JSON.stringify(data);
  const checksum = await computeChecksum(serializedData);
  const companyName = settings[0]?.companyName || 'Entreprise non définie';

  const pkg: BackupPackage = {
    app: 'Gestion Financière',
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    companyName,
    recordCount,
    checksum,
    data,
  };

  return { json: JSON.stringify(pkg, null, 2), pkg };
}

export async function verifyAndParseBackupJson(rawJson: string): Promise<{
  valid: boolean;
  error?: string;
  pkg?: BackupPackage;
}> {
  try {
    const parsed = JSON.parse(rawJson) as BackupPackage;
    if (!parsed || parsed.app !== 'Gestion Financière' || !parsed.data || typeof parsed.data !== 'object') {
      return {
        valid: false,
        error: 'Ce fichier ne correspond pas à une sauvegarde valide de Gestion Financière.',
      };
    }

    const requiredKeys: Array<keyof BackupDataTables> = [
      'settings',
      'contacts',
      'bankAccounts',
      'chequeBooks',
      'chequeLeaves',
      'customerInvoices',
      'supplierInvoices',
      'payments',
      'paymentAllocations',
      'expenseCategories',
      'expenses',
      'incomingCheques',
      'outgoingCheques',
      'ledgerEntries',
      'auditLogs',
    ];

    for (const key of requiredKeys) {
      if (!Array.isArray(parsed.data[key])) {
        return {
          valid: false,
          error: `Structure de sauvegarde incomplète (table « ${key} » manquante ou corrompue).`,
        };
      }
    }

    if (parsed.checksum) {
      const expected = await computeChecksum(JSON.stringify(parsed.data));
      if (expected !== parsed.checksum) {
        return {
          valid: false,
          error: 'Le contrôle d’intégrité a échoué : le fichier semble modifié ou endommagé.',
        };
      }
    }

    return { valid: true, pkg: parsed };
  } catch {
    return {
      valid: false,
      error: 'Impossible de lire le fichier JSON sélectionné.',
    };
  }
}

export function triggerBrowserJsonDownload(jsonContent: string, fileName: string): void {
  const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export async function restoreFromBackupJson(rawJson: string): Promise<{
  ok: boolean;
  error?: string;
  companyName?: string;
  recordCount?: number;
}> {
  const check = await verifyAndParseBackupJson(rawJson);
  if (!check.valid || !check.pkg) {
    return { ok: false, error: check.error || 'Sauvegarde invalide.' };
  }

  // Créer une sauvegarde de sécurité AVANT toute restauration
  try {
    const safety = await exportFullBackupJson();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    if (window.electronAPI?.isElectron) {
      const settings = await db.settings.get('company_settings');
      const saveRes = await window.electronAPI.saveBackup(
        safety.json,
        'manual',
        settings?.backupFolder || ''
      );
      if (!saveRes.ok) {
        return {
          ok: false,
          error: `Impossible de créer la sauvegarde de sécurité préalable : ${saveRes.error || 'erreur disque'}. Restauration annulée.`,
        };
      }
    } else {
      triggerBrowserJsonDownload(safety.json, `securite-avant-restauration-${stamp}.json`);
    }
  } catch (err) {
    return {
      ok: false,
      error: `Échec de la sauvegarde de sécurité préalable : ${err instanceof Error ? err.message : 'erreur inconnue'}.`,
    };
  }

  const d = check.pkg.data;

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
        db.settings.clear(),
        db.contacts.clear(),
        db.bankAccounts.clear(),
        db.chequeBooks.clear(),
        db.chequeLeaves.clear(),
        db.customerInvoices.clear(),
        db.supplierInvoices.clear(),
        db.payments.clear(),
        db.paymentAllocations.clear(),
        db.expenseCategories.clear(),
        db.expenses.clear(),
        db.incomingCheques.clear(),
        db.outgoingCheques.clear(),
        db.ledgerEntries.clear(),
        db.auditLogs.clear(),
      ]);

      await Promise.all([
        d.settings.length ? db.settings.bulkPut(d.settings) : Promise.resolve(),
        d.contacts.length ? db.contacts.bulkPut(d.contacts) : Promise.resolve(),
        d.bankAccounts.length ? db.bankAccounts.bulkPut(d.bankAccounts) : Promise.resolve(),
        d.chequeBooks.length ? db.chequeBooks.bulkPut(d.chequeBooks) : Promise.resolve(),
        d.chequeLeaves.length ? db.chequeLeaves.bulkPut(d.chequeLeaves) : Promise.resolve(),
        d.customerInvoices.length ? db.customerInvoices.bulkPut(d.customerInvoices) : Promise.resolve(),
        d.supplierInvoices.length ? db.supplierInvoices.bulkPut(d.supplierInvoices) : Promise.resolve(),
        d.payments.length ? db.payments.bulkPut(d.payments) : Promise.resolve(),
        d.paymentAllocations.length ? db.paymentAllocations.bulkPut(d.paymentAllocations) : Promise.resolve(),
        d.expenseCategories.length ? db.expenseCategories.bulkPut(d.expenseCategories) : Promise.resolve(),
        d.expenses.length ? db.expenses.bulkPut(d.expenses) : Promise.resolve(),
        d.incomingCheques.length ? db.incomingCheques.bulkPut(d.incomingCheques) : Promise.resolve(),
        d.outgoingCheques.length ? db.outgoingCheques.bulkPut(d.outgoingCheques) : Promise.resolve(),
        d.ledgerEntries.length ? db.ledgerEntries.bulkPut(d.ledgerEntries) : Promise.resolve(),
        d.auditLogs.length ? db.auditLogs.bulkPut(d.auditLogs) : Promise.resolve(),
      ]);
    }
  );

  await ensureDatabaseInitialized();
  await recordAudit({
    action: 'RESTAURATION',
    entityType: 'systeme',
    entityId: 'backup_restore',
    summary: `Restauration de la sauvegarde (${check.pkg.companyName}, ${check.pkg.recordCount} enregistrements)`,
  });

  return {
    ok: true,
    companyName: check.pkg.companyName,
    recordCount: check.pkg.recordCount,
  };
}

export async function runElectronAutoBackup(): Promise<{ ok: boolean; error?: string }> {
  if (!window.electronAPI?.isElectron) {
    return { ok: true };
  }
  try {
    const settings = await db.settings.get('company_settings');
    const { json } = await exportFullBackupJson();
    const res = await window.electronAPI.saveBackup(json, 'auto', settings?.backupFolder || '');
    if (!res.ok) {
      return { ok: false, error: res.error || 'Échec de la sauvegarde automatique.' };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Erreur inattendue lors de la sauvegarde automatique.',
    };
  }
}
