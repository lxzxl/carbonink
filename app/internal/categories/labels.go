package categories

import "strings"

// legacyLabels labels the dotted/snake-case category values that predate the
// GHG Protocol taxonomy and still exist in imported workspaces. 1.x kept the
// same mapping in category-labels.ts; the raw value is returned when a
// workspace contains a label this table does not know.
var legacyLabels = map[string][2]string{
	"business_travel":              {"Business travel", "商务差旅"},
	"capital_goods":                {"Capital goods", "资本货物"},
	"commuting":                    {"Employee commuting", "员工通勤"},
	"data_center":                  {"Data center", "数据中心"},
	"downstream_transportation":    {"Downstream transportation", "下游运输配送"},
	"electricity":                  {"Electricity", "电力"},
	"electricity.grid":             {"Grid electricity", "电网电力"},
	"electricity.purchased":        {"Purchased electricity", "外购电力"},
	"employee_commuting":           {"Employee commuting", "员工通勤"},
	"end_of_life_treatment":        {"End-of-life treatment of sold products", "售出产品报废处理"},
	"franchises":                   {"Franchises", "特许经营"},
	"freight":                      {"Freight", "货运"},
	"fuel_and_energy_related":      {"Fuel- and energy-related activities", "燃料和能源相关活动"},
	"fuel.mobile":                  {"Mobile combustion", "移动燃烧"},
	"fuel.stationary":              {"Stationary combustion", "固定燃烧"},
	"fugitive":                     {"Fugitive emissions", "逸散排放"},
	"fugitive_emissions":           {"Fugitive emissions", "逸散排放"},
	"investments":                  {"Investments", "投资"},
	"leased_assets_downstream":     {"Downstream leased assets", "下游租赁资产"},
	"leased_assets_upstream":       {"Upstream leased assets", "上游租赁资产"},
	"mobile_combustion":            {"Mobile combustion", "移动燃烧"},
	"process_emissions":            {"Process emissions", "工艺过程排放"},
	"processing_of_sold_products":  {"Processing of sold products", "售出产品的加工"},
	"purchase":                     {"Purchased goods and services", "采购的商品和服务"},
	"purchased_electricity":        {"Purchased electricity", "外购电力"},
	"purchased_goods":              {"Purchased goods", "外购商品"},
	"purchased_goods_and_services": {"Purchased goods and services", "外购商品及服务"},
	"purchased_heat":               {"Purchased heat", "外购供热"},
	"purchased_services":           {"Purchased services", "外购服务"},
	"purchased_steam":              {"Purchased steam", "外购蒸汽"},
	"refrigerant":                  {"Refrigerant", "制冷剂"},
	"refrigerants":                 {"Refrigerants", "制冷剂"},
	"stationary_combustion":        {"Stationary combustion", "固定燃烧"},
	"travel":                       {"Travel", "差旅"},
	"travel.air":                   {"Air travel", "航空差旅"},
	"travel.rail":                  {"Rail travel", "铁路差旅"},
	"travel.road":                  {"Road travel", "公路差旅"},
	"upstream_transportation":      {"Upstream transportation", "上游运输配送"},
	"use_of_sold_products":         {"Use of sold products", "售出产品的使用"},
	"waste":                        {"Waste", "废弃物"},
	"waste_generated":              {"Waste generated", "产生的废弃物"},
	"waste_treatment":              {"Waste treatment", "废弃物处理"},
	"water":                        {"Water", "水"},
	"water_supply":                 {"Water supply", "自来水供应"},
}

// LegacyLabel returns the localized label for a pre-taxonomy category value,
// or the value itself when no label is known.
func LegacyLabel(locale, value string) string {
	labels, ok := legacyLabels[value]
	if !ok {
		return value
	}
	if strings.HasPrefix(strings.ToLower(locale), "zh") {
		return labels[1]
	}
	return labels[0]
}
