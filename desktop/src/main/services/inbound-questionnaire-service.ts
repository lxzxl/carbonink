import { randomUUID } from 'node:crypto';
import type { CustomerService } from '@main/services/customer-service.js';
import {
  type ParsedXlsxAnswer,
  parseInboundXlsx,
  renderInboundXlsx,
} from '@main/services/excel-template-renderer.js';
import {
  CAT1_SUPPLIER_DISCLOSURE,
  getInboundTemplate,
} from '@main/services/inbound-templates/index.js';
import type {
  ImportPreview,
  ImportPreviewAnswer,
  ImportPreviewWarning,
  InboundTemplate,
  InboundTemplateKind,
  Question,
  Questionnaire,
  Supplier,
  Tier,
} from '@shared/types';
import type { Database } from 'better-sqlite3';

/**
 * Service orchestrating the v2.0 inbound questionnaire lifecycle:
 *
 *   draft  →  sent  →  received  →  ingested
 *   (T3)     (T6)      (T7)         (T8)
 *
 * Each transition is owned by its task in the implementation plan; this
 * file lands incrementally. v2.0 ships exactly one method here (T3:
 * `createDraft`); the rest (`exportBlankXlsx` / `importFilledXlsx` /
 * `getIngestPreview` / `ingest`) follow in T6–T8.
 *
 * The service is intentionally side-effect-isolated:
 *
 *  - All writes go through a single `db.transaction` so a partial draft
 *    creation can never leave dangling question rows pointing at a
 *    non-existent questionnaire.
 *  - The clock is injectable via `deps.now` so tests can pin timestamps.
 *  - Foreign references (supplier, reporting period) are validated
 *    against the DB before the transaction opens — pure validation
 *    failures don't take out a transaction slot.
 */
export class InboundQuestionnaireService {
  constructor(
    private readonly deps: {
      db: Database;
      customerService: Pick<CustomerService, 'listSuppliers'>;
      /** Injectable for tests; defaults to `new Date().toISOString()`. */
      now?: () => string;
    },
  ) {}

  /**
   * Materialize an inbound questionnaire draft.
   *
   * Resolves the template, validates the supplier + period FKs, then
   * writes one questionnaire row (status='draft', direction='inbound',
   * document_id=NULL) plus one `question` row per checked template
   * position. The template's `tier`, `kind`, and `expected_unit` carry
   * onto the question row verbatim; `question_signature` is derived from
   * the template kind + version + position so the same template position
   * always produces the same signature across different suppliers (lets
   * us aggregate "all Tier 2 totals across all suppliers for 2025"
   * cheaply in future analytics).
   *
   * Throws:
   *  - `InboundSupplierNotFound` if `supplier_id` isn't a role='supplier' row.
   *  - `InboundPeriodNotFound` if `reporting_period_id` doesn't exist.
   *  - `InboundUnknownTemplate` if `template_kind` isn't registered.
   *  - `InboundNoQuestionsIncluded` if `included_question_positions` is empty
   *    or doesn't intersect the template's positions.
   *
   * Returns `{ questionnaire_id, question_count }` so the caller (the IPC
   * handler / wizard) can route the user to the detail page.
   */
  createDraft(input: {
    supplier_id: string;
    reporting_period_id: string;
    template_kind: InboundTemplateKind;
    included_question_positions: readonly string[];
  }): { questionnaire_id: string; question_count: number } {
    // --- Pre-flight validation -------------------------------------------
    // Done before the transaction opens: pure SELECTs against committed
    // state, no rollback cost on rejection.

    const supplier = this.findSupplier(input.supplier_id);
    if (!supplier) {
      throw new InboundSupplierNotFound(input.supplier_id);
    }

    const period = this.findReportingPeriod(input.reporting_period_id);
    if (!period) {
      throw new InboundPeriodNotFound(input.reporting_period_id);
    }

    // `getInboundTemplate` throws on unknown kind — convert to our typed
    // error so callers can pattern-match instead of string-sniffing.
    let template: ReturnType<typeof getInboundTemplate>;
    try {
      template = getInboundTemplate(input.template_kind);
    } catch {
      throw new InboundUnknownTemplate(input.template_kind);
    }

    const includedSet = new Set(input.included_question_positions);
    const selectedQuestions = template.questions.filter((q) => includedSet.has(q.position));
    if (selectedQuestions.length === 0) {
      throw new InboundNoQuestionsIncluded(input.template_kind);
    }

    // --- Transaction body ------------------------------------------------

    const nowFn = this.deps.now ?? (() => new Date().toISOString());
    const questionnaireId = randomUUID();
    const createdAt = nowFn();

    const tx = this.deps.db.transaction(() => {
      this.deps.db
        .prepare(
          `INSERT INTO questionnaire
             (id, customer_id, document_id, template_kind, reporting_year,
              status, direction, due_date, created_at)
           VALUES (?, ?, NULL, ?, ?, 'draft', 'inbound', NULL, ?)`,
        )
        .run(questionnaireId, supplier.id, template.template_kind, period.year, createdAt);

      const insertQ = this.deps.db.prepare(
        `INSERT INTO question (
           id, questionnaire_id, question_signature, signature_version,
           normalized_text, raw_text, parsed_intent, question_kind,
           expected_unit, position, required, tier
         ) VALUES (?, ?, ?, 'v1', ?, ?, NULL, ?, ?, ?, ?, ?)`,
      );

      // Position order in the template is the canonical UX order; preserve
      // it in `question.position` so the detail page renders top-to-bottom
      // the same way every time.
      for (const tq of selectedQuestions) {
        // Metadata questions (`tier: null`) are required; tier questions are
        // optional because suppliers can fill any tier subset.
        const required = tq.tier === null ? 1 : 0;
        insertQ.run(
          randomUUID(),
          questionnaireId,
          buildSignature(template.template_kind, template.version, tq.position),
          tq.raw_zh,
          tq.raw_zh,
          tq.kind,
          tq.expected_unit,
          tq.position,
          required,
          tq.tier,
        );
      }
    });
    tx();

    return {
      questionnaire_id: questionnaireId,
      question_count: selectedQuestions.length,
    };
  }

  /**
   * Export the inbound questionnaire as a fillable xlsx Buffer.
   *
   * Status machine:
   *   draft → sent (first export; emits audit row)
   *   sent  → sent (re-export, e.g. supplier lost the file; no audit)
   *
   * Any other status is rejected — exporting a `received` or `ingested`
   * questionnaire would risk overwriting completed work, and there's no
   * use case for exporting an outbound questionnaire through this path.
   *
   * Idempotent on `status='sent'`: the second export produces a fresh
   * Buffer (the underlying template + supplier name + period haven't
   * changed) but does NOT re-audit. The intent is that "I lost the
   * file, send me another copy" doesn't pollute the audit trail with
   * spurious supplier-engagement events.
   */
  async exportBlankXlsx(questionnaireId: string): Promise<Buffer> {
    const qn = this.findQuestionnaire(questionnaireId);
    if (!qn) {
      throw new InboundQuestionnaireNotFound(questionnaireId);
    }
    if (qn.direction !== 'inbound') {
      throw new InboundWrongDirection({
        questionnaire_id: questionnaireId,
        actual: qn.direction,
      });
    }
    if (qn.status !== 'draft' && qn.status !== 'sent') {
      throw new InboundWrongStatus({
        questionnaire_id: questionnaireId,
        actual: qn.status,
        allowed: ['draft', 'sent'],
      });
    }

    // Resolve the side-data: supplier, period, our org, the questions actually
    // attached to this draft (so we honor whatever subset the wizard picked).
    const supplier = this.findSupplier(qn.customer_id);
    if (!supplier) {
      // Should be impossible if createDraft ran cleanly — supplier was
      // validated then. Surfaces a typed error rather than a sentinel
      // string mismatch later.
      throw new InboundSupplierNotFound(qn.customer_id);
    }

    const periodYear = qn.reporting_year;

    const org = this.findCurrentOrg();
    if (!org) {
      throw new InboundOrgMissing();
    }

    // Template_kind on the row is the source of truth for which template
    // to render against — the user might have shipped multiple templates
    // by v2.x and we mustn't accidentally render the wrong one.
    const template = getInboundTemplate(qn.template_kind as InboundTemplateKind);

    // Which positions are included? Read straight from `question` rows
    // since createDraft only inserts the checked subset.
    const includedPositions = this.findIncludedPositions(questionnaireId);

    const buf = await renderInboundXlsx({
      template,
      questionnaireId,
      supplierName: supplier.name,
      periodYear,
      myOrgName: org.name,
      dueDate: null, // due_date column isn't filled on inbound drafts in v2.0
      includedPositions,
    });

    // Status transition + audit only on the FIRST export. Re-exports
    // from 'sent' just return a fresh buffer without bumping audit.
    const wasFirstExport = qn.status === 'draft';
    if (wasFirstExport) {
      const nowFn = this.deps.now ?? (() => new Date().toISOString());
      const occurredAt = nowFn();
      const tx = this.deps.db.transaction(() => {
        this.deps.db
          .prepare(`UPDATE questionnaire SET status = 'sent' WHERE id = ?`)
          .run(questionnaireId);
        this.deps.db
          .prepare(
            `INSERT INTO audit_event (id, event_kind, payload, occurred_at) VALUES (?, ?, ?, ?)`,
          )
          .run(
            randomUUID(),
            'inbound_questionnaire.exported',
            JSON.stringify({
              questionnaire_id: questionnaireId,
              supplier_id: supplier.id,
              template_kind: template.template_kind,
              question_count: includedPositions.length,
              period_year: periodYear,
            }),
            occurredAt,
          );
      });
      tx();
    }

    return buf;
  }

  /**
   * Parse a supplier-filled xlsx, write tentative answer rows, transition
   * status to `'received'`, and return an ImportPreview the review UI
   * renders for human approval.
   *
   * Status machine:
   *   sent     → received (first import, emits audit row)
   *   received → received (re-import — supplier sent a corrected file)
   *
   * Re-imports DO emit a fresh audit row. Unlike re-exports (which are
   * silent "the supplier lost the file" events), a re-import means the
   * supplier sent revised numbers — meaningful provenance worth keeping.
   *
   * Each call wipes all existing tentative-answer rows (source_kind=
   * 'manual', finalized_at IS NULL) for this questionnaire before
   * writing the parsed set. This avoids stale rows when the supplier
   * fills fewer fields the second time around.
   *
   * Hard failures (sentinel mismatch, etc.) bubble up from the parser
   * as typed errors; no DB writes happen if parse fails.
   */
  async importFilledXlsx(
    questionnaireId: string,
    fileBytes: Buffer | ArrayBuffer,
  ): Promise<ImportPreview> {
    const ctx = this.loadIngestContext(questionnaireId, ['sent', 'received']);
    const parsed = await parseInboundXlsx({
      fileBytes,
      template: ctx.template,
      expectedQuestionnaireId: questionnaireId,
      expectedPeriodYear: ctx.questionnaire.reporting_year,
    });

    const nowFn = this.deps.now ?? (() => new Date().toISOString());
    const occurredAt = nowFn();
    const isFirstImport = ctx.questionnaire.status === 'sent';

    const tx = this.deps.db.transaction(() => {
      this.wipeTentativeAnswers(questionnaireId);
      this.upsertTentativeAnswers(parsed.answers, ctx.questionsByPosition);
      this.deps.db
        .prepare(`UPDATE questionnaire SET status = 'received' WHERE id = ?`)
        .run(questionnaireId);
      this.deps.db
        .prepare(
          `INSERT INTO audit_event (id, event_kind, payload, occurred_at) VALUES (?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          'inbound_questionnaire.imported',
          JSON.stringify({
            questionnaire_id: questionnaireId,
            supplier_id: ctx.supplier.id,
            is_first_import: isFirstImport,
            answer_count: parsed.answers.filter((a) => !a.is_blank).length,
            blank_count: parsed.answers.filter((a) => a.is_blank).length,
            warning_count: parsed.warnings.length,
          }),
          occurredAt,
        );
    });
    tx();

    return this.buildImportPreview(ctx, parsed.answers, parsed.warnings);
  }

  /**
   * Idempotently re-build the ImportPreview from already-imported tentative
   * answers — without re-parsing the xlsx. Lets the review page survive
   * navigation: user can leave and come back without re-uploading the file.
   *
   * Requires status='received'. Imports + re-imports both leave the
   * questionnaire in this state until {@link ingest} runs.
   */
  getIngestPreview(questionnaireId: string): ImportPreview {
    const ctx = this.loadIngestContext(questionnaireId, ['received']);

    // Reconstruct ParsedXlsxAnswer[] from the tentative rows on disk.
    const tentativeRows = this.deps.db
      .prepare(
        `SELECT q.position, q.tier, q.question_kind, a.value, a.unit
           FROM answer a
           JOIN question q ON q.id = a.question_id
          WHERE q.questionnaire_id = ?
            AND a.source_kind = 'manual'
            AND a.finalized_at IS NULL`,
      )
      .all(questionnaireId) as Array<{
      position: string;
      tier: Tier | null;
      question_kind: 'numerical' | 'categorical' | 'narrative';
      value: string;
      unit: string | null;
    }>;

    const byPosition = new Map(tentativeRows.map((r) => [r.position, r]));

    const answers: ParsedXlsxAnswer[] = ctx.template.questions.map((q) => {
      const row = byPosition.get(q.position);
      if (!row || row.value === '') {
        return { position: q.position, raw_value: '', parsed_value: null, is_blank: true };
      }
      if (q.kind === 'numerical') {
        const n = Number.parseFloat(row.value);
        return {
          position: q.position,
          raw_value: row.value,
          parsed_value: Number.isFinite(n) ? n : null,
          is_blank: false,
        };
      }
      return {
        position: q.position,
        raw_value: row.value,
        parsed_value: row.value,
        is_blank: false,
      };
    });

    // Re-deriving warnings from the DB is lossy (we didn't persist them).
    // Acceptable: the warnings on first import were already surfaced via
    // the audit row's payload counts; the re-opened review just shows the
    // computed `ingestion_plan` + per-answer view. Real soft-warning
    // surfacing happens on the import call itself.
    return this.buildImportPreview(ctx, answers, []);
  }

  // ---------------------------------------------------------------------
  // Internal helpers (intentionally narrow — no exported reach to
  // questionnaire-service or customer-service from here)
  // ---------------------------------------------------------------------

  /**
   * Bundle the cross-table reads needed by both `importFilledXlsx` and
   * `getIngestPreview` — saves duplicated lookups across the two paths.
   * Validates `direction='inbound'` and `status` against an allowlist.
   */
  private loadIngestContext(
    questionnaireId: string,
    allowedStatuses: readonly string[],
  ): {
    questionnaire: Questionnaire;
    supplier: Supplier;
    template: InboundTemplate;
    questionsByPosition: Map<string, Question>;
  } {
    const qn = this.findQuestionnaire(questionnaireId);
    if (!qn) throw new InboundQuestionnaireNotFound(questionnaireId);
    if (qn.direction !== 'inbound') {
      throw new InboundWrongDirection({
        questionnaire_id: questionnaireId,
        actual: qn.direction,
      });
    }
    if (!allowedStatuses.includes(qn.status)) {
      throw new InboundWrongStatus({
        questionnaire_id: questionnaireId,
        actual: qn.status,
        allowed: allowedStatuses,
      });
    }
    const supplier = this.findSupplier(qn.customer_id);
    if (!supplier) throw new InboundSupplierNotFound(qn.customer_id);
    const template = getInboundTemplate(qn.template_kind as InboundTemplateKind);
    const questions = this.deps.db
      .prepare(`SELECT * FROM question WHERE questionnaire_id = ?`)
      .all(questionnaireId) as Question[];
    const questionsByPosition = new Map(
      questions
        .filter((q): q is Question & { position: string } => q.position !== null)
        .map((q) => [q.position, q]),
    );
    return { questionnaire: qn, supplier, template, questionsByPosition };
  }

  private wipeTentativeAnswers(questionnaireId: string): void {
    this.deps.db
      .prepare(
        `DELETE FROM answer
           WHERE source_kind = 'manual'
             AND finalized_at IS NULL
             AND question_id IN (SELECT id FROM question WHERE questionnaire_id = ?)`,
      )
      .run(questionnaireId);
  }

  private upsertTentativeAnswers(
    parsedAnswers: readonly ParsedXlsxAnswer[],
    questionsByPosition: Map<string, Question>,
  ): void {
    const insert = this.deps.db.prepare(
      `INSERT INTO answer (id, question_id, value, unit, source_kind, source_summary, finalized_at)
       VALUES (?, ?, ?, ?, 'manual', ?, NULL)`,
    );
    for (const ans of parsedAnswers) {
      if (ans.is_blank) continue;
      const q = questionsByPosition.get(ans.position);
      if (!q) continue;
      // `value` is NOT NULL; stringify whatever parsed_value we got.
      const value =
        ans.parsed_value === null
          ? ans.raw_value
          : typeof ans.parsed_value === 'number'
            ? String(ans.parsed_value)
            : ans.parsed_value;
      insert.run(
        randomUUID(),
        q.id,
        value,
        q.expected_unit,
        JSON.stringify({ source: 'inbound_questionnaire', tier: q.tier, position: ans.position }),
      );
    }
  }

  /**
   * Assemble the ImportPreview from parsed answers + warnings + the
   * loaded context. Tier 1 wins over Tier 2 when both are filled;
   * neither filled → `tier_selected = null` and ingestion is a no-op.
   *
   * `proposed_activity` is materialized only for Tier 2's kgCO2e cell
   * (position `tier2.3` in the v2.0 template). Tier 1 needs the user's
   * purchased quantity supplied at ingest time, so the preview shows
   * the per-kg PCF but no proposed activity row.
   */
  private buildImportPreview(
    ctx: {
      questionnaire: Questionnaire;
      supplier: Supplier;
      template: InboundTemplate;
      questionsByPosition: Map<string, Question>;
    },
    parsedAnswers: readonly ParsedXlsxAnswer[],
    parserWarnings: readonly ImportPreviewWarning[],
  ): ImportPreview {
    const byPos = new Map(parsedAnswers.map((a) => [a.position, a]));
    const tierSelected = selectTier(ctx.template, byPos);

    const answers: ImportPreviewAnswer[] = ctx.template.questions.map((tq) => {
      const ans = byPos.get(tq.position) ?? {
        position: tq.position,
        raw_value: '',
        parsed_value: null as number | string | null,
        is_blank: true,
      };
      const q = ctx.questionsByPosition.get(tq.position);
      const proposed = computeProposedActivity(tq, ans, tierSelected);
      return {
        question_id: q?.id ?? '',
        position: tq.position,
        tier: tq.tier,
        raw_value: ans.raw_value,
        parsed_value: ans.parsed_value,
        is_blank: ans.is_blank,
        proposed_activity: proposed,
      };
    });

    // Per-question warnings need their question_id stamped in. The parser
    // can't know the question_id (only positions), so we resolve here.
    const warningsWithIds = parserWarnings.map((w) => {
      if (w.question_id !== null) return w;
      // The detail string mentions a position; extract the first one
      // matching a template question position and resolve.
      const matched = ctx.template.questions.find((tq) => w.detail.includes(tq.position));
      if (!matched) return w;
      const q = ctx.questionsByPosition.get(matched.position);
      return { ...w, question_id: q?.id ?? null };
    });

    const year = ctx.questionnaire.reporting_year;
    const emissionSourceName = `${ctx.supplier.name} — purchased goods (${year})`;
    const totalCo2eKg = answers
      .map((a) => a.proposed_activity?.co2e_kg ?? 0)
      .reduce((acc, v) => acc + v, 0);
    const activityRowCount = answers.filter((a) => a.proposed_activity !== null).length;

    return {
      questionnaire_id: ctx.questionnaire.id,
      supplier_name: ctx.supplier.name,
      warnings: warningsWithIds,
      answers,
      ingestion_plan: {
        tier_selected: tierSelected,
        emission_source_name: emissionSourceName,
        activity_row_count: activityRowCount,
        total_co2e_kg: totalCo2eKg,
      },
    };
  }

  private findQuestionnaire(id: string): Questionnaire | null {
    const row = this.deps.db.prepare(`SELECT * FROM questionnaire WHERE id = ?`).get(id) as
      | Questionnaire
      | undefined;
    return row ?? null;
  }

  private findIncludedPositions(questionnaireId: string): string[] {
    return (
      this.deps.db
        .prepare(
          `SELECT position FROM question
             WHERE questionnaire_id = ? AND position IS NOT NULL
             ORDER BY position`,
        )
        .all(questionnaireId) as Pick<Question, 'position'>[]
    )
      .map((r) => r.position)
      .filter((p): p is string => p !== null);
  }

  private findCurrentOrg(): { id: string; name: string } | null {
    // Organization is a singleton (CHECK(singleton_key = 1) UNIQUE), so
    // LIMIT 1 is the canonical "current org" lookup.
    const row = this.deps.db
      .prepare(`SELECT id, name_zh, name_en FROM organization LIMIT 1`)
      .get() as { id: string; name_zh: string | null; name_en: string | null } | undefined;
    if (!row) return null;
    // Prefer zh name on the supplier-facing xlsx (suppliers in v2.0 are
    // assumed Chinese-speaking — Cat 1 disclosure is a domestic supply-
    // chain use case). Fall through to en name; final fallback is id.
    return {
      id: row.id,
      name: row.name_zh ?? row.name_en ?? row.id,
    };
  }

  private findSupplier(supplierId: string): Supplier | null {
    // Could call `customerService.listSuppliers()` + .find, but that's
    // O(N) per call; a direct SELECT with role-scoped WHERE is the same
    // pattern customer-service uses internally and avoids round-tripping
    // through an array allocation.
    const row = this.deps.db
      .prepare(`SELECT id, name, notes, role FROM customer WHERE id = ? AND role = 'supplier'`)
      .get(supplierId) as Supplier | undefined;
    return row ?? null;
  }

  private findReportingPeriod(periodId: string): { id: string; year: number } | null {
    const row = this.deps.db
      .prepare(`SELECT id, year FROM reporting_period WHERE id = ?`)
      .get(periodId) as { id: string; year: number } | undefined;
    return row ?? null;
  }
}

// ---------------------------------------------------------------------
// Tagged errors — flat plain-Error subclasses so the IPC sanitize layer
// can pattern-match on `instanceof` without needing Effect's Data
// machinery (this service isn't Effect-wrapped in v2.0).
// ---------------------------------------------------------------------

export class InboundSupplierNotFound extends Error {
  readonly _tag = 'InboundSupplierNotFound' as const;
  constructor(public readonly supplier_id: string) {
    super(`Supplier not found: ${supplier_id}`);
  }
}

export class InboundPeriodNotFound extends Error {
  readonly _tag = 'InboundPeriodNotFound' as const;
  constructor(public readonly reporting_period_id: string) {
    super(`Reporting period not found: ${reporting_period_id}`);
  }
}

export class InboundUnknownTemplate extends Error {
  readonly _tag = 'InboundUnknownTemplate' as const;
  constructor(public readonly template_kind: string) {
    super(`Unknown inbound template kind: ${template_kind}`);
  }
}

export class InboundNoQuestionsIncluded extends Error {
  readonly _tag = 'InboundNoQuestionsIncluded' as const;
  constructor(public readonly template_kind: string) {
    super(
      `No questions selected from template "${template_kind}" — at least one position must be included.`,
    );
  }
}

export class InboundQuestionnaireNotFound extends Error {
  readonly _tag = 'InboundQuestionnaireNotFound' as const;
  constructor(public readonly questionnaire_id: string) {
    super(`Inbound questionnaire not found: ${questionnaire_id}`);
  }
}

export class InboundWrongDirection extends Error {
  readonly _tag = 'InboundWrongDirection' as const;
  constructor(public readonly details: { questionnaire_id: string; actual: string }) {
    super(
      `Operation requires direction='inbound', but questionnaire ${details.questionnaire_id} is direction='${details.actual}'.`,
    );
  }
}

export class InboundWrongStatus extends Error {
  readonly _tag = 'InboundWrongStatus' as const;
  constructor(
    public readonly details: {
      questionnaire_id: string;
      actual: string;
      allowed: readonly string[];
    },
  ) {
    super(
      `Inbound questionnaire ${details.questionnaire_id} has status='${details.actual}'; ` +
        `operation requires one of: ${details.allowed.join(', ')}.`,
    );
  }
}

export class InboundOrgMissing extends Error {
  readonly _tag = 'InboundOrgMissing' as const;
  constructor() {
    super(
      'No organization row found — complete onboarding before creating inbound questionnaires.',
    );
  }
}

// ---------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------

/**
 * Build a stable `question_signature` from template_kind + version + position.
 *
 * Why stable: signatures let v2.x analytics aggregate across questionnaires
 * (e.g. "all `tier1.1` PCF values across our 2025 supplier disclosures").
 * If we re-derived the signature from `raw_text` like outbound does, every
 * cosmetic copy edit in `cat1.ts` would shatter the historical match.
 *
 * Format: `inbound:{template_kind}:{version}:{position}`. Outbound uses
 * arbitrary hashed strings; the explicit `inbound:` prefix keeps the two
 * signature namespaces from ever colliding.
 */
function buildSignature(
  templateKind: InboundTemplateKind,
  version: string,
  position: string,
): string {
  return `inbound:${templateKind}:${version}:${position}`;
}

// Re-export the template constant so wizard / IPC layers can call out
// to `service.template` to enumerate positions without re-importing
// from the registry. Small ergonomic win.
export { CAT1_SUPPLIER_DISCLOSURE };

// ---------------------------------------------------------------------
// Tier selection + activity row derivation (used by importFilledXlsx
// and getIngestPreview; pulled out so both share semantics exactly).
// ---------------------------------------------------------------------

/**
 * Decide which tier the supplier's data supports, per GHG Protocol Cat 1
 * preference order:
 *  - Any Tier 1 numerical filled → Tier 1 wins
 *  - Else if every Tier 2 numerical + categorical is filled → Tier 2
 *  - Else → null (workbook returned no actionable data)
 *
 * For v2.0's Cat 1 template the Tier 2 trio is `tier2.1` (total Scope 1+2)
 * + `tier2.2` (allocation method) + `tier2.3` (attributed kgCO2e). All
 * three must be present; missing any drops to null because the audit
 * trail isn't reproducible without the methodology + magnitude pair.
 */
function selectTier(
  template: InboundTemplate,
  answersByPosition: ReadonlyMap<string, ParsedXlsxAnswer>,
): Tier | null {
  const tier1Filled = template.questions
    .filter((q) => q.tier === 1 && q.kind === 'numerical')
    .some((q) => {
      const a = answersByPosition.get(q.position);
      return a && !a.is_blank && typeof a.parsed_value === 'number';
    });
  if (tier1Filled) return 1;

  const tier2 = template.questions.filter((q) => q.tier === 2);
  if (tier2.length === 0) return null;
  const tier2AllFilled = tier2.every((q) => {
    const a = answersByPosition.get(q.position);
    return a && !a.is_blank;
  });
  return tier2AllFilled ? 2 : null;
}

/**
 * Materialize a `proposed_activity` cell for one ImportPreviewAnswer.
 * The rules:
 *  - tier_selected = 2 + this is the `tier2.3` row (attributed kgCO2e):
 *      amount = parsed_value, unit = 'kgCO2e', co2e_kg = parsed_value (1:1)
 *  - tier_selected = 1 + this is a Tier 1 numerical row:
 *      null (the per-kg PCF needs multiplication by purchase quantity
 *      which the user enters at ingest time; the preview row carries
 *      the PCF in `parsed_value` but no activity row is proposed yet)
 *  - anything else: null
 *
 * The `tier2.3` position is hard-coded here because v2.0 has exactly
 * one template. v2.x would generalize by tagging the template question
 * with a `produces_activity: true` flag.
 */
function computeProposedActivity(
  templateQuestion: InboundTemplate['questions'][number],
  parsedAnswer: ParsedXlsxAnswer,
  tierSelected: Tier | null,
): { amount: number; unit: string; co2e_kg: number } | null {
  if (tierSelected === 2 && templateQuestion.position === 'tier2.3') {
    if (
      typeof parsedAnswer.parsed_value === 'number' &&
      Number.isFinite(parsedAnswer.parsed_value)
    ) {
      return {
        amount: parsedAnswer.parsed_value,
        unit: 'kgCO2e',
        co2e_kg: parsedAnswer.parsed_value,
      };
    }
  }
  return null;
}
