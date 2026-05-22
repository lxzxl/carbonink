CREATE TABLE audit_event (
  id            TEXT PRIMARY KEY,
  event_kind    TEXT NOT NULL,
  payload       TEXT NOT NULL CHECK(json_valid(payload)),
  occurred_at   TEXT NOT NULL
);
CREATE INDEX idx_audit_occurred ON audit_event(occurred_at);
CREATE INDEX idx_audit_kind_occurred ON audit_event(event_kind, occurred_at);

CREATE TRIGGER audit_event_no_update
BEFORE UPDATE ON audit_event
BEGIN
  SELECT RAISE(ABORT, 'audit_event is append-only');
END;

CREATE TRIGGER audit_event_no_delete
BEFORE DELETE ON audit_event
BEGIN
  SELECT RAISE(ABORT, 'audit_event is append-only');
END;
