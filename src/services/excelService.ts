import * as XLSX from 'xlsx';
import { createId, db, recordAudit } from '../db/database';
import type {
  CompanySettings,
  Contact,
  CustomerInvoice,
  Expense,
  IncomingCheque,
  IncomingChequeStatus,
  LedgerEntry,
  OutgoingCheque,
  OutgoingChequeStatus,
  PaymentMethod,
  SupplierInvoice,
} from '../db/types';
import { computeInvoiceDocumentTotals } from '../utils/finance';
import { convertToBaseDzd, parseMoneyInputToCentimes } from '../utils/money';

export interface ExcelColumnDef {
  header: string;
  key: string;
  type?: 'text' | 'number' | 'date';
}

export function exportReportToExcel(params: {
  title: string;
  companyName: string;
  filterSummary: string;
  columns: ExcelColumnDef[];
  rows: Array<Record<string, string | number>>;
  totalsRow?: Record<string, string | number>;
  fileName: string;
}): void {
  const aoa: Array<Array<string | number>> = [
    [params.companyName || 'Gestion Financière'],
    [params.title],
    [`Édité le : ${new Date().toLocaleDateString('fr-FR')}${params.filterSummary ? ` · ${params.filterSummary}` : ''}`],
    [],
    params.columns.map((c) => c.header),
  ];

  const dataStartRowIdx = aoa.length;
  for (const row of params.rows) {
    aoa.push(params.columns.map((c) => row[c.key] ?? ''));
  }

  if (params.totalsRow) {
    aoa.push(params.columns.map((c) => params.totalsRow?.[c.key] ?? ''));
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Conserver les colonnes texte (ex : N° Chèque, N° Facture, NIF, Téléphone) au format texte '@'
  const textColIndices = params.columns
    .map((c, idx) => (c.type === 'text' ? idx : -1))
    .filter((idx) => idx >= 0);

  for (let r = dataStartRowIdx; r < aoa.length; r += 1) {
    for (const c of textColIndices) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      if (cell) {
        cell.t = 's';
        cell.v = String(cell.v ?? '');
        cell.z = '@';
      }
    }
  }

  ws['!cols'] = params.columns.map((col, idx) => {
    let maxLen = col.header.length;
    for (let r = dataStartRowIdx; r < aoa.length; r += 1) {
      const val = String(aoa[r][idx] ?? '');
      if (val.length > maxLen) maxLen = val.length;
    }
    return { wch: Math.min(45, Math.max(12, maxLen + 3)) };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Rapport');
  XLSX.writeFile(wb, params.fileName.endsWith('.xlsx') ? params.fileName : `${params.fileName}.xlsx`);
}

// ============================================================================
// IMPORTATION EXCEL (Détection française, mapping manuel, zéros initiaux, doublons)
// ============================================================================

export type ExcelImportType =
  | 'clients'
  | 'fournisseurs'
  | 'factures_clients'
  | 'factures_fournisseurs'
  | 'depenses'
  | 'cheques_recus'
  | 'cheques_emis';

export interface ImportFieldDef {
  key: string;
  label: string;
  required?: boolean;
  aliases: string[];
  isTextProtected?: boolean;
}

export interface ImportSchemaDef {
  type: ExcelImportType;
  label: string;
  description: string;
  templateFileName: string;
  fields: ImportFieldDef[];
  exampleRows: Array<Record<string, string>>;
}

export const IMPORT_SCHEMAS: Record<ExcelImportType, ImportSchemaDef> = {
  clients: {
    type: 'clients',
    label: 'Clients',
    description: 'Importer une liste de clients avec leurs coordonnées et identifiants fiscaux.',
    templateFileName: 'modele-import-clients.xlsx',
    fields: [
      { key: 'company', label: 'Société / Raison sociale', aliases: ['societe', 'entreprise', 'raison sociale', 'client'] },
      { key: 'name', label: 'Nom du contact', required: true, aliases: ['nom', 'contact', 'nom complet', 'responsable'] },
      { key: 'phone', label: 'Téléphone', aliases: ['telephone', 'tel', 'mobile', 'gsm'], isTextProtected: true },
      { key: 'email', label: 'Email', aliases: ['email', 'mail', 'courriel'] },
      { key: 'address', label: 'Adresse', aliases: ['adresse', 'wilaya', 'ville'] },
      { key: 'nif', label: 'NIF', aliases: ['nif'], isTextProtected: true },
      { key: 'nis', label: 'NIS', aliases: ['nis'], isTextProtected: true },
      { key: 'rc', label: 'RC', aliases: ['rc', 'registre de commerce'], isTextProtected: true },
      { key: 'ai', label: 'AI', aliases: ['ai', 'article imposition'], isTextProtected: true },
      { key: 'notes', label: 'Notes', aliases: ['notes', 'observations', 'remarque'] },
    ],
    exampleRows: [
      {
        company: 'SARL Atlas Construction',
        name: 'Amine Ziani',
        phone: '0550112233',
        email: 'contact@atlas-const.example',
        address: 'Dar El Beïda, Alger',
        nif: '002216099887766',
        nis: '002216099887700',
        rc: '16/00-0998877B22',
        ai: '16240998877',
        notes: 'Client B2B',
      },
    ],
  },
  fournisseurs: {
    type: 'fournisseurs',
    label: 'Fournisseurs',
    description: 'Importer une liste de fournisseurs et prestataires.',
    templateFileName: 'modele-import-fournisseurs.xlsx',
    fields: [
      { key: 'company', label: 'Société / Raison sociale', aliases: ['societe', 'entreprise', 'raison sociale', 'fournisseur'] },
      { key: 'name', label: 'Nom du contact', required: true, aliases: ['nom', 'contact', 'nom complet'] },
      { key: 'phone', label: 'Téléphone', aliases: ['telephone', 'tel', 'mobile'], isTextProtected: true },
      { key: 'email', label: 'Email', aliases: ['email', 'mail'] },
      { key: 'address', label: 'Adresse', aliases: ['adresse', 'ville', 'wilaya'] },
      { key: 'nif', label: 'NIF', aliases: ['nif'], isTextProtected: true },
      { key: 'nis', label: 'NIS', aliases: ['nis'], isTextProtected: true },
      { key: 'rc', label: 'RC', aliases: ['rc'], isTextProtected: true },
      { key: 'ai', label: 'AI', aliases: ['ai'], isTextProtected: true },
      { key: 'notes', label: 'Notes', aliases: ['notes', 'observations'] },
    ],
    exampleRows: [
      {
        company: 'EURL Équipements Pro',
        name: 'Rachid Toumi',
        phone: '0661778899',
        email: 'achats@equipements-pro.example',
        address: 'Zone Industrielle Rouïba, Alger',
        nif: '001916044556677',
        nis: '001916044556600',
        rc: '16/00-0445566B19',
        ai: '16240445566',
        notes: 'Matériel industriel',
      },
    ],
  },
  factures_clients: {
    type: 'factures_clients',
    label: 'Factures clients',
    description: 'Importer des factures clients (N° Facture, N° BC, Campagne, HT, TVA, TTC).',
    templateFileName: 'modele-import-factures-clients.xlsx',
    fields: [
      { key: 'invoiceNumber', label: 'N° Facture', required: true, aliases: ['n° facture', 'numero facture', 'n facture', 'facture', 'ref facture'], isTextProtected: true },
      { key: 'clientName', label: 'Client', required: true, aliases: ['client', 'nom client', 'societe', 'tiers'] },
      { key: 'issueDate', label: 'Date', required: true, aliases: ['date', 'date facture', 'date emission'] },
      { key: 'dueDate', label: 'Date d’échéance', aliases: ['echeance', 'date echeance', 'date d echeance'] },
      { key: 'bcNumber', label: 'N° BC', aliases: ['n° bc', 'n bc', 'numero bc', 'bc', 'bon de commande'], isTextProtected: true },
      { key: 'campaignRef', label: 'Campagne / Réf.', aliases: ['campagne', 'reference', 'ref', 'projet'] },
      { key: 'description', label: 'Description', aliases: ['description', 'libelle', 'objet', 'designation'] },
      { key: 'htAmount', label: 'Montant HT', required: true, aliases: ['montant ht', 'ht', 'total ht', 'net ht'] },
      { key: 'tvaRate', label: 'Taux TVA (%)', aliases: ['taux tva', 'tva %', 'pourcentage tva'] },
      { key: 'tvaAmount', label: 'Montant TVA', aliases: ['tva', 'montant tva', 'total tva'] },
      { key: 'ttcAmount', label: 'Montant TTC', aliases: ['ttc', 'montant ttc', 'total ttc'] },
      { key: 'currency', label: 'Devise', aliases: ['devise', 'monnaie'] },
      { key: 'exchangeRate', label: 'Taux de change', aliases: ['taux de change', 'taux', 'cours'] },
      { key: 'notes', label: 'Notes', aliases: ['notes', 'remarque'] },
    ],
    exampleRows: [
      {
        invoiceNumber: 'FAC-2026-0101',
        clientName: 'SARL Atlas Construction',
        issueDate: '2026-11-01',
        dueDate: '2026-12-01',
        bcNumber: 'BC-104/26',
        campaignRef: 'Campagne Automne',
        description: 'Prestation maintenance annuelle',
        htAmount: '100000,00',
        tvaRate: '19',
        tvaAmount: '19000,00',
        ttcAmount: '119000,00',
        currency: 'DZD',
        exchangeRate: '1',
        notes: 'Import initial',
      },
    ],
  },
  factures_fournisseurs: {
    type: 'factures_fournisseurs',
    label: 'Factures fournisseurs',
    description: 'Importer des factures fournisseurs avec référence fournisseur et TVA.',
    templateFileName: 'modele-import-factures-fournisseurs.xlsx',
    fields: [
      { key: 'invoiceNumber', label: 'N° Facture interne', required: true, aliases: ['n° facture', 'numero facture', 'n facture', 'facture'], isTextProtected: true },
      { key: 'supplierRef', label: 'Référence fournisseur', aliases: ['reference fournisseur', 'ref fournisseur', 'n facture fournisseur'], isTextProtected: true },
      { key: 'supplierName', label: 'Fournisseur', required: true, aliases: ['fournisseur', 'nom fournisseur', 'societe'] },
      { key: 'issueDate', label: 'Date', required: true, aliases: ['date', 'date facture'] },
      { key: 'dueDate', label: 'Date d’échéance', aliases: ['echeance', 'date echeance'] },
      { key: 'description', label: 'Description', aliases: ['description', 'libelle', 'objet'] },
      { key: 'htAmount', label: 'Montant HT', required: true, aliases: ['montant ht', 'ht', 'total ht'] },
      { key: 'tvaRate', label: 'Taux TVA (%)', aliases: ['taux tva', 'tva %'] },
      { key: 'tvaAmount', label: 'Montant TVA', aliases: ['tva', 'montant tva'] },
      { key: 'ttcAmount', label: 'Montant TTC', aliases: ['ttc', 'montant ttc'] },
      { key: 'currency', label: 'Devise', aliases: ['devise'] },
      { key: 'exchangeRate', label: 'Taux de change', aliases: ['taux de change', 'taux'] },
      { key: 'notes', label: 'Notes', aliases: ['notes'] },
    ],
    exampleRows: [
      {
        invoiceNumber: 'FF-2026-0101',
        supplierRef: 'F-785/26',
        supplierName: 'EURL Équipements Pro',
        issueDate: '2026-11-02',
        dueDate: '2026-12-02',
        description: 'Achat outillage',
        htAmount: '50000,00',
        tvaRate: '19',
        tvaAmount: '9500,00',
        ttcAmount: '59500,00',
        currency: 'DZD',
        exchangeRate: '1',
        notes: '',
      },
    ],
  },
  depenses: {
    type: 'depenses',
    label: 'Dépenses',
    description: 'Importer des dépenses (en espèces, virement ou carte — ou liées à un chèque).',
    templateFileName: 'modele-import-depenses.xlsx',
    fields: [
      { key: 'date', label: 'Date', required: true, aliases: ['date', 'date depense'] },
      { key: 'beneficiary', label: 'Bénéficiaire', required: true, aliases: ['beneficiaire', 'paye a', 'fournisseur', 'tiers'] },
      { key: 'category', label: 'Catégorie', aliases: ['categorie', 'poste', 'nature'] },
      { key: 'description', label: 'Description', required: true, aliases: ['description', 'libelle', 'motif', 'objet'] },
      { key: 'amount', label: 'Montant', required: true, aliases: ['montant', 'ttc', 'somme'] },
      { key: 'currency', label: 'Devise', aliases: ['devise'] },
      { key: 'exchangeRate', label: 'Taux de change', aliases: ['taux de change', 'taux'] },
      { key: 'paymentMethod', label: 'Mode de paiement', aliases: ['mode de paiement', 'mode', 'paiement', 'reglement'] },
      { key: 'bankName', label: 'Banque', aliases: ['banque', 'compte bancaire', 'compte'] },
      { key: 'reference', label: 'Référence', aliases: ['reference', 'ref', 'n piece'], isTextProtected: true },
      { key: 'notes', label: 'Notes', aliases: ['notes'] },
    ],
    exampleRows: [
      {
        date: '2026-11-04',
        beneficiary: 'Algérie Télécom',
        category: 'Internet & téléphone',
        description: 'Abonnement fibre optique bureau',
        amount: '4500,00',
        currency: 'DZD',
        exchangeRate: '1',
        paymentMethod: 'especes',
        bankName: '',
        reference: 'FAC-AT-441',
        notes: '',
      },
    ],
  },
  cheques_recus: {
    type: 'cheques_recus',
    label: 'Chèques reçus',
    description: 'Importer des chèques reçus des clients (numéro conservé en texte avec zéros initiaux).',
    templateFileName: 'modele-import-cheques-recus.xlsx',
    fields: [
      { key: 'clientName', label: 'Client', required: true, aliases: ['client', 'nom client', 'emetteur'] },
      { key: 'issuerBank', label: 'Banque émettrice', required: true, aliases: ['banque', 'banque emettrice'] },
      { key: 'chequeNumber', label: 'N° Chèque', required: true, aliases: ['n° cheque', 'n cheque', 'numero cheque', 'cheque'], isTextProtected: true },
      { key: 'entryDate', label: 'Date d’entrée', required: true, aliases: ['date entree', 'date d entree', 'date reception', 'date'] },
      { key: 'chequeDate', label: 'Date du chèque', aliases: ['date cheque', 'date du cheque'] },
      { key: 'amount', label: 'Montant', required: true, aliases: ['montant', 'somme'] },
      { key: 'currency', label: 'Devise', aliases: ['devise'] },
      { key: 'exchangeRate', label: 'Taux de change', aliases: ['taux de change', 'taux'] },
      { key: 'invoiceNumber', label: 'N° Facture payée', aliases: ['n° facture', 'facture', 'facture payee'], isTextProtected: true },
      { key: 'status', label: 'Statut', aliases: ['statut', 'etat'] },
      { key: 'notes', label: 'Notes', aliases: ['notes'] },
    ],
    exampleRows: [
      {
        clientName: 'SARL Atlas Construction',
        issuerBank: 'BEA',
        chequeNumber: '0045123',
        entryDate: '2026-11-06',
        chequeDate: '2026-11-05',
        amount: '119000,00',
        currency: 'DZD',
        exchangeRate: '1',
        invoiceNumber: 'FAC-2026-0101',
        status: 'recu',
        notes: '',
      },
    ],
  },
  cheques_emis: {
    type: 'cheques_emis',
    label: 'Chèques émis',
    description: 'Importer des chèques émis (banque, numéro texte avec zéros, bénéficiaire, date de sortie, objet).',
    templateFileName: 'modele-import-cheques-emis.xlsx',
    fields: [
      { key: 'bankName', label: 'Banque', required: true, aliases: ['banque', 'compte bancaire', 'compte'] },
      { key: 'chequeNumber', label: 'N° Chèque', required: true, aliases: ['n° cheque', 'n cheque', 'numero cheque', 'cheque'], isTextProtected: true },
      { key: 'beneficiary', label: 'Bénéficiaire', required: true, aliases: ['beneficiaire', 'destinataire', 'ordre de'] },
      { key: 'issueDate', label: 'Date de sortie', required: true, aliases: ['date sortie', 'date de sortie', 'date emission', 'date'] },
      { key: 'amount', label: 'Montant', required: true, aliases: ['montant', 'somme'] },
      { key: 'currency', label: 'Devise', aliases: ['devise'] },
      { key: 'exchangeRate', label: 'Taux de change', aliases: ['taux de change', 'taux'] },
      { key: 'purpose', label: 'Objet / Motif', required: true, aliases: ['objet', 'motif', 'pour', 'description'] },
      { key: 'status', label: 'Statut', aliases: ['statut', 'etat'] },
      { key: 'notes', label: 'Notes', aliases: ['notes'] },
    ],
    exampleRows: [
      {
        bankName: 'BNA',
        chequeNumber: '0012399',
        beneficiary: 'EURL Équipements Pro',
        issueDate: '2026-11-08',
        amount: '59500,00',
        currency: 'DZD',
        exchangeRate: '1',
        purpose: 'Règlement outillage atelier',
        status: 'remis',
        notes: '',
      },
    ],
  },
};

export function downloadExcelImportTemplate(type: ExcelImportType): void {
  const schema = IMPORT_SCHEMAS[type];
  const headers = schema.fields.map((f) => f.label);
  const aoa: string[][] = [
    headers,
    ...schema.exampleRows.map((row) => schema.fields.map((f) => row[f.key] ?? '')),
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Forcer format texte '@' sur les colonnes à zéros initiaux (N° chèque, téléphone, NIF...)
  const protectedCols = schema.fields
    .map((f, idx) => (f.isTextProtected ? idx : -1))
    .filter((i) => i >= 0);

  for (let r = 1; r <= schema.exampleRows.length + 25; r += 1) {
    for (const c of protectedCols) {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (!ws[addr]) {
        ws[addr] = { t: 's', v: '', z: '@' };
      } else {
        ws[addr].t = 's';
        ws[addr].v = String(ws[addr].v ?? '');
        ws[addr].z = '@';
      }
    }
  }

  ws['!cols'] = headers.map((h) => ({ wch: Math.max(16, h.length + 5) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, schema.label.slice(0, 31));
  XLSX.writeFile(wb, schema.templateFileName);
}

export function normalizeHeaderText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[°'’`_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function autoDetectColumnMapping(
  type: ExcelImportType,
  headers: string[]
): Record<string, string> {
  const schema = IMPORT_SCHEMAS[type];
  const mapping: Record<string, string> = {};
  const normalizedHeaders = headers.map((h) => ({
    raw: h,
    norm: normalizeHeaderText(h),
  }));

  for (const field of schema.fields) {
    const labelNorm = normalizeHeaderText(field.label);
    const aliasNorms = [labelNorm, ...field.aliases.map(normalizeHeaderText)];

    const exact = normalizedHeaders.find((h) => aliasNorms.includes(h.norm));
    if (exact) {
      mapping[field.key] = exact.raw;
      continue;
    }

    const partial = normalizedHeaders.find((h) =>
      aliasNorms.some((a) => h.norm.includes(a) || a.includes(h.norm))
    );
    if (partial) {
      mapping[field.key] = partial.raw;
    }
  }

  return mapping;
}

export function normalizeImportedDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  // ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return s;
  }

  // FR DD/MM/YYYY or DD-MM-YYYY
  const fr = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (fr) {
    const day = fr[1].padStart(2, '0');
    const month = fr[2].padStart(2, '0');
    const year = fr[3];
    const dNum = Number(day);
    const mNum = Number(month);
    if (mNum >= 1 && mNum <= 12 && dNum >= 1 && dNum <= 31) {
      return `${year}-${month}-${day}`;
    }
  }

  // Numéro de série Excel (jours depuis 1899-12-30)
  if (/^\d{5}$/.test(s)) {
    const serial = Number(s);
    if (serial > 20000 && serial < 80000) {
      const utc = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
      if (!Number.isNaN(utc.getTime())) {
        return utc.toISOString().slice(0, 10);
      }
    }
  }

  return null;
}

export function normalizeChequeNumberValue(raw: string): string {
  return raw.trim();
}

export interface ParsedExcelSheet {
  headers: string[];
  rows: Array<Record<string, string>>;
  sheetName: string;
}

export async function parseExcelBuffer(buffer: ArrayBuffer): Promise<ParsedExcelSheet> {
  const wb = XLSX.read(buffer, { type: 'array', raw: false, cellText: true, cellNF: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    throw new Error('Le fichier Excel ne contient aucune feuille.');
  }
  const sheet = wb.Sheets[sheetName];
  const ref = sheet['!ref'];
  if (!ref) {
    throw new Error('La feuille Excel est vide.');
  }

  const range = XLSX.utils.decode_range(ref);
  const headers: string[] = [];
  for (let c = range.s.c; c <= range.e.c; c += 1) {
    const addr = XLSX.utils.encode_cell({ r: range.s.r, c });
    const cell = sheet[addr];
    const h = cell ? String(cell.w ?? cell.v ?? '').trim() : '';
    headers.push(h || `Colonne ${c + 1}`);
  }

  const rows: Array<Record<string, string>> = [];
  for (let r = range.s.r + 1; r <= range.e.r; r += 1) {
    const rowObj: Record<string, string> = {};
    let hasValue = false;
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const header = headers[c - range.s.c];
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[addr];
      // cell.w préserve le texte affiché exact (ex: zéros initiaux "0012345")
      const val = cell ? String(cell.w ?? cell.v ?? '').trim() : '';
      if (val) hasValue = true;
      rowObj[header] = val;
    }
    if (hasValue) rows.push(rowObj);
  }

  if (rows.length === 0) {
    throw new Error('Aucune ligne de données trouvée sous la ligne d’en-tête.');
  }

  return { headers, rows, sheetName };
}

export interface ValidatedImportRow {
  rowIndex: number; // Ligne Excel 1-indexed (2 = première ligne sous en-tête)
  status: 'valide' | 'doublon' | 'erreur';
  message: string;
  raw: Record<string, string>;
  mapped: Record<string, string>;
}

export interface ValidationContext {
  contacts: Contact[];
  customerInvoices: CustomerInvoice[];
  supplierInvoices: SupplierInvoice[];
  expenses: Expense[];
  incomingCheques: IncomingCheque[];
  outgoingCheques: OutgoingCheque[];
  chequeLeafKeys: Set<string>; // `${bankAccountId}::${chequeNumber}`
  bankAccounts: Array<{ id: string; bankName: string; accountName: string }>;
  defaultTvaRate: number;
  defaultCurrency: string;
}

export function validateImportRows(params: {
  type: ExcelImportType;
  rows: Array<Record<string, string>>;
  mapping: Record<string, string>;
  ctx: ValidationContext;
}): ValidatedImportRow[] {
  const { type, rows, mapping, ctx } = params;
  const schema = IMPORT_SCHEMAS[type];

  const getMapped = (raw: Record<string, string>): Record<string, string> => {
    const res: Record<string, string> = {};
    for (const f of schema.fields) {
      const col = mapping[f.key];
      res[f.key] = col ? String(raw[col] ?? '').trim() : '';
    }
    return res;
  };

  // Ensembles de déduplication (base existante + lignes déjà vues dans le fichier)
  const existingContacts = new Set(
    ctx.contacts.map((c) => normalizeHeaderText(`${c.company}|${c.name}`))
  );
  const existingClientInvNums = new Set(
    ctx.customerInvoices.map((i) => i.invoiceNumber.trim().toLowerCase())
  );
  const existingSupplierInvNums = new Set(
    ctx.supplierInvoices.map((i) => i.invoiceNumber.trim().toLowerCase())
  );
  const existingExpenseKeys = new Set(
    ctx.expenses
      .filter((e) => e.status === 'valide')
      .map((e) => `${e.date}|${normalizeHeaderText(e.beneficiary)}|${e.amountCentimes}|${normalizeHeaderText(e.description)}`)
  );
  const existingIncomingChequeKeys = new Set(
    ctx.incomingCheques.map(
      (c) => `${normalizeHeaderText(c.issuerBank)}|${c.chequeNumber.trim()}`
    )
  );
  const existingOutgoingChequeKeys = new Set<string>([
    ...ctx.chequeLeafKeys,
    ...ctx.outgoingCheques.map((c) => `${c.bankAccountId}::${c.chequeNumber.trim()}`),
  ]);

  const seenBatch = new Set<string>();
  const results: ValidatedImportRow[] = [];

  rows.forEach((raw, idx) => {
    const rowIndex = idx + 2;
    const m = getMapped(raw);

    // 1. Champs obligatoires
    const missing = schema.fields
      .filter((f) => f.required && !m[f.key])
      .map((f) => f.label);
    if (missing.length > 0) {
      results.push({
        rowIndex,
        status: 'erreur',
        message: `Champ(s) obligatoire(s) manquant(s) : ${missing.join(', ')}.`,
        raw,
        mapped: m,
      });
      return;
    }

    if (type === 'clients' || type === 'fournisseurs') {
      const key = normalizeHeaderText(`${m.company}|${m.name}`);
      if (existingContacts.has(key) || seenBatch.has(key)) {
        results.push({
          rowIndex,
          status: 'doublon',
          message: `Contact déjà existant (${m.company || m.name}).`,
          raw,
          mapped: m,
        });
        return;
      }
      seenBatch.add(key);
      results.push({ rowIndex, status: 'valide', message: 'Prêt à importer', raw, mapped: m });
      return;
    }

    if (type === 'factures_clients' || type === 'factures_fournisseurs') {
      const dateIso = normalizeImportedDate(m.issueDate);
      if (!dateIso) {
        results.push({
          rowIndex,
          status: 'erreur',
          message: `Date invalide (« ${m.issueDate} »). Utilisez AAAA-MM-JJ ou JJ/MM/AAAA.`,
          raw,
          mapped: m,
        });
        return;
      }
      if (m.dueDate && !normalizeImportedDate(m.dueDate)) {
        results.push({
          rowIndex,
          status: 'erreur',
          message: `Date d’échéance invalide (« ${m.dueDate} »).`,
          raw,
          mapped: m,
        });
        return;
      }
      const ht = parseMoneyInputToCentimes(m.htAmount);
      if (Number.isNaN(ht) || ht <= 0) {
        results.push({
          rowIndex,
          status: 'erreur',
          message: `Montant HT invalide (« ${m.htAmount} »).`,
          raw,
          mapped: m,
        });
        return;
      }

      const numKey = m.invoiceNumber.trim().toLowerCase();
      const targetSet = type === 'factures_clients' ? existingClientInvNums : existingSupplierInvNums;
      if (targetSet.has(numKey) || seenBatch.has(numKey)) {
        results.push({
          rowIndex,
          status: 'doublon',
          message: `Numéro de facture déjà existant (${m.invoiceNumber}).`,
          raw,
          mapped: m,
        });
        return;
      }
      seenBatch.add(numKey);
      results.push({ rowIndex, status: 'valide', message: 'Prêt à importer', raw, mapped: m });
      return;
    }

    if (type === 'depenses') {
      const dateIso = normalizeImportedDate(m.date);
      if (!dateIso) {
        results.push({
          rowIndex,
          status: 'erreur',
          message: `Date invalide (« ${m.date} »).`,
          raw,
          mapped: m,
        });
        return;
      }
      const amt = parseMoneyInputToCentimes(m.amount);
      if (Number.isNaN(amt) || amt <= 0) {
        results.push({
          rowIndex,
          status: 'erreur',
          message: `Montant invalide (« ${m.amount} »).`,
          raw,
          mapped: m,
        });
        return;
      }
      const key = `${dateIso}|${normalizeHeaderText(m.beneficiary)}|${amt}|${normalizeHeaderText(m.description)}`;
      if (existingExpenseKeys.has(key) || seenBatch.has(key)) {
        results.push({
          rowIndex,
          status: 'doublon',
          message: 'Dépense identique déjà enregistrée.',
          raw,
          mapped: m,
        });
        return;
      }
      seenBatch.add(key);
      results.push({ rowIndex, status: 'valide', message: 'Prêt à importer', raw, mapped: m });
      return;
    }

    if (type === 'cheques_recus') {
      const entryIso = normalizeImportedDate(m.entryDate);
      if (!entryIso) {
        results.push({
          rowIndex,
          status: 'erreur',
          message: `Date d’entrée invalide (« ${m.entryDate} »).`,
          raw,
          mapped: m,
        });
        return;
      }
      const chqIso = m.chequeDate ? normalizeImportedDate(m.chequeDate) : entryIso;
      if (!chqIso) {
        results.push({
          rowIndex,
          status: 'erreur',
          message: `Date du chèque invalide (« ${m.chequeDate} »).`,
          raw,
          mapped: m,
        });
        return;
      }
      const amt = parseMoneyInputToCentimes(m.amount);
      if (Number.isNaN(amt) || amt <= 0) {
        results.push({
          rowIndex,
          status: 'erreur',
          message: `Montant invalide (« ${m.amount} »).`,
          raw,
          mapped: m,
        });
        return;
      }
      const chqNum = normalizeChequeNumberValue(m.chequeNumber);
      const key = `${normalizeHeaderText(m.issuerBank)}|${chqNum}`;
      if (existingIncomingChequeKeys.has(key) || seenBatch.has(key)) {
        results.push({
          rowIndex,
          status: 'doublon',
          message: `Chèque reçu N° ${chqNum} (${m.issuerBank}) déjà enregistré.`,
          raw,
          mapped: m,
        });
        return;
      }
      seenBatch.add(key);
      results.push({ rowIndex, status: 'valide', message: 'Prêt à importer', raw, mapped: m });
      return;
    }

    if (type === 'cheques_emis') {
      const issueIso = normalizeImportedDate(m.issueDate);
      if (!issueIso) {
        results.push({
          rowIndex,
          status: 'erreur',
          message: `Date de sortie invalide (« ${m.issueDate} »).`,
          raw,
          mapped: m,
        });
        return;
      }
      const amt = parseMoneyInputToCentimes(m.amount);
      if (Number.isNaN(amt) || amt <= 0) {
        results.push({
          rowIndex,
          status: 'erreur',
          message: `Montant invalide (« ${m.amount} »).`,
          raw,
          mapped: m,
        });
        return;
      }
      const bankNorm = normalizeHeaderText(m.bankName);
      const matchedBank = ctx.bankAccounts.find(
        (b) =>
          normalizeHeaderText(b.bankName) === bankNorm ||
          normalizeHeaderText(b.accountName) === bankNorm ||
          normalizeHeaderText(`${b.bankName} ${b.accountName}`).includes(bankNorm)
      );
      if (!matchedBank) {
        results.push({
          rowIndex,
          status: 'erreur',
          message: `Banque introuvable (« ${m.bankName} »). Créez d’abord ce compte dans Banques & comptes.`,
          raw,
          mapped: m,
        });
        return;
      }

      const chqNum = normalizeChequeNumberValue(m.chequeNumber);
      const dupKey = `${matchedBank.id}::${chqNum}`;
      if (existingOutgoingChequeKeys.has(dupKey) || seenBatch.has(dupKey)) {
        results.push({
          rowIndex,
          status: 'doublon',
          message: `N° de chèque ${chqNum} déjà existant ou réservé sur ${matchedBank.bankName} (jamais réutilisable).`,
          raw,
          mapped: m,
        });
        return;
      }
      seenBatch.add(dupKey);
      results.push({ rowIndex, status: 'valide', message: 'Prêt à importer', raw, mapped: m });
    }
  });

  return results;
}

export function downloadImportErrorsExcel(rows: ValidatedImportRow[], type: ExcelImportType): void {
  const schema = IMPORT_SCHEMAS[type];
  const problemRows = rows.filter((r) => r.status !== 'valide');
  const headers = ['Ligne Excel', 'Statut', 'Motif / Erreur', ...schema.fields.map((f) => f.label)];
  const aoa: Array<Array<string | number>> = [
    headers,
    ...problemRows.map((r) => [
      r.rowIndex,
      r.status === 'doublon' ? 'Doublon' : 'Erreur',
      r.message,
      ...schema.fields.map((f) => r.mapped[f.key] ?? ''),
    ]),
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = headers.map((h) => ({ wch: Math.max(15, h.length + 4) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Erreurs import');
  XLSX.writeFile(wb, `erreurs-import-${type}.xlsx`);
}

function parsePaymentMethod(raw: string): PaymentMethod {
  const n = normalizeHeaderText(raw);
  if (n.includes('cheque')) return 'cheque';
  if (n.includes('virement')) return 'virement';
  if (n.includes('carte')) return 'carte';
  return 'especes';
}

function parseIncomingStatus(raw: string): IncomingChequeStatus {
  const n = normalizeHeaderText(raw);
  if (n.includes('encaisse')) return 'encaisse';
  if (n.includes('depose')) return 'depose';
  if (n.includes('attente')) return 'en_attente';
  if (n.includes('rejet')) return 'rejete';
  if (n.includes('annul')) return 'annule';
  return 'recu';
}

function parseOutgoingStatus(raw: string): OutgoingChequeStatus {
  const n = normalizeHeaderText(raw);
  if (n.includes('encaisse')) return 'encaisse';
  if (n.includes('depose')) return 'depose';
  if (n.includes('attente')) return 'en_attente';
  if (n.includes('prepare')) return 'prepare';
  if (n.includes('rejet')) return 'rejete';
  if (n.includes('annul')) return 'annule';
  return 'remis';
}

export async function executeValidatedImport(params: {
  type: ExcelImportType;
  validRows: ValidatedImportRow[];
  settings: CompanySettings;
}): Promise<{ importedCount: number }> {
  const { type, validRows, settings } = params;
  if (validRows.length === 0) {
    throw new Error('Aucune ligne valide à importer.');
  }

  const now = new Date().toISOString();

  await db.transaction(
    'rw',
    [
      db.contacts,
      db.customerInvoices,
      db.supplierInvoices,
      db.expenses,
      db.expenseCategories,
      db.incomingCheques,
      db.outgoingCheques,
      db.bankAccounts,
      db.ledgerEntries,
    ],
    async () => {
      const contacts = await db.contacts.toArray();
      const bankAccounts = await db.bankAccounts.toArray();
      const categories = await db.expenseCategories.toArray();
      const customerInvoices = await db.customerInvoices.toArray();

      const findOrCreateContact = async (
        label: string,
        role: 'client' | 'fournisseur'
      ): Promise<string> => {
        const norm = normalizeHeaderText(label);
        const found = contacts.find(
          (c) =>
            normalizeHeaderText(c.company) === norm ||
            normalizeHeaderText(c.name) === norm
        );
        if (found) return found.id;

        const created: Contact = {
          id: createId('cnt'),
          type: role,
          name: label.trim(),
          company: label.trim(),
          address: '',
          phone: '',
          email: '',
          nif: '',
          nis: '',
          rc: '',
          ai: '',
          notes: 'Créé automatiquement lors d’un import Excel',
          archived: false,
          createdAt: now,
          updatedAt: now,
        };
        await db.contacts.put(created);
        contacts.push(created);
        return created.id;
      };

      const findBank = (rawName: string): string | null => {
        if (!rawName.trim()) return null;
        const norm = normalizeHeaderText(rawName);
        const b = bankAccounts.find(
          (x) =>
            normalizeHeaderText(x.bankName) === norm ||
            normalizeHeaderText(x.accountName) === norm ||
            normalizeHeaderText(`${x.bankName} ${x.accountName}`).includes(norm)
        );
        return b ? b.id : null;
      };

      if (type === 'clients' || type === 'fournisseurs') {
        const records: Contact[] = validRows.map((r) => ({
          id: createId('cnt'),
          type: type === 'clients' ? 'client' : 'fournisseur',
          name: r.mapped.name,
          company: r.mapped.company,
          address: r.mapped.address,
          phone: r.mapped.phone,
          email: r.mapped.email,
          nif: r.mapped.nif,
          nis: r.mapped.nis,
          rc: r.mapped.rc,
          ai: r.mapped.ai,
          notes: r.mapped.notes,
          archived: false,
          createdAt: now,
          updatedAt: now,
        }));
        await db.contacts.bulkPut(records);
      } else if (type === 'factures_clients') {
        const invs: CustomerInvoice[] = [];
        for (const r of validRows) {
          const m = r.mapped;
          const clientId = await findOrCreateContact(m.clientName, 'client');
          const issueDate = normalizeImportedDate(m.issueDate)!;
          const dueDate = m.dueDate ? normalizeImportedDate(m.dueDate) || issueDate : issueDate;
          const ht = parseMoneyInputToCentimes(m.htAmount);
          const tvaRateRaw = m.tvaRate ? Number(m.tvaRate.replace(',', '.')) : settings.defaultTvaRate;
          const tvaRate = Number.isFinite(tvaRateRaw) ? tvaRateRaw : settings.defaultTvaRate;
          const calc = computeInvoiceDocumentTotals([
            {
              id: createId('line'),
              description: m.description || `Facture ${m.invoiceNumber}`,
              quantity: 1,
              unitPriceCentimes: ht,
              discountPercent: 0,
              tvaRate,
            },
          ]);
          const currency = (m.currency || settings.defaultCurrency || 'DZD').toUpperCase();
          const exRateRaw = m.exchangeRate ? Number(m.exchangeRate.replace(',', '.')) : 1;
          const exchangeRate = currency === 'DZD' ? 1 : Math.max(0.0001, exRateRaw || 1);

          invs.push({
            id: createId('cinv'),
            invoiceNumber: m.invoiceNumber,
            clientId,
            issueDate,
            dueDate,
            bcNumber: m.bcNumber,
            campaignRef: m.campaignRef,
            currency,
            exchangeRate,
            description: m.description || `Import Excel (${m.invoiceNumber})`,
            lines: calc.lines,
            totalHtCentimes: calc.totalHtCentimes,
            totalTvaCentimes: calc.totalTvaCentimes,
            totalTtcCentimes: calc.totalTtcCentimes,
            baseDzdTtcCentimes: convertToBaseDzd(calc.totalTtcCentimes, exchangeRate),
            status: 'impayee',
            notes: m.notes,
            createdAt: now,
            updatedAt: now,
          });
        }
        await db.customerInvoices.bulkPut(invs);
      } else if (type === 'factures_fournisseurs') {
        const invs: SupplierInvoice[] = [];
        for (const r of validRows) {
          const m = r.mapped;
          const supplierId = await findOrCreateContact(m.supplierName, 'fournisseur');
          const issueDate = normalizeImportedDate(m.issueDate)!;
          const dueDate = m.dueDate ? normalizeImportedDate(m.dueDate) || issueDate : issueDate;
          const ht = parseMoneyInputToCentimes(m.htAmount);
          const tvaRateRaw = m.tvaRate ? Number(m.tvaRate.replace(',', '.')) : settings.defaultTvaRate;
          const tvaRate = Number.isFinite(tvaRateRaw) ? tvaRateRaw : settings.defaultTvaRate;
          const calc = computeInvoiceDocumentTotals([
            {
              id: createId('line'),
              description: m.description || `Facture ${m.invoiceNumber}`,
              quantity: 1,
              unitPriceCentimes: ht,
              discountPercent: 0,
              tvaRate,
            },
          ]);
          const currency = (m.currency || settings.defaultCurrency || 'DZD').toUpperCase();
          const exRateRaw = m.exchangeRate ? Number(m.exchangeRate.replace(',', '.')) : 1;
          const exchangeRate = currency === 'DZD' ? 1 : Math.max(0.0001, exRateRaw || 1);

          invs.push({
            id: createId('sinv'),
            invoiceNumber: m.invoiceNumber,
            supplierRef: m.supplierRef,
            supplierId,
            issueDate,
            dueDate,
            currency,
            exchangeRate,
            description: m.description || `Import Excel (${m.invoiceNumber})`,
            lines: calc.lines,
            totalHtCentimes: calc.totalHtCentimes,
            totalTvaCentimes: calc.totalTvaCentimes,
            totalTtcCentimes: calc.totalTtcCentimes,
            baseDzdTtcCentimes: convertToBaseDzd(calc.totalTtcCentimes, exchangeRate),
            status: 'impayee',
            notes: m.notes,
            createdAt: now,
            updatedAt: now,
          });
        }
        await db.supplierInvoices.bulkPut(invs);
      } else if (type === 'depenses') {
        const expRecords: Expense[] = [];
        const ledRecords: LedgerEntry[] = [];

        for (const r of validRows) {
          const m = r.mapped;
          const dateIso = normalizeImportedDate(m.date)!;
          const amt = parseMoneyInputToCentimes(m.amount);
          const currency = (m.currency || settings.defaultCurrency || 'DZD').toUpperCase();
          const exRateRaw = m.exchangeRate ? Number(m.exchangeRate.replace(',', '.')) : 1;
          const exchangeRate = currency === 'DZD' ? 1 : Math.max(0.0001, exRateRaw || 1);
          const baseDzd = convertToBaseDzd(amt, exchangeRate);
          const method = parsePaymentMethod(m.paymentMethod);
          const bankId = method === 'especes' ? null : findBank(m.bankName);

          const catName = m.category || 'Autres charges';
          const catNorm = normalizeHeaderText(catName);
          let cat = categories.find((c) => normalizeHeaderText(c.name) === catNorm);
          if (!cat) {
            cat = {
              id: createId('cat'),
              name: catName,
              color: '#475569',
              isDefault: false,
              createdAt: now,
            };
            await db.expenseCategories.put(cat);
            categories.push(cat);
          }

          const expId = createId('exp');
          expRecords.push({
            id: expId,
            date: dateIso,
            beneficiary: m.beneficiary,
            categoryId: cat.id,
            categoryName: cat.name,
            description: m.description,
            amountCentimes: amt,
            currency,
            exchangeRate,
            baseDzdAmountCentimes: baseDzd,
            paymentMethod: method,
            bankAccountId: bankId,
            reference: m.reference,
            notes: m.notes,
            status: 'valide',
            createdAt: now,
            updatedAt: now,
          });

          // Règle anti-doublon : une dépense par chèque n'écrit pas au grand livre immédiatement
          if (method !== 'cheque') {
            ledRecords.push({
              id: createId('led'),
              date: dateIso,
              direction: 'sortie',
              sourceType: 'depense',
              sourceId: expId,
              bankAccountId: bankId,
              label: `Dépense — ${m.beneficiary} : ${m.description}`,
              amountCentimes: amt,
              currency,
              exchangeRate,
              baseDzdAmountCentimes: baseDzd,
              status: 'valide',
              createdAt: now,
            });
          }
        }
        await db.expenses.bulkPut(expRecords);
        if (ledRecords.length) await db.ledgerEntries.bulkPut(ledRecords);
      } else if (type === 'cheques_recus') {
        const chqRecords: IncomingCheque[] = [];
        const ledRecords: LedgerEntry[] = [];

        for (const r of validRows) {
          const m = r.mapped;
          const clientId = await findOrCreateContact(m.clientName, 'client');
          const entryDate = normalizeImportedDate(m.entryDate)!;
          const chequeDate = m.chequeDate ? normalizeImportedDate(m.chequeDate) || entryDate : entryDate;
          const amt = parseMoneyInputToCentimes(m.amount);
          const currency = (m.currency || settings.defaultCurrency || 'DZD').toUpperCase();
          const exRateRaw = m.exchangeRate ? Number(m.exchangeRate.replace(',', '.')) : 1;
          const exchangeRate = currency === 'DZD' ? 1 : Math.max(0.0001, exRateRaw || 1);
          const baseDzd = convertToBaseDzd(amt, exchangeRate);
          const status = parseIncomingStatus(m.status);
          const linkedInv = m.invoiceNumber
            ? customerInvoices.find(
                (i) => i.invoiceNumber.trim().toLowerCase() === m.invoiceNumber.trim().toLowerCase()
              )
            : undefined;
          const targetBankId = bankAccounts[0]?.id || null;

          const id = createId('ichq');
          chqRecords.push({
            id,
            clientId,
            issuerBank: m.issuerBank,
            chequeNumber: normalizeChequeNumberValue(m.chequeNumber),
            chequeDate,
            entryDate,
            amountCentimes: amt,
            currency,
            exchangeRate,
            baseDzdAmountCentimes: baseDzd,
            targetBankAccountId: targetBankId,
            clearingDate: status === 'encaisse' ? entryDate : undefined,
            status,
            allocatedInvoiceIds: linkedInv ? [linkedInv.id] : [],
            notes: m.notes,
            createdAt: now,
            updatedAt: now,
          });

          if (status === 'encaisse') {
            ledRecords.push({
              id: createId('led'),
              date: entryDate,
              direction: 'entree',
              sourceType: 'cheque_recu_encaisse',
              sourceId: id,
              bankAccountId: targetBankId,
              contactId: clientId,
              label: `Chèque reçu encaissé ${m.chequeNumber} — ${m.clientName}`,
              amountCentimes: amt,
              currency,
              exchangeRate,
              baseDzdAmountCentimes: baseDzd,
              status: 'valide',
              createdAt: now,
            });
          }
        }
        await db.incomingCheques.bulkPut(chqRecords);
        if (ledRecords.length) await db.ledgerEntries.bulkPut(ledRecords);
      } else if (type === 'cheques_emis') {
        const chqRecords: OutgoingCheque[] = [];
        const ledRecords: LedgerEntry[] = [];

        for (const r of validRows) {
          const m = r.mapped;
          const bankId = findBank(m.bankName)!;
          const issueDate = normalizeImportedDate(m.issueDate)!;
          const amt = parseMoneyInputToCentimes(m.amount);
          const currency = (m.currency || settings.defaultCurrency || 'DZD').toUpperCase();
          const exRateRaw = m.exchangeRate ? Number(m.exchangeRate.replace(',', '.')) : 1;
          const exchangeRate = currency === 'DZD' ? 1 : Math.max(0.0001, exRateRaw || 1);
          const baseDzd = convertToBaseDzd(amt, exchangeRate);
          const status = parseOutgoingStatus(m.status);
          const chqNum = normalizeChequeNumberValue(m.chequeNumber);
          const id = createId('ochq');

          chqRecords.push({
            id,
            bankAccountId: bankId,
            chequeBookId: '',
            chequeLeafId: '',
            chequeNumber: chqNum,
            beneficiary: m.beneficiary,
            issueDate,
            amountCentimes: amt,
            currency,
            exchangeRate,
            baseDzdAmountCentimes: baseDzd,
            purpose: m.purpose,
            linkedType: 'autre',
            clearingDate: status === 'encaisse' ? issueDate : undefined,
            status,
            notes: m.notes,
            createdAt: now,
            updatedAt: now,
          });

          if (status === 'encaisse') {
            ledRecords.push({
              id: createId('led'),
              date: issueDate,
              direction: 'sortie',
              sourceType: 'cheque_emis_encaisse',
              sourceId: id,
              bankAccountId: bankId,
              label: `Chèque émis encaissé ${chqNum} — ${m.beneficiary} (${m.purpose})`,
              amountCentimes: amt,
              currency,
              exchangeRate,
              baseDzdAmountCentimes: baseDzd,
              status: 'valide',
              createdAt: now,
            });
          }
        }
        await db.outgoingCheques.bulkPut(chqRecords);
        if (ledRecords.length) await db.ledgerEntries.bulkPut(ledRecords);
      }
    }
  );

  await recordAudit({
    action: 'IMPORT',
    entityType: type,
    entityId: 'excel_import',
    summary: `Import Excel (${IMPORT_SCHEMAS[type].label}) : ${validRows.length} ligne(s) importée(s)`,
  });

  return { importedCount: validRows.length };
}
