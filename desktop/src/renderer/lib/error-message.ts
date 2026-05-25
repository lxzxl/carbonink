/**
 * Convert a thrown error into a user-facing toast description, or
 * `undefined` to hide the description row entirely.
 *
 * Why this layer exists: raw IPC errors come back as strings like
 * `"Error invoking remote method 'extraction:discard': Error: IPC
 * handler extraction:discard failed [60a80cdc-...]"` — half-English
 * machine output with a correlation ID. Mixing those into otherwise
 * Chinese toasts looks like a bug and is useless to end users.
 * The localized toast TITLE already says what failed; the raw
 * details survive in the dev tools console + the on-disk log file
 * (Settings → Logs) for support work.
 *
 * Pattern Mac apps use: localized title only, no raw stack/correlation
 * ID in the user-visible toast. Power users open Console.app for the
 * details.
 *
 * Strategy:
 *  - For typed errors that we know how to translate (tagged classes
 *    like LicenseReadOnlyError), return a translated string.
 *  - For everything else (the dominant case), return `undefined`.
 *
 * Today the typed branch is empty — the helper is a no-op aside from
 * the type narrowing. As typed errors accumulate (License variants,
 * vision-unsupported, network), add cases here so the translated
 * description re-surfaces case by case.
 */
export function friendlyErrorDescription(_err: unknown): string | undefined {
  // Intentionally empty: future tagged-error cases land here. See
  // module header for the design rationale.
  return undefined;
}
