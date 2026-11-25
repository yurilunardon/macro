/**
 * The personal coach: what it is told about the user each time, and what it gives back. The model
 * remembers nothing between questions; the app does. Each question goes with a snapshot of the
 * last weeks and the notes the coach kept about the user.
 */
import type { DateKey } from './dates';
import type { Profile, Targets } from './goals';

export type CoachMessage = { role: 'user' | 'model'; text: string; at: string };

/** What the coach learned about the user and keeps: one fact a line. */
export type CoachNote = { text: string; at: string };

export type CoachSnapshot = {
  today: DateKey;
  profile: Profile | null;
  goalWeight: number | null;
  /** The last days of the diary, oldest first; days with nothing logged are left out. */
  days: { date: DateKey; kcal: number; protein: number; carbs: number; fat: number; target: Targets | null; training: boolean }[];
  weights: { date: DateKey; kg: number }[];
  workouts: { date: DateKey; name: string; minutes: number | null; exercises: { name: string; sets: { kg: number | null; reps: number | null }[] }[] }[];
  program: {
    name: string;
    days: { name: string; exercises: string[] }[];
    muscles: { name: string; sets: number; level: 'good' | 'low' | 'bad' }[];
  } | null;
  supplements: { name: string; dose: string; schedule: string; taken: number; due: number }[];
  coming: { date: DateKey; time: string | null; what: string }[];
  notes: CoachNote[];
};

/** How many messages of the conversation go with each question. */
export const CHAT_SENT = 24;
/** How many are kept on the phone. */
export const CHAT_KEPT = 120;

const ROUND = (n: number) => Math.round(n);

const GOALS: Record<Profile['goal'], string> = {
  lose: 'dimagrire',
  lose_slow: 'dimagrire piano',
  maintain: 'mantenere',
  gain_slow: 'aumentare piano',
  gain: 'aumentare',
};

/** The user and the last weeks, as plain text for the model: short, numbers first. */
export function snapshotText(s: CoachSnapshot): string {
  const out: string[] = [`Oggi è ${s.today}.`];

  if (s.notes.length > 0) {
    out.push('', 'COSA SAI DELL’UTENTE (note tue, dalla più vecchia):', ...s.notes.map((n) => `- ${n.text}`));
  }

  if (s.profile) {
    const p = s.profile;
    const age = Number(s.today.slice(0, 4)) - p.birthYear;
    out.push(
      '',
      'PROFILO:',
      `${p.sex === 'male' ? 'Uomo' : 'Donna'}, ${age} anni, ${p.heightCm} cm, ${p.weightKg} kg, obiettivo: ${GOALS[p.goal]}` +
        (s.goalWeight ? `, peso obiettivo ${s.goalWeight} kg` : '') +
        `. Proteine ${p.proteinPerKg} g/kg, grassi ${p.fatPercent}% delle calorie.`,
    );
  }

  if (s.weights.length > 0) {
    out.push('', 'PESO (data: kg):', s.weights.map((w) => `${w.date.slice(5)}: ${w.kg}`).join(', '));
  }

  if (s.days.length > 0) {
    out.push('', 'ALIMENTAZIONE (giorno: kcal, proteine/carbo/grassi g, rispetto all’obiettivo):');
    for (const d of s.days) {
      const target = d.target ? ` (obiettivo ${ROUND(d.target.kcal)} kcal, ${ROUND(d.target.protein)} g prot)` : '';
      out.push(`- ${d.date.slice(5)}${d.training ? ' allenamento' : ' riposo'}: ${ROUND(d.kcal)} kcal, P${ROUND(d.protein)} C${ROUND(d.carbs)} G${ROUND(d.fat)}${target}`);
    }
  } else {
    out.push('', 'ALIMENTAZIONE: niente registrato negli ultimi giorni.');
  }

  if (s.workouts.length > 0) {
    out.push('', 'ALLENAMENTI (serie: kg×ripetizioni):');
    for (const w of s.workouts) {
      out.push(`- ${w.date.slice(5)} ${w.name}${w.minutes ? `, ${w.minutes} min` : ''}`);
      for (const e of w.exercises) {
        const sets = e.sets.map((x) => `${x.kg ?? 0}×${x.reps ?? 0}`).join(' ');
        out.push(`  ${e.name}: ${sets}`);
      }
    }
  } else {
    out.push('', 'ALLENAMENTI: nessuno nelle ultime settimane.');
  }

  if (s.program) {
    out.push('', `SCHEDA IN USO: ${s.program.name}`);
    for (const d of s.program.days) out.push(`- ${d.name}: ${d.exercises.join('; ')}`);
    const label = { good: 'ok', low: 'poco', bad: 'troppo poco' } as const;
    out.push(`Serie a settimana per muscolo (servono 10–20): ${s.program.muscles.map((m) => `${m.name} ${ROUND(m.sets)} ${label[m.level]}`).join(', ')}.`);
  }

  if (s.supplements.length > 0) {
    out.push('', 'INTEGRATORI (presi / previsti negli ultimi 14 giorni):');
    for (const x of s.supplements) out.push(`- ${x.name} ${x.dose}, ${x.schedule}: ${x.taken}/${x.due}`);
  }

  if (s.coming.length > 0) {
    out.push('', 'PROSSIMI GIORNI (calendario):', ...s.coming.map((c) => `- ${c.date.slice(5)}${c.time ? ` ${c.time}` : ''}: ${c.what}`));
  }

  return out.join('\n');
}

/** Who the coach is and how it talks, then everything it knows. */
export function systemPrompt(snapshot: CoachSnapshot): string {
  return [
    'Sei il coach personale dell’utente dentro Fuel, la sua app di alimentazione, allenamento e integratori.',
    'Rispondi in italiano, breve e diretto, come un allenatore che lo conosce: niente premesse, niente elenchi lunghi se non servono.',
    'Basati sui dati qui sotto e cita i numeri. Se un dato manca, dillo invece di inventarlo.',
    'Non sei un medico: per dolori che non passano, sintomi o farmaci consiglia di sentire un medico, in una frase.',
    'Quando impari qualcosa di duraturo sull’utente (obiettivi, infortuni, lavoro e orari, sport, cibi che non mangia, preferenze), scrivi in fondo alla risposta una riga per ogni fatto nuovo, così: "NOTA: <il fatto in una frase>". Non ripetere fatti già tra le note. L’utente non vede queste righe.',
    'Se l’utente vuole che tu lo conosca, fagli una domanda alla volta, partendo da ciò che le note non dicono ancora.',
    '',
    snapshotText(snapshot),
  ].join('\n');
}

/** The reply as shown, and the notes it asked to keep. */
export function parseReply(text: string): { text: string; notes: string[] } {
  const notes: string[] = [];
  const kept: string[] = [];
  for (const line of text.split('\n')) {
    const match = /^\s*[-*]?\s*\**NOTA\**\s*:\s*(.+)$/i.exec(line);
    if (match) {
      const note = match[1].replace(/^\*+|\*+$/g, '').trim();
      if (note) notes.push(note);
    } else kept.push(line);
  }
  return { text: kept.join('\n').trim(), notes };
}

/** Notes not kept yet, by their words: the coach often says the same thing again. */
export function newNotes(existing: readonly CoachNote[], found: readonly string[]): string[] {
  const seen = new Set(existing.map((n) => n.text.toLowerCase().trim()));
  const out: string[] = [];
  for (const note of found) {
    const key = note.toLowerCase().trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(note);
  }
  return out;
}

type ListedModel = { name: string; supportedGenerationMethods?: string[] };

/**
 * The Flash models to try, best first: the newest stable one, then older ones, previews last.
 * Flash is the one the free quota covers; Lite, image, audio and other kinds are left out.
 */
export function pickModels(models: readonly ListedModel[]): string[] {
  const found = models
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .map((id) => ({ id, match: /^gemini-(\d+(?:\.\d+)?)-flash(-preview[\w-]*)?$/.exec(id) }))
    .filter((m): m is { id: string; match: RegExpExecArray } => m.match !== null);
  return found
    .sort((a, b) => {
      const preview = Number(Boolean(a.match[2])) - Number(Boolean(b.match[2]));
      return preview !== 0 ? preview : Number(b.match[1]) - Number(a.match[1]);
    })
    .map((m) => m.id);
}

/** What went wrong, said for the user, from Gemini's status and error. */
export function geminiErrorText(status: number, body: string): string {
  let reason = '';
  try {
    const parsed = JSON.parse(body) as { error?: { status?: string; message?: string; details?: { reason?: string }[] } };
    reason = [parsed.error?.status, parsed.error?.message, ...(parsed.error?.details ?? []).map((d) => d.reason)].filter(Boolean).join(' ');
  } catch {
    reason = body;
  }
  if (/API_KEY_INVALID|API key not valid/i.test(reason)) return 'La chiave non è valida: controlla di averla copiata tutta';
  if (status === 429) return 'Troppe domande per il piano gratuito: riprova tra un minuto';
  if (status === 403) return 'La chiave non ha accesso a Gemini';
  if (status === 404) return 'Modello non trovato';
  if (status >= 500) return 'Gemini non risponde, riprova più tardi';
  if (status === 0) return 'Nessuna connessione';
  return `Errore ${status}`;
}
