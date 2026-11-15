import type { CurrencyConfig } from '../db/types';

export const DEFAULT_CURRENCIES: CurrencyConfig[] = [
  { code: 'DZD', name: 'Dinar algérien', symbol: 'DA', rateToDzd: 1, enabled: true },
  { code: 'EUR', name: 'Euro', symbol: '€', rateToDzd: 145, enabled: true },
  { code: 'USD', name: 'Dollar américain', symbol: '$', rateToDzd: 134, enabled: true },
  { code: 'GBP', name: 'Livre sterling', symbol: '£', rateToDzd: 170, enabled: true },
];

const CURRENCY_SYMBOLS: Record<string, string> = {
  DZD: 'DA',
  EUR: '€',
  USD: '$',
  GBP: '£',
};

export function getCurrencySymbol(currencyCode: string, customCurrencies?: CurrencyConfig[]): string {
  const found = customCurrencies?.find((c) => c.code === currencyCode);
  if (found) return found.symbol;
  return CURRENCY_SYMBOLS[currencyCode] ?? currencyCode;
}

/**
 * Addition entière sécurisée en centimes.
 */
export function addMoney(...values: number[]): number {
  let total = 0;
  for (const val of values) {
    total += Math.round(val);
  }
  return total;
}

/**
 * Soustraction entière sécurisée en centimes.
 */
export function subtractMoney(a: number, b: number): number {
  return Math.round(a) - Math.round(b);
}

/**
 * Conversion vers DZD en centimes avec taux figé (arrondi entier au centime).
 */
export function convertToBaseDzd(amountCentimes: number, exchangeRate: number): number {
  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
    return Math.round(amountCentimes);
  }
  if (exchangeRate === 1) {
    return Math.round(amountCentimes);
  }
  return Math.round(Math.round(amountCentimes) * exchangeRate);
}

/**
 * Calcule HT, TVA et TTC d'une ligne de facture en centimes entiers.
 */
export function computeInvoiceLineTotals(params: {
  quantity: number;
  unitPriceCentimes: number;
  discountPercent: number;
  tvaRate: number;
}): {
  htCentimes: number;
  tvaCentimes: number;
  ttcCentimes: number;
} {
  const qty = Number.isFinite(params.quantity) && params.quantity > 0 ? params.quantity : 0;
  const unitPrice = Math.round(params.unitPriceCentimes || 0);
  const discount = Math.min(100, Math.max(0, params.discountPercent || 0));
  const tvaRate = Math.max(0, params.tvaRate || 0);

  const gross = qty * unitPrice;
  const htCentimes = Math.round((gross * (100 - discount)) / 100);
  const tvaCentimes = Math.round((htCentimes * tvaRate) / 100);
  const ttcCentimes = htCentimes + tvaCentimes;

  return { htCentimes, tvaCentimes, ttcCentimes };
}

/**
 * Convertit une saisie texte utilisateur (ex: "100 000,50" ou "100000.5") en centimes entiers
 * sans passer par des calculs flottants imprécis.
 */
export function parseMoneyInputToCentimes(raw: string | number): number {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return 0;
    return Math.round(raw * 100);
  }

  const cleaned = raw
    .trim()
    .replace(/\s|\u00A0|\u202F/g, '')
    .replace(',', '.');

  if (!cleaned) return 0;

  const isNegative = cleaned.startsWith('-');
  const unsigned = isNegative ? cleaned.slice(1) : cleaned;

  if (!/^\d+(\.\d*)?$/.test(unsigned)) {
    return NaN;
  }

  const [intPartRaw, fracPartRaw = ''] = unsigned.split('.');
  const intPart = parseInt(intPartRaw || '0', 10);
  const paddedFrac = (fracPartRaw + '000').slice(0, 3);
  let centimes = intPart * 100 + parseInt(paddedFrac.slice(0, 2), 10);

  // Arrondi demi-supérieur sur le 3e chiffre après la virgule
  if (parseInt(paddedFrac[2], 10) >= 5) {
    centimes += 1;
  }

  return isNegative ? -centimes : centimes;
}

/**
 * Formate un montant en centimes entiers au style fr-DZ : "1 234 567,50 DA".
 */
export function formatMoney(
  centimes: number,
  currencyCode = 'DZD',
  customCurrencies?: CurrencyConfig[]
): string {
  const safeCentimes = Math.round(Number.isFinite(centimes) ? centimes : 0);
  const isNeg = safeCentimes < 0;
  const abs = Math.abs(safeCentimes);

  const whole = Math.floor(abs / 100);
  const cents = String(abs % 100).padStart(2, '0');

  const wholeFormatted = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const symbol = getCurrencySymbol(currencyCode, customCurrencies);
  const sign = isNeg ? '-' : '';

  return `${sign}${wholeFormatted},${cents} ${symbol}`;
}

/**
 * Formate un montant en unités majeures pour affichage dans un champ de saisie (ex: "100000,00").
 */
export function centimesToInputString(centimes: number): string {
  const safe = Math.round(Number.isFinite(centimes) ? centimes : 0);
  const isNeg = safe < 0;
  const abs = Math.abs(safe);
  const whole = Math.floor(abs / 100);
  const cents = String(abs % 100).padStart(2, '0');
  return `${isNeg ? '-' : ''}${whole},${cents}`;
}
