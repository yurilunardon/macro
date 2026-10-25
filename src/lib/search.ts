const ACCENTS: Record<string, string> = {
  à: 'a', á: 'a', â: 'a', ä: 'a', ã: 'a', å: 'a',
  è: 'e', é: 'e', ê: 'e', ë: 'e',
  ì: 'i', í: 'i', î: 'i', ï: 'i',
  ò: 'o', ó: 'o', ô: 'o', ö: 'o', õ: 'o', ø: 'o',
  ù: 'u', ú: 'u', û: 'u', ü: 'u',
  ç: 'c', ñ: 'n', ß: 'ss', œ: 'oe', æ: 'ae',
};

/** Lower case with accented Latin letters replaced by plain ones ("Caffè" → "caffe"). */
export function foldAccents(text: string): string {
  return text.toLowerCase().replace(/[^\u0000-\u007f]/g, (c) => ACCENTS[c] ?? c);
}

/**
 * Lower case without accents or punctuation, so "Caffè" matches "caffe" and "Würstel" matches
 * "wurstel". SQLite's LIKE only folds ASCII case, so this is stored next to each food.
 */
export function normalizeSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’'`´]/g, '')
    .replace(/[^a-z0-9%]/g, (c) => {
      const folded = ACCENTS[c];
      if (folded) return folded;
      // Keep letters of other alphabets (they have an upper case); symbols such as ° become spaces.
      return c.toUpperCase() !== c.toLowerCase() ? c : ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** The text a food is found by: its name, brand and category. */
export function foodSearchText(food: { name: string; brand: string | null; category?: string | null }): string {
  return normalizeSearch([food.name, food.brand, food.category].filter(Boolean).join(' '));
}
