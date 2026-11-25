import { describe, expect, it } from 'vitest';

import { geminiErrorText, newNotes, parseReply, pickModels, snapshotText, type CoachSnapshot } from '../coach';

describe('parseReply', () => {
  it('takes the notes out of the reply', () => {
    const { text, notes } = parseReply('Va bene così.\n\nNOTA: Gioca a pallavolo il martedì e il giovedì\n**NOTA:** Non mangia pesce');
    expect(text).toBe('Va bene così.');
    expect(notes).toEqual(['Gioca a pallavolo il martedì e il giovedì', 'Non mangia pesce']);
  });
});

describe('newNotes', () => {
  it('skips what is already kept', () => {
    expect(newNotes([{ text: 'Non mangia pesce', at: '' }], ['non mangia pesce ', 'Lavora da casa il giovedì'])).toEqual(['Lavora da casa il giovedì']);
  });
});

describe('pickModels', () => {
  it('puts the newest stable Flash first, previews last, no Lite', () => {
    const g = ['generateContent'];
    expect(
      pickModels([
        { name: 'models/gemini-2.5-flash', supportedGenerationMethods: g },
        { name: 'models/gemini-3.8-flash', supportedGenerationMethods: g },
        { name: 'models/gemini-4-flash-preview', supportedGenerationMethods: g },
        { name: 'models/gemini-3.8-flash-lite', supportedGenerationMethods: g },
        { name: 'models/gemini-3.8-pro', supportedGenerationMethods: g },
        { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
      ]),
    ).toEqual(['gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-4-flash-preview']);
  });
});

describe('geminiErrorText', () => {
  it('says what went wrong', () => {
    expect(geminiErrorText(400, JSON.stringify({ error: { status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.' } }))).toMatch(/chiave/);
    expect(geminiErrorText(429, '{}')).toMatch(/minuto/);
  });
});

describe('snapshotText', () => {
  it('writes the numbers', () => {
    const s: CoachSnapshot = {
      today: '2026-11-25',
      profile: null,
      goalWeight: null,
      days: [{ date: '2026-11-24', kcal: 2100.4, protein: 150, carbs: 200, fat: 70, target: { kcal: 2200, protein: 160, carbs: 220, fat: 70 }, training: true }],
      weights: [{ date: '2026-11-24', kg: 84.2 }],
      workouts: [{ date: '2026-11-23', name: 'Push', minutes: 62, exercises: [{ name: 'Panca piana', sets: [{ kg: 80, reps: 10 }] }] }],
      program: null,
      supplements: [],
      coming: [],
      notes: [{ text: 'Gioca a pallavolo', at: '' }],
    };
    const text = snapshotText(s);
    expect(text).toContain('11-24 allenamento: 2100 kcal');
    expect(text).toContain('Panca piana: 80×10');
    expect(text).toContain('- Gioca a pallavolo');
  });
});
