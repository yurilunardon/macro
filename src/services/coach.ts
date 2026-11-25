/**
 * The coach's model: Gemini, with the user's own key. The key stays on this phone only, in a file
 * of its own: it is not in the database, so neither the backup file nor the online copy carries it.
 */
import { File, Paths } from 'expo-file-system';
import { useSyncExternalStore } from 'react';

import { geminiErrorText, pickModels, type CoachMessage } from '@/lib/coach';

const API = 'https://generativelanguage.googleapis.com/v1beta';
const STORE = 'coach.json';
/** Used when the list of models cannot be read. */
const FALLBACK_MODELS = ['gemini-2.5-flash'];

export type CoachKeyState = { key: string | null; /** The model that answered last. */ model: string | null };

export class CoachError extends Error {}

let state: CoachKeyState = load();
const listeners = new Set<() => void>();

function load(): CoachKeyState {
  const empty: CoachKeyState = { key: null, model: null };
  try {
    const file = new File(Paths.document, STORE);
    if (!file.exists) return empty;
    return { ...empty, ...(JSON.parse(file.textSync()) as Partial<CoachKeyState>) };
  } catch {
    return empty;
  }
}

function set(change: Partial<CoachKeyState>): void {
  state = { ...state, ...change };
  for (const listener of listeners) listener();
  try {
    const file = new File(Paths.document, STORE);
    if (!file.exists) file.create();
    file.writeSync(JSON.stringify(state));
  } catch {
    // On the web there is no file: it lasts until the page is closed.
  }
}

export function useCoachKey(): CoachKeyState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => state,
  );
}

async function call(path: string, key: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${API}/${path}${path.includes('?') ? '&' : '?'}key=${encodeURIComponent(key)}`, init);
  } catch {
    throw new CoachError(geminiErrorText(0, ''));
  }
  const body = await response.text();
  if (!response.ok) throw Object.assign(new CoachError(geminiErrorText(response.status, body)), { status: response.status });
  return JSON.parse(body);
}

async function models(key: string): Promise<string[]> {
  try {
    const listed = (await call('models?pageSize=1000', key)) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
    const picked = pickModels(listed.models ?? []);
    return picked.length > 0 ? picked : FALLBACK_MODELS;
  } catch (e) {
    // A wrong key is said at once; anything else, the usual model is tried.
    if ((e as { status?: number }).status === 400 || (e as { status?: number }).status === 403) throw e;
    return FALLBACK_MODELS;
  }
}

/** Checks the key with Google and keeps it. */
export async function saveCoachKey(key: string): Promise<void> {
  const trimmed = key.trim();
  const found = await models(trimmed);
  set({ key: trimmed, model: found[0] ?? null });
}

export function forgetCoachKey(): void {
  set({ key: null, model: null });
}

type GenerateResponse = {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
};

/**
 * One answer to the conversation. The model that answered last goes first; on a limit or a missing
 * model the next Flash is tried.
 */
export async function askCoach(system: string, messages: readonly CoachMessage[]): Promise<string> {
  const key = state.key;
  if (!key) throw new CoachError('Manca la chiave di Gemini');
  const list = await models(key);
  const order = state.model && list.includes(state.model) ? [state.model, ...list.filter((m) => m !== state.model)] : list;
  let last: unknown = null;
  for (const model of order.slice(0, 3)) {
    try {
      const result = (await call(`models/${model}:generateContent`, key, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: messages.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
        }),
      })) as GenerateResponse;
      if (result.promptFeedback?.blockReason) throw new CoachError('Gemini non ha voluto rispondere a questa domanda');
      const candidate = result.candidates?.[0];
      const text = (candidate?.content?.parts ?? [])
        .filter((p) => !p.thought)
        .map((p) => p.text ?? '')
        .join('')
        .trim();
      if (!text) throw new CoachError(candidate?.finishReason === 'SAFETY' ? 'Gemini non ha voluto rispondere a questa domanda' : 'Risposta vuota, riprova');
      if (model !== state.model) set({ model });
      return text;
    } catch (e) {
      last = e;
      const status = (e as { status?: number }).status;
      if (status !== 429 && status !== 404 && !(status && status >= 500)) throw e;
    }
  }
  throw last instanceof Error ? last : new CoachError('Gemini non risponde');
}

export function coachFailure(e: unknown): string {
  return e instanceof CoachError ? e.message : 'Qualcosa non è andato, riprova';
}
