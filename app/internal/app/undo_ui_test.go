package app

import (
	"context"
	"testing"
	"time"

	"app.carbonink.desktop/internal/store"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/nsgotest"
)

func TestUndoAndRedoActivityMutations(t *testing.T) {
	dbPath := fixtureDB(t)
	t.Setenv("CARBONINK_TEST_DB", dbPath)
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.WaitFor("id:activities-table", 5*time.Second)

	// Delete, undo, redo.
	ui.Press("text:外购电力")
	ui.Press("id:activity-delete")
	ui.WaitFor("id:activity-delete-dialog", 2*time.Second)
	ui.Press("id:activity-delete-confirm")
	ui.WaitForGone("text:外购电力", 3*time.Second)
	ui.Key("mod+z")
	ui.WaitFor("text:外购电力", 3*time.Second)
	ui.Key("mod+shift+z")
	ui.WaitForGone("text:外购电力", 3*time.Second)
	ui.Key("mod+z")
	ui.WaitFor("text:外购电力", 3*time.Second)

	// Create, undo, redo.
	ui.Press("id:activity-add")
	ui.WaitFor("id:activity-dialog", 2*time.Second)
	ui.Type("id:activity-amount", "100")
	ui.Type("id:activity-unit", "kWh")
	ui.Press("id:activity-save")
	ui.WaitFor("text:100.00", 3*time.Second)
	ui.Key("mod+z")
	ui.WaitForGone("text:100.00", 3*time.Second)
	ui.Key("mod+shift+z")
	ui.WaitFor("text:100.00", 3*time.Second)
}

func TestUndoAndRedoActivityUpdate(t *testing.T) {
	t.Setenv("CARBONINK_TEST_DB", fixtureDB(t))
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.WaitFor("id:activities-table", 5*time.Second)
	ui.Press("text:外购电力")
	ui.Press("id:activity-edit")
	ui.WaitFor("id:activity-edit-dialog", 2*time.Second)
	ui.WaitFor("id:guidance-ef-rebind", 2*time.Second)
	ui.Press("id:guidance-ef-rebind-skip")
	ui.Clear("id:activity-edit-amount")
	ui.Type("id:activity-edit-amount", "500")
	ui.Press("id:activity-edit-save")
	ui.WaitFor("text:500.00", 3*time.Second)
	ui.Key("mod+z")
	ui.WaitForGone("text:500.00", 3*time.Second)
	ui.WaitFor("text:240.00", 3*time.Second)
	ui.Key("mod+shift+z")
	ui.WaitFor("text:500.00", 3*time.Second)
}

func TestUndoAndRedoSourceCreate(t *testing.T) {
	t.Setenv("CARBONINK_TEST_DB", fixtureDB(t))
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.Press("id:nav:sources")
	ui.WaitFor("id:source-add", 5*time.Second)
	ui.Press("id:source-add")
	ui.WaitFor("id:source-add-dialog", 2*time.Second)
	ui.Type("id:source-add-name", "Business travel")
	ui.Press("id:source-add-save")
	ui.WaitFor("text:Business travel", 3*time.Second)
	ui.Key("mod+z")
	ui.WaitForGone("text:Business travel", 3*time.Second)
	ui.Key("mod+shift+z")
	ui.WaitFor("text:Business travel", 3*time.Second)
}

func TestUndoAndRedoAnswerFinalize(t *testing.T) {
	dbPath := fixtureDB(t)
	t.Setenv("CARBONINK_TEST_DB", dbPath)
	ctx := context.Background()
	s, err := store.Open(ctx, dbPath)
	if err != nil {
		t.Fatal(err)
	}
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := s.DB().ExecContext(ctx, query, args...); err != nil {
			t.Fatalf("%s: %v", query, err)
		}
	}
	exec(`INSERT INTO customer (id, name, role) VALUES ('cust', 'ACME Ltd', 'customer')`)
	exec(`INSERT INTO questionnaire
		(id, customer_id, document_id, reporting_year, status, direction, created_at)
		VALUES ('qn', 'cust', NULL, 2025, 'answering', 'outbound', '2025-01-20T00:00:00Z')`)
	exec(`INSERT INTO question
		(id, questionnaire_id, question_signature, signature_version, normalized_text,
		 raw_text, question_kind, position, required)
		VALUES ('q1', 'qn', 'sig-1', 'v1', 'annual electricity use',
		'annual electricity use', 'numerical', 'B2', 1)`)
	exec(`INSERT INTO answer
		(id, question_id, value, unit, source_kind, finalized_at)
		VALUES ('a1', 'q1', '120000', 'kWh', 'manual', NULL)`)
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
	ui.Press("id:questionnaires-answer-finalize")
	ui.WaitFor("text:Finalized", 3*time.Second)
	ui.Key("mod+z")
	ui.WaitFor("text:Draft", 3*time.Second)
	ui.Key("mod+shift+z")
	ui.WaitFor("text:Finalized", 3*time.Second)

	check, err := store.Open(ctx, dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer check.Close()
	answer, err := check.AnswerByID(ctx, "a1")
	if err != nil || answer == nil || answer.FinalizedAt == "" {
		t.Fatalf("answer after redo = %+v, %v", answer, err)
	}
}

// seedReviewExtraction inserts a document with one staged china_utility
// extraction so the documents screen can exercise discard and confirm without
// calling a model.
func seedReviewExtraction(t *testing.T, dbPath string) {
	t.Helper()
	ctx := context.Background()
	s, err := store.Open(ctx, dbPath)
	if err != nil {
		t.Fatal(err)
	}
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := s.DB().ExecContext(ctx, query, args...); err != nil {
			t.Fatalf("%s: %v", query, err)
		}
	}
	exec(`INSERT INTO document
		(id, sha256, filename, mime_type, size_bytes, storage_path, uploaded_at)
		VALUES ('doc', 'sha-doc', 'bill.pdf', 'application/pdf', 10, 'uploads/bill.pdf',
		'2026-01-01T00:00:00Z')`)
	exec(`INSERT INTO extraction
		(id, document_id, llm_provider, llm_model, prompt_version, raw_response,
		 parsed_json, status, cost_usd, created_at)
		VALUES ('ext', 'doc', 'openai', 'gpt-4o', 'china_utility.v1', 'raw output',
		'{"doc_type":"china_utility","supplier_name":"国网北京市电力公司","account_no":"1234567890","amount_kwh":523.5,"amount_yuan":312.7,"period_start":"2025-09-01","period_end":"2025-09-30","confidence":"high"}',
		'review_needed', 0.01, '2026-01-01T00:00:00Z')`)
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestUndoAndRedoExtractionDiscard(t *testing.T) {
	dbPath := fixtureDB(t)
	t.Setenv("CARBONINK_TEST_DB", dbPath)
	seedReviewExtraction(t, dbPath)
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}),
		nsgotest.Secrets(map[string]string{llmSecretAccount: "test-key"}))
	configureLLMEndpoint(t, ui, "http://127.0.0.1:1/v1")
	ui.Press("id:nav:documents")
	ui.WaitFor("id:documents-detail-doc", 5*time.Second)
	ui.Press("id:documents-detail-doc")
	ui.WaitFor("id:documents-detail-dialog", 3*time.Second)
	ui.WaitFor("id:documents-extraction-discard", 3*time.Second)
	ui.Press("id:documents-extraction-discard")
	ui.WaitFor("id:documents-detail-dialog >> text:Discarded", 3*time.Second)

	ui.Key("mod+z")
	ui.WaitFor("id:documents-detail-dialog >> text:Needs review", 3*time.Second)
	ui.WaitFor("id:documents-extraction-confirm", 3*time.Second)

	ctx := context.Background()
	check, err := store.OpenReadOnly(ctx, dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer check.Close()
	var status, parsed string
	if err := check.DB().QueryRowContext(ctx,
		`SELECT status, parsed_json FROM extraction WHERE id = 'ext'`).Scan(&status, &parsed); err != nil {
		t.Fatal(err)
	}
	if status != store.ExtractionReviewNeeded || parsed == "" {
		t.Fatalf("after undo: status = %q, parsed = %q", status, parsed)
	}

	ui.Key("mod+shift+z")
	ui.WaitFor("id:documents-detail-dialog >> text:Discarded", 3*time.Second)
	ui.WaitForGone("id:documents-extraction-confirm", 3*time.Second)
}

func TestUndoAndRedoExtractionConfirm(t *testing.T) {
	dbPath := fixtureDB(t)
	t.Setenv("CARBONINK_TEST_DB", dbPath)
	seedReviewExtraction(t, dbPath)
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}),
		nsgotest.Secrets(map[string]string{llmSecretAccount: "test-key"}))
	configureLLMEndpoint(t, ui, "http://127.0.0.1:1/v1")
	ui.Press("id:nav:documents")
	ui.WaitFor("id:documents-detail-doc", 5*time.Second)
	ui.Press("id:documents-detail-doc")
	ui.WaitFor("id:documents-extraction-confirm", 3*time.Second)
	ui.Press("id:documents-extraction-confirm")
	ui.WaitFor("id:documents-extraction-activity-dialog", 3*time.Second)
	ui.Press("id:documents-extraction-activity-save")
	ui.WaitFor("id:documents-detail-dialog >> text:Confirmed", 5*time.Second)
	ui.WaitFor("id:documents-detail-dialog >> text:1 linked", 3*time.Second)

	ctx := context.Background()
	check := func(activities int, wantStatus string) {
		t.Helper()
		s, err := store.OpenReadOnly(ctx, dbPath)
		if err != nil {
			t.Fatal(err)
		}
		defer s.Close()
		var got int
		var status string
		if err := s.DB().QueryRowContext(ctx,
			`SELECT (SELECT count(*) FROM activity_data), status FROM extraction WHERE id = 'ext'`).
			Scan(&got, &status); err != nil {
			t.Fatal(err)
		}
		if got != activities || status != wantStatus {
			t.Fatalf("activities = %d, status = %q; want %d, %q", got, status, activities, wantStatus)
		}
	}
	check(2, store.ExtractionParsed)

	ui.Key("mod+z")
	ui.WaitFor("id:documents-detail-dialog >> text:Needs review", 3*time.Second)
	ui.WaitFor("id:documents-extraction-confirm", 3*time.Second)
	check(1, store.ExtractionReviewNeeded)

	ui.Key("mod+shift+z")
	ui.WaitFor("id:documents-detail-dialog >> text:Confirmed", 5*time.Second)
	check(2, store.ExtractionParsed)
}

func TestUndoAndRedoSourceUpdate(t *testing.T) {
	dbPath := fixtureDB(t)
	t.Setenv("CARBONINK_TEST_DB", dbPath)
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.Press("id:nav:sources")
	ui.WaitFor("id:source-edit-src", 5*time.Second)
	ui.Press("id:source-edit-src")
	ui.WaitFor("id:source-edit-src-dialog", 2*time.Second)
	ui.Clear("id:source-edit-src-name")
	ui.Type("id:source-edit-src-name", "Grid power")
	ui.Press("id:source-edit-src-save")
	ui.WaitFor("text:Grid power", 3*time.Second)

	name := func() string {
		t.Helper()
		s, err := store.OpenReadOnly(context.Background(), dbPath)
		if err != nil {
			t.Fatal(err)
		}
		defer s.Close()
		var got string
		if err := s.DB().QueryRow(`SELECT name FROM emission_source WHERE id = 'src'`).Scan(&got); err != nil {
			t.Fatal(err)
		}
		return got
	}
	if got := name(); got != "Grid power" {
		t.Fatalf("name after save = %q", got)
	}

	ui.Key("mod+z")
	ui.WaitFor("text:外购电力", 3*time.Second)
	if got := name(); got != "外购电力" {
		t.Fatalf("name after undo = %q", got)
	}

	ui.Key("mod+shift+z")
	ui.WaitFor("text:Grid power", 3*time.Second)
	if got := name(); got != "Grid power" {
		t.Fatalf("name after redo = %q", got)
	}
}

func TestUndoAndRedoFinalizeAll(t *testing.T) {
	dbPath := fixtureDB(t)
	t.Setenv("CARBONINK_TEST_DB", dbPath)
	ctx := context.Background()
	s, err := store.Open(ctx, dbPath)
	if err != nil {
		t.Fatal(err)
	}
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := s.DB().ExecContext(ctx, query, args...); err != nil {
			t.Fatalf("%s: %v", query, err)
		}
	}
	exec(`INSERT INTO customer (id, name, role) VALUES ('cust', 'ACME Ltd', 'customer')`)
	exec(`INSERT INTO questionnaire
		(id, customer_id, document_id, reporting_year, status, direction, created_at)
		VALUES ('qn', 'cust', NULL, 2025, 'answering', 'outbound', '2025-01-20T00:00:00Z')`)
	exec(`INSERT INTO question
		(id, questionnaire_id, question_signature, signature_version, normalized_text,
		 raw_text, question_kind, position, required)
		VALUES ('q1', 'qn', 'sig-1', 'v1', 'annual electricity use',
		'annual electricity use', 'numerical', 'B2', 1),
		('q2', 'qn', 'sig-2', 'v1', 'annual gas use',
		'annual gas use', 'numerical', 'B3', 1)`)
	exec(`INSERT INTO answer (id, question_id, value, unit, source_kind)
		VALUES ('a1', 'q1', '120000', 'kWh', 'manual'),
		('a2', 'q2', '40000', 'm3', 'manual')`)
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}

	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.Press("id:nav:questionnaires")
	ui.WaitFor("id:questionnaires-row-qn", 5*time.Second)
	ui.Press("id:questionnaires-row-qn")
	ui.WaitFor("id:questionnaires-detail-dialog", 3*time.Second)
	ui.Press("id:questionnaires-finalize-all")
	ui.WaitFor(`id:questionnaires-detail-dialog >> text:"2025 · Finalized"`, 3*time.Second)

	state := func(wantStatus string, wantFinalized bool) {
		t.Helper()
		check, err := store.OpenReadOnly(ctx, dbPath)
		if err != nil {
			t.Fatal(err)
		}
		defer check.Close()
		var status string
		var finalized int
		if err := check.DB().QueryRowContext(ctx,
			`SELECT status FROM questionnaire WHERE id = 'qn'`).Scan(&status); err != nil {
			t.Fatal(err)
		}
		if err := check.DB().QueryRowContext(ctx,
			`SELECT count(*) FROM answer WHERE finalized_at IS NOT NULL`).Scan(&finalized); err != nil {
			t.Fatal(err)
		}
		want := 0
		if wantFinalized {
			want = 2
		}
		if status != wantStatus || finalized != want {
			t.Fatalf("status = %q, finalized = %d; want %q, %d", status, finalized, wantStatus, want)
		}
	}
	state(store.QuestionnaireFinalized, true)

	ui.Key("mod+z")
	ui.WaitFor(`id:questionnaires-detail-dialog >> text:"2025 · Answering"`, 3*time.Second)
	state("answering", false)

	ui.Key("mod+shift+z")
	ui.WaitFor(`id:questionnaires-detail-dialog >> text:"2025 · Finalized"`, 3*time.Second)
	state(store.QuestionnaireFinalized, true)
}
