import type { Database } from 'better-sqlite3';

export interface ServiceContext {
  db: Database;
  /** Returns ISO8601 timestamp; injected for testability */
  now: () => string;
}

export function defaultNow(): string {
  return new Date().toISOString();
}
