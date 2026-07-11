import type {
  ActivityData,
  ActivityLineage,
  Answer,
  AnswerLineage,
  LineageAnswerRef,
  LineageResult,
  LineageSnapshotRef,
  LineageSourceNode,
  PinnedEmissionFactor,
  Tier,
} from '@shared/types.js';
import type { ServiceContext } from './base.js';
import type { EvidenceService } from './evidence-service.js';

/**
 * Read-only assembly of the end-to-end provenance chain for one record
 * (audit-readiness spec 2026-07-11). All the links already exist as FKs —
 * extraction → document (003), inbound_question → questionnaire (017),
 * activity → pinned EF (004), answer → activity (005/014), snapshot line →
 * activity (004) — this service just walks them in one place so the
 * renderer's lineage panel is a single IPC call instead of five.
 */
export class LineageService {
  private readonly db: ServiceContext['db'];
  private readonly evidenceService: EvidenceService;

  constructor(ctx: { db: ServiceContext['db']; evidenceService: EvidenceService }) {
    this.db = ctx.db;
    this.evidenceService = ctx.evidenceService;
  }

  get(input: { entity: 'activity_data' | 'answer'; id: string }): LineageResult {
    return input.entity === 'activity_data'
      ? this.activityLineage(input.id)
      : this.answerLineage(input.id);
  }

  private activityLineage(id: string): ActivityLineage {
    const activity = this.db.prepare('SELECT * FROM activity_data WHERE id = ?').get(id) as
      | ActivityData
      | undefined;
    if (!activity) throw new Error(`activity_data not found: ${id}`);

    const sourceName = this.db
      .prepare('SELECT name FROM emission_source WHERE id = ?')
      .get(activity.emission_source_id) as { name: string } | undefined;

    const pinned = this.db
      .prepare(
        `SELECT * FROM pinned_emission_factor
          WHERE factor_code = ? AND year = ? AND source = ? AND geography = ? AND dataset_version = ?`,
      )
      .get(
        activity.ef_factor_code,
        activity.ef_year,
        activity.ef_source,
        activity.ef_geography,
        activity.ef_dataset_version,
      ) as PinnedEmissionFactor | undefined;

    const answers = this.db
      .prepare(
        `SELECT a.id AS answer_id,
                a.question_id,
                q.questionnaire_id,
                COALESCE(q.raw_text, q.normalized_text) AS question_text,
                a.value,
                a.finalized_at
           FROM answer a
           JOIN question q ON q.id = a.question_id
          WHERE a.source_activity_data_id = ?
          ORDER BY a.id ASC`,
      )
      .all(id) as LineageAnswerRef[];

    const snapshots = this.db
      .prepare(
        `SELECT DISTINCT csl.calculation_snapshot_id AS snapshot_id,
                cs.frozen_at,
                cs.revision
           FROM calculation_snapshot_line csl
           JOIN calculation_snapshot cs ON cs.id = csl.calculation_snapshot_id
          WHERE csl.original_activity_data_id = ?
          ORDER BY cs.frozen_at DESC`,
      )
      .all(id) as LineageSnapshotRef[];

    return {
      entity: 'activity_data',
      activity,
      source: this.sourceNode(activity),
      pinned_ef: pinned ?? null,
      emission_source_name: sourceName?.name ?? '',
      answers,
      snapshots,
      evidence: this.evidenceService.list({ activity_data_id: id }),
    };
  }

  /**
   * Provenance trichotomy. `extraction_id` and `inbound_question_id` are
   * mutually exclusive in practice (different creation paths); if both were
   * ever set, extraction wins — it is the stronger claim (a real uploaded
   * file exists).
   */
  private sourceNode(activity: ActivityData): LineageSourceNode {
    if (activity.extraction_id) {
      const row = this.db
        .prepare(
          `SELECT e.id AS extraction_id, d.id AS document_id, d.filename
             FROM extraction e
             JOIN document d ON d.id = e.document_id
            WHERE e.id = ?`,
        )
        .get(activity.extraction_id) as
        | { extraction_id: string; document_id: string; filename: string }
        | undefined;
      if (row) return { kind: 'document', ...row };
    }
    if (activity.inbound_question_id) {
      const row = this.db
        .prepare(
          `SELECT q.id AS question_id, q.questionnaire_id, c.name AS supplier_name
             FROM question q
             JOIN questionnaire qn ON qn.id = q.questionnaire_id
             LEFT JOIN customer c ON c.id = qn.customer_id
            WHERE q.id = ?`,
        )
        .get(activity.inbound_question_id) as
        | { question_id: string; questionnaire_id: string; supplier_name: string | null }
        | undefined;
      if (row) {
        return {
          kind: 'inbound',
          questionnaire_id: row.questionnaire_id,
          supplier_name: row.supplier_name,
          question_id: row.question_id,
          tier: (activity.inbound_tier ?? null) as Tier | null,
        };
      }
    }
    return { kind: 'manual' };
  }

  private answerLineage(id: string): AnswerLineage {
    const answer = this.db.prepare('SELECT * FROM answer WHERE id = ?').get(id) as
      | Answer
      | undefined;
    if (!answer) throw new Error(`answer not found: ${id}`);

    const meta = this.db
      .prepare(
        `SELECT COALESCE(q.raw_text, q.normalized_text) AS question_text,
                qn.id AS questionnaire_id,
                qn.direction,
                qn.reporting_year,
                c.name AS customer_name
           FROM question q
           JOIN questionnaire qn ON qn.id = q.questionnaire_id
           LEFT JOIN customer c ON c.id = qn.customer_id
          WHERE q.id = ?`,
      )
      .get(answer.question_id) as
      | {
          question_text: string;
          questionnaire_id: string;
          direction: 'outbound' | 'inbound';
          reporting_year: number;
          customer_name: string | null;
        }
      | undefined;
    if (!meta) throw new Error(`question not found for answer: ${id}`);

    // One upstream hop: a mapped_inventory answer sourced from a specific
    // activity row embeds that row's full lineage so the panel can show
    // document → activity → EF → answer without a second IPC round-trip.
    const sourceActivity = answer.source_activity_data_id
      ? this.activityLineage(answer.source_activity_data_id)
      : null;

    return {
      entity: 'answer',
      answer,
      question_text: meta.question_text,
      questionnaire: {
        id: meta.questionnaire_id,
        direction: meta.direction,
        reporting_year: meta.reporting_year,
        customer_name: meta.customer_name,
      },
      source_activity: sourceActivity,
      evidence: this.evidenceService.list({ answer_id: id }),
    };
  }
}
