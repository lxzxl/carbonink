-- 018_evidence_attachment.sql
-- Generic evidence attachments for audit-readiness
-- (spec: docs/specs/2026-07-11-audit-evidence-lineage.md).
--
-- One row links a supporting `document` (content-addressed upload, reused
-- from migration 003) to exactly one auditable record: an `activity_data`
-- row or an `answer` row. The two-nullable-FK + CHECK(exactly one) shape
-- mirrors the `answer` source columns from migration 014. Extending to a
-- new entity later = ADD COLUMN <entity>_id REFERENCES ... + a CHECK
-- rebuild (see 014/015/017 for the rebuild pattern).
--
-- FKs are deliberately NO ACTION (the schema default), NOT ON DELETE
-- CASCADE: with foreign_keys enabled, DROP TABLE performs an implicit
-- DELETE FROM, so a CASCADE here would silently wipe evidence rows the
-- next time a migration rebuilds activity_data or answer (the established
-- CHECK-change pattern). Cleanup on record deletion is done explicitly in
-- the owning services instead (ActivityDataService.delete,
-- InboundQuestionnaireService.delete / re-import wipe).

CREATE TABLE evidence_attachment (
  id               TEXT PRIMARY KEY,
  activity_data_id TEXT REFERENCES activity_data(id),
  answer_id        TEXT REFERENCES answer(id),
  document_id      TEXT NOT NULL REFERENCES document(id),
  note             TEXT,
  created_at       TEXT NOT NULL,
  CHECK ((activity_data_id IS NOT NULL) + (answer_id IS NOT NULL) = 1)
);

CREATE INDEX idx_evidence_activity ON evidence_attachment(activity_data_id)
  WHERE activity_data_id IS NOT NULL;
CREATE INDEX idx_evidence_answer ON evidence_attachment(answer_id)
  WHERE answer_id IS NOT NULL;
CREATE INDEX idx_evidence_document ON evidence_attachment(document_id);
