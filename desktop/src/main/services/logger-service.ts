import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

/**
 * LoggerService — file-based diagnostic log for the main process.
 *
 * Why we don't just rely on Electron's stdout:
 *   - Packaged macOS apps don't show stdout anywhere unless launched
 *     from a terminal. The support team can't ask non-technical users to
 *     run `Console.app` and filter by process name.
 *   - A predictable file path lets us add "Open log folder" + "Export
 *     latest log" UI affordances in Settings → About.
 *
 * Layout: `<userData>/logs/main-YYYY-MM-DD.log` — one file per day, no
 * mid-day rotation. On startup we delete log files older than
 * `LOG_RETENTION_DAYS` so users don't accumulate forever-growing log dirs.
 *
 * Severity policy: every call goes through `log(level, ...args)`. We
 * mirror to console (so `pnpm dev` still shows it in the terminal) and
 * append a single line to the day's log file. No JSON, no timestamps in
 * the args — the file format is `[ISO_TIMESTAMP] LEVEL message...`, plain
 * text for easy `tail -f` + `grep`.
 */

const LOG_RETENTION_DAYS = 14;
type Level = 'info' | 'warn' | 'error';

let logDir: string | null = null;
let installed = false;

function getLogDir(): string {
  if (logDir) return logDir;
  logDir = join(app.getPath('userData'), 'logs');
  if (!existsSync(logDir)) {
    try {
      mkdirSync(logDir, { recursive: true });
    } catch {
      // Best-effort: if the dir can't be created we fall back to
      // console-only and never throw — logging shouldn't crash the app.
    }
  }
  return logDir;
}

function currentLogFile(): string {
  const dir = getLogDir();
  const today = new Date().toISOString().slice(0, 10);
  return join(dir, `main-${today}.log`);
}

function writeLine(level: Level, args: unknown[]): void {
  const timestamp = new Date().toISOString();
  const message = args
    .map((arg) => {
      if (arg instanceof Error) return `${arg.message}\n${arg.stack ?? ''}`;
      if (typeof arg === 'object' && arg !== null) {
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    })
    .join(' ');
  try {
    appendFileSync(currentLogFile(), `[${timestamp}] ${level.toUpperCase()} ${message}\n`);
  } catch {
    // Best-effort: never crash the app because we couldn't write a log.
  }
}

function pruneOldLogs(): void {
  const dir = getLogDir();
  try {
    const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    for (const file of readdirSync(dir)) {
      if (!file.startsWith('main-') || !file.endsWith('.log')) continue;
      const fullPath = join(dir, file);
      try {
        const stat = statSync(fullPath);
        if (stat.mtimeMs < cutoff) {
          unlinkSync(fullPath);
        }
      } catch {
        // Skip files we can't stat/delete; keep retention best-effort.
      }
    }
  } catch {
    // Dir doesn't exist or unreadable — nothing to prune.
  }
}

/**
 * Install the file-logger. Patches `console.log/warn/error` to mirror
 * to both stdout AND the daily log file. Idempotent — safe to call
 * multiple times. Run pruning once on install.
 */
export function installLogger(): void {
  if (installed) return;
  installed = true;
  pruneOldLogs();
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  console.log = (...args: unknown[]): void => {
    writeLine('info', args);
    origLog(...args);
  };
  console.warn = (...args: unknown[]): void => {
    writeLine('warn', args);
    origWarn(...args);
  };
  console.error = (...args: unknown[]): void => {
    writeLine('error', args);
    origError(...args);
  };
}

export function getLogDirPath(): string {
  return getLogDir();
}
