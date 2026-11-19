package spike

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/go-pdf/fpdf"
	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/ui"
)

// ReportData is the slice of the real ISO 14064-1 report the layout test
// needs: a cover, an organization boundary table and an emissions summary.
type ReportData struct {
	Org        string
	Year       int
	Sites      []SiteRow
	Categories []CategoryRow
	Total      float64
}

type SiteRow struct {
	Name    string
	Country string
	Scope   string
}

type CategoryRow struct {
	Code  string
	Name  string
	TCO2e float64
}

func sampleReport() ReportData {
	return ReportData{
		Org:  "示例制造（上海）有限公司",
		Year: 2025,
		Sites: []SiteRow{
			{"上海工厂", "中国", "运营控制"},
			{"苏州仓库", "中国", "运营控制"},
			{"Singapore HQ", "新加坡", "财务控制"},
			{"深圳办公室", "中国", "运营控制"},
		},
		Categories: []CategoryRow{
			{"Cat 1", "外购商品与服务", 18240.42},
			{"Cat 2", "资本货物", 3120.18},
			{"Cat 3", "燃料与能源", 9840.73},
			{"Cat 4", "上游运输与配送", 2210.55},
			{"Cat 6", "商务差旅", 486.91},
			{"Cat 12", "废弃物处理", 133.27},
		},
		Total: 34032.06,
	}
}

// buildReport lays out a three-page A4 report with embedded CJK text.
func buildReport(font []byte, d ReportData) ([]byte, error) {
	pdf := fpdf.New("P", "mm", "A4", "")
	pdf.SetMargins(18, 18, 18)
	pdf.SetAutoPageBreak(true, 20)
	if len(font) > 0 {
		pdf.AddUTF8FontFromBytes("noto", "", font)
	} else {
		pdf.SetError(fmt.Errorf("no CJK font"))
	}
	pdf.SetFooterFunc(func() {
		pdf.SetY(-14)
		pdf.SetFont("noto", "", 8)
		pdf.SetTextColor(120, 120, 120)
		pdf.CellFormat(0, 6, fmt.Sprintf("CarbonInk · %d 温室气体清单 · 第 %d 页", d.Year, pdf.PageNo()), "", 0, "C", false, 0, "")
	})

	// Cover.
	pdf.AddPage()
	pdf.SetFillColor(22, 62, 47)
	pdf.Rect(0, 0, 210, 70, "F")
	pdf.SetTextColor(255, 255, 255)
	pdf.SetXY(18, 24)
	pdf.SetFont("noto", "", 26)
	pdf.CellFormat(0, 12, "温室气体清单报告", "", 1, "L", false, 0, "")
	pdf.SetFont("noto", "", 13)
	pdf.CellFormat(0, 8, "Greenhouse Gas Inventory Report · ISO 14064-1", "", 1, "L", false, 0, "")
	pdf.SetTextColor(40, 40, 40)
	pdf.SetXY(18, 92)
	pdf.SetFont("noto", "", 18)
	pdf.CellFormat(0, 10, d.Org, "", 1, "L", false, 0, "")
	pdf.SetFont("noto", "", 12)
	pdf.SetTextColor(90, 90, 90)
	pdf.CellFormat(0, 8, fmt.Sprintf("报告年度 %d · 生成于 %s", d.Year, time.Now().Format("2006-01-02")), "", 1, "L", false, 0, "")
	pdf.SetTextColor(40, 40, 40)
	pdf.SetXY(18, 130)
	pdf.SetFont("noto", "", 11)
	pdf.MultiCell(0, 7, "本报告依据 ISO 14064-1:2018 编制，覆盖组织边界内的直接与间接排放。每一个数字都可以追溯到来源凭证与排放因子。", "", "L", false)
	pdf.SetXY(18, 170)
	pdf.SetDrawColor(22, 62, 47)
	pdf.SetLineWidth(0.6)
	pdf.Line(18, 170, 192, 170)
	pdf.SetFont("noto", "", 10)
	pdf.SetTextColor(90, 90, 90)
	pdf.SetXY(18, 174)
	pdf.MultiCell(0, 6, "编制：CarbonInk 2.0 可行性验证 · 仅用于版式测试，不是正式披露文件。", "", "L", false)

	// Boundary table.
	pdf.AddPage()
	pdf.SetTextColor(40, 40, 40)
	pdf.SetFont("noto", "", 16)
	pdf.CellFormat(0, 10, "1  组织边界", "", 1, "L", false, 0, "")
	pdf.SetFont("noto", "", 10)
	pdf.SetTextColor(90, 90, 90)
	pdf.MultiCell(0, 6, "下表列出纳入清单的场所及其合并方式。运营控制法适用于全部生产与仓储场所。", "", "L", false)
	pdf.Ln(4)
	header := func(cells ...string) {
		pdf.SetFillColor(238, 242, 239)
		pdf.SetTextColor(40, 40, 40)
		pdf.SetFont("noto", "", 10)
		for i, c := range cells {
			pdf.CellFormat([]float64{70, 40, 64}[i], 9, c, "B", 0, "L", true, 0, "")
		}
		pdf.Ln(-1)
	}
	header("场所", "国家/地区", "合并方式")
	pdf.SetFont("noto", "", 10)
	for _, s := range d.Sites {
		pdf.SetTextColor(40, 40, 40)
		pdf.CellFormat(70, 9, s.Name, "B", 0, "L", false, 0, "")
		pdf.CellFormat(40, 9, s.Country, "B", 0, "L", false, 0, "")
		pdf.CellFormat(64, 9, s.Scope, "B", 0, "L", false, 0, "")
		pdf.Ln(-1)
	}
	pdf.Ln(8)
	pdf.SetFont("noto", "", 11)
	pdf.SetTextColor(22, 62, 47)
	pdf.CellFormat(0, 8, fmt.Sprintf("合计 %d 个场所 · %d 个排放类别", len(d.Sites), len(d.Categories)), "", 1, "L", false, 0, "")

	// Emissions summary.
	pdf.AddPage()
	pdf.SetTextColor(40, 40, 40)
	pdf.SetFont("noto", "", 16)
	pdf.CellFormat(0, 10, "2  排放汇总", "", 1, "L", false, 0, "")
	pdf.SetFont("noto", "", 10)
	pdf.SetTextColor(90, 90, 90)
	// Noto Sans SC has no U+2082 (₂), so the report spells the unit in ASCII.
	// A real template would set the subscript with a second text run.
	pdf.MultiCell(0, 6, "按 ISO 14064-1 的类别汇总。数值以吨二氧化碳当量（tCO2e）计，采用 AR6 GWP-100。", "", "L", false)
	pdf.Ln(4)
	pdf.SetFillColor(238, 242, 239)
	pdf.SetTextColor(40, 40, 40)
	pdf.SetFont("noto", "", 10)
	pdf.CellFormat(24, 9, "类别", "B", 0, "L", true, 0, "")
	pdf.CellFormat(104, 9, "名称", "B", 0, "L", true, 0, "")
	pdf.CellFormat(46, 9, "tCO2e", "B", 0, "R", true, 0, "")
	pdf.Ln(-1)
	for _, c := range d.Categories {
		pdf.SetTextColor(40, 40, 40)
		pdf.CellFormat(24, 9, c.Code, "B", 0, "L", false, 0, "")
		pdf.CellFormat(104, 9, c.Name, "B", 0, "L", false, 0, "")
		pdf.CellFormat(46, 9, fmt.Sprintf("%.2f", c.TCO2e), "B", 0, "R", false, 0, "")
		pdf.Ln(-1)
	}
	pdf.SetFont("noto", "", 11)
	pdf.SetTextColor(22, 62, 47)
	pdf.CellFormat(128, 10, "合计", "T", 0, "L", false, 0, "")
	pdf.CellFormat(46, 10, fmt.Sprintf("%.2f", d.Total), "T", 0, "R", false, 0, "")
	pdf.Ln(-1)
	pdf.Ln(6)
	pdf.SetFont("noto", "", 9)
	pdf.SetTextColor(110, 110, 110)
	pdf.MultiCell(0, 5, "数据来源：供应商发票、电费账单、运输单据与差旅记录。排放因子来自 CarbonInk 内置库与用户导入库；每一项活动数据均保留凭证链接。", "", "L", false)

	var buf bytes.Buffer
	if err := pdf.Output(&buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func reportScreen(cx *core.Scope) core.Node {
	font, fontPath, fontErr := fontBytes()
	status := core.NewSignal(cx, "")
	last := core.NewSignal(cx, "")
	size := core.NewSignal(cx, 0)
	pages := core.NewSignal(cx, 0)

	generate := func() {
		data, err := buildReport(font, sampleReport())
		if err != nil {
			status.Set("failed: " + err.Error())
			return
		}
		out := filepath.Join(cx.DataDir(), "spike-report.pdf")
		if err := os.MkdirAll(cx.DataDir(), 0o755); err == nil {
			if err := os.WriteFile(out, data, 0o644); err != nil {
				status.Set("write failed: " + err.Error())
				return
			}
		}
		last.Set(out)
		size.Set(len(data))
		pages.Set(3)
		status.Set("generated")
	}

	info := "font: not loaded"
	if fontErr == nil {
		info = "font: " + fontPath + fmt.Sprintf(" (%d KB)", len(font)/1024)
	}

	return panel(cx,
		card(cx,
			label(cx, "What this proves"),
			core.Text{Content: "A three-page A4 report with CJK headings, tables and page numbers, laid out by Go and opened by the system viewer. The real app has three templates (ISO, TCFD, questionnaire); this is the ISO shape.", Style: core.Style{FontSize: 13}},
			core.Text{Content: info, Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
			core.View{Style: core.Style{Direction: core.Row, Gap: 8}, Children: []core.Node{
				ui.Button{Text: "Generate", OnPress: generate},
				ui.Button{Text: "Open", Variant: ui.ButtonSecondary, Disabled: func() bool { return last.Get() == "" },
					OnPress: func() { openPDF(cx, last.Get()) }},
				ui.Button{Text: "Save a copy…", Variant: ui.ButtonSecondary, Disabled: func() bool { return last.Get() == "" },
					OnPress: func() {
						data, err := os.ReadFile(last.Get())
						if err != nil {
							status.Set("read failed: " + err.Error())
							return
						}
						cx.SaveFile(core.SaveOptions{Name: "carbonink-report.pdf", MIME: "application/pdf", Data: data},
							func(saved bool, path string, err error) {
								if err != nil {
									status.Set("save failed: " + err.Error())
								} else if saved {
									status.Set("saved to " + path)
								}
							})
					}},
			}},
			core.Text{ContentFunc: func() string {
				switch {
				case status.Get() == "":
					return "Not generated yet."
				case size.Get() == 0:
					return status.Get()
				default:
					return fmt.Sprintf("%s · %d KB · %d pages · %s", status.Get(), size.Get()/1024, pages.Get(), last.Get())
				}
			}, Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
		),
		card(cx,
			label(cx, "Why this is the risky one"),
			core.Text{Content: "1.x renders HTML in a hidden BrowserWindow and calls printToPDF. NSGo has no print API, so the templates become Go layout. Page breaks, table widths and CJK line breaking are the parts to compare against the current PDFs.", Style: core.Style{FontSize: 13}},
		),
	)
}
