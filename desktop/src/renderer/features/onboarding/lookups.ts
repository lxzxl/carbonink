/**
 * Shared lookup tables for onboarding form fields. Lives in the feature
 * folder rather than `src/shared/` because these are renderer-only
 * (paraglide message functions don't resolve in main); when we add
 * server-side validation that needs the same values we'll promote the
 * raw value list to `src/shared/`.
 */

/**
 * Industry classification — simplified sector taxonomy modeled on
 * SASB / CDP industry groups, narrowed to the categories a Chinese
 * SME doing voluntary inventory is most likely to identify with. Not
 * the full GB/T 4754 list (96 entries deep) — that's overwhelming for
 * an onboarding wizard. Users who don't see a perfect match pick
 * `other`; the field is descriptive metadata and doesn't drive any
 * calculation logic today.
 */
export const INDUSTRIES: ReadonlyArray<{
  value: string;
  label_zh: string;
  label_en: string;
}> = [
  { value: 'manufacturing', label_zh: '制造业', label_en: 'Manufacturing' },
  { value: 'power_utility', label_zh: '电力与公用事业', label_en: 'Power & utilities' },
  { value: 'oil_and_gas', label_zh: '石油与天然气', label_en: 'Oil & gas' },
  { value: 'chemicals', label_zh: '化工', label_en: 'Chemicals' },
  { value: 'metals_and_mining', label_zh: '金属与采矿', label_en: 'Metals & mining' },
  {
    value: 'construction_materials',
    label_zh: '建筑材料与水泥',
    label_en: 'Construction materials',
  },
  { value: 'construction', label_zh: '建筑业', label_en: 'Construction' },
  { value: 'transportation', label_zh: '交通运输', label_en: 'Transportation' },
  {
    value: 'logistics_warehousing',
    label_zh: '物流与仓储',
    label_en: 'Logistics & warehousing',
  },
  { value: 'consumer_goods', label_zh: '消费品', label_en: 'Consumer goods' },
  { value: 'food_and_beverage', label_zh: '食品与饮料', label_en: 'Food & beverage' },
  { value: 'agriculture', label_zh: '农业', label_en: 'Agriculture' },
  { value: 'retail', label_zh: '零售', label_en: 'Retail' },
  { value: 'technology', label_zh: '信息技术', label_en: 'Technology' },
  { value: 'telecom', label_zh: '电信', label_en: 'Telecom' },
  { value: 'financial_services', label_zh: '金融服务', label_en: 'Financial services' },
  { value: 'real_estate', label_zh: '房地产', label_en: 'Real estate' },
  { value: 'healthcare', label_zh: '医疗健康', label_en: 'Healthcare' },
  { value: 'pharmaceutical', label_zh: '制药', label_en: 'Pharmaceuticals' },
  { value: 'education', label_zh: '教育', label_en: 'Education' },
  { value: 'hospitality', label_zh: '酒店与餐饮', label_en: 'Hospitality' },
  { value: 'professional_services', label_zh: '专业服务', label_en: 'Professional services' },
  { value: 'government_nonprofit', label_zh: '政府与非营利', label_en: 'Government / nonprofit' },
  { value: 'other', label_zh: '其他', label_en: 'Other' },
] as const;

/**
 * Asia/Pacific defaults + the Western markets a Chinese carbonink user
 * is most likely to encounter via CDP / supply-chain questionnaires.
 * Used by both step 1 (company country) and step 4 (site country) so
 * the two never drift. ISO 3166 alpha-2 codes — back-end accepts 2-3
 * char strings, but UX-wise alpha-2 + label is what the user sees.
 */
export const COMMON_COUNTRIES: ReadonlyArray<{
  code: string;
  label_zh: string;
  label_en: string;
}> = [
  { code: 'CN', label_zh: '中国', label_en: 'China' },
  { code: 'HK', label_zh: '香港 SAR', label_en: 'Hong Kong SAR' },
  { code: 'TW', label_zh: '台湾', label_en: 'Taiwan' },
  { code: 'JP', label_zh: '日本', label_en: 'Japan' },
  { code: 'KR', label_zh: '韩国', label_en: 'South Korea' },
  { code: 'SG', label_zh: '新加坡', label_en: 'Singapore' },
  { code: 'US', label_zh: '美国', label_en: 'United States' },
  { code: 'GB', label_zh: '英国', label_en: 'United Kingdom' },
  { code: 'DE', label_zh: '德国', label_en: 'Germany' },
] as const;
