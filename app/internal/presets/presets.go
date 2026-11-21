// Package presets owns the bundled emission-source catalog. The JSON is a
// Climatiq-derived export shared with 1.x; each row's Climatiq category is
// mapped here to the app's own GHG Protocol taxonomy before anything is
// written to emission_source.category or ghg_protocol_path.
package presets

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"app.carbonink.desktop/internal/categories"
)

//go:embed preset-sources.json
var catalogJSON []byte

// Preset is one catalog row exactly as the shared export ships it.
type Preset struct {
	ID       string `json:"id"`
	NameZH   string `json:"name_zh"`
	NameEN   string `json:"name_en"`
	Scope    int    `json:"scope"`
	Category string `json:"category"`
	HintUnit string `json:"hint_unit"`
	Source   string `json:"source"`
	Region   string `json:"region"`
	Year     int    `json:"year"`
}

// All is the catalog in file order. Treat it as read-only.
var All []Preset

var (
	byID         map[string]Preset
	categoryList []string
)

// categoryCodes is the deliberate Climatiq → taxonomy mapping. Climatiq's
// category is a factor classification, not a GHG Protocol category; writing
// it into emission_source.category would break EF matching, whose vocabulary
// is the dotted/short prefix on the right-hand side.
var categoryCodes = map[string]string{
	// Scope 1.
	"Fuel": "scope1.mobile_combustion",

	// Scope 2.
	"Electricity":    "scope2.purchased_electricity",
	"Heat and Steam": "scope2.purchased_heat",
	"Cooling":        "scope2.purchased_cooling",

	// Scope 3 — business travel.
	"Accommodation": "scope3.cat6_business_travel",
	"Air Travel":    "scope3.cat6_business_travel",
	"Rail Travel":   "scope3.cat6_business_travel",
	"Road Travel":   "scope3.cat6_business_travel",
	"Sea Travel":    "scope3.cat6_business_travel",

	// Scope 3 — transportation and distribution.
	"Air Freight":                        "scope3.cat4_upstream_transportation",
	"Rail Freight":                       "scope3.cat4_upstream_transportation",
	"Road Freight":                       "scope3.cat4_upstream_transportation",
	"Sea Freight":                        "scope3.cat4_upstream_transportation",
	"Transport Services and Warehousing": "scope3.cat4_upstream_transportation",
	// Climatiq's "Vehicles" rows are distance-based freight factors
	// (kg/km), not vehicle purchases.
	"Vehicles": "scope3.cat4_upstream_transportation",

	// Scope 3 — purchased goods and services. Everything Climatiq
	// classifies by material or industry lands here.
	"Building Materials":               "scope3.cat1_purchased_goods",
	"Ceramic Goods":                    "scope3.cat1_purchased_goods",
	"Chemical Products":                "scope3.cat1_purchased_goods",
	"Clothing and Footwear":            "scope3.cat1_purchased_goods",
	"Construction":                     "scope3.cat1_purchased_goods",
	"Electrical Equipment":             "scope3.cat1_purchased_goods",
	"Electronics":                      "scope3.cat1_purchased_goods",
	"Fabricated Metal Products":        "scope3.cat1_purchased_goods",
	"Food and Beverage Services":       "scope3.cat1_purchased_goods",
	"Food/Beverages/Tobacco":           "scope3.cat1_purchased_goods",
	"Furnishings and Household":        "scope3.cat1_purchased_goods",
	"Glass and Glass Products":         "scope3.cat1_purchased_goods",
	"Machinery":                        "scope3.cat1_purchased_goods",
	"Manufacturing":                    "scope3.cat1_purchased_goods",
	"Metals":                           "scope3.cat1_purchased_goods",
	"Mined Materials":                  "scope3.cat1_purchased_goods",
	"Mining":                           "scope3.cat1_purchased_goods",
	"Organic Products":                 "scope3.cat1_purchased_goods",
	"Paper Products":                   "scope3.cat1_purchased_goods",
	"Paper and Cardboard":              "scope3.cat1_purchased_goods",
	"Personal Care and Accessories":    "scope3.cat1_purchased_goods",
	"Plastics and Rubber Products":     "scope3.cat1_purchased_goods",
	"Textiles":                         "scope3.cat1_purchased_goods",
	"Timber and Forestry Products":     "scope3.cat1_purchased_goods",
	"Vehicle Maintenance and Services": "scope3.cat1_purchased_goods",
	"Vehicle Parts":                    "scope3.cat1_purchased_goods",
}

// codeOverrides handles presets where the Climatiq category is coarser than
// the taxonomy. District steam is Scope 2 purchased steam, not purchased heat.
var codeOverrides = map[string]string{
	"heat_and_steam-type_district_steam": "scope2.purchased_steam",
}

// categoryLabelsZH mirrors the 1.x catalog labels. English rows already read
// naturally, so the English locale renders the Climatiq string verbatim.
var categoryLabelsZH = map[string]string{
	"Accommodation":                      "住宿",
	"Air Freight":                        "航空货运",
	"Air Travel":                         "航空差旅",
	"Building Materials":                 "建筑材料",
	"Ceramic Goods":                      "陶瓷制品",
	"Chemical Products":                  "化学制品",
	"Clothing and Footwear":              "服装鞋类",
	"Construction":                       "建设工程",
	"Cooling":                            "冷却",
	"Electrical Equipment":               "电气设备",
	"Electricity":                        "电力",
	"Electronics":                        "电子产品",
	"Fabricated Metal Products":          "金属制品",
	"Food and Beverage Services":         "餐饮服务",
	"Food/Beverages/Tobacco":             "食品/饮料/烟草",
	"Fuel":                               "燃料",
	"Furnishings and Household":          "家具家居",
	"Glass and Glass Products":           "玻璃及制品",
	"Heat and Steam":                     "热和蒸汽",
	"Machinery":                          "机械",
	"Manufacturing":                      "制造业",
	"Metals":                             "金属",
	"Mined Materials":                    "矿产",
	"Mining":                             "采矿",
	"Organic Products":                   "有机产品",
	"Paper Products":                     "纸制品",
	"Paper and Cardboard":                "纸和纸板",
	"Personal Care and Accessories":      "个人护理及配饰",
	"Plastics and Rubber Products":       "塑料和橡胶制品",
	"Rail Freight":                       "铁路货运",
	"Rail Travel":                        "铁路差旅",
	"Road Freight":                       "公路货运",
	"Road Travel":                        "公路差旅",
	"Sea Freight":                        "海运货运",
	"Sea Travel":                         "海运差旅",
	"Textiles":                           "纺织品",
	"Timber and Forestry Products":       "木材和林产品",
	"Transport Services and Warehousing": "运输与仓储服务",
	"Vehicle Maintenance and Services":   "车辆维护和服务",
	"Vehicle Parts":                      "车辆零部件",
	"Vehicles":                           "车辆",
}

func init() {
	var file struct {
		Entries []Preset `json:"entries"`
	}
	if err := json.Unmarshal(catalogJSON, &file); err != nil {
		panic(fmt.Sprintf("presets: embedded catalog is not valid JSON: %v", err))
	}
	if len(file.Entries) == 0 {
		panic("presets: embedded catalog is empty")
	}
	All = file.Entries
	byID = make(map[string]Preset, len(All))
	seen := make(map[string]bool, len(categoryCodes))
	for _, preset := range All {
		if preset.ID == "" {
			panic("presets: entry with empty id")
		}
		if _, ok := byID[preset.ID]; ok {
			panic("presets: duplicate id " + preset.ID)
		}
		byID[preset.ID] = preset
		code := preset.Code()
		if code == "" {
			panic("presets: unmapped category " + preset.Category + " (" + preset.ID + ")")
		}
		category, ok := categories.ByCode(code)
		if !ok {
			panic("presets: unknown taxonomy code " + code)
		}
		if category.Scope != preset.Scope {
			panic(fmt.Sprintf("presets: %s maps to %s (scope %d) but the preset says scope %d",
				preset.ID, code, category.Scope, preset.Scope))
		}
		seen[preset.Category] = true
	}
	categoryList = make([]string, 0, len(seen))
	for category := range seen {
		categoryList = append(categoryList, category)
	}
	sort.Strings(categoryList)
}

// ByID returns one preset.
func ByID(id string) (Preset, bool) {
	preset, ok := byID[id]
	return preset, ok
}

// Categories returns the distinct Climatiq categories in alphabetical order.
func Categories() []string {
	out := make([]string, len(categoryList))
	copy(out, categoryList)
	return out
}

// Code is the taxonomy code (stored in ghg_protocol_path) this preset maps to.
func (p Preset) Code() string {
	if code, ok := codeOverrides[p.ID]; ok {
		return code
	}
	return categoryCodes[p.Category]
}

// EFCategory is the emission_source.category prefix implied by the mapping.
func (p Preset) EFCategory() string {
	return categories.EFCategoryForCode(p.Code())
}

// Name is the display/creation name for a locale.
func (p Preset) Name(locale string) string {
	if isChinese(locale) {
		return p.NameZH
	}
	return p.NameEN
}

// Matches reports whether every whitespace-separated term appears in the
// bilingual name, either category spelling, source, region, or year.
func (p Preset) Matches(query string) bool {
	query = strings.ToLower(strings.TrimSpace(query))
	if query == "" {
		return true
	}
	haystack := strings.ToLower(strings.Join([]string{
		p.NameZH, p.NameEN, p.Category, p.Source, p.Region,
		CategoryLabel(p.Category, "zh-CN"), fmt.Sprint(p.Year),
	}, " "))
	for _, term := range strings.Fields(query) {
		if !strings.Contains(haystack, term) {
			return false
		}
	}
	return true
}

// CategoryLabel localizes a Climatiq category for display.
func CategoryLabel(category, locale string) string {
	if isChinese(locale) {
		if label, ok := categoryLabelsZH[category]; ok {
			return label
		}
	}
	return category
}

func isChinese(locale string) bool {
	return strings.HasPrefix(strings.ToLower(locale), "zh")
}
