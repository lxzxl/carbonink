package store

import (
	"context"
	"testing"
)

func TestCustomersAndSuppliersAreRoleScoped(t *testing.T) {
	s, ctx := openFixture(t)
	customer, err := s.CreateOrGetCustomer(ctx, " ACME Ltd ")
	if err != nil {
		t.Fatal(err)
	}
	if customer.Name != "ACME Ltd" || customer.Role != "customer" {
		t.Fatalf("customer = %+v", customer)
	}
	again, err := s.CreateOrGetCustomer(ctx, "ACME Ltd")
	if err != nil || again.ID != customer.ID {
		t.Fatalf("get-or-create = %+v, %v", again, err)
	}
	supplier, err := s.CreateSupplier(ctx, "Upstream Co", "", " buyer@example.com ")
	if err != nil {
		t.Fatal(err)
	}
	if supplier.Role != "supplier" || supplier.Email != "buyer@example.com" {
		t.Fatalf("supplier = %+v", supplier)
	}
	customers, err := s.ListCustomers(ctx)
	if err != nil || len(customers) != 1 || customers[0].ID != customer.ID {
		t.Fatalf("customers = %+v, %v", customers, err)
	}
	suppliers, err := s.ListSuppliers(ctx)
	if err != nil || len(suppliers) != 1 || suppliers[0].ID != supplier.ID {
		t.Fatalf("suppliers = %+v, %v", suppliers, err)
	}
	if got, err := s.CustomerByID(ctx, supplier.ID); err != nil || got != nil {
		t.Fatalf("supplier read as customer = %+v, %v", got, err)
	}
	if updated, err := s.SetSupplierEmail(ctx, supplier.ID, ""); err != nil || updated == nil ||
		updated.Email != "" {
		t.Fatalf("clear email = %+v, %v", updated, err)
	}
	if updated, err := s.SetSupplierEmail(ctx, customer.ID, "x@example.com"); err != nil ||
		updated != nil {
		t.Fatalf("customer email update = %+v, %v", updated, err)
	}
	both, err := s.SetCounterpartyRole(ctx, supplier.ID, "both")
	if err != nil || both == nil || both.Role != "both" {
		t.Fatalf("set role both = %+v, %v", both, err)
	}
	customers, err = s.ListCustomers(ctx)
	if err != nil || len(customers) != 2 {
		t.Fatalf("customers with both = %+v, %v", customers, err)
	}
	suppliers, err = s.ListSuppliers(ctx)
	if err != nil || len(suppliers) != 1 || suppliers[0].ID != supplier.ID {
		t.Fatalf("suppliers with both = %+v, %v", suppliers, err)
	}
}

func TestQuestionnaireReuseFinalizeAndUnfinalize(t *testing.T) {
	s, ctx := openFixture(t)
	dir := t.TempDir()
	docA := saveTestDocument(t, s, ctx, dir, "a.xlsx", []byte("a"))
	docB := saveTestDocument(t, s, ctx, dir, "b.xlsx", []byte("b"))

	first, reused, err := s.CreateQuestionnaire(ctx, QuestionnaireInput{
		CustomerName:  "ACME Ltd",
		DocumentID:    docA.ID,
		ReportingYear: 2025,
		Questions: []QuestionInput{
			{NormalizedText: "annual electricity use", RawText: "Annual electricity use (kWh)",
				QuestionKind: "numerical", ExpectedUnit: "kWh", Position: "Sheet1!B5"},
			{NormalizedText: "describe transition plan", RawText: "Describe your transition plan",
				QuestionKind: "narrative", Position: "Sheet1!B6"},
			{NormalizedText: "employees", RawText: "Total employees",
				QuestionKind: "numerical", Position: "Sheet1!B5"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if reused != 0 {
		t.Fatalf("first import reused = %d", reused)
	}
	questions, err := s.ListQuestions(ctx, first)
	if err != nil || len(questions) != 3 {
		t.Fatalf("questions = %d, %v", len(questions), err)
	}
	var electricity Question
	for _, q := range questions {
		if q.NormalizedText == "annual electricity use" {
			electricity = q
		}
	}
	if electricity.QuestionSignature != QuestionSignature("annual electricity use") ||
		electricity.SignatureVersion != SignatureVersion {
		t.Fatalf("signature = %+v", electricity)
	}
	emptyPositions := 0
	for _, q := range questions {
		if q.Position == "" {
			emptyPositions++
		}
	}
	if emptyPositions != 1 {
		t.Fatalf("duplicate position kept: empty = %d", emptyPositions)
	}

	answer, err := s.SaveAnswer(ctx, SaveAnswerInput{
		QuestionID: electricity.ID, Value: "120000", Unit: "kWh", Finalize: true,
	})
	if err != nil || answer.FinalizedAt == "" || answer.SourceKind != "manual" {
		t.Fatalf("saved answer = %+v, %v", answer, err)
	}
	if _, err := s.SaveAnswer(ctx, SaveAnswerInput{
		QuestionID: electricity.ID, Value: "130000", Unit: "kWh",
	}); err != nil {
		t.Fatal(err)
	}
	if kept, err := s.AnswerByQuestion(ctx, electricity.ID); err != nil || kept.FinalizedAt == "" {
		t.Fatalf("finalization stamp lost = %+v, %v", kept, err)
	}

	second, reused, err := s.CreateQuestionnaire(ctx, QuestionnaireInput{
		CustomerName:  "ACME Ltd",
		DocumentID:    docB.ID,
		ReportingYear: 2026,
		Questions: []QuestionInput{
			{NormalizedText: "annual electricity use", RawText: "Annual electricity use (kWh)",
				QuestionKind: "numerical", ExpectedUnit: "kWh", Position: "Data!C2"},
			{NormalizedText: "describe transition plan", RawText: "Describe your transition plan",
				QuestionKind: "narrative", Position: "Data!C3"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if reused != 1 {
		t.Fatalf("second import reused = %d, want 1 (only the finalized signature)", reused)
	}
	secondQuestions, err := s.ListQuestions(ctx, second)
	if err != nil {
		t.Fatal(err)
	}
	if secondQuestions[0].AnswerSourceKind != "reused" ||
		secondQuestions[0].AnswerValue != "130000" ||
		secondQuestions[0].AnswerFinalizedAt != "" {
		t.Fatalf("reused answer = %+v", secondQuestions[0])
	}
	if secondQuestions[1].Answered() {
		t.Fatalf("unfinalized signature was reused: %+v", secondQuestions[1])
	}

	if err := s.FinalizeQuestionnaire(ctx, second); err != nil {
		t.Fatal(err)
	}
	secondQuestions, err = s.ListQuestions(ctx, second)
	if err != nil {
		t.Fatal(err)
	}
	if secondQuestions[0].AnswerFinalizedAt == "" {
		t.Fatal("reused answer was not finalized")
	}
	questionnaire, err := s.QuestionnaireByID(ctx, second)
	if err != nil || questionnaire.Status != QuestionnaireFinalized ||
		questionnaire.AnsweredCount != 1 || questionnaire.QuestionCount != 2 {
		t.Fatalf("finalized questionnaire = %+v, %v", questionnaire, err)
	}
	if _, err := s.UnfinalizeAnswer(ctx, secondQuestions[0].ID); err != nil {
		t.Fatal(err)
	}
	if unfinalized, err := s.AnswerByQuestion(ctx, secondQuestions[0].ID); err != nil ||
		unfinalized.FinalizedAt != "" {
		t.Fatalf("unfinalized answer = %+v, %v", unfinalized, err)
	}

	if err := s.MarkQuestionnaireExported(ctx, second); err != nil {
		t.Fatal(err)
	}
	if err := s.FinalizeQuestionnaire(ctx, second); err != nil {
		t.Fatal(err)
	}
	if exported, err := s.QuestionnaireByID(ctx, second); err != nil ||
		exported.Status != QuestionnaireExported {
		t.Fatalf("exported status regressed: %+v, %v", exported, err)
	}
	if err := s.FinalizeQuestionnaire(ctx, "missing"); err == nil {
		t.Fatal("missing questionnaire finalized")
	}

	list, err := s.ListQuestionnaires(ctx)
	if err != nil || len(list) != 2 {
		t.Fatalf("list = %d, %v", len(list), err)
	}
}

func TestCreateQuestionnaireRejectsBadInput(t *testing.T) {
	s, ctx := openFixture(t)
	dir := t.TempDir()
	document := saveTestDocument(t, s, ctx, dir, "q.xlsx", []byte("q"))
	cases := []struct {
		name  string
		input QuestionnaireInput
	}{
		{"year", QuestionnaireInput{CustomerName: "ACME", DocumentID: document.ID,
			ReportingYear: 1999}},
		{"document", QuestionnaireInput{CustomerName: "ACME", ReportingYear: 2025}},
		{"customer", QuestionnaireInput{DocumentID: document.ID, ReportingYear: 2025}},
		{"kind", QuestionnaireInput{CustomerName: "ACME", DocumentID: document.ID,
			ReportingYear: 2025, Questions: []QuestionInput{{NormalizedText: "x", QuestionKind: "other"}}}},
		{"text", QuestionnaireInput{CustomerName: "ACME", DocumentID: document.ID,
			ReportingYear: 2025, Questions: []QuestionInput{{QuestionKind: "numerical"}}}},
	}
	for _, tc := range cases {
		if _, _, err := s.CreateQuestionnaire(ctx, tc.input); err == nil {
			t.Errorf("%s accepted", tc.name)
		}
	}
	if _, err := s.SaveAnswer(ctx, SaveAnswerInput{QuestionID: "missing", Value: "x"}); err == nil {
		t.Error("missing question answered")
	}
	if _, err := s.UnfinalizeAnswer(ctx, "missing"); err == nil {
		t.Error("missing answer unfinalized")
	}
}

func saveTestDocument(t *testing.T, s *Store, ctx context.Context, dir, name string,
	data []byte) *Document {
	t.Helper()
	document, _, err := s.SaveDocument(ctx, DocumentInput{
		Filename: name,
		MIMEType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		Data:     data,
	}, dir)
	if err != nil {
		t.Fatal(err)
	}
	return document
}
