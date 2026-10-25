import { useSyncExternalStore } from 'react';

import type { RecipeIngredient } from '@/lib/recipes';

/**
 * The recipe being edited. It lives outside React so that the "add food" modal, opened to
 * pick an ingredient, can add to it and close, leaving the editor underneath up to date.
 */
export type RecipeDraft = {
  /** The recipe's food id, or null for a new recipe. */
  id: number | null;
  name: string;
  cookedWeight: string;
  servings: string;
  ingredients: DraftIngredient[];
};

/** `uid` keeps list rows stable when ingredients are removed. */
export type DraftIngredient = RecipeIngredient & { uid: number };

let nextUid = 1;
const withUid = (ingredient: RecipeIngredient): DraftIngredient => ({ ...ingredient, uid: nextUid++ });

const EMPTY: RecipeDraft = { id: null, name: '', cookedWeight: '', servings: '', ingredients: [] };

let draft: RecipeDraft = EMPTY;
const listeners = new Set<() => void>();

function update(next: RecipeDraft): void {
  draft = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useRecipeDraft(): RecipeDraft {
  return useSyncExternalStore(subscribe, () => draft);
}

export const recipeDraft = {
  start(initial: Partial<Omit<RecipeDraft, 'ingredients'>> & { ingredients?: RecipeIngredient[] } = {}): void {
    update({ ...EMPTY, ...initial, ingredients: (initial.ingredients ?? []).map(withUid) });
  },
  set(fields: Partial<Omit<RecipeDraft, 'ingredients'>>): void {
    update({ ...draft, ...fields });
  },
  addIngredient(ingredient: RecipeIngredient): void {
    update({ ...draft, ingredients: [...draft.ingredients, withUid(ingredient)] });
  },
  setQuantity(index: number, quantity: number): void {
    update({
      ...draft,
      ingredients: draft.ingredients.map((ing, i) => (i === index ? { ...ing, quantity } : ing)),
    });
  },
  removeIngredient(index: number): void {
    update({ ...draft, ingredients: draft.ingredients.filter((_, i) => i !== index) });
  },
};
