/**
 * The personal coach: what it is told about the user each time, and what it gives back. The model
 * remembers nothing between questions; the app does. Each question goes with a snapshot of the
 * last weeks and the notes the coach kept about the user.
 */
import { addDays, fromDateKey, type DateKey } from './dates';
import type { Profile, Targets } from './goals';

export type CoachMessage = {
  role: 'user' | 'model';
  text: string;
  at: string;
  /** What the question is about, when asked from a part of the app: "Panca piana". */
  about?: string;
  /** The data of that part, for the model only: the sets, the foods of a meal. */
  context?: string;
};

/** The fixed parts of what the coach knows about the user: each one is a short text. */
export const PROFILE_FIELDS = [
  { key: 'goal', label: 'Obiettivo', ask: 'cosa vuoi ottenere e entro quando' },
  { key: 'week', label: 'Settimana', ask: 'lavoro, orari e sport fissi' },
  { key: 'training', label: 'Allenamento', ask: 'da quanto ti alleni e come' },
  { key: 'body', label: 'Corpo', ask: 'infortuni, dolori, salute' },
  { key: 'food', label: 'Cibo', ask: 'abitudini, cosa non mangi, pasti fuori' },
  { key: 'sleep', label: 'Sonno', ask: 'quanto e come dormi' },
] as const;

export type ProfileFieldKey = (typeof PROFILE_FIELDS)[number]['key'];
export type CoachProfile = Partial<Record<ProfileFieldKey, string>>;

/** What the coach learned about the user and keeps: one fact a line. */
export type CoachNote = { text: string; at: string };

export type CoachSnapshot = {
  today: DateKey;
  /** The time the question is asked, "HH:MM". */
  clock?: string;
  profile: Profile | null;
  /** The user's own card, field by field. */
  facts?: CoachProfile;
  /** The day's targets as set now: for training days, and for rest days when they differ. */
  targets?: { training: Targets | null; rest: Targets | null };
  goalWeight: number | null;
  /** The last days of the diary, oldest first; days with nothing logged are left out. */
  days: { date: DateKey; kcal: number; protein: number; carbs: number; fat: number; target: Targets | null; training: boolean }[];
  weights: { date: DateKey; kg: number }[];
  workouts: { date: DateKey; name: string; minutes: number | null; exercises: { name: string; sets: { kg: number | null; reps: number | null }[] }[] }[];
  program: {
    name: string;
    days: { name: string; exercises: { id: number; text: string }[] }[];
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
  const out: string[] = [`Oggi è ${s.today}${s.clock ? `, sono le ${s.clock}` : ''}.`];

  const facts = s.facts ?? {};
  out.push('', 'LA SCHEDA DELL’UTENTE (campi fissi):', ...PROFILE_FIELDS.map((f) => `- ${f.label}: ${facts[f.key]?.trim() || '(manca)'}`));
  if (s.notes.length > 0) {
    out.push('', 'ALTRO CHE SAI DELL’UTENTE (dalla più vecchia):', ...s.notes.map((n) => `- ${n.text}`));
  }

  if (s.profile) {
    const p = s.profile;
    const age = Number(s.today.slice(0, 4)) - p.birthYear;
    out.push(
      '',
      'DATI FISICI:',
      `${p.sex === 'male' ? 'Uomo' : 'Donna'}, ${age} anni, ${p.heightCm} cm, ${p.weightKg} kg, obiettivo: ${GOALS[p.goal]}` +
        (s.goalWeight ? `, peso obiettivo ${s.goalWeight} kg` : '') +
        `. Proteine ${p.proteinPerKg} g/kg, grassi ${p.fatPercent}% delle calorie.`,
    );
  }

  if (s.targets?.training) {
    const t = (x: Targets) => `${ROUND(x.kcal)} kcal, P${ROUND(x.protein)} C${ROUND(x.carbs)} G${ROUND(x.fat)}`;
    out.push('', `OBIETTIVI GIORNALIERI ATTUALI: ${s.targets.rest ? `allenamento ${t(s.targets.training)}; riposo ${t(s.targets.rest)}` : `tutti i giorni ${t(s.targets.training)}`}.`);
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
    for (const d of s.program.days) out.push(`- ${d.name}: ${d.exercises.map((e) => `[#${e.id}] ${e.text}`).join('; ')}`);
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
    `Quando impari qualcosa che va in un campo della scheda dell’utente (${PROFILE_FIELDS.map((f) => f.label).join(', ')}), scrivi in fondo alla risposta una riga "PROFILO <Campo>: <il campo intero aggiornato, breve>", che sostituisce quello di prima. Per altro di duraturo che non sta nei campi: "NOTA: <il fatto in una frase>". Non ripetere quello che sai già. L’utente non vede queste righe.`,
    'Se l’utente vuole che tu lo conosca, fagli una domanda alla volta, partendo dai campi che mancano.',
    'Se un messaggio inizia con [Riguarda: …], la domanda è su quella cosa; i [Dati: …] che seguono sono presi dall’app.',
    '',
    snapshotText(snapshot),
  ].join('\n');
}

/** The reply as shown, the notes it asked to keep and the fields of the card it rewrote. */
export function parseReply(text: string): { text: string; notes: string[]; profile: CoachProfile } {
  const notes: string[] = [];
  const profile: CoachProfile = {};
  const kept: string[] = [];
  const clean = (x: string) => x.replace(/^\*+|\*+$/g, '').trim();
  for (const line of text.split('\n')) {
    const note = /^\s*[-*]?\s*\**NOTA\**\s*:\s*(.+)$/i.exec(line);
    const field = /^\s*[-*]?\s*\**PROFILO\s+([^:*]+?)\**\s*:\s*(.+)$/i.exec(line);
    if (note) {
      const value = clean(note[1]);
      if (value) notes.push(value);
    } else if (field) {
      const label = field[1].trim().toLowerCase();
      const known = PROFILE_FIELDS.find((f) => f.label.toLowerCase() === label || f.key === label);
      const value = clean(field[2]);
      if (known && value) profile[known.key] = value;
      else if (value) notes.push(value);
    } else kept.push(line);
  }
  return { text: kept.join('\n').trim(), notes, profile };
}

/** A message as the model reads it: what it is about and its data first. */
export function messageForModel(m: Pick<CoachMessage, 'text' | 'about' | 'context'>): string {
  const head = [m.about ? `[Riguarda: ${m.about}]` : null, m.context ? `[Dati: ${m.context}]` : null].filter(Boolean);
  return head.length > 0 ? `${head.join('\n')}\n${m.text}` : m.text;
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

// ---------- The day, the week, the workout

/** The coach's sentence for today, written once when the Calendar is first opened that day. */
export type CoachDaily = { date: DateKey; text: string; at: string };

/** What the coach asks itself for the sentence of the day. */
export function dailyQuestion(today: DateKey, clock: string): string {
  return `Scrivi una sola frase, al massimo 30 parole, su cosa conta oggi (${today}, ore ${clock}) tra allenamento, cibo e integratori, con i numeri giusti. Niente saluti, niente elenchi, niente righe PROFILO o NOTA.`;
}

/** One line of plain text from a reply: no markdown, no notes. */
export function oneLine(reply: string): string {
  return parseReply(reply)
    .text.replace(/[*_#`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The week before the one of `today`: Monday to Sunday. */
export function lastWeek(today: DateKey): { from: DateKey; to: DateKey } {
  const monday = addDays(today, -((fromDateKey(today).getDay() + 6) % 7));
  return { from: addDays(monday, -7), to: addDays(monday, -1) };
}

/** A change the app can make by itself when the user taps Applica. */
export type CoachChange =
  | { kind: 'targets'; day: 'training' | 'rest' | 'all'; kcal: number; protein: number; carbs: number | null; fat: number | null }
  | { kind: 'exercise'; planId: number; sets: number; repMin: number; repMax: number }
  | { kind: 'goalWeight'; kg: number };

/** What there was before a change, to put it back. */
export type CoachUndo =
  | { kind: 'targets'; training: Targets | null; rest: Targets | null }
  | { kind: 'exercise'; planId: number; sets: number; repMin: number; repMax: number }
  | { kind: 'goalWeight'; kg: number | null };

export type CoachProposal = {
  id: string;
  /** The change in a few words: "Proteine nei giorni di riposo a 150 g". */
  title: string;
  /** Why, with the numbers. */
  detail: string;
  change: CoachChange;
  applied: { at: string; before: CoachUndo } | null;
};

export type CoachWeek = {
  from: DateKey;
  to: DateKey;
  at: string;
  /** Three short points, for the card in the Calendar. */
  summary: string[];
  food: string;
  training: string;
  weight: string;
  proposals: CoachProposal[];
};

/** How many weekly analyses are kept. */
export const WEEKS_KEPT = 12;

/** The shape Gemini must answer the weekly analysis in. */
export const WEEK_SCHEMA = {
  type: 'OBJECT',
  properties: {
    summary: { type: 'ARRAY', items: { type: 'STRING' } },
    food: { type: 'STRING' },
    training: { type: 'STRING' },
    weight: { type: 'STRING' },
    proposals: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING' },
          detail: { type: 'STRING' },
          kind: { type: 'STRING', enum: ['targets', 'exercise', 'goalWeight'] },
          day: { type: 'STRING', enum: ['training', 'rest', 'all'] },
          kcal: { type: 'NUMBER' },
          protein: { type: 'NUMBER' },
          carbs: { type: 'NUMBER' },
          fat: { type: 'NUMBER' },
          planId: { type: 'INTEGER' },
          sets: { type: 'INTEGER' },
          repMin: { type: 'INTEGER' },
          repMax: { type: 'INTEGER' },
          kg: { type: 'NUMBER' },
        },
        required: ['title', 'detail', 'kind'],
      },
    },
  },
  required: ['summary', 'food', 'training', 'weight', 'proposals'],
} as const;

export function weekQuestion(from: DateKey, to: DateKey): string {
  return [
    `Analizza la settimana da lunedì ${from} a domenica ${to}, con i dati che hai. Rispondi in JSON.`,
    'summary: tre punti brevissimi con i numeri (allenamenti fatti, cibo, peso).',
    'food, training, weight: una o due frasi ciascuno, con i numeri.',
    'proposals: da zero a tre cambi concreti che l’app può fare da sola, solo se servono davvero:',
    '- kind "targets": nuovi obiettivi giornalieri; day "training", "rest" o "all"; dai kcal, protein, carbs, fat coerenti (kcal ≈ 4×protein + 4×carbs + 9×fat).',
    '- kind "exercise": un esercizio della scheda, planId è il numero tra [# ] nella scheda; dai sets, repMin, repMax.',
    '- kind "goalWeight": un nuovo peso obiettivo in kg.',
    'title: il cambio in poche parole. detail: perché, con i numeri, in una frase.',
  ].join('\n');
}

type RawProposal = {
  title?: unknown; detail?: unknown; kind?: unknown; day?: unknown; kcal?: unknown; protein?: unknown; carbs?: unknown; fat?: unknown;
  planId?: unknown; sets?: unknown; repMin?: unknown; repMax?: unknown; kg?: unknown;
};

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const text = (x: unknown): string => (typeof x === 'string' ? x.trim() : '');

/** A proposal from the model, if it is one the app can apply; anything off is left out. */
export function proposalFromRaw(raw: RawProposal, id: string): CoachProposal | null {
  const title = text(raw.title);
  const detail = text(raw.detail);
  if (!title) return null;
  let change: CoachChange | null = null;
  if (raw.kind === 'targets') {
    const kcal = num(raw.kcal);
    const protein = num(raw.protein);
    const day = raw.day === 'training' || raw.day === 'rest' ? raw.day : 'all';
    const ok = (x: number | null, min: number, max: number) => x === null || (x >= min && x <= max);
    if (kcal !== null && protein !== null && ok(kcal, 1000, 6000) && ok(protein, 30, 400) && ok(num(raw.carbs), 0, 900) && ok(num(raw.fat), 10, 300)) {
      change = { kind: 'targets', day, kcal: Math.round(kcal), protein: Math.round(protein), carbs: round(num(raw.carbs)), fat: round(num(raw.fat)) };
    }
  } else if (raw.kind === 'exercise') {
    const planId = num(raw.planId);
    const sets = num(raw.sets);
    const repMin = num(raw.repMin);
    const repMax = num(raw.repMax) ?? repMin;
    if (planId !== null && sets !== null && repMin !== null && repMax !== null && sets >= 1 && sets <= 10 && repMin >= 1 && repMax <= 50) {
      change = { kind: 'exercise', planId: Math.round(planId), sets: Math.round(sets), repMin: Math.round(Math.min(repMin, repMax)), repMax: Math.round(Math.max(repMin, repMax)) };
    }
  } else if (raw.kind === 'goalWeight') {
    const kg = num(raw.kg);
    if (kg !== null && kg >= 30 && kg <= 250) change = { kind: 'goalWeight', kg: Math.round(kg * 10) / 10 };
  }
  return change ? { id, title, detail, change, applied: null } : null;
}

function round(x: number | null): number | null {
  return x === null ? null : Math.round(x);
}

/** The weekly analysis from the model's JSON; null if it is not usable. */
export function parseWeek(json: string, from: DateKey, to: DateKey, at: string): CoachWeek | null {
  let raw: { summary?: unknown; food?: unknown; training?: unknown; weight?: unknown; proposals?: unknown };
  try {
    raw = JSON.parse(json.replace(/^```(?:json)?\s*|\s*```$/g, '')) as typeof raw;
  } catch {
    return null;
  }
  const summary = Array.isArray(raw.summary) ? raw.summary.map(text).filter(Boolean).slice(0, 3) : [];
  if (summary.length === 0) return null;
  const proposals = (Array.isArray(raw.proposals) ? (raw.proposals as RawProposal[]) : [])
    .map((p, i) => proposalFromRaw(p ?? {}, `${from}-${i}`))
    .filter((p): p is CoachProposal => p !== null)
    .slice(0, 3);
  return { from, to, at, summary, food: text(raw.food), training: text(raw.training), weight: text(raw.weight), proposals };
}

/** The coach's comment at the end of a workout. */
export type CoachWorkoutNote = { workoutId: number; text: string; at: string };

/** How many workout comments are kept. */
export const WORKOUT_NOTES_KEPT = 30;

export type WorkoutForCoach = {
  name: string;
  date: DateKey;
  exercises: { name: string; sets: { kg: number | null; reps: number | null }[] }[];
};

/** A workout as one line per exercise, for the model. */
export function workoutText(w: WorkoutForCoach): string {
  const lines = w.exercises
    .filter((e) => e.sets.length > 0)
    .map((e) => `${e.name}: ${e.sets.map((x) => `${x.kg ?? 0}×${x.reps ?? 0}`).join(' ')}`);
  return [`${w.name} del ${w.date}`, ...lines].join('\n');
}

export function workoutQuestion(w: WorkoutForCoach): string {
  return `Commenta in due frasi l’allenamento qui sotto, confrontandolo con i precedenti nei dati: cosa è cresciuto, cosa è fermo, cosa fare la prossima volta con numeri precisi. Niente saluti, niente righe PROFILO o NOTA.\n\n${workoutText(w)}`;
}

/**
 * The one question worth asking about the day, when its numbers say so: from the afternoon on,
 * protein well behind or calories well over. Null when all is fine.
 */
export function readyQuestion(hour: number, eaten: { kcal: number; protein: number }, target: Targets | null): string | null {
  if (!target || hour < 14) return null;
  const missing = Math.round(target.protein - eaten.protein);
  if (missing >= 25) return `Come recupero ${missing} g di proteine?`;
  const over = Math.round(eaten.kcal - target.kcal);
  if (over >= 200) return `Ho superato di ${over} kcal, come sistemo?`;
  return null;
}
