import { describe, expect, it } from 'vitest';

import { shareEqual } from '../share-equal';

describe('shareEqual', () => {
  it('keeps the previous object when nothing changed', () => {
    const previous = { a: 1, list: [{ id: 1 }, { id: 2 }] };
    expect(shareEqual(previous, { a: 1, list: [{ id: 1 }, { id: 2 }] })).toBe(previous);
  });

  it('keeps the unchanged parts of a changed result', () => {
    const previous = { list: [{ id: 1, done: false }, { id: 2, done: false }] };
    const next = shareEqual(previous, { list: [{ id: 1, done: true }, { id: 2, done: false }] });
    expect(next).not.toBe(previous);
    expect(next.list[0]).toEqual({ id: 1, done: true });
    expect(next.list[1]).toBe(previous.list[1]);
  });

  it('sees added and removed keys and items', () => {
    expect(shareEqual({ a: 1 }, { a: 1, b: 2 })).toEqual({ a: 1, b: 2 });
    expect(shareEqual({ a: 1, b: 2 }, { a: 1 })).toEqual({ a: 1 });
    const previous = [1, 2];
    expect(shareEqual(previous, [1, 2, 3])).toEqual([1, 2, 3]);
    expect(shareEqual([1, 2, 3], [1, 2])).toEqual([1, 2]);
  });

  it('does not look inside sets, maps or dates', () => {
    const next = new Set([1]);
    expect(shareEqual(new Set([1]), next)).toBe(next);
  });
});
