import { monotonicFactory } from 'ulid';

const monotonicUlid = monotonicFactory();

/**
 * Returns a 26-character ULID. Monotonic within a single process.
 * Used as primary key for all rows in app.sqlite (per spec §3 原则 5).
 */
export function newId(): string {
  return monotonicUlid();
}
