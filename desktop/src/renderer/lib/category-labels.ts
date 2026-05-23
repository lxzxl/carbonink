import { currentLocale } from '@renderer/lib/i18n';

/**
 * Localized labels for `emission_source.category` values.
 *
 * Two flavors of category string flow through the app:
 *
 * 1. **Climatiq Title Case** — what `preset-sources.json` ships and what
 *    a "从目录添加" source carries. 41 distinct values, all English
 *    Title Case (`Fuel`, `Air Travel`, `Heat and Steam`).
 *
 * 2. **Dotted-lowercase legacy** — what the hand-typed source form
 *    suggests (`fuel.mobile`, `electricity.grid`) and what the EF
 *    matcher's prefix-match against the EF catalog historically used.
 *    Less common in real data but possible from user input or older
 *    extractions.
 *
 * For the zh-CN UI, neither flavor reads naturally. This module maps
 * both to a single Chinese phrase. Unknown categories fall back to the
 * raw string so we never lose information — if a user types
 * "stationary_combustion" or some other ad-hoc value, it still
 * displays + filters correctly, just untranslated.
 *
 * The English locale returns Climatiq strings verbatim (they're already
 * English) and humanizes only the dotted-legacy forms.
 *
 * Not in paraglide because:
 *  - These are domain term mappings, not UI prose. They don't need
 *    translator workflow; they need engineering review when new
 *    Climatiq categories land in the preset catalog.
 *  - Keeping 50+ entries here off the paraglide tree avoids polluting
 *    every translator's queue with technical strings.
 */

/** Climatiq Title Case → 中文 (41 entries, matches preset-sources.json). */
const CLIMATIQ_ZH: Record<string, string> = {
  Accommodation: '住宿',
  'Air Freight': '航空货运',
  'Air Travel': '航空差旅',
  'Building Materials': '建筑材料',
  'Ceramic Goods': '陶瓷制品',
  'Chemical Products': '化学制品',
  'Clothing and Footwear': '服装鞋类',
  Construction: '建设工程',
  Cooling: '冷却',
  'Electrical Equipment': '电气设备',
  Electricity: '电力',
  Electronics: '电子产品',
  'Fabricated Metal Products': '金属制品',
  'Food and Beverage Services': '餐饮服务',
  'Food/Beverages/Tobacco': '食品/饮料/烟草',
  Fuel: '燃料',
  'Furnishings and Household': '家具家居',
  'Glass and Glass Products': '玻璃及制品',
  'Heat and Steam': '热和蒸汽',
  Machinery: '机械',
  Manufacturing: '制造业',
  Metals: '金属',
  'Mined Materials': '矿产',
  Mining: '采矿',
  'Organic Products': '有机产品',
  'Paper Products': '纸制品',
  'Paper and Cardboard': '纸和纸板',
  'Personal Care and Accessories': '个人护理及配饰',
  'Plastics and Rubber Products': '塑料和橡胶制品',
  'Rail Freight': '铁路货运',
  'Rail Travel': '铁路差旅',
  'Road Freight': '公路货运',
  'Road Travel': '公路差旅',
  'Sea Freight': '海运货运',
  'Sea Travel': '海运差旅',
  Textiles: '纺织品',
  'Timber and Forestry Products': '木材和林产品',
  'Transport Services and Warehousing': '运输与仓储服务',
  'Vehicle Maintenance and Services': '车辆维护和服务',
  'Vehicle Parts': '车辆零部件',
  Vehicles: '车辆',
};

/**
 * Dotted-lowercase legacy → 中文 / English humanized form. Both locales
 * benefit from rewriting these — "fuel.mobile" isn't readable in
 * either language. Keep entries sorted alphabetically.
 */
const LEGACY_ZH: Record<string, string> = {
  'electricity.grid': '电网电力',
  'electricity.purchased': '外购电力',
  'fuel.mobile': '移动燃烧',
  'fuel.stationary': '固定燃烧',
  mobile_combustion: '移动燃烧',
  stationary_combustion: '固定燃烧',
  'travel.air': '航空差旅',
  'travel.rail': '铁路差旅',
  'travel.road': '公路差旅',
};

const LEGACY_EN: Record<string, string> = {
  'electricity.grid': 'Grid electricity',
  'electricity.purchased': 'Purchased electricity',
  'fuel.mobile': 'Mobile combustion',
  'fuel.stationary': 'Stationary combustion',
  mobile_combustion: 'Mobile combustion',
  stationary_combustion: 'Stationary combustion',
  'travel.air': 'Air travel',
  'travel.rail': 'Rail travel',
  'travel.road': 'Road travel',
};

/**
 * Look up the localized label for a category string. Falls back to the
 * raw input when no translation exists — preserving custom user input
 * (e.g. "data_center_PUE") and any new Climatiq categories that ship
 * before this map is updated.
 *
 * Callers: /sources card, SourceCatalogDrawer row, SourceFilterHeader
 * chip row, and the filter hook's `getSearchExtras` (so Chinese-only
 * search terms like "燃料" still match English-stored rows).
 */
export function categoryLabel(raw: string | null | undefined): string {
  if (!raw) return '';
  const locale = currentLocale();
  if (locale === 'zh-CN') {
    return CLIMATIQ_ZH[raw] ?? LEGACY_ZH[raw] ?? raw;
  }
  // en: Climatiq strings are already idiomatic English; only humanize
  // the dotted-legacy forms.
  return LEGACY_EN[raw] ?? raw;
}
