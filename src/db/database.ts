import Dexie, { type Table } from 'dexie';
import { APP_VERSION, DEVELOPER_BRAND } from '../constants/branding';
import { DEFAULT_CURRENCIES } from '../utils/money';
import type {
  AuditAction,
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
} from './types';

export const DEFAULT_EXPENSE_CATEGORIES: Omit<ExpenseCategory, 'createdAt'>[] = [
  { id: 'cat-loyer', name: 'Loyer & charges', color: '#1e40af', isDefault: true },
  { id: 'cat-salaires', name: 'Salaires & charges sociales', color: '#047857', isDefault: true },
  { id: 'cat-fournitures', name: 'Fournitures & consommables', color: '#b45309', isDefault: true },
  { id: 'cat-transport', name: 'Transport & carburant', color: '#4338ca', isDefault: true },
  { id: 'cat-telecom', name: 'Télécom & Internet', color: '#0f766e', isDefault: true },
  { id: 'cat-impots', name: 'Impôts & taxes', color: '#b91c1c', isDefault: true },
  { id: 'cat-prestations', name: 'Prestations & sous-traitance', color: '#6d28d9', isDefault: true },
  { id: 'cat-autres', name: 'Autres dépenses', color: '#475569', isDefault: true },
];

export function createDefaultSettings(): CompanySettings {
  const now = new Date().toISOString();
  return {
    id: 'company_settings',
    companyName: '',
    logoDataUrl: '',
    address: '',
    phone: '',
    email: '',
    nif: '',
    nis: '',
    rc: '',
    ai: '',
    defaultCurrency: 'DZD',
    enabledCurrencies: DEFAULT_CURRENCIES,
    defaultTvaRate: 19,
    invoicePrefix: 'FAC-',
    invoiceNextSeq: 1,
    supplierInvoicePrefix: 'FF-',
    supplierInvoiceNextSeq: 1,
    cashOpeningBalanceCentimes: 0,
    cashOpeningDate: now.slice(0, 10),
    backupFolder: '',
    uiMode: 'simple',
    onboardingCompleted: false,
    developerBrand: DEVELOPER_BRAND,
    appVersion: APP_VERSION,
    isDemoDataLoaded: false,
    updatedAt: now,
  };
}

export class GestionFinanciereDB extends Dexie {
  settings!: Table<CompanySettings, string>;
  contacts!: Table<Contact, string>;
  bankAccounts!: Table<BankAccount, string>;
  chequeBooks!: Table<ChequeBook, string>;
  chequeLeaves!: Table<ChequeLeaf, string>;
  customerInvoices!: Table<CustomerInvoice, string>;
  supplierInvoices!: Table<SupplierInvoice, string>;
  payments!: Table<Payment, string>;
  paymentAllocations!: Table<PaymentAllocation, string>;
  expenseCategories!: Table<ExpenseCategory, string>;
  expenses!: Table<Expense, string>;
  incomingCheques!: Table<IncomingCheque, string>;
  outgoingCheques!: Table<OutgoingCheque, string>;
  ledgerEntries!: Table<LedgerEntry, string>;
  auditLogs!: Table<AuditLog, string>;

  constructor() {
    super('GestionFinanciereDB');
    this.version(1).stores({
      settings: 'id',
      contacts: 'id, type, name, company, archived',
      bankAccounts: 'id, bankName, currency, active',
      chequeBooks: 'id, bankAccountId, createdAt',
      chequeLeaves: 'id, chequeBookId, bankAccountId, &[bankAccountId+chequeNumber], status',
      customerInvoices: 'id, invoiceNumber, clientId, issueDate, dueDate, status',
      supplierInvoices: 'id, invoiceNumber, supplierId, issueDate, dueDate, status',
      payments: 'id, direction, contactId, date, method, bankAccountId, status',
      paymentAllocations: 'id, paymentId, invoiceType, invoiceId',
      expenseCategories: 'id, name',
      expenses: 'id, date, categoryId, beneficiary, paymentMethod, bankAccountId, status',
      incomingCheques: 'id, clientId, chequeNumber, entryDate, status, targetBankAccountId',
      outgoingCheques: 'id, bankAccountId, chequeBookId, chequeNumber, issueDate, status',
      ledgerEntries: 'id, date, direction, sourceType, sourceId, bankAccountId, status',
      auditLogs: 'id, timestamp, action, entityType, entityId',
    });
  }
}

export const db = new GestionFinanciereDB();

export function createId(prefix = 'id'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function ensureDatabaseInitialized(): Promise<CompanySettings> {
  const existing = await db.settings.get('company_settings');
  const now = new Date().toISOString();

  const catCount = await db.expenseCategories.count();
  if (catCount === 0) {
    await db.expenseCategories.bulkPut(
      DEFAULT_EXPENSE_CATEGORIES.map((c) => ({ ...c, createdAt: now }))
    );
  }

  if (existing) {
    if (existing.developerBrand !== DEVELOPER_BRAND) {
      const updated = { ...existing, developerBrand: DEVELOPER_BRAND };
      await db.settings.put(updated);
      return updated;
    }
    return existing;
  }

  const defaults = createDefaultSettings();
  await db.settings.put(defaults);
  return defaults;
}

export async function recordAudit(params: {
  action: AuditAction;
  entityType: string;
  entityId: string;
  summary: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
  actor?: string;
}): Promise<void> {
  const entry: AuditLog = {
    id: createId('aud'),
    timestamp: new Date().toISOString(),
    actor: params.actor || 'Utilisateur local',
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    summary: params.summary,
    beforeJson: params.before !== undefined ? JSON.stringify(params.before) : undefined,
    afterJson: params.after !== undefined ? JSON.stringify(params.after) : undefined,
    reason: params.reason,
  };
  await db.auditLogs.put(entry);
}
