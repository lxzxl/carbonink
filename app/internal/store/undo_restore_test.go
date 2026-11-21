package store

import "testing"

func TestRestoreActivityWithEvidence(t *testing.T) {
	s, ctx := openFixture(t)
	_, site, period := onboard(t, s, ctx)
	src, err := s.CreateSource(ctx, SourceInput{
		SiteID: site.ID, Name: "Purchased electricity", Scope: 2, Category: "electricity.grid",
		GHGProtocolPath: "scope2.location",
	})
	if err != nil {
		t.Fatal(err)
	}
	ef := findFactor(t, s, ctx, EFFilter{Scope: 2, Category: "electricity.grid", Search: "national"})
	activity, err := s.CreateActivity(ctx, ActivityInput{
		EmissionSourceID: src.ID, ReportingPeriodID: period.ID,
		OccurredAtStart: "2025-01-01", OccurredAtEnd: "2025-01-31",
		Amount: 100, Unit: "kWh", EF: keyOf(ef), Notes: "original",
	})
	if err != nil {
		t.Fatal(err)
	}
	attachment, err := s.AddEvidence(ctx, EvidenceTarget{ActivityDataID: activity.ID}, DocumentInput{
		Filename: "meter.pdf", MIMEType: "application/pdf",
		Data: []byte("%PDF-1.4\nmeter\n"),
	}, t.TempDir(), "reading")
	if err != nil {
		t.Fatal(err)
	}
	before, err := s.ActivityByID(ctx, activity.ID)
	if err != nil {
		t.Fatal(err)
	}
	evidence, err := s.ListEvidence(ctx, EvidenceTarget{ActivityDataID: activity.ID})
	if err != nil || len(evidence) != 1 || evidence[0].ID != attachment.ID {
		t.Fatalf("evidence = %+v, %v", evidence, err)
	}
	if err := s.DeleteActivity(ctx, activity.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.RestoreActivity(ctx, *before, evidence); err != nil {
		t.Fatal(err)
	}
	after, err := s.ActivityByID(ctx, activity.ID)
	if err != nil || after == nil {
		t.Fatalf("activity after restore = %+v, %v", after, err)
	}
	if after.Notes != "original" || after.Amount != 100 || after.EFYear != before.EFYear ||
		after.CO2eKg != before.CO2eKg {
		t.Fatalf("restored activity = %+v", after)
	}
	evidence, err = s.ListEvidence(ctx, EvidenceTarget{ActivityDataID: activity.ID})
	if err != nil || len(evidence) != 1 || evidence[0].DocumentID != attachment.DocumentID {
		t.Fatalf("restored evidence = %+v, %v", evidence, err)
	}
	events, err := s.AuditEventsForRecord(ctx, activity.ID, "", 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) < 3 || events[0].Kind != "activity_data.created" {
		t.Fatalf("audit after restore = %+v", events)
	}
}

func TestRestoreSourcesAtomically(t *testing.T) {
	s, ctx := openFixture(t)
	org, site, _ := onboard(t, s, ctx)
	created, err := s.CreateSources(ctx, []SourceInput{
		{SiteID: site.ID, Name: "Diesel", Scope: 1, Category: "fuel.diesel"},
		{SiteID: site.ID, Name: "Electricity", Scope: 2, Category: "electricity.grid"},
	})
	if err != nil || len(created) != 2 {
		t.Fatalf("created = %+v, %v", created, err)
	}
	rows := []EmissionSource{*created[0], *created[1]}
	ids := []string{created[0].ID, created[1].ID}
	if err := s.DeleteSources(ctx, ids); err != nil {
		t.Fatal(err)
	}
	if sources, err := s.ListSources(ctx, org.ID); err != nil || len(sources) != 0 {
		t.Fatalf("sources after delete = %+v, %v", sources, err)
	}
	if err := s.RestoreSources(ctx, rows); err != nil {
		t.Fatal(err)
	}
	sources, err := s.ListSources(ctx, org.ID)
	if err != nil || len(sources) != 2 {
		t.Fatalf("sources after restore = %+v, %v", sources, err)
	}
	if sources[0].Name != "Diesel" && sources[1].Name != "Diesel" {
		t.Fatalf("restored sources = %+v", sources)
	}
}

func TestRestoreExtractionAfterDiscard(t *testing.T) {
	s, ctx := openFixture(t)
	document, _, err := s.SaveDocument(ctx, DocumentInput{
		Filename: "bill.pdf", MIMEType: "application/pdf", Data: []byte("%PDF-1.4\nbill\n"),
	}, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	created, err := s.InsertExtraction(ctx, ExtractionInput{
		DocumentID: document.ID, LLMProvider: "test", LLMModel: "model",
		PromptVersion: "china_utility.v1", RawResponse: `{"amount":100}`,
		ParsedJSON: `{"amount":100}`,
	})
	if err != nil {
		t.Fatal(err)
	}
	before, err := s.ExtractionByID(ctx, created.ID)
	if err != nil || before == nil {
		t.Fatalf("before = %+v, %v", before, err)
	}
	if err := s.DiscardExtraction(ctx, created.ID); err != nil {
		t.Fatal(err)
	}
	discarded, err := s.ExtractionByID(ctx, created.ID)
	if err != nil || discarded.Status != ExtractionRejected || discarded.ParsedJSON != "" {
		t.Fatalf("discarded = %+v, %v", discarded, err)
	}
	if err := s.RestoreExtraction(ctx, *before); err != nil {
		t.Fatal(err)
	}
	restored, err := s.ExtractionByID(ctx, created.ID)
	if err != nil || restored.Status != ExtractionReviewNeeded ||
		restored.ParsedJSON != before.ParsedJSON || restored.RawResponse != before.RawResponse {
		t.Fatalf("restored = %+v, %v", restored, err)
	}
}

func TestRestoreAnswerAndQuestionnaireStatus(t *testing.T) {
	s, ctx := openFixture(t)
	template, _, err := s.SaveDocument(ctx, DocumentInput{
		Filename: "template.xlsx",
		MIMEType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		Data:     []byte("workbook"),
	}, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	questionnaireID, _, err := s.CreateQuestionnaire(ctx, QuestionnaireInput{
		CustomerName: "ACME Ltd", DocumentID: template.ID, ReportingYear: 2025,
		Questions: []QuestionInput{{
			RawText: "Annual electricity use", NormalizedText: "annual electricity use",
			QuestionKind: "numerical", ExpectedUnit: "kWh", Position: "B2",
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	questions, err := s.ListQuestions(ctx, questionnaireID)
	if err != nil || len(questions) != 1 {
		t.Fatalf("questions = %+v, %v", questions, err)
	}
	first, err := s.SaveAnswer(ctx, SaveAnswerInput{
		QuestionID: questions[0].ID, Value: "100", Unit: "kWh", SourceKind: "manual",
	})
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.SaveAnswer(ctx, SaveAnswerInput{
		QuestionID: questions[0].ID, Value: "200", Unit: "kWh",
		SourceKind: "manual", Finalize: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.RestoreAnswer(ctx, *first); err != nil {
		t.Fatal(err)
	}
	got, err := s.AnswerByID(ctx, first.ID)
	if err != nil || got.Value != "100" || got.FinalizedAt != "" {
		t.Fatalf("restored answer = %+v, %v", got, err)
	}
	if err := s.RestoreAnswer(ctx, *second); err != nil {
		t.Fatal(err)
	}
	got, err = s.AnswerByID(ctx, first.ID)
	if err != nil || got.Value != "200" || got.FinalizedAt == "" {
		t.Fatalf("redone answer = %+v, %v", got, err)
	}
	if err := s.DeleteAnswer(ctx, first.ID); err != nil {
		t.Fatal(err)
	}
	if got, err = s.AnswerByID(ctx, first.ID); err != nil || got != nil {
		t.Fatalf("deleted answer = %+v, %v", got, err)
	}
	if err := s.RestoreAnswer(ctx, *second); err != nil {
		t.Fatal(err)
	}

	before, err := s.QuestionnaireByID(ctx, questionnaireID)
	if err != nil || before == nil {
		t.Fatalf("questionnaire = %+v, %v", before, err)
	}
	if err := s.FinalizeQuestionnaire(ctx, questionnaireID); err != nil {
		t.Fatal(err)
	}
	if err := s.RestoreQuestionnaireStatus(ctx, questionnaireID, before.Status); err != nil {
		t.Fatal(err)
	}
	after, err := s.QuestionnaireByID(ctx, questionnaireID)
	if err != nil || after.Status != before.Status {
		t.Fatalf("restored status = %+v, %v", after, err)
	}
}
