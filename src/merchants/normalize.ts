// Normalizes a merchant name for accent/case-insensitive find-or-create and
// search: trims, lowercases, strips diacritics and collapses inner whitespace.
export function normalizeMerchantName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ');
}
