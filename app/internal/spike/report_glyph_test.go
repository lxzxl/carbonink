package spike

import (
	"os"
	"testing"

	"golang.org/x/image/font/sfnt"
)

// TestReportGlyphs guards the layout against silent tofu. fpdf draws glyph 0
// for a rune the font does not cover; this caught "tCO₂e" on the summary page,
// because Noto Sans SC has no U+2082.
func TestReportGlyphs(t *testing.T) {
	font, path, err := fontBytes()
	if err != nil {
		t.Skip(err)
	}
	face, err := sfnt.Parse(font)
	if err != nil {
		t.Fatalf("parse %s: %v", path, err)
	}
	var missing []rune
	seen := map[rune]bool{}
	for _, s := range reportStrings() {
		for _, r := range s {
			if r == '\n' || r == '\t' || seen[r] {
				continue
			}
			seen[r] = true
			idx, err := face.GlyphIndex(nil, r)
			if err != nil {
				t.Fatalf("glyph %q: %v", r, err)
			}
			if idx == 0 {
				missing = append(missing, r)
			}
		}
	}
	if len(missing) > 0 {
		t.Fatalf("%s does not cover %q (%U); pick another glyph or font", path, string(missing), missing)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatal(err)
	}
}

// reportStrings is every string buildReport writes. Keep it in sync when the
// template changes.
func reportStrings() []string {
	d := sampleReport()
	out := []string{
		"温室气体清单报告",
		"Greenhouse Gas Inventory Report · ISO 14064-1",
		"报告年度 %d · 生成于 %s",
		"本报告依据 ISO 14064-1:2018 编制，覆盖组织边界内的直接与间接排放。每一个数字都可以追溯到来源凭证与排放因子。",
		"编制：CarbonInk 2.0 可行性验证 · 仅用于版式测试，不是正式披露文件。",
		"1  组织边界",
		"下表列出纳入清单的场所及其合并方式。运营控制法适用于全部生产与仓储场所。",
		"场所", "国家/地区", "合并方式",
		"合计 %d 个场所 · %d 个排放类别",
		"2  排放汇总",
		"按 ISO 14064-1 的类别汇总。数值以吨二氧化碳当量（tCO2e）计，采用 AR6 GWP-100。",
		"类别", "名称", "tCO2e", "合计",
		"数据来源：供应商发票、电费账单、运输单据与差旅记录。排放因子来自 CarbonInk 内置库与用户导入库；每一项活动数据均保留凭证链接。",
		"CarbonInk · %d 温室气体清单 · 第 %d 页",
		d.Org,
	}
	for _, s := range d.Sites {
		out = append(out, s.Name, s.Country, s.Scope)
	}
	for _, c := range d.Categories {
		out = append(out, c.Code, c.Name)
	}
	return out
}
