/**
 * Génère une séquence de numéros de chèques à partir du premier numéro (texte)
 * et d'un nombre de feuillets, tout en préservant les zéros initiaux (ex: "0012345").
 */
export function generateChequeSerialSequence(startSerial: string, count: number): string[] {
  const trimmed = startSerial.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error('Le premier numéro de chèque doit contenir uniquement des chiffres.');
  }
  if (!Number.isInteger(count) || count < 1 || count > 500) {
    throw new Error('Le nombre de chèques doit être compris entre 1 et 500.');
  }

  const width = trimmed.length;
  const startBigInt = BigInt(trimmed);
  const result: string[] = [];

  for (let i = 0; i < count; i += 1) {
    const nextVal = startBigInt + BigInt(i);
    const formatted = nextVal.toString().padStart(width, '0');
    result.push(formatted);
  }

  return result;
}

/**
 * Vérifie si de nouveaux numéros entrent en conflit avec des numéros déjà existants pour la même banque.
 */
export function findDuplicateChequeNumbers(
  existingNumbers: Iterable<string>,
  candidateNumbers: string[]
): string[] {
  const existingSet = new Set(existingNumbers);
  return candidateNumbers.filter((num) => existingSet.has(num));
}
