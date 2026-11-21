package store

import (
	"strings"
	"testing"
)

func TestEvidenceAttachListRemove(t *testing.T) {
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
		Amount: 100, Unit: "kWh", EF: keyOf(ef),
	})
	if err != nil {
		t.Fatal(err)
	}

	dataDir := t.TempDir()
	first, err := s.AddEvidence(ctx, EvidenceTarget{ActivityDataID: activity.ID}, DocumentInput{
		Filename: "meter.pdf", MIMEType: "application/pdf",
		Data: []byte("%PDF-1.4\nfirst meter reading\n"),
	}, dataDir, "January meter reading")
	if err != nil {
		t.Fatal(err)
	}
	if first.DocumentID == "" || first.Filename != "meter.pdf" ||
		first.SizeBytes == 0 || first.Note != "January meter reading" {
		t.Fatalf("evidence = %+v", first)
	}
	document, err := s.DocumentByID(ctx, first.DocumentID)
	if err != nil {
		t.Fatal(err)
	}
	if document == nil || document.StoragePath == "" {
		t.Fatalf("document = %+v", document)
	}

	events, err := s.AuditEventsForRecord(ctx, activity.ID, "", 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 2 || events[0].Kind != "evidence.attached" {
		t.Fatalf("events = %+v", events)
	}
	if strings.Contains(events[0].Payload, "January meter reading") {
		t.Fatalf("evidence audit leaks the note: %s", events[0].Payload)
	}

	second, err := s.AddEvidence(ctx, EvidenceTarget{ActivityDataID: activity.ID}, DocumentInput{
		Filename: "meter-copy.pdf", MIMEType: "application/pdf",
		Data: []byte("%PDF-1.4\nfirst meter reading\n"),
	}, dataDir, "")
	if err != nil {
		t.Fatal(err)
	}
	if second.DocumentID != first.DocumentID || second.ID == first.ID {
		t.Fatalf("content-addressed reuse failed: first=%+v second=%+v", first, second)
	}
	list, err := s.ListEvidence(ctx, EvidenceTarget{ActivityDataID: activity.ID})
	if err != nil || len(list) != 2 {
		t.Fatalf("list = %d, %v", len(list), err)
	}

	if err := s.RemoveEvidence(ctx, first.ID); err != nil {
		t.Fatal(err)
	}
	list, err = s.ListEvidence(ctx, EvidenceTarget{ActivityDataID: activity.ID})
	if err != nil || len(list) != 1 || list[0].ID != second.ID {
		t.Fatalf("after remove = %+v, %v", list, err)
	}
	if document, err = s.DocumentByID(ctx, first.DocumentID); err != nil || document == nil {
		t.Fatalf("document was deleted with the link: %+v, %v", document, err)
	}
	events, err = s.AuditEventsForRecord(ctx, activity.ID, "", 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 4 || events[0].Kind != "evidence.removed" {
		t.Fatalf("events after remove = %+v", events)
	}
	// Removing an already-removed link is a no-op and writes no second event.
	if err := s.RemoveEvidence(ctx, first.ID); err != nil {
		t.Fatal(err)
	}
	events, err = s.AuditEventsForRecord(ctx, activity.ID, "", 20)
	if err != nil || len(events) != 4 {
		t.Fatalf("events after second remove = %+v, %v", events, err)
	}
}

func TestEvidenceAnswerTargetAndValidation(t *testing.T) {
	s, ctx := openFixture(t)
	_, site, _ := onboard(t, s, ctx)
	src, err := s.CreateSource(ctx, SourceInput{
		SiteID: site.ID, Name: "Purchased electricity", Scope: 2, Category: "electricity.grid",
		GHGProtocolPath: "scope2.location",
	})
	if err != nil {
		t.Fatal(err)
	}
	_ = src
	document, _, err := s.SaveDocument(ctx, DocumentInput{
		Filename: "template.xlsx",
		MIMEType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		Data:     []byte("workbook"),
	}, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	questionnaireID, _, err := s.CreateQuestionnaire(ctx, QuestionnaireInput{
		CustomerName: "ACME Ltd", DocumentID: document.ID, ReportingYear: 2025,
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
	answer, err := s.SaveAnswer(ctx, SaveAnswerInput{
		QuestionID: questions[0].ID, Value: "120000", Unit: "kWh", SourceKind: "manual",
	})
	if err != nil {
		t.Fatal(err)
	}

	attachment, err := s.AddEvidence(ctx, EvidenceTarget{AnswerID: answer.ID}, DocumentInput{
		Filename: "invoice.pdf", MIMEType: "application/pdf",
		Data: []byte("%PDF-1.4\ninvoice\n"),
	}, t.TempDir(), "utility invoice")
	if err != nil {
		t.Fatal(err)
	}
	if attachment.AnswerID != answer.ID || attachment.ActivityDataID != "" {
		t.Fatalf("answer attachment = %+v", attachment)
	}
	events, err := s.AuditEventsForRecord(ctx, "", answer.ID, 20)
	if err != nil || len(events) != 1 || events[0].Kind != "evidence.attached" {
		t.Fatalf("answer events = %+v, %v", events, err)
	}

	if _, err := s.AddEvidence(ctx, EvidenceTarget{}, DocumentInput{
		Filename: "x.pdf", MIMEType: "application/pdf", Data: []byte("%PDF"),
	}, t.TempDir(), ""); err == nil {
		t.Fatal("AddEvidence accepted an empty target")
	}
	if _, err := s.AddEvidence(ctx, EvidenceTarget{
		ActivityDataID: "act", AnswerID: "ans",
	}, DocumentInput{
		Filename: "x.pdf", MIMEType: "application/pdf", Data: []byte("%PDF"),
	}, t.TempDir(), ""); err == nil {
		t.Fatal("AddEvidence accepted two targets")
	}
	if _, err := s.AddEvidence(ctx, EvidenceTarget{ActivityDataID: "missing"}, DocumentInput{
		Filename: "x.pdf", MIMEType: "application/pdf", Data: []byte("%PDF"),
	}, t.TempDir(), ""); err == nil {
		t.Fatal("AddEvidence accepted a missing activity")
	}
	if _, err := s.ListEvidence(ctx, EvidenceTarget{}); err == nil {
		t.Fatal("ListEvidence accepted an empty target")
	}
}

func TestAuditEventsForRecordOnlyMatchesTheRecord(t *testing.T) {
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
	first, err := s.CreateActivity(ctx, ActivityInput{
		EmissionSourceID: src.ID, ReportingPeriodID: period.ID,
		OccurredAtStart: "2025-01-01", OccurredAtEnd: "2025-01-31",
		Amount: 100, Unit: "kWh", EF: keyOf(ef),
	})
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.CreateActivity(ctx, ActivityInput{
		EmissionSourceID: src.ID, ReportingPeriodID: period.ID,
		OccurredAtStart: "2025-02-01", OccurredAtEnd: "2025-02-28",
		Amount: 200, Unit: "kWh", EF: keyOf(ef),
	})
	if err != nil {
		t.Fatal(err)
	}
	events, err := s.AuditEventsForRecord(ctx, first.ID, "", 20)
	if err != nil || len(events) != 1 || events[0].Kind != "activity_data.created" {
		t.Fatalf("first events = %+v, %v", events, err)
	}
	if !strings.Contains(events[0].Payload, first.ID) || strings.Contains(events[0].Payload, second.ID) {
		t.Fatalf("filtered payload = %s", events[0].Payload)
	}
	if events, err := s.AuditEventsForRecord(ctx, "", "", 20); err != nil || len(events) != 0 {
		t.Fatalf("empty ref = %+v, %v", events, err)
	}
}
