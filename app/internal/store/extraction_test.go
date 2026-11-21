package store

import (
	"context"
	"strings"
	"testing"
)

func extractionFixture(t *testing.T) (*Store, *Document) {
	t.Helper()
	s, ctx := openFixture(t)
	document, _, err := s.SaveDocument(ctx, DocumentInput{
		Filename: "bill.pdf", MIMEType: "application/pdf", Data: []byte("%PDF-1.7\nbill\n"),
	}, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return s, document
}

func TestExtractionLifecycle(t *testing.T) {
	s, document := extractionFixture(t)
	ctx := context.Background()
	key := ExtractionKey{
		DocumentID: document.ID, PromptVersion: "china_utility.v1",
		LLMProvider: "openai", LLMModel: "gpt-test",
	}
	first, err := s.InsertExtraction(ctx, ExtractionInput{
		DocumentID: document.ID, LLMProvider: "openai", LLMModel: "gpt-test",
		PromptVersion: "china_utility.v1", ParsedJSON: `{"doc_type":"china_utility"}`,
	})
	if err != nil {
		t.Fatal(err)
	}
	if first.Status != ExtractionReviewNeeded || first.RawResponse != first.ParsedJSON {
		t.Fatalf("inserted = %+v", first)
	}
	if cached, err := s.FindExtraction(ctx, key); err != nil || cached == nil || cached.ID != first.ID {
		t.Fatalf("cached = %+v, %v", cached, err)
	}
	status, err := s.ExtractionStatusByDocument(ctx)
	if err != nil || len(status) != 1 || status[0].ActiveStatus != ExtractionReviewNeeded ||
		status[0].HasRejected {
		t.Fatalf("status = %+v, %v", status, err)
	}
	if err := s.ConfirmExtraction(ctx, first.ID); err != nil {
		t.Fatal(err)
	}
	confirmed, err := s.ExtractionByID(ctx, first.ID)
	if err != nil || confirmed.Status != ExtractionParsed || confirmed.ReviewedByUserAt == "" {
		t.Fatalf("confirmed = %+v, %v", confirmed, err)
	}
	if err := s.DiscardExtraction(ctx, first.ID); err == nil {
		t.Fatal("discarded a confirmed extraction")
	}

	second, err := s.InsertExtraction(ctx, ExtractionInput{
		DocumentID: document.ID, LLMProvider: "openai", LLMModel: "gpt-test",
		PromptVersion: "china_utility.v1", ParsedJSON: `{"doc_type":"china_utility"}`,
	})
	if err == nil {
		t.Fatalf("duplicate insert succeeded: %+v", second)
	}

	if err := s.DiscardExtraction(ctx, first.ID); err == nil {
		t.Fatal("discard accepted a parsed row")
	}
	third, err := s.InsertExtraction(ctx, ExtractionInput{
		DocumentID: document.ID, LLMProvider: "other", LLMModel: "model",
		PromptVersion: "travel.v1", ParsedJSON: `{"doc_type":"travel"}`,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.DiscardExtraction(ctx, third.ID); err != nil {
		t.Fatal(err)
	}
	status, err = s.ExtractionStatusByDocument(ctx)
	if err != nil || len(status) != 1 || status[0].ActiveStatus != ExtractionParsed ||
		!status[0].HasRejected {
		t.Fatalf("status = %+v, %v", status, err)
	}
}

func TestRejectedExtractionDoesNotBlockRetry(t *testing.T) {
	s, document := extractionFixture(t)
	ctx := context.Background()
	input := ExtractionInput{
		DocumentID: document.ID, LLMProvider: "openai", LLMModel: "gpt-test",
		PromptVersion: "china_utility.v1", ParsedJSON: `{"doc_type":"china_utility"}`,
	}
	first, err := s.InsertExtraction(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.DiscardExtraction(ctx, first.ID); err != nil {
		t.Fatal(err)
	}
	second, err := s.InsertExtraction(ctx, input)
	if err != nil {
		t.Fatalf("retry after reject: %v", err)
	}
	if second.ID == first.ID {
		t.Fatal("retry reused the rejected row")
	}
	if old, err := s.ExtractionByID(ctx, first.ID); err != nil || old != nil {
		t.Fatalf("rejected row survived: %+v, %v", old, err)
	}
}

func TestExtractionRejectsBadInput(t *testing.T) {
	s, document := extractionFixture(t)
	ctx := context.Background()
	cases := []ExtractionInput{
		{DocumentID: "", LLMProvider: "p", LLMModel: "m", PromptVersion: "v", ParsedJSON: `{}`},
		{DocumentID: document.ID, LLMProvider: "", LLMModel: "m", PromptVersion: "v", ParsedJSON: `{}`},
		{DocumentID: document.ID, LLMProvider: "p", LLMModel: "m", PromptVersion: "v"},
		{DocumentID: document.ID, LLMProvider: "p", LLMModel: "m", PromptVersion: "v", ParsedJSON: `[]`},
		{DocumentID: document.ID, LLMProvider: "p", LLMModel: "m", PromptVersion: "v", ParsedJSON: `not json`},
	}
	for _, input := range cases {
		if _, err := s.InsertExtraction(ctx, input); err == nil {
			t.Errorf("accepted %+v", input)
		}
	}
}

func TestExtractionAuditEvents(t *testing.T) {
	s, document := extractionFixture(t)
	ctx := context.Background()
	row, err := s.InsertExtraction(ctx, ExtractionInput{
		DocumentID: document.ID, LLMProvider: "openai", LLMModel: "gpt-test",
		PromptVersion: "travel.v1", ParsedJSON: `{"doc_type":"travel"}`,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.DiscardExtraction(ctx, row.ID); err != nil {
		t.Fatal(err)
	}
	rows, err := s.DB().QueryContext(ctx,
		`SELECT event_kind, payload FROM audit_event WHERE event_kind LIKE 'extraction.%'
		 ORDER BY occurred_at, id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var kinds []string
	for rows.Next() {
		var kind, payload string
		if err := rows.Scan(&kind, &payload); err != nil {
			t.Fatal(err)
		}
		kinds = append(kinds, kind)
		if strings.Contains(payload, "国网") || strings.Contains(payload, "doc_type") {
			t.Errorf("%s audit payload leaked document content: %s", kind, payload)
		}
	}
	if len(kinds) != 2 || kinds[0] != "extraction.created" || kinds[1] != "extraction.discarded" {
		t.Fatalf("audit kinds = %v", kinds)
	}
}
