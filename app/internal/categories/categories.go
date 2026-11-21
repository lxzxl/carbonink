// Package categories is the canonical emission-source taxonomy. The codes are
// stored verbatim in emission_source.ghg_protocol_path; EFCategory is the
// internal prefix written to emission_source.category so the EF candidate
// query keeps matching the catalog's own vocabulary.
package categories

import (
	"fmt"
	"strings"
)

// Category is one GHG Protocol source category.
type Category struct {
	// Code is stable and stored in emission_source.ghg_protocol_path.
	Code string
	// Scope is 1, 2, or 3.
	Scope int
	// GHGPNumber is the Scope 3 category number (1-15), zero for scope 1/2.
	GHGPNumber int
	// ISO is the ISO 14064-1:2018 category number.
	ISO int
	// LabelEN and LabelZH are the domain names, not UI prose.
	LabelEN string
	LabelZH string
	// EFCategory is empty where the bundled EF catalog has no coverage.
	EFCategory string
	// Keywords are extra search terms in both languages.
	Keywords []string
}

// All is the taxonomy in standard order.
var All = []Category{
	// Scope 1 — direct emissions (ISO C1).
	{
		Code: "scope1.stationary_combustion", Scope: 1, ISO: 1,
		LabelEN: "Stationary combustion", LabelZH: "固定燃烧", EFCategory: "fuel.stationary",
		Keywords: []string{"boiler", "furnace", "natural gas", "coal", "锅炉", "窑炉", "天然气", "燃煤"},
	},
	{
		Code: "scope1.mobile_combustion", Scope: 1, ISO: 1,
		LabelEN: "Mobile combustion", LabelZH: "移动燃烧", EFCategory: "fuel.mobile",
		Keywords: []string{"fleet", "vehicle", "diesel", "gasoline", "车队", "公务车", "柴油", "汽油", "叉车"},
	},
	{
		Code: "scope1.process_emissions", Scope: 1, ISO: 1,
		LabelEN: "Process emissions", LabelZH: "工艺过程排放",
		Keywords: []string{"cement", "calcination", "chemical", "水泥", "煅烧", "碳酸盐", "化工"},
	},
	{
		Code: "scope1.fugitive_emissions", Scope: 1, ISO: 1,
		LabelEN: "Fugitive emissions", LabelZH: "逸散排放",
		Keywords: []string{"refrigerant", "sf6", "leak", "制冷剂", "冷媒", "泄漏", "六氟化硫"},
	},

	// Scope 2 — imported energy (ISO C2).
	{
		Code: "scope2.purchased_electricity", Scope: 2, ISO: 2,
		LabelEN: "Purchased electricity", LabelZH: "外购电力", EFCategory: "electricity",
		Keywords: []string{"grid", "power", "电网", "用电", "购电"},
	},
	{
		Code: "scope2.purchased_heat", Scope: 2, ISO: 2,
		LabelEN: "Purchased heat", LabelZH: "外购热力",
		Keywords: []string{"district heating", "hot water", "集中供热", "热水"},
	},
	{
		Code: "scope2.purchased_steam", Scope: 2, ISO: 2,
		LabelEN: "Purchased steam", LabelZH: "外购蒸汽",
		Keywords: []string{"steam", "蒸汽"},
	},
	{
		Code: "scope2.purchased_cooling", Scope: 2, ISO: 2,
		LabelEN: "Purchased cooling", LabelZH: "外购冷力",
		Keywords: []string{"chilled water", "district cooling", "冷冻水", "集中供冷"},
	},

	// Scope 3 upstream — categories 1-8.
	{
		Code: "scope3.cat1_purchased_goods", Scope: 3, GHGPNumber: 1, ISO: 4,
		LabelEN: "Purchased goods and services", LabelZH: "采购的商品和服务", EFCategory: "purchase",
		Keywords: []string{"supplier", "materials", "procurement", "供应商", "原材料", "采购", "服务"},
	},
	{
		Code: "scope3.cat2_capital_goods", Scope: 3, GHGPNumber: 2, ISO: 4,
		LabelEN: "Capital goods", LabelZH: "资本商品",
		Keywords: []string{"equipment", "machinery", "buildings", "设备", "机器", "厂房", "固定资产"},
	},
	{
		Code: "scope3.cat3_fuel_energy_related", Scope: 3, GHGPNumber: 3, ISO: 4,
		LabelEN: "Fuel- and energy-related activities", LabelZH: "燃料和能源相关活动",
		Keywords: []string{"wtt", "t&d losses", "upstream fuel", "燃料上游", "输配电损耗"},
	},
	{
		Code: "scope3.cat4_upstream_transportation", Scope: 3, GHGPNumber: 4, ISO: 3,
		LabelEN: "Upstream transportation and distribution", LabelZH: "上游运输和配送", EFCategory: "freight",
		Keywords: []string{"inbound freight", "logistics", "入厂物流", "货运", "仓储"},
	},
	{
		Code: "scope3.cat5_waste_generated", Scope: 3, GHGPNumber: 5, ISO: 4,
		LabelEN: "Waste generated in operations", LabelZH: "运营中产生的废弃物",
		Keywords: []string{"landfill", "incineration", "wastewater", "填埋", "焚烧", "污水", "固废"},
	},
	{
		Code: "scope3.cat6_business_travel", Scope: 3, GHGPNumber: 6, ISO: 3,
		LabelEN: "Business travel", LabelZH: "商务差旅", EFCategory: "travel",
		Keywords: []string{"flight", "hotel", "rail", "taxi", "机票", "酒店", "高铁", "出差"},
	},
	{
		Code: "scope3.cat7_employee_commuting", Scope: 3, GHGPNumber: 7, ISO: 3,
		LabelEN: "Employee commuting", LabelZH: "员工通勤",
		Keywords: []string{"commute", "remote work", "通勤", "班车", "居家办公"},
	},
	{
		Code: "scope3.cat8_upstream_leased_assets", Scope: 3, GHGPNumber: 8, ISO: 4,
		LabelEN: "Upstream leased assets", LabelZH: "上游租赁资产",
		Keywords: []string{"leased", "租入", "租赁"},
	},

	// Scope 3 downstream — categories 9-15.
	{
		Code: "scope3.cat9_downstream_transportation", Scope: 3, GHGPNumber: 9, ISO: 3,
		LabelEN: "Downstream transportation and distribution", LabelZH: "下游运输和配送", EFCategory: "freight",
		Keywords: []string{"outbound freight", "delivery", "出厂物流", "配送", "末端配送"},
	},
	{
		Code: "scope3.cat10_processing_of_sold_products", Scope: 3, GHGPNumber: 10, ISO: 5,
		LabelEN: "Processing of sold products", LabelZH: "售出产品的加工",
		Keywords: []string{"downstream processing", "下游加工", "客户加工"},
	},
	{
		Code: "scope3.cat11_use_of_sold_products", Scope: 3, GHGPNumber: 11, ISO: 5,
		LabelEN: "Use of sold products", LabelZH: "售出产品的使用",
		Keywords: []string{"use phase", "使用阶段", "产品用电"},
	},
	{
		Code: "scope3.cat12_end_of_life_treatment", Scope: 3, GHGPNumber: 12, ISO: 5,
		LabelEN: "End-of-life treatment of sold products", LabelZH: "售出产品的报废处理",
		Keywords: []string{"disposal", "recycling", "报废", "回收", "处置"},
	},
	{
		Code: "scope3.cat13_downstream_leased_assets", Scope: 3, GHGPNumber: 13, ISO: 5,
		LabelEN: "Downstream leased assets", LabelZH: "下游租赁资产",
		Keywords: []string{"leased out", "租出", "出租"},
	},
	{
		Code: "scope3.cat14_franchises", Scope: 3, GHGPNumber: 14, ISO: 5,
		LabelEN: "Franchises", LabelZH: "特许经营",
		Keywords: []string{"franchise", "加盟", "门店"},
	},
	{
		Code: "scope3.cat15_investments", Scope: 3, GHGPNumber: 15, ISO: 6,
		LabelEN: "Investments", LabelZH: "投资",
		Keywords: []string{"financed emissions", "portfolio", "pcaf", "投融资排放", "资产组合"},
	},
}

var byCode = func() map[string]Category {
	out := make(map[string]Category, len(All))
	for _, category := range All {
		out[category.Code] = category
	}
	return out
}()

// ByCode returns the taxonomy entry for a stored ghg_protocol_path.
func ByCode(code string) (Category, bool) {
	category, ok := byCode[code]
	return category, ok
}

// ForScope returns the categories valid under scope, in standard order.
func ForScope(scope int) []Category {
	out := make([]Category, 0, len(All))
	for _, category := range All {
		if category.Scope == scope {
			out = append(out, category)
		}
	}
	return out
}

// EFCategoryForCode returns the emission_source.category value a picked code
// implies, or "" where the bundled catalog has no coverage.
func EFCategoryForCode(code string) string {
	if category, ok := ByCode(code); ok {
		return category.EFCategory
	}
	return ""
}

// Label is the display name, prefixed with the Scope 3 category number that
// CDP/CSRD tables use to refer to it. locale selects Chinese for any zh tag.
func (c Category) Label(locale string) string {
	name := c.LabelEN
	if isChinese(locale) {
		name = c.LabelZH
	}
	if c.GHGPNumber > 0 {
		return fmt.Sprintf("%d.%d %s", c.Scope, c.GHGPNumber, name)
	}
	return name
}

// Matches reports whether query appears in either label or a keyword.
func (c Category) Matches(query string) bool {
	q := strings.ToLower(strings.TrimSpace(query))
	if q == "" {
		return true
	}
	if strings.Contains(strings.ToLower(c.LabelEN), q) || strings.Contains(strings.ToLower(c.LabelZH), q) {
		return true
	}
	for _, keyword := range c.Keywords {
		if strings.Contains(strings.ToLower(keyword), q) {
			return true
		}
	}
	return false
}

func isChinese(locale string) bool {
	return strings.HasPrefix(strings.ToLower(locale), "zh")
}
