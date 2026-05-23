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
 * Dotted-lowercase / snake_case legacy → 中文 / English humanized form.
 * Both locales benefit from rewriting these — "fuel.mobile" or
 * "business_travel" isn't readable in either language.
 *
 * Coverage targets: anything the AI matcher or hand-typed source form
 * might emit. Errs on the side of including alternate spellings
 * (snake_case + dotted) since both have shown up in real data.
 *
 * Keep entries sorted alphabetically.
 */
const LEGACY_ZH: Record<string, string> = {
  business_travel: '商务差旅',
  capital_goods: '资本货物',
  commuting: '员工通勤',
  data_center: '数据中心',
  downstream_transportation: '下游运输配送',
  'electricity.grid': '电网电力',
  'electricity.purchased': '外购电力',
  employee_commuting: '员工通勤',
  end_of_life_treatment: '售出产品报废处理',
  franchises: '特许经营',
  fuel_and_energy_related: '燃料和能源相关活动',
  'fuel.mobile': '移动燃烧',
  'fuel.stationary': '固定燃烧',
  fugitive: '逸散排放',
  fugitive_emissions: '逸散排放',
  investments: '投资',
  leased_assets_downstream: '下游租赁资产',
  leased_assets_upstream: '上游租赁资产',
  mobile_combustion: '移动燃烧',
  process_emissions: '工艺排放',
  processing_of_sold_products: '售出产品的加工',
  purchased_electricity: '外购电力',
  purchased_goods: '外购商品',
  purchased_goods_and_services: '外购商品及服务',
  purchased_heat: '外购供热',
  purchased_services: '外购服务',
  purchased_steam: '外购蒸汽',
  refrigerant: '制冷剂',
  refrigerants: '制冷剂',
  stationary_combustion: '固定燃烧',
  'travel.air': '航空差旅',
  'travel.rail': '铁路差旅',
  'travel.road': '公路差旅',
  upstream_transportation: '上游运输配送',
  use_of_sold_products: '售出产品的使用',
  waste: '废弃物',
  waste_generated: '产生的废弃物',
  waste_treatment: '废弃物处理',
  water: '水',
  water_supply: '自来水供应',
};

const LEGACY_EN: Record<string, string> = {
  business_travel: 'Business travel',
  capital_goods: 'Capital goods',
  commuting: 'Employee commuting',
  data_center: 'Data center',
  downstream_transportation: 'Downstream transportation',
  'electricity.grid': 'Grid electricity',
  'electricity.purchased': 'Purchased electricity',
  employee_commuting: 'Employee commuting',
  end_of_life_treatment: 'End-of-life treatment of sold products',
  franchises: 'Franchises',
  fuel_and_energy_related: 'Fuel- and energy-related activities',
  'fuel.mobile': 'Mobile combustion',
  'fuel.stationary': 'Stationary combustion',
  fugitive: 'Fugitive emissions',
  fugitive_emissions: 'Fugitive emissions',
  investments: 'Investments',
  leased_assets_downstream: 'Downstream leased assets',
  leased_assets_upstream: 'Upstream leased assets',
  mobile_combustion: 'Mobile combustion',
  process_emissions: 'Process emissions',
  processing_of_sold_products: 'Processing of sold products',
  purchased_electricity: 'Purchased electricity',
  purchased_goods: 'Purchased goods',
  purchased_goods_and_services: 'Purchased goods and services',
  purchased_heat: 'Purchased heat',
  purchased_services: 'Purchased services',
  purchased_steam: 'Purchased steam',
  refrigerant: 'Refrigerant',
  refrigerants: 'Refrigerants',
  stationary_combustion: 'Stationary combustion',
  'travel.air': 'Air travel',
  'travel.rail': 'Rail travel',
  'travel.road': 'Road travel',
  upstream_transportation: 'Upstream transportation',
  use_of_sold_products: 'Use of sold products',
  waste: 'Waste',
  waste_generated: 'Waste generated',
  waste_treatment: 'Waste treatment',
  water: 'Water',
  water_supply: 'Water supply',
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

/**
 * Localized labels for `emission_source.ghg_protocol_path` values like
 * "scope1.mobile_combustion" or "scope2.market".
 *
 * Approach: split the path on the first `.`, render the scope prefix
 * via the existing `范围 N` short label, and translate the remainder
 * via `categoryLabel` (which already understands the snake_case forms
 * like `mobile_combustion` and `business_travel`). The two pieces are
 * joined with " · " — same visual rhythm as the rest of the card meta
 * row.
 *
 * Special-cased: `scope2.market` and `scope2.location` map to the
 * GHG Protocol Scope 2 method names (基于市场 / 基于地理位置) rather
 * than going through the snake_case path. Those exact tokens aren't
 * meaningful as category strings.
 */
const SCOPE2_METHOD_ZH: Record<string, string> = {
  market: '基于市场',
  market_based: '基于市场',
  location: '基于地理位置',
  location_based: '基于地理位置',
};
const SCOPE2_METHOD_EN: Record<string, string> = {
  market: 'Market-based',
  market_based: 'Market-based',
  location: 'Location-based',
  location_based: 'Location-based',
};

export function pathLabel(raw: string | null | undefined): string {
  if (!raw) return '';
  const locale = currentLocale();
  // "scope1.foo" → ["scope1", "foo"]; anything without a "." passes
  // through `categoryLabel` directly.
  const dotIdx = raw.indexOf('.');
  if (dotIdx < 0) return categoryLabel(raw);

  const scopePart = raw.slice(0, dotIdx);
  const tail = raw.slice(dotIdx + 1);

  // Scope 2 has a methodology axis (location vs market) the category
  // label space doesn't cover. Handle it explicitly.
  if (scopePart === 'scope2') {
    const method = locale === 'zh-CN' ? SCOPE2_METHOD_ZH[tail] : SCOPE2_METHOD_EN[tail];
    if (method) {
      return `${scopeShort('scope2', locale)} · ${method}`;
    }
  }

  const scopeText = scopeShort(scopePart, locale);
  const tailLabel = categoryLabel(tail);
  if (!scopeText) return tailLabel;
  if (!tailLabel || tailLabel === tail) {
    // Couldn't translate the tail. Fall back to the raw path; halfway
    // translated (e.g. "范围 1 · mobile_combustion") reads worse than
    // the original.
    return raw;
  }
  return `${scopeText} · ${tailLabel}`;
}

function scopeShort(prefix: string, locale: 'zh-CN' | 'en'): string {
  if (locale === 'zh-CN') {
    if (prefix === 'scope1') return '范围 1';
    if (prefix === 'scope2') return '范围 2';
    if (prefix === 'scope3') return '范围 3';
    return '';
  }
  if (prefix === 'scope1') return 'Scope 1';
  if (prefix === 'scope2') return 'Scope 2';
  if (prefix === 'scope3') return 'Scope 3';
  return '';
}

/**
 * Heuristic: is the ghg_protocol_path saying the same thing as the
 * category? Used by /sources cards to suppress the path display when
 * it'd repeat what the category already shows. The card row 1 already
 * has a 范围 N chip, so the scope prefix is also redundant.
 *
 * Example: path="scope1.mobile_combustion", category="mobile_combustion"
 * → redundant (hide path). path="scope2.market",
 * category="electricity.grid" → not redundant (path adds methodology).
 */
export function isPathRedundantWithCategory(
  path: string | null | undefined,
  category: string | null | undefined,
): boolean {
  if (!path || !category) return false;
  const stripped = path.replace(/^scope\d+\./, '').toLowerCase();
  const cat = category.toLowerCase().replace(/\s+/g, '_');
  return stripped === cat;
}
