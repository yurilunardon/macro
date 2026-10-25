/// <reference types="node" />
/**
 * Runs the app's database code on Node's built-in SQLite, so the real SQL is tested without a phone.
 * Implements only the parts of expo-sqlite's SQLiteDatabase that the app uses.
 */
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import type { SQLiteDatabase } from 'expo-sqlite';

type Params = SQLInputValue[];

function flatten(params: unknown[]): Params {
  if (params.length === 1 && Array.isArray(params[0])) return params[0] as Params;
  return params as Params;
}

class TestDatabase {
  constructor(readonly raw: DatabaseSync) {}

  async execAsync(source: string) {
    this.raw.exec(source);
  }

  async runAsync(source: string, ...params: unknown[]) {
    const result = this.raw.prepare(source).run(...flatten(params));
    return { lastInsertRowId: Number(result.lastInsertRowid), changes: Number(result.changes) };
  }

  async getAllAsync(source: string, ...params: unknown[]) {
    return this.raw.prepare(source).all(...flatten(params)).map((row) => ({ ...row }));
  }

  async getFirstAsync(source: string, ...params: unknown[]) {
    const row = this.raw.prepare(source).get(...flatten(params));
    return row ? { ...row } : null;
  }

  async prepareAsync(source: string) {
    const statement = this.raw.prepare(source);
    return {
      executeAsync: async (params: Params) => statement.run(...params),
      finalizeAsync: async () => {},
    };
  }

  async withExclusiveTransactionAsync(task: (tx: TestDatabase) => Promise<void>) {
    this.raw.exec('BEGIN');
    try {
      await task(this);
      this.raw.exec('COMMIT');
    } catch (error) {
      this.raw.exec('ROLLBACK');
      throw error;
    }
  }
}

export function createTestDatabase(): SQLiteDatabase {
  return new TestDatabase(new DatabaseSync(':memory:')) as unknown as SQLiteDatabase;
}
