package app

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"app.carbonink.desktop/internal/store"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/nsgotest"
)

func TestActivityLineagePanelAndEvidence(t *testing.T) {
	dbPath := fixtureDB(t)
	t.Setenv("CARBONINK_TEST_DB", dbPath)
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.WaitFor("id:activities-table", 5*time.Second)
	ui.Press("text:外购电力")
	ui.Press("id:activity-lineage")
	ui.WaitFor("id:lineage-dialog", 3*time.Second)
	drawer := ui.Find("id:lineage-dialog")
	if drawer == nil || drawer.Frame.Size.Width < 400 || drawer.Frame.Origin.X < 700 {
		t.Fatalf("lineage panel is not a right-side drawer: %+v", drawer)
	}
	ui.WaitFor("id:lineage-source-manual", 2*time.Second)
	ui.WaitFor("text:Manual entry", 2*time.Second)
	ui.WaitFor("id:lineage-pinned-ef", 2*time.Second)
	ui.WaitFor("text:No audit events for this record yet", 2*time.Second)

	evidencePath := filepath.Join(t.TempDir(), "meter.pdf")
	if err := os.WriteFile(evidencePath, []byte("%PDF-1.4\nmeter reading\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	ui.PickFiles = func(nsgotest.FilePick) []core.File {
		return []core.File{{Name: "meter.pdf", Path: evidencePath}}
	}
	ui.Press("id:lineage-evidence-add")
	ui.WaitFor("text:meter.pdf", 3*time.Second)
	ui.WaitFor("text:Evidence attached", 2*time.Second)

	ctx := context.Background()
	check, err := store.Open(ctx, dbPath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = check.Close() })
	list, err := check.ListEvidence(ctx, store.EvidenceTarget{ActivityDataID: "act"})
	if err != nil || len(list) != 1 {
		t.Fatalf("evidence = %+v, %v", list, err)
	}
	documentID := list[0].DocumentID
	ui.Press("id:lineage-evidence-remove-" + list[0].ID)
	ui.WaitForGone("text:meter.pdf", 3*time.Second)
	ui.WaitFor("text:Evidence removed", 2*time.Second)
	list, err = check.ListEvidence(ctx, store.EvidenceTarget{ActivityDataID: "act"})
	if err != nil || len(list) != 0 {
		t.Fatalf("evidence after remove = %+v, %v", list, err)
	}
	if document, err := check.DocumentByID(ctx, documentID); err != nil || document == nil {
		t.Fatalf("document was deleted with the link: %+v, %v", document, err)
	}
}

func TestAnswerLineagePanel(t *testing.T) {
	dbPath := fixtureDB(t)
	t.Setenv("CARBONINK_TEST_DB", dbPath)
	ctx := context.Background()
	s, err := store.Open(ctx, dbPath)
	if err != nil {
		t.Fatal(err)
	}
	const ts = "2025-01-20T00:00:00Z"
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := s.DB().ExecContext(ctx, query, args...); err != nil {
			t.Fatalf("%s: %v", query, err)
		}
	}
	exec(`INSERT INTO customer (id, name, role) VALUES ('cust', 'ACME Ltd', 'customer')`)
	exec(`INSERT INTO questionnaire
		(id, customer_id, document_id, reporting_year, status, direction, created_at)
		VALUES ('qn', 'cust', NULL, 2025, 'answering', 'outbound', ?)`, ts)
	exec(`INSERT INTO question
		(id, questionnaire_id, question_signature, signature_version, normalized_text,
		 raw_text, question_kind, position, required)
		VALUES ('q1', 'qn', 'sig-1', 'v1', 'annual electricity use',
		'annual electricity use', 'numerical', 'B2', 1)`)
	exec(`INSERT INTO answer
		(id, question_id, value, unit, source_kind, source_activity_data_id, finalized_at)
		VALUES ('a1', 'q1', '120000', 'kWh', 'mapped_inventory', 'act', ?)`, ts)
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}

	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.Press("id:nav:questionnaires")
	ui.WaitFor("id:questionnaires-row-qn", 5*time.Second)
	ui.Press("id:questionnaires-row-qn")
	ui.WaitFor("id:questionnaires-detail-dialog", 3*time.Second)
	ui.Press("id:questionnaires-question-0")
	ui.WaitFor("id:answer-lineage", 2*time.Second)
	ui.Press("id:answer-lineage")
	ui.WaitFor("id:lineage-dialog", 3*time.Second)
	ui.WaitFor("id:lineage-node-question", 2*time.Second)
	ui.WaitFor("id:lineage-node-answer", 2*time.Second)
	ui.WaitFor("id:lineage-node-question >> text:annual electricity use", 2*time.Second)
	ui.WaitFor("text:mapped from inventory", 2*time.Second)
	ui.WaitFor("text:Upstream inventory data", 2*time.Second)
	ui.WaitFor("text:外购电力", 2*time.Second)
}
