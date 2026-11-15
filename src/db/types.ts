export type UIMode = 'simple' | 'avance';

export type ContactType = 'client' | 'fournisseur' | 'les_deux';

export type PaymentMethod = 'especes' | 'cheque' | 'virement' | 'carte';

export type StoredInvoiceStatus = 'impayee' | 'partielle' | 'payee' | 'annulee';
export type ComputedInvoiceStatus = StoredInvoiceStatus | 'en_retard';

export type ChequeLeafStatus =
  | 'disponible'
  | 'prepare'
  | 'remis'
  | 'depose'
  | 'en_attente'
  | 'encaisse'
  | 'rejete'
  | 'annule';

export type OutgoingChequeStatus =
  | 'prepare'
  | 'remis'
  | 'depose'
  | 'en_attente'
  | 'encaisse'
  | 'rejete'
  | 'annule';

export type IncomingChequeStatus =
  | 'recu'
  | 'depose'
  | 'en_attente'
  | 'encaisse'
  | 'rejete'
  | 'annule';

export interface CurrencyConfig {
  code: string; // e.g., 'DZD', 'EUR', 'USD', 'GBP'
  name: string; // e.g., 'Dinar algérien'
  symbol: string; // e.g., 'DA', '€', '$', '£'
  rateToDzd: number; // Taux indicatif manuel vers DZD (1 pour DZD)
  enabled: boolean;
}

export interface CompanySettings {
  id: 'company_settings';
  companyName: string;
  logoDataUrl: string;
  address: string;
  phone: string;
  email: string;
  nif: string;
  nis: string;
  rc: string;
  ai: string;
  defaultCurrency: string;
  enabledCurrencies: CurrencyConfig[];
  defaultTvaRate: number; // Ex: 19
  invoicePrefix: string; // Ex: 'FAC-'
  invoiceNextSeq: number;
  supplierInvoicePrefix: string; // Ex: 'FF-'
  supplierInvoiceNextSeq: number;
  cashOpeningBalanceCentimes: number;
  cashOpeningDate: string;
  backupFolder: string;
  uiMode: UIMode;
  onboardingCompleted: boolean;
  developerBrand: string;
  appVersion: string;
  isDemoDataLoaded: boolean;
  updatedAt: string;
}

export interface Contact {
  id: string;
  type: ContactType;
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
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BankAccount {
  id: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
  rib: string;
  currency: string;
  openingBalanceCentimes: number;
  openingDate: string;
  notes: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ChequeBook {
  id: string;
  bankAccountId: string;
  startSerial: string; // Conservé en texte avec zéros initiaux, ex: '0012345'
  count: number;
  notes: string;
  createdAt: string;
}

export interface ChequeLeaf {
  id: string;
  chequeBookId: string;
  bankAccountId: string;
  chequeNumber: string; // Texte avec zéros initiaux
  status: ChequeLeafStatus;
  outgoingChequeId?: string;
  createdAt: string;
}

export interface InvoiceLine {
  id: string;
  description: string;
  quantity: number;
  unitPriceCentimes: number;
  discountPercent: number; // 0 à 100
  tvaRate: number; // Ex: 19, 9, 0
  htCentimes: number;
  tvaCentimes: number;
  ttcCentimes: number;
}

export interface CustomerInvoice {
  id: string;
  invoiceNumber: string;
  clientId: string;
  issueDate: string;
  dueDate: string;
  bcNumber: string;
  campaignRef: string;
  currency: string;
  exchangeRate: number; // Taux figé au moment de la facture
  description: string;
  lines: InvoiceLine[];
  totalHtCentimes: number;
  totalTvaCentimes: number;
  totalTtcCentimes: number;
  baseDzdTtcCentimes: number;
  status: StoredInvoiceStatus;
  cancelReason?: string;
  cancelledAt?: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierInvoice {
  id: string;
  invoiceNumber: string;
  supplierRef: string;
  supplierId: string;
  issueDate: string;
  dueDate: string;
  currency: string;
  exchangeRate: number;
  description: string;
  lines: InvoiceLine[];
  totalHtCentimes: number;
  totalTvaCentimes: number;
  totalTtcCentimes: number;
  baseDzdTtcCentimes: number;
  status: StoredInvoiceStatus;
  cancelReason?: string;
  cancelledAt?: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface Payment {
  id: string;
  direction: 'entrant' | 'sortant';
  contactId: string;
  date: string;
  amountCentimes: number;
  currency: string;
  exchangeRate: number;
  baseDzdAmountCentimes: number;
  method: PaymentMethod;
  bankAccountId: string | null; // null = Caisse espèces
  chequeId?: string;
  reference: string;
  notes: string;
  isAdvance: boolean;
  status: 'valide' | 'annule';
  cancelReason?: string;
  cancelledAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentAllocation {
  id: string;
  paymentId: string;
  invoiceType: 'client' | 'fournisseur';
  invoiceId: string;
  amountCentimes: number;
  createdAt: string;
}

export interface ExpenseCategory {
  id: string;
  name: string;
  color: string;
  isDefault: boolean;
  createdAt: string;
}

export interface Expense {
  id: string;
  date: string;
  beneficiary: string;
  contactId?: string;
  categoryId: string;
  categoryName: string;
  description: string;
  amountCentimes: number;
  currency: string;
  exchangeRate: number;
  baseDzdAmountCentimes: number;
  paymentMethod: PaymentMethod;
  bankAccountId: string | null;
  chequeLeafId?: string;
  outgoingChequeId?: string;
  reference: string;
  notes: string;
  status: 'valide' | 'annule';
  cancelReason?: string;
  cancelledAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface IncomingCheque {
  id: string;
  clientId: string;
  issuerBank: string;
  chequeNumber: string; // Texte avec zéros initiaux
  chequeDate: string;
  entryDate: string;
  amountCentimes: number;
  currency: string;
  exchangeRate: number;
  baseDzdAmountCentimes: number;
  targetBankAccountId: string | null;
  depositDate?: string;
  clearingDate?: string;
  status: IncomingChequeStatus;
  linkedPaymentId?: string;
  allocatedInvoiceIds: string[];
  notes: string;
  cancelReason?: string;
  cancelledAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OutgoingCheque {
  id: string;
  bankAccountId: string;
  chequeBookId: string;
  chequeLeafId: string;
  chequeNumber: string;
  beneficiary: string;
  contactId?: string;
  issueDate: string;
  amountCentimes: number;
  currency: string;
  exchangeRate: number;
  baseDzdAmountCentimes: number;
  purpose: string;
  linkedType: 'fournisseur_facture' | 'depense' | 'paiement' | 'autre';
  linkedId?: string;
  clearingDate?: string;
  status: OutgoingChequeStatus;
  notes: string;
  cancelReason?: string;
  cancelledAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type LedgerSourceType =
  | 'paiement_client'
  | 'paiement_fournisseur'
  | 'depense'
  | 'cheque_recu_encaisse'
  | 'cheque_emis_encaisse'
  | 'solde_ouverture';

export interface LedgerEntry {
  id: string;
  date: string;
  direction: 'entree' | 'sortie';
  sourceType: LedgerSourceType;
  sourceId: string;
  bankAccountId: string | null; // null = Caisse espèces
  contactId?: string;
  label: string;
  amountCentimes: number; // Toujours positif, le sens est porté par direction
  currency: string;
  exchangeRate: number;
  baseDzdAmountCentimes: number;
  status: 'valide' | 'annule';
  createdAt: string;
}

export type AuditAction =
  | 'CREATION'
  | 'MODIFICATION'
  | 'ANNULATION'
  | 'ENCAISSEMENT'
  | 'SAUVEGARDE'
  | 'RESTAURATION'
  | 'IMPORT';

export interface AuditLog {
  id: string;
  timestamp: string;
  actor: string;
  action: AuditAction;
  entityType: string;
  entityId: string;
  summary: string;
  beforeJson?: string;
  afterJson?: string;
  reason?: string;
}
