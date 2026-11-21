package lineage

import (
	"context"
	"path/filepath"
	"testing"

	"app.carbonink.desktop/internal/store"
)

type fixture struct {
	store      *store.Store
	ctx        context.Context
	site       *store.Site
	period     *store.ReportingPeriod
	source     *store.EmissionSource
	factor     store.EmissionFactor
	activityID string
}

func setup(t *testing.T) fixture {
	t.Helper()
	ctx := context.Background()
	s, err := store.Open(ctx, filepath.Join(t.TempDir(), "workspace.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	if _, err := s.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	_, site, period, err := s.CompleteOnboarding(ctx, store.OnboardingInput{
		Organization: store.OrganizationInput{
			NameZH: "测试组织", NameEN: "Test Org", Industry: "manufacturing",
			CountryCode: "cn", BoundaryKind: "operational_control",
		},
		Site: store.SiteInput{NameZH: "上海工厂", NameEN: "Shanghai Plant", CountryCode: "cn"},
		Year: 2025,
	})
	if err != nil {
		t.Fatal(err)
	}
	source, err := s.CreateSource(ctx, store.SourceInput{
		SiteID: site.ID, Name: "Purchased electricity", Scope: 2, Category: "electricity.grid",
		GHGProtocolPath: "scope2.location",
	})
	if err != nil {
		t.Fatal(err)
	}
	factors, err := s.ListEmissionFactors(ctx, store.EFFilter{
		Scope: 2, Category: "electricity.grid", Search: "national",
	})
	if err != nil || len(factors) == 0 {
		t.Fatalf("factors = %d, %v", len(factors), err)
	}
	factor := factors[0]
	activity, err := s.CreateActivity(ctx, store.ActivityInput{
		EmissionSourceID: source.ID, ReportingPeriodID: period.ID,
		OccurredAtStart: "2025-01-01", OccurredAtEnd: "2025-01-31",
		Amount: 100, Unit: "kWh",
		EF: store.EmissionFactorKey{
			FactorCode: factor.FactorCode, Year: factor.Year, Source: factor.Source,
			Geography: factor.Geography, DatasetVersion: factor.DatasetVersion,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	return fixture{
		store: s, ctx: ctx, site: site, period: period, source: source,
		factor: factor, activityID: activity.ID,
	}
}

func TestActivityLineageManual(t *testing.T) {
	f := setup(t)
	got, err := Activity(f.ctx, f.store, f.activityID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Source.Kind != SourceManual {
		t.Fatalf("source = %+v", got.Source)
	}
	if got.EmissionSourceName != f.source.Name || got.Activity.Source != f.source.Name {
		t.Fatalf("source name = %q / %q", got.EmissionSourceName, got.Activity.Source)
	}
	if got.PinnedEF == nil || got.PinnedEF.FactorCode != f.factor.FactorCode ||
		got.PinnedEF.CO2eKgPerUnit != f.factor.CO2eKgPerUnit {
		t.Fatalf("pinned EF = %+v", got.PinnedEF)
	}
	if len(got.Answers) != 0 || len(got.Snapshots) != 0 || len(got.Evidence) != 0 {
		t.Fatalf("unexpected consumers: %+v", got)
	}
}

func TestActivityLineageDocumentAndInboundSources(t *testing.T) {
	f := setup(t)
	document, _, err := f.store.SaveDocument(f.ctx, store.DocumentInput{
		Filename: "utility-bill.pdf", MIMEType: "application/pdf",
		Data: []byte("%PDF-1.4\nutility bill\n"),
	}, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.store.DB().ExecContext(f.ctx, `INSERT INTO extraction
		(id, document_id, llm_provider, llm_model, prompt_version, raw_response, parsed_json,
		 status, created_at)
		VALUES ('ext-1', ?, 'test', 'test-model', 'v1', '{}', '{}', 'parsed', '2025-01-15T00:00:00Z')`,
		document.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.store.DB().ExecContext(f.ctx,
		`UPDATE activity_data SET extraction_id = 'ext-1' WHERE id = ?`, f.activityID); err != nil {
		t.Fatal(err)
	}
	got, err := Activity(f.ctx, f.store, f.activityID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Source.Kind != SourceDocument || got.Source.DocumentID != document.ID ||
		got.Source.Filename != "utility-bill.pdf" || got.Source.ExtractionID != "ext-1" {
		t.Fatalf("document source = %+v", got.Source)
	}

	if _, err := f.store.DB().ExecContext(f.ctx, `INSERT INTO customer (id, name, role)
		VALUES ('supplier-1', 'Acme Metals', 'supplier')`); err != nil {
		t.Fatal(err)
	}
	if _, err := f.store.DB().ExecContext(f.ctx, `INSERT INTO questionnaire
		(id, customer_id, document_id, reporting_year, status, direction, created_at)
		VALUES ('qn-in', 'supplier-1', NULL, 2025, 'received', 'inbound',
		'2025-01-15T00:00:00Z')`); err != nil {
		t.Fatal(err)
	}
	if _, err := f.store.DB().ExecContext(f.ctx, `INSERT INTO question
		(id, questionnaire_id, question_signature, signature_version, normalized_text,
		 raw_text, question_kind, position, required, tier)
		VALUES ('q-in', 'qn-in', 'sig-in', 'v1', 'product carbon footprint',
		'product carbon footprint', 'numerical', 'B2', 1, 1)`); err != nil {
		t.Fatal(err)
	}
	if _, err := f.store.DB().ExecContext(f.ctx, `UPDATE activity_data
		SET extraction_id = NULL, inbound_question_id = 'q-in', inbound_tier = 1
		WHERE id = ?`, f.activityID); err != nil {
		t.Fatal(err)
	}
	got, err = Activity(f.ctx, f.store, f.activityID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Source.Kind != SourceInbound || got.Source.QuestionID != "q-in" ||
		got.Source.QuestionnaireID != "qn-in" || got.Source.SupplierName != "Acme Metals" ||
		got.Source.Tier != 1 {
		t.Fatalf("inbound source = %+v", got.Source)
	}
}

func TestActivityLineageConsumersAndEvidence(t *testing.T) {
	f := setup(t)
	const ts = "2025-01-20T00:00:00Z"
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := f.store.DB().ExecContext(f.ctx, query, args...); err != nil {
			t.Fatalf("%s: %v", query, err)
		}
	}
	exec(`INSERT INTO customer (id, name, role) VALUES ('customer-1', 'ACME Ltd', 'customer')`)
	exec(`INSERT INTO questionnaire
		(id, customer_id, document_id, reporting_year, status, direction, created_at)
		VALUES ('qn-1', 'customer-1', NULL, 2025, 'answering', 'outbound', ?)`, ts)
	exec(`INSERT INTO question
		(id, questionnaire_id, question_signature, signature_version, normalized_text,
		 raw_text, question_kind, position, required)
		VALUES ('q-1', 'qn-1', 'sig-1', 'v1', 'annual electricity use',
		'annual electricity use', 'numerical', 'B2', 1)`)
	exec(`INSERT INTO answer
		(id, question_id, value, unit, source_kind, source_activity_data_id, finalized_at)
		VALUES ('ans-1', 'q-1', '120000', 'kWh', 'mapped_inventory', ?, ?)`, f.activityID, ts)
	exec(`INSERT INTO calculation_snapshot
		(id, reporting_period_id, frozen_at, ef_dataset_versions, total_co2e_kg,
		 scope1_kg, scope2_kg_location, scope3_kg_by_cat, revision)
		VALUES ('snap-1', ?, ?, '{}', 50, 0, 50, '{}', 2)`, f.period.ID, ts)
	exec(`INSERT INTO calculation_snapshot_line
		(id, calculation_snapshot_id, original_activity_data_id,
		 site_id_at_freeze, site_name_at_freeze, emission_source_id_at_freeze,
		 emission_source_name_at_freeze, reporting_period_id_at_freeze,
		 occurred_at_start, occurred_at_end, amount, unit, ef_input_unit,
		 converted_amount, ef_factor_code, ef_year, ef_source, ef_geography,
		 ef_dataset_version, ef_co2e_kg_per_unit, ef_gwp_basis,
		 computed_co2e_kg, scope)
		VALUES ('line-1', 'snap-1', ?, ?, 'Shanghai Plant', ?, 'Purchased electricity',
		 ?, '2025-01-01', '2025-01-31', 100, 'kWh', 'kWh', 100, ?, ?, ?, ?,
		 ?, ?, 'AR6', 50, 2)`,
		f.activityID, f.site.ID, f.source.ID, f.period.ID,
		f.factor.FactorCode, f.factor.Year, f.factor.Source, f.factor.Geography,
		f.factor.DatasetVersion, f.factor.CO2eKgPerUnit)
	attachment, err := f.store.AddEvidence(f.ctx,
		store.EvidenceTarget{ActivityDataID: f.activityID}, store.DocumentInput{
			Filename: "meter.pdf", MIMEType: "application/pdf",
			Data: []byte("%PDF-1.4\nmeter\n"),
		}, t.TempDir(), "meter reading")
	if err != nil {
		t.Fatal(err)
	}

	activity, err := Activity(f.ctx, f.store, f.activityID)
	if err != nil {
		t.Fatal(err)
	}
	if len(activity.Answers) != 1 || activity.Answers[0].AnswerID != "ans-1" ||
		activity.Answers[0].QuestionnaireID != "qn-1" ||
		activity.Answers[0].FinalizedAt != ts {
		t.Fatalf("answers = %+v", activity.Answers)
	}
	if len(activity.Snapshots) != 1 || activity.Snapshots[0].SnapshotID != "snap-1" ||
		activity.Snapshots[0].Revision != 2 {
		t.Fatalf("snapshots = %+v", activity.Snapshots)
	}
	if len(activity.Evidence) != 1 || activity.Evidence[0].ID != attachment.ID {
		t.Fatalf("evidence = %+v", activity.Evidence)
	}

	answer, err := Answer(f.ctx, f.store, "ans-1")
	if err != nil {
		t.Fatal(err)
	}
	if answer.QuestionText != "annual electricity use" || answer.Questionnaire.ID != "qn-1" ||
		answer.Questionnaire.CustomerName != "ACME Ltd" || answer.Questionnaire.ReportingYear != 2025 {
		t.Fatalf("answer lineage = %+v", answer)
	}
	if answer.SourceActivity == nil || answer.SourceActivity.Activity.ID != f.activityID {
		t.Fatalf("upstream activity = %+v", answer.SourceActivity)
	}
	if len(answer.Evidence) != 0 {
		t.Fatalf("answer evidence = %+v", answer.Evidence)
	}

	if _, err := f.store.AddEvidence(f.ctx, store.EvidenceTarget{AnswerID: "ans-1"},
		store.DocumentInput{
			Filename: "invoice.pdf", MIMEType: "application/pdf",
			Data: []byte("%PDF-1.4\ninvoice\n"),
		}, t.TempDir(), ""); err != nil {
		t.Fatal(err)
	}
	answer, err = Answer(f.ctx, f.store, "ans-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(answer.Evidence) != 1 || answer.Evidence[0].Filename != "invoice.pdf" {
		t.Fatalf("answer evidence after add = %+v", answer.Evidence)
	}
}

func TestGetRejectsUnknownEntityAndMissingRecord(t *testing.T) {
	f := setup(t)
	if _, err := Get(f.ctx, f.store, "source", f.activityID); err == nil {
		t.Fatal("Get accepted an unknown entity")
	}
	if _, err := Get(f.ctx, f.store, "activity_data", "missing"); err == nil {
		t.Fatal("Get accepted a missing activity")
	}
	if _, err := Answer(f.ctx, f.store, "missing"); err == nil {
		t.Fatal("Answer accepted a missing answer")
	}
}
