package app

import (
	"testing"

	"app.carbonink.desktop/internal/inbound"
)

func TestSupplierQuestionTextUsesReaderLanguage(t *testing.T) {
	question := inbound.Question{
		Position: "Q1",
		RawEN:    "Reporting period {{period_year}}.",
		RawZH:    "报告期 {{period_year}}。",
	}

	if got, want := supplierQuestionText("en-US", question, "2025"), "Reporting period 2025."; got != want {
		t.Fatalf("en-US question = %q, want %q", got, want)
	}
	if got, want := supplierQuestionText("zh-CN", question, "2025"), "报告期 2025。"; got != want {
		t.Fatalf("zh-CN question = %q, want %q", got, want)
	}

	question.RawZH = ""
	if got, want := supplierQuestionText("zh-CN", question, ""), "Reporting period {{period_year}}."; got != want {
		t.Fatalf("fallback question = %q, want %q", got, want)
	}
}
