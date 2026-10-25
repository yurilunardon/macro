import { describe, expect, it } from 'vitest';

import { foodSearchText, normalizeSearch } from '../search';

describe('normalizeSearch', () => {
  it('folds case, accents and punctuation', () => {
    expect(normalizeSearch('Caffè espresso')).toBe('caffe espresso');
    expect(normalizeSearch('Würstel di maiale')).toBe('wurstel di maiale');
    expect(normalizeSearch("Pasta all'uovo")).toBe('pasta alluovo');
    expect(normalizeSearch('Baccalà, secco (prima dell’ammollo)')).toBe('baccala secco prima dellammollo');
    expect(normalizeSearch('  Yogurt   greco 0% ')).toBe('yogurt greco 0%');
    expect(normalizeSearch('Mandarino / clementina')).toBe('mandarino clementina');
  });

  it('keeps letters it cannot fold', () => {
    expect(normalizeSearch('Ελληνικό γιαούρτι')).toBe('ελληνικό γιαούρτι');
  });
});

describe('foodSearchText', () => {
  it('joins name, brand and category', () => {
    expect(foodSearchText({ name: 'Mela', brand: null, category: 'Frutta' })).toBe('mela frutta');
    expect(foodSearchText({ name: 'Spaghetti n°5', brand: 'Barilla' })).toBe('spaghetti n 5 barilla');
  });
});
