import { createHash } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import archiver from 'archiver';
import type { Database } from 'better-sqlite3';

/**
 * Client deliverable bundle (spec 2026-07-23-client-deliverable-bundle):
 * one zip a consultant hands to their client / an external reviewer —
 * report PDF + xlsx appendix + copies of every evidence file attached to
 * the reporting period's activity rows + a `manifest.csv` of sha256
 * checksums, so the recipient can verify completeness offline without
 * installing CarbonInk.
 *
 * Streaming by construction: the report/appendix buffers are appended
 * directly, but evidence files go through `archive.file()` (lazy fs
 * streams with backpressure), so a period with hundreds of attachments
 * never loads them into memory at once and never blocks the main
 * process's event loop on a single synchronous read.
 */

/** One evidence row joined with its backing document + owning activity. */
type EvidenceRow = {
  activity_data_id: string;
  filename: string;
  sha256: string;
  size_bytes: number;
  storage_path: string;
};

export interface DeliverableActivityRef {
  /** activity_data.id, in report order (= the xlsx appendix row order). */
  id: string;
  /** Emission-source display name, echoed into the manifest. */
  source_name: string;
}

export interface BuildDeliverableArgs {
  db: Database;
  /** Reporting period whose evidence gets bundled. */
  periodId: string;
  /**
   * Activities in report order — the manifest's `activity_no` is the
   * 1-based index here, matching the appendix's activity sheet so a
   * reviewer can cross-reference `evidence/007-*.pdf` with appendix row 7.
   */
  activities: readonly DeliverableActivityRef[];
  reportPdf: { name: string; bytes: Buffer };
  appendixXlsx: { name: string; bytes: Buffer };
  outPath: string;
}

export interface DeliverableResult {
  /** Evidence attachments found for the period (incl. missing files). */
  evidenceTotal: number;
  /** Attachments whose on-disk file was gone — noted in the manifest. */
  evidenceMissing: number;
}

/**
 * Drop control characters and replace path separators + characters that
 * are unsafe in zip entry names or common filesystems with `_`. Keeps CJK
 * and normal punctuation — the original (user-supplied) filename should
 * stay recognizable. Guards against zip-slip style entries (`../../x`)
 * since separators can't survive. Implemented as a char-code filter, not
 * a regex, so no control-character escape has to live in this source file.
 */
const UNSAFE_FILENAME_CHARS = '\\/:*?"<>|';

function sanitizeFilename(name: string): string {
  let out = '';
  for (const ch of name) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) continue;
    out += UNSAFE_FILENAME_CHARS.includes(ch) ? '_' : ch;
  }
  const cleaned = out.trim();
  return cleaned === '' ? 'file.bin' : cleaned;
}

/** RFC 4180 field escape — mirrors audit:export-csv (always quoted). */
function csvField(value: string | number): string {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Zip entry name for one evidence file: `evidence/NNN-<original name>`,
 * NNN = zero-padded activity number. `used` dedupes collisions (same
 * activity, two attachments with the same original filename) by
 * inserting `-2`, `-3`, … before the extension.
 */
function evidenceEntryName(
  activityNo: number,
  originalFilename: string,
  used: Set<string>,
): string {
  const safe = sanitizeFilename(originalFilename);
  const prefix = String(activityNo).padStart(3, '0');
  const base = `evidence/${prefix}-${safe}`;
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  const dot = safe.lastIndexOf('.');
  const stem = dot > 0 ? safe.slice(0, dot) : safe;
  const ext = dot > 0 ? safe.slice(dot) : '';
  for (let n = 2; ; n++) {
    const candidate = `evidence/${prefix}-${stem}-${n}${ext}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}

/**
 * Assemble and write the deliverable zip. Resolves once the output file
 * is fully flushed. Missing evidence files are recorded in the manifest
 * (`status=missing`, expected sha256 still listed from the ledger) and
 * never abort the bundle — the recipient sees exactly what's absent.
 *
 * Evidence sha256 values come from the `document` table, not a re-read:
 * the store is content-addressed and immutable, so the recorded hash IS
 * the expected value a reviewer verifies the copied file against.
 */
export async function buildDeliverableBundle(
  args: BuildDeliverableArgs,
): Promise<DeliverableResult> {
  const activityNoById = new Map<string, number>();
  const sourceNameById = new Map<string, string>();
  args.activities.forEach((a, i) => {
    activityNoById.set(a.id, i + 1);
    sourceNameById.set(a.id, a.source_name);
  });

  const rows = args.db
    .prepare(
      `SELECT ea.activity_data_id, d.filename, d.sha256, d.size_bytes, d.storage_path
         FROM evidence_attachment ea
         JOIN document d ON d.id = ea.document_id
         JOIN activity_data ad ON ad.id = ea.activity_data_id
        WHERE ad.reporting_period_id = ?
          AND ea.activity_data_id IS NOT NULL
        ORDER BY ea.created_at, ea.id`,
    )
    .all(args.periodId) as EvidenceRow[];

  // Report order, then attachment insertion order within an activity.
  // Rows whose activity is somehow absent from the passed list (shouldn't
  // happen — both derive from the same period) are skipped defensively
  // rather than numbered wrong.
  const evidence = rows
    .filter((r) => activityNoById.has(r.activity_data_id))
    .sort(
      (a, b) =>
        (activityNoById.get(a.activity_data_id) ?? 0) -
        (activityNoById.get(b.activity_data_id) ?? 0),
    );

  const manifest: string[] = [
    [
      'file',
      'type',
      'sha256',
      'size_bytes',
      'activity_no',
      'activity_id',
      'source_name',
      'original_filename',
      'status',
    ].join(','),
  ];
  const manifestRow = (r: {
    file: string;
    type: string;
    sha256: string;
    size_bytes: number;
    activity_no?: number;
    activity_id?: string;
    source_name?: string;
    original_filename?: string;
    status: string;
  }): string =>
    [
      csvField(r.file),
      csvField(r.type),
      csvField(r.sha256),
      csvField(r.size_bytes),
      csvField(r.activity_no ?? ''),
      csvField(r.activity_id ?? ''),
      csvField(r.source_name ?? ''),
      csvField(r.original_filename ?? ''),
      csvField(r.status),
    ].join(',');

  return new Promise<DeliverableResult>((resolve, reject) => {
    const output = createWriteStream(args.outPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    let settledError: Error | null = null;
    let missing = 0;
    const fail = (err: Error) => {
      if (settledError) return;
      settledError = err;
      archive.destroy();
      output.destroy();
      reject(err);
    };
    output.on('error', fail);
    archive.on('error', fail);
    output.on('close', () => {
      if (!settledError) {
        resolve({ evidenceTotal: evidence.length, evidenceMissing: missing });
      }
    });
    archive.pipe(output);

    archive.append(args.reportPdf.bytes, { name: args.reportPdf.name });
    manifest.push(
      manifestRow({
        file: args.reportPdf.name,
        type: 'report',
        sha256: sha256Hex(args.reportPdf.bytes),
        size_bytes: args.reportPdf.bytes.length,
        status: 'included',
      }),
    );

    archive.append(args.appendixXlsx.bytes, { name: args.appendixXlsx.name });
    manifest.push(
      manifestRow({
        file: args.appendixXlsx.name,
        type: 'appendix',
        sha256: sha256Hex(args.appendixXlsx.bytes),
        size_bytes: args.appendixXlsx.bytes.length,
        status: 'included',
      }),
    );

    const usedNames = new Set<string>();
    for (const row of evidence) {
      const activityNo = activityNoById.get(row.activity_data_id) ?? 0;
      const common = {
        type: 'evidence',
        sha256: row.sha256,
        size_bytes: row.size_bytes,
        activity_no: activityNo,
        activity_id: row.activity_data_id,
        source_name: sourceNameById.get(row.activity_data_id) ?? '',
        original_filename: row.filename,
      };
      if (!existsSync(row.storage_path)) {
        missing += 1;
        manifest.push(manifestRow({ ...common, file: '', status: 'missing' }));
        continue;
      }
      const entryName = evidenceEntryName(activityNo, row.filename, usedNames);
      archive.file(row.storage_path, { name: entryName });
      manifest.push(manifestRow({ ...common, file: entryName, status: 'included' }));
    }

    // UTF-8 BOM so Excel opens Chinese source names correctly on
    // double-click (same rationale as audit:export-csv). Explicit
    // fromCharCode instead of an invisible literal in source.
    const bom = String.fromCharCode(0xfeff);
    archive.append(Buffer.from(`${bom}${manifest.join('\n')}\n`, 'utf8'), {
      name: 'manifest.csv',
    });

    void archive.finalize();
  });
}
