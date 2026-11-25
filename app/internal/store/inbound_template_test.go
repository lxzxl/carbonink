package store

import (
	"testing"
)

func TestInboundTemplateCRUD(t *testing.T) {
	s, ctx := openFixture(t)
	saved, err := s.SaveInboundTemplate(ctx, InboundTemplateInput{
		LabelEN:         "Packaging Supplier Form",
		LabelZH:         "包装材料供应商表",
		Category:        "purchased_goods",
		GHGProtocolPath: "scope3.cat1_purchased_goods",
		EFCategory:      "purchase",
		Tier1Unit:       "kg",
		DefaultUnit:     "kg",
		Questions: []InboundTemplateQuestion{
			{Tier: 0, Kind: "narrative", RawEN: "Legal name", RawZH: "法定名称"},
			{Tier: 1, Kind: "numerical", RawEN: "PCF per kg", RawZH: "单位碳足迹", ExpectedUnit: "kgCO2e/kg"},
			{Tier: 3, Kind: "numerical", RawEN: "Weight supplied", RawZH: "供货重量", ExpectedUnit: "kg"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if saved.Kind != "custom:"+saved.ID || len(saved.Questions) != 3 {
		t.Fatalf("saved = %+v", saved)
	}
	if saved.Questions[0].Position != "meta.1" || saved.Questions[0].CellRef != "metadata!B5" ||
		saved.Questions[1].Position != "tier1.1" || saved.Questions[1].CellRef != "tier1!B5" ||
		saved.Questions[2].Position != "tier3.1" || saved.Questions[2].CellRef != "tier3!B5" {
		t.Fatalf("normalized questions = %+v", saved.Questions)
	}

	list, err := s.ListInboundTemplates(ctx)
	if err != nil || len(list) != 1 || list[0].ID != saved.ID {
		t.Fatalf("list = %+v, %v", list, err)
	}
	byKind, err := s.InboundTemplateByKind(ctx, saved.Kind)
	if err != nil || byKind == nil || byKind.LabelEN != "Packaging Supplier Form" {
		t.Fatalf("byKind = %+v, %v", byKind, err)
	}

	updated, err := s.SaveInboundTemplate(ctx, InboundTemplateInput{
		ID:              saved.ID,
		LabelEN:         "Packaging Supplier Form v2",
		Category:        "purchased_goods",
		GHGProtocolPath: "scope3.cat1_purchased_goods",
		Questions: []InboundTemplateQuestion{
			{Tier: 0, Kind: "narrative", RawEN: "Legal name"},
			{Tier: 0, Kind: "narrative", RawEN: "Plant city"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.LabelZH != "Packaging Supplier Form v2" || len(updated.Questions) != 2 ||
		updated.Questions[1].CellRef != "metadata!B7" {
		t.Fatalf("updated = %+v", updated)
	}

	if err := s.DeleteInboundTemplate(ctx, saved.ID); err != nil {
		t.Fatal(err)
	}
	gone, err := s.InboundTemplateByID(ctx, saved.ID)
	if err != nil || gone != nil {
		t.Fatalf("after delete = %+v, %v", gone, err)
	}
}
