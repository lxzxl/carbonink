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
  IngestResult,
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
        `SELECT q.position, q.tier, q.question_kind, a.value, a.unit, a.source_summary
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
      source_summary: string | null;
    }>;

    const byPosition = new Map(tentativeRows.map((r) => [r.position, r]));

    const answers: ParsedXlsxAnswer[] = ctx.template.questions.map((q) => {
      const row = byPosition.get(q.position);
      const note = row ? extractNoteFromSourceSummary(row.source_summary) : '';
      if (!row || row.value === '') {
        return { position: q.position, raw_value: '', parsed_value: null, is_blank: true, note };
      }
      if (q.kind === 'numerical') {
        const n = Number.parseFloat(row.value);
        return {
          position: q.position,
          raw_value: row.value,
          parsed_value: Number.isFinite(n) ? n : null,
          is_blank: false,
          note,
        };
      }
      return {
        position: q.position,
        raw_value: row.value,
        parsed_value: row.value,
        is_blank: false,
        note,
      };
    });

    // Re-deriving warnings from the DB is lossy (we didn't persist them).
    // Acceptable: the warnings on first import were already surfaced via
    // the audit row's payload counts; the re-opened review just shows the
    // computed `ingestion_plan` + per-answer view. Real soft-warning
    // surfacing happens on the import call itself.
    return this.buildImportPreview(ctx, answers, []);
  }

  /**
   * Convert accepted tentative answers into `activity_data` rows and mark
   * the questionnaire `'ingested'`. This is the terminal transition for
   * the v2.0 inbound flow.
   *
   * Status transitions:
   *   received → ingested (writes activity_data, finalizes answers, audits)
   *   ingested → ingested (idempotent — returns the already-created rows)
   *
   * Tier selection:
   *   Tier 1 wins when any Tier 1 numerical is in `accepted_question_ids`
   *   AND the row is non-blank. Requires `tier1_purchased_quantity` —
   *   without it we can't multiply per-kg PCF into a total. Throws
   *   InboundQuantityRequired so the UI knows to prompt for it.
   *
   *   Tier 2 wins when all of (tier2.1, tier2.2, tier2.3) are accepted
   *   AND non-blank. amount = tier2.3 value (the attributed kgCO2e).
   *
   *   Neither → "soft no-op": returns empty IngestResult, status stays
   *   `received`. The UI surfaces this as "supplier didn't return
   *   actionable data"; user can request a corrected file from supplier
   *   without re-creating the questionnaire.
   *
   * Side effects, in transaction order:
   *   1. Find-or-create emission_source for this supplier × period.
   *   2. Find-or-create the sentinel pinned_emission_factor row that
   *      satisfies activity_data.ef_* NOT NULL.
   *   3. INSERT one activity_data row carrying `inbound_question_id` +
   *      `inbound_tier` provenance.
   *   4. UPDATE accepted answers SET finalized_at = now.
   *   5. UPDATE questionnaire SET status='ingested'.
   *   6. INSERT one `inbound_questionnaire.ingested` audit_event row.
   */
  ingest(input: {
    questionnaire_id: string;
    accepted_question_ids: readonly string[];
    tier1_purchased_quantity?: number;
  }): IngestResult {
    const qn = this.findQuestionnaire(input.questionnaire_id);
    if (!qn) throw new InboundQuestionnaireNotFound(input.questionnaire_id);
    if (qn.direction !== 'inbound') {
      throw new InboundWrongDirection({
        questionnaire_id: input.questionnaire_id,
        actual: qn.direction,
      });
    }

    // --- Idempotency: replay returns the existing rows ------------------
    if (qn.status === 'ingested') {
      const existing = this.deps.db
        .prepare(
          `SELECT id, emission_source_id, computed_at
             FROM activity_data
            WHERE inbound_question_id IN (
              SELECT id FROM question WHERE questionnaire_id = ?
            )`,
        )
        .all(input.questionnaire_id) as Array<{
        id: string;
        emission_source_id: string;
        computed_at: string;
      }>;
      const first = existing[0];
      return {
        activity_data_ids: existing.map((r) => r.id),
        emission_source_id: first?.emission_source_id ?? '',
        ingested_at: first?.computed_at ?? '',
      };
    }

    if (qn.status !== 'received') {
      throw new InboundWrongStatus({
        questionnaire_id: input.questionnaire_id,
        actual: qn.status,
        allowed: ['received', 'ingested'],
      });
    }

    const supplier = this.findSupplier(qn.customer_id);
    if (!supplier) throw new InboundSupplierNotFound(qn.customer_id);

    const template = getInboundTemplate(qn.template_kind as InboundTemplateKind);
    const periodId = this.findPeriodIdByYear(qn.reporting_year);
    if (!periodId) throw new InboundPeriodNotFound(`year=${qn.reporting_year}`);

    const org = this.findCurrentOrg();
    if (!org) throw new InboundOrgMissing();
    const siteId = this.findFirstSiteForOrg(org.id);
    if (!siteId) throw new InboundSiteMissing(org.id);

    // Load accepted tentative answers — pulled into a JS-side map so we
    // can index by position without an N+1 query per template question.
    const acceptedSet = new Set(input.accepted_question_ids);
    const tentative = this.deps.db
      .prepare(
        `SELECT q.id as question_id, q.position, q.tier, q.question_kind, a.value, a.source_summary
           FROM answer a JOIN question q ON q.id = a.question_id
          WHERE q.questionnaire_id = ?
            AND a.source_kind = 'manual'
            AND a.finalized_at IS NULL`,
      )
      .all(input.questionnaire_id) as Array<{
      question_id: string;
      position: string;
      tier: Tier | null;
      question_kind: 'numerical' | 'categorical' | 'narrative';
      value: string;
      source_summary: string | null;
    }>;
    const acceptedRows = tentative.filter((t) => acceptedSet.has(t.question_id));
    const byPosition = new Map(acceptedRows.map((r) => [r.position, r]));

    const tierSelected = decideTierFromAccepted(template, byPosition);

    // --- Soft no-op: insufficient data --------------------------------
    if (tierSelected === null) {
      return {
        activity_data_ids: [],
        emission_source_id: '',
        ingested_at: '',
      };
    }

    // --- Compute the activity_data amount + co2e ---------------------
    let amountCo2eKg: number;
    let chosenQuestionId: string;
    let chosenNote = '';
    if (tierSelected === 1) {
      if (
        typeof input.tier1_purchased_quantity !== 'number' ||
        !Number.isFinite(input.tier1_purchased_quantity)
      ) {
        throw new InboundQuantityRequired(input.questionnaire_id);
      }
      const tier1Row = byPosition.get('tier1.1');
      if (!tier1Row) throw new InboundQuantityRequired(input.questionnaire_id);
      const pcf = Number.parseFloat(tier1Row.value);
      if (!Number.isFinite(pcf)) throw new InboundQuantityRequired(input.questionnaire_id);
      amountCo2eKg = pcf * input.tier1_purchased_quantity;
      chosenQuestionId = tier1Row.question_id;
      chosenNote = extractNoteFromSourceSummary(tier1Row.source_summary);
    } else {
      // Tier 2 — read from tier2.3 (attributed kgCO2e)
      const tier2_3 = byPosition.get('tier2.3');
      if (!tier2_3) throw new InboundQuantityRequired(input.questionnaire_id);
      const v = Number.parseFloat(tier2_3.value);
      if (!Number.isFinite(v)) throw new InboundQuantityRequired(input.questionnaire_id);
      amountCo2eKg = v;
      chosenQuestionId = tier2_3.question_id;
      chosenNote = extractNoteFromSourceSummary(tier2_3.source_summary);
    }

    const nowFn = this.deps.now ?? (() => new Date().toISOString());
    const occurredAt = nowFn();
    const emissionSourceName = `${supplier.name} — purchased goods (${qn.reporting_year})`;
    // Carry the supplier's note (e.g. "估算" / "third-party verified") into
    // the activity row's notes so the caveat survives into the inventory
    // audit trail, not just the questionnaire review.
    const baseNote = `来自 ${supplier.name} 供应商问卷 (${qn.reporting_year})`;
    const activityNotes = chosenNote !== '' ? `${baseNote}；供应商备注：${chosenNote}` : baseNote;

    let activityDataId = '';
    let emissionSourceId = '';

    const tx = this.deps.db.transaction(() => {
      // 1) Sentinel pinned EF (find-or-create)
      const ef = this.findOrCreateSentinelPinnedEf({
        supplierId: supplier.id,
        year: qn.reporting_year,
        occurredAt,
      });

      // 2) Emission source (find-or-create on (site_id, name))
      emissionSourceId = this.findOrCreateSupplierEmissionSource({
        siteId,
        name: emissionSourceName,
      });

      // 3) activity_data row
      activityDataId = randomUUID();
      this.deps.db
        .prepare(
          `INSERT INTO activity_data (
             id, site_id, emission_source_id, reporting_period_id,
             occurred_at_start, occurred_at_end, amount, unit,
             ef_factor_code, ef_year, ef_source, ef_geography, ef_dataset_version,
             computed_co2e_kg, computed_at,
             extraction_id, notes, created_at, updated_at,
             inbound_question_id, inbound_tier
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'kgCO2e', ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
        )
        .run(
          activityDataId,
          siteId,
          emissionSourceId,
          periodId,
          `${qn.reporting_year}-01-01T00:00:00Z`,
          `${qn.reporting_year}-12-31T23:59:59Z`,
          amountCo2eKg,
          ef.factor_code,
          ef.year,
          ef.source,
          ef.geography,
          ef.dataset_version,
          amountCo2eKg, // direct mode: 1:1 with amount
          occurredAt,
          activityNotes,
          occurredAt,
          occurredAt,
          chosenQuestionId,
          tierSelected,
        );

      // 4) Finalize accepted answers
      const finalizeStmt = this.deps.db.prepare(
        `UPDATE answer SET finalized_at = ? WHERE question_id = ?`,
      );
      for (const r of acceptedRows) {
        finalizeStmt.run(occurredAt, r.question_id);
      }

      // 5) Bump questionnaire status
      this.deps.db
        .prepare(`UPDATE questionnaire SET status = 'ingested' WHERE id = ?`)
        .run(input.questionnaire_id);

      // 6) Audit
      this.deps.db
        .prepare(
          `INSERT INTO audit_event (id, event_kind, payload, occurred_at) VALUES (?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          'inbound_questionnaire.ingested',
          JSON.stringify({
            questionnaire_id: input.questionnaire_id,
            supplier_id: supplier.id,
            tier_selected: tierSelected,
            activity_data_ids: [activityDataId],
            emission_source_id: emissionSourceId,
            total_co2e_kg: amountCo2eKg,
          }),
          occurredAt,
        );
    });
    tx();

    return {
      activity_data_ids: [activityDataId],
      emission_source_id: emissionSourceId,
      ingested_at: occurredAt,
    };
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
      // Persist a row when the supplier filled the answer cell OR left a
      // note. A note-only row (blank answer, non-empty note) still carries
      // signal worth surfacing in review.
      if (ans.is_blank && ans.note === '') continue;
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
        JSON.stringify({
          source: 'inbound_questionnaire',
          tier: q.tier,
          position: ans.position,
          ...(ans.note !== '' ? { note: ans.note } : {}),
        }),
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
        note: '',
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
        note: ans.note,
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

  private findPeriodIdByYear(year: number): string | null {
    const row = this.deps.db
      .prepare(`SELECT id FROM reporting_period WHERE year = ? ORDER BY created_at LIMIT 1`)
      .get(year) as { id: string } | undefined;
    return row?.id ?? null;
  }

  private findFirstSiteForOrg(orgId: string): string | null {
    const row = this.deps.db
      .prepare(
        `SELECT id FROM site WHERE organization_id = ? AND is_active = 1 ORDER BY created_at LIMIT 1`,
      )
      .get(orgId) as { id: string } | undefined;
    return row?.id ?? null;
  }

  /**
   * Find-or-create the sentinel pinned_emission_factor row that lets
   * activity_data.ef_* NOT NULL be satisfied for direct-co2e (Tier 2)
   * and Tier-1-with-quantity ingest. One sentinel row per (supplier × year).
   */
  private findOrCreateSentinelPinnedEf(args: {
    supplierId: string;
    year: number;
    occurredAt: string;
  }): {
    factor_code: string;
    year: number;
    source: string;
    geography: string;
    dataset_version: string;
  } {
    const ef = {
      factor_code: `supplier_direct.${args.supplierId}.${args.year}`,
      year: args.year,
      source: 'inbound_questionnaire',
      geography: 'SUPPLIER',
      dataset_version: '1.0',
    };
    const existing = this.deps.db
      .prepare(
        `SELECT 1 FROM pinned_emission_factor
           WHERE factor_code = ? AND year = ? AND source = ?
             AND geography = ? AND dataset_version = ?`,
      )
      .get(ef.factor_code, ef.year, ef.source, ef.geography, ef.dataset_version);
    if (!existing) {
      this.deps.db
        .prepare(
          `INSERT INTO pinned_emission_factor (
             factor_code, year, source, geography, dataset_version,
             scope, category, ghg_protocol_path,
             input_unit, co2e_kg_per_unit,
             gwp_basis,
             name_zh, name_en,
             description_zh, description_en,
             pinned_at, pinned_from
           ) VALUES (?, ?, ?, ?, ?, 3, 'purchased_goods', 'scope3.cat1_purchased_goods',
                     'kgCO2e', 1.0, 'AR6',
                     '供应商直报排放', 'Supplier-reported direct emissions',
                     '供应商问卷直接报送的 kgCO2e；amount 已是 CO2e。',
                     'Supplier-reported direct emissions in kgCO2e; amount IS the CO2e value (no EF chain).',
                     ?, 'inbound_questionnaire')`,
        )
        .run(ef.factor_code, ef.year, ef.source, ef.geography, ef.dataset_version, args.occurredAt);
    }
    return ef;
  }

  /**
   * Find-or-create the supplier-specific emission_source. Idempotent on
   * (site_id, name). Re-ingesting a re-imported file for the same
   * supplier × period reuses the source instead of duplicating it.
   */
  private findOrCreateSupplierEmissionSource(args: { siteId: string; name: string }): string {
    const existing = this.deps.db
      .prepare(`SELECT id FROM emission_source WHERE site_id = ? AND name = ?`)
      .get(args.siteId, args.name) as { id: string } | undefined;
    if (existing) return existing.id;
    const id = randomUUID();
    this.deps.db
      .prepare(
        `INSERT INTO emission_source
           (id, site_id, name, scope, category, ghg_protocol_path,
            default_ef_query, template_origin, is_active)
         VALUES (?, ?, ?, 3, 'purchased_goods', 'scope3.cat1_purchased_goods',
                 NULL, 'inbound_questionnaire', 1)`,
      )
      .run(id, args.siteId, args.name);
    return id;
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

export class InboundSiteMissing extends Error {
  readonly _tag = 'InboundSiteMissing' as const;
  constructor(public readonly organization_id: string) {
    super(
      `No active site found for organization ${organization_id} — inbound ingest needs a site to attribute supplier activity to.`,
    );
  }
}

export class InboundQuantityRequired extends Error {
  readonly _tag = 'InboundQuantityRequired' as const;
  constructor(public readonly questionnaire_id: string) {
    super(
      `Tier 1 ingest for ${questionnaire_id} requires a purchased quantity (kg). ` +
        'Provide `tier1_purchased_quantity` in the ingest call.',
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

/**
 * Pull the supplier's `note` back out of an answer row's `source_summary`
 * JSON (written by `upsertTentativeAnswers`). Returns '' for null / invalid
 * JSON / absent note — the read side never throws on a malformed blob, it
 * just degrades to "no note".
 */
function extractNoteFromSourceSummary(sourceSummary: string | null): string {
  if (!sourceSummary) return '';
  try {
    const parsed = JSON.parse(sourceSummary) as { note?: unknown };
    return typeof parsed.note === 'string' ? parsed.note : '';
  } catch {
    return '';
  }
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
/**
 * Tier decision at INGEST time. Differs from `selectTier` (the preview-time
 * variant) in two ways:
 *  - input is a Map keyed by position holding `{value: string}` rows (DB
 *    rows, not ParsedXlsxAnswer)
 *  - only accepted rows are present (caller pre-filtered)
 *
 * Tier 1: any Tier 1 numerical row with a finite-parseable value.
 * Tier 2: all three of (tier2.1, tier2.2, tier2.3) present and non-empty.
 * Else: null (soft no-op).
 */
function decideTierFromAccepted(
  template: InboundTemplate,
  acceptedByPosition: ReadonlyMap<string, { value: string; tier: Tier | null }>,
): Tier | null {
  const tier1Filled = template.questions
    .filter((q) => q.tier === 1 && q.kind === 'numerical')
    .some((q) => {
      const row = acceptedByPosition.get(q.position);
      if (!row) return false;
      return Number.isFinite(Number.parseFloat(row.value));
    });
  if (tier1Filled) return 1;

  const tier2 = template.questions.filter((q) => q.tier === 2);
  if (tier2.length === 0) return null;
  const tier2AllFilled = tier2.every((q) => {
    const row = acceptedByPosition.get(q.position);
    return row && row.value.trim() !== '';
  });
  return tier2AllFilled ? 2 : null;
}

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
