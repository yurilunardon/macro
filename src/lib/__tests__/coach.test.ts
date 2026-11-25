import { describe, expect, it } from 'vitest';

import { geminiErrorText, lastWeek, messageForModel, newNotes, parseReply, parseWeek, pickModels, readyQuestion, snapshotText, type CoachSnapshot } from '../coach';

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

describe('parseReply fields of the card', () => {
  it('takes the PROFILO lines into the card, unknown fields as notes', () => {
    const r = parseReply('Ok.\nPROFILO Sonno: circa 7 ore, a letto alle 23\n**PROFILO Corpo:** ginocchio destro delicato\nPROFILO Hobby: chitarra');
    expect(r.text).toBe('Ok.');
    expect(r.profile).toEqual({ sleep: 'circa 7 ore, a letto alle 23', body: 'ginocchio destro delicato' });
    expect(r.notes).toEqual(['chitarra']);
  });
});

describe('messageForModel', () => {
  it('puts what it is about and its data first', () => {
    expect(messageForModel({ text: 'Cosa cambio?', about: 'Panca piana', context: '4×8' })).toBe('[Riguarda: Panca piana]\n[Dati: 4×8]\nCosa cambio?');
    expect(messageForModel({ text: 'Ciao' })).toBe('Ciao');
  });
});

describe('lastWeek', () => {
  it('is Monday to Sunday of the week before', () => {
    expect(lastWeek('2026-11-25')).toEqual({ from: '2026-11-16', to: '2026-11-22' });
    expect(lastWeek('2026-11-23')).toEqual({ from: '2026-11-16', to: '2026-11-22' });
    expect(lastWeek('2026-11-29')).toEqual({ from: '2026-11-16', to: '2026-11-22' });
  });
});

describe('parseWeek', () => {
  it('keeps the proposals the app can apply and drops the rest', () => {
    const json = JSON.stringify({
      summary: ['4 allenamenti su 4', 'Proteine sotto 3 giorni', 'Peso −0,4 kg'],
      food: 'Calorie giuste.',
      training: 'Panca cresce.',
      weight: 'In linea.',
      proposals: [
        { title: 'Proteine a 150 g a riposo', detail: 'Oggi 130 g', kind: 'targets', day: 'rest', kcal: 2200.4, protein: 150, carbs: 220, fat: 70 },
        { title: 'Rematore 4×8', detail: 'Fermo da 3 volte', kind: 'exercise', planId: 12, sets: 4, repMin: 8, repMax: 8 },
        { title: 'Calorie a 400', detail: 'troppo poche', kind: 'targets', day: 'all', kcal: 400, protein: 100 },
        { title: 'Senza numeri', detail: '', kind: 'exercise' },
      ],
    });
    const week = parseWeek(json, '2026-11-16', '2026-11-22', 'now');
    expect(week?.summary).toHaveLength(3);
    expect(week?.proposals.map((p) => p.change)).toEqual([
      { kind: 'targets', day: 'rest', kcal: 2200, protein: 150, carbs: 220, fat: 70 },
      { kind: 'exercise', planId: 12, sets: 4, repMin: 8, repMax: 8 },
    ]);
    expect(week?.proposals[0].applied).toBeNull();
  });

  it('is null for what is not JSON', () => {
    expect(parseWeek('non è json', '2026-11-16', '2026-11-22', 'now')).toBeNull();
  });
});

describe('readyQuestion', () => {
  const target = { kcal: 2400, protein: 160, carbs: 250, fat: 70 };
  it('asks about protein from the afternoon on', () => {
    expect(readyQuestion(18, { kcal: 1800, protein: 98 }, target)).toBe('Come recupero 62 g di proteine?');
    expect(readyQuestion(10, { kcal: 300, protein: 20 }, target)).toBeNull();
  });
  it('asks about calories when well over, nothing when fine', () => {
    expect(readyQuestion(21, { kcal: 2700, protein: 150 }, target)).toBe('Ho superato di 300 kcal, come sistemo?');
    expect(readyQuestion(21, { kcal: 2400, protein: 150 }, target)).toBeNull();
    expect(readyQuestion(21, { kcal: 2400, protein: 50 }, null)).toBeNull();
  });
});
