/* eslint-disable */
import { getLocale, experimentalStaticLocale } from "../runtime.js"

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} App_TitleInputs */
/** @typedef {{}} Dashboard_Welcome_TitleInputs */
/** @typedef {{}} Dashboard_Welcome_BodyInputs */
/** @typedef {{}} Dashboard_Inventory_TitleInputs */
/** @typedef {{}} Dashboard_Inventory_BodyInputs */
/** @typedef {{}} Nav_DashboardInputs */
/** @typedef {{}} LoadingInputs */
/** @typedef {{}} Onboarding_TitleInputs */
/** @typedef {{}} Onboarding_Step_Company_TitleInputs */
/** @typedef {{}} Onboarding_Step_Company_Name_ZhInputs */
/** @typedef {{}} Onboarding_Step_Company_Name_EnInputs */
/** @typedef {{}} Onboarding_Step_Company_IndustryInputs */
/** @typedef {{}} Onboarding_Step_Company_CountryInputs */
/** @typedef {{}} Onboarding_BackInputs */
/** @typedef {{}} Onboarding_NextInputs */
/** @typedef {{}} Required_FieldInputs */
/** @typedef {{}} Onboarding_Step_Year_TitleInputs */
/** @typedef {{}} Onboarding_Step_Year_BodyInputs */
/** @typedef {{}} Onboarding_Step_Boundary_TitleInputs */
/** @typedef {{}} Onboarding_Step_Boundary_BodyInputs */
/** @typedef {{}} Onboarding_Step_Boundary_Equity_ShareInputs */
/** @typedef {{}} Onboarding_Step_Boundary_Operational_ControlInputs */
/** @typedef {{}} Onboarding_Step_Site_TitleInputs */
/** @typedef {{}} Onboarding_Step_Site_BodyInputs */
/** @typedef {{}} Onboarding_Step_Site_Name_ZhInputs */
/** @typedef {{}} Onboarding_Step_Site_Name_EnInputs */
/** @typedef {{}} Onboarding_Step_Site_AddressInputs */
/** @typedef {{}} Onboarding_Step_Site_CountryInputs */
/** @typedef {{}} Onboarding_Step_Ai_TitleInputs */
/** @typedef {{}} Onboarding_Step_Ai_BodyInputs */
/** @typedef {{}} Onboarding_Step_Ai_SkipInputs */
/** @typedef {{}} Onboarding_Step_Ai_ByotInputs */
/** @typedef {{}} Onboarding_FinishInputs */
/** @typedef {{}} Onboarding_CreatingInputs */
import * as __en from "./en.js"
import * as __zh_cn2 from "./zh-CN.js"
/**
* | output |
* | --- |
* | "carbonbook" |
*
* @param {App_TitleInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const app_title = /** @type {((inputs?: App_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<App_TitleInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.app_title(inputs)
	return __zh_cn2.app_title(inputs)
});
/**
* | output |
* | --- |
* | "Welcome to carbonbook" |
*
* @param {Dashboard_Welcome_TitleInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const dashboard_welcome_title = /** @type {((inputs?: Dashboard_Welcome_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Dashboard_Welcome_TitleInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.dashboard_welcome_title(inputs)
	return __zh_cn2.dashboard_welcome_title(inputs)
});
/**
* | output |
* | --- |
* | "You haven't set up your organization yet. The onboarding wizard will guide you next." |
*
* @param {Dashboard_Welcome_BodyInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const dashboard_welcome_body = /** @type {((inputs?: Dashboard_Welcome_BodyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Dashboard_Welcome_BodyInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.dashboard_welcome_body(inputs)
	return __zh_cn2.dashboard_welcome_body(inputs)
});
/**
* | output |
* | --- |
* | "Inventory Dashboard" |
*
* @param {Dashboard_Inventory_TitleInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const dashboard_inventory_title = /** @type {((inputs?: Dashboard_Inventory_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Dashboard_Inventory_TitleInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.dashboard_inventory_title(inputs)
	return __zh_cn2.dashboard_inventory_title(inputs)
});
/**
* | output |
* | --- |
* | "No emission data yet." |
*
* @param {Dashboard_Inventory_BodyInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const dashboard_inventory_body = /** @type {((inputs?: Dashboard_Inventory_BodyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Dashboard_Inventory_BodyInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.dashboard_inventory_body(inputs)
	return __zh_cn2.dashboard_inventory_body(inputs)
});
/**
* | output |
* | --- |
* | "Dashboard" |
*
* @param {Nav_DashboardInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const nav_dashboard = /** @type {((inputs?: Nav_DashboardInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Nav_DashboardInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.nav_dashboard(inputs)
	return __zh_cn2.nav_dashboard(inputs)
});
/**
* | output |
* | --- |
* | "Loading…" |
*
* @param {LoadingInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const loading = /** @type {((inputs?: LoadingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<LoadingInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.loading(inputs)
	return __zh_cn2.loading(inputs)
});
/**
* | output |
* | --- |
* | "Onboarding" |
*
* @param {Onboarding_TitleInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const onboarding_title = /** @type {((inputs?: Onboarding_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Onboarding_TitleInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.onboarding_title(inputs)
	return __zh_cn2.onboarding_title(inputs)
});
/**
* | output |
* | --- |
* | "Company info" |
*
* @param {Onboarding_Step_Company_TitleInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const onboarding_step_company_title = /** @type {((inputs?: Onboarding_Step_Company_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Onboarding_Step_Company_TitleInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.onboarding_step_company_title(inputs)
	return __zh_cn2.onboarding_step_company_title(inputs)
});
/**
* | output |
* | --- |
* | "Chinese name" |
*
* @param {Onboarding_Step_Company_Name_ZhInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const onboarding_step_company_name_zh = /** @type {((inputs?: Onboarding_Step_Company_Name_ZhInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Onboarding_Step_Company_Name_ZhInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.onboarding_step_company_name_zh(inputs)
	return __zh_cn2.onboarding_step_company_name_zh(inputs)
});
/**
* | output |
* | --- |
* | "English name" |
*
* @param {Onboarding_Step_Company_Name_EnInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const onboarding_step_company_name_en = /** @type {((inputs?: Onboarding_Step_Company_Name_EnInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Onboarding_Step_Company_Name_EnInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.onboarding_step_company_name_en(inputs)
	return __zh_cn2.onboarding_step_company_name_en(inputs)
});
/**
* | output |
* | --- |
* | "Industry" |
*
* @param {Onboarding_Step_Company_IndustryInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const onboarding_step_company_industry = /** @type {((inputs?: Onboarding_Step_Company_IndustryInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Onboarding_Step_Company_IndustryInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.onboarding_step_company_industry(inputs)
	return __zh_cn2.onboarding_step_company_industry(inputs)
});
/**
* | output |
* | --- |
* | "Country" |
*
* @param {Onboarding_Step_Company_CountryInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const onboarding_step_company_country = /** @type {((inputs?: Onboarding_Step_Company_CountryInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Onboarding_Step_Company_CountryInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.onboarding_step_company_country(inputs)
	return __zh_cn2.onboarding_step_company_country(inputs)
});
/**
* | output |
* | --- |
* | "Back" |
*
* @param {Onboarding_BackInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const onboarding_back = /** @type {((inputs?: Onboarding_BackInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Onboarding_BackInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.onboarding_back(inputs)
	return __zh_cn2.onboarding_back(inputs)
});
/**
* | output |
* | --- |
* | "Next" |
*
* @param {Onboarding_NextInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const onboarding_next = /** @type {((inputs?: Onboarding_NextInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Onboarding_NextInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.onboarding_next(inputs)
	return __zh_cn2.onboarding_next(inputs)
});
/**
* | output |
* | --- |
* | "Required" |
*
* @param {Required_FieldInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const required_field = /** @type {((inputs?: Required_FieldInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Required_FieldInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.required_field(inputs)
	return __zh_cn2.required_field(inputs)
});
/**
* | output |
* | --- |
* | "Reporting year" |
*
* @param {Onboarding_Step_Year_TitleInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const onboarding_step_year_title = /** @type {((inputs?: Onboarding_Step_Year_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Onboarding_Step_Year_TitleInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.onboarding_step_year_title(inputs)
	return __zh_cn2.onboarding_step_year_title(inputs)
});
/**
* | output |
* | --- |
* | "Default is the current year. Select the fiscal year you'll be calculating emissions for." |
*
* @param {Onboarding_Step_Year_BodyInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const onboarding_step_year_body = /** @type {((inputs?: Onboarding_Step_Year_BodyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Onboarding_Step_Year_BodyInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.onboarding_step_year_body(inputs)
	return __zh_cn2.onboarding_step_year_body(inputs)
});
/**
* | output |
* | --- |
* | "Organizational boundary" |
*
* @param {Onboarding_Step_Boundary_TitleInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const onboarding_step_boundary_title = /** @type {((inputs?: Onboarding_Step_Boundary_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Onboarding_Step_Boundary_TitleInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.onboarding_step_boundary_title(inputs)
	return __zh_cn2.onboarding_step_boundary_title(inputs)
});
/**
* | output |
* | --- |
* | "Per GHG Protocol Corporate Standard. Choose how you account for organizational boundaries." |
*
* @param {Onboarding_Step_Boundary_BodyInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const onboarding_step_boundary_body = /** @type {((inputs?: Onboarding_Step_Boundary_BodyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Onboarding_Step_Boundary_BodyInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.onboarding_step_boundary_body(inputs)
	return __zh_cn2.onboarding_step_boundary_body(inputs)
});
/**
* | output |
* | --- |
* | "Equity Share — emissions allocated by ownership share of joint ventures." |
*
* @param {Onboarding_Step_Boundary_Equity_ShareInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const onboarding_step_boundary_equity_share = /** @type {((inputs?: Onboarding_Step_Boundary_Equity_ShareInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Onboarding_Step_Boundary_Equity_ShareInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.onboarding_step_boundary_equity_share(inputs)
	return __zh_cn2.onboarding_step_boundary_equity_share(inputs)
});
/**
* | output |
* | --- |
* | "Operational Control — emissions from facilities you operate, regardless of ownership." |
*
* @param {Onboarding_Step_Boundary_Operational_ControlInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const onboarding_step_boundary_operational_control = /** @type {((inputs?: Onboarding_Step_Boundary_Operational_ControlInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Onboarding_Step_Boundary_Operational_ControlInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.onboarding_step_boundary_operational_control(inputs)
	return __zh_cn2.onboarding_step_boundary_operational_control(inputs)
});
/**
* | output |
* | --- |
* | "Add your first site" |
*
* @param {Onboarding_Step_Site_TitleInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const onboarding_step_site_title = /** @type {((inputs?: Onboarding_Step_Site_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Onboarding_Step_Site_TitleInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.onboarding_step_site_title(inputs)
	return __zh_cn2.onboarding_step_site_title(inputs)
});
/**
* | output |
* | --- |
* | "A site is a physical location (factory, office, warehouse). You'll add more later." |
*
* @param {Onboarding_Step_Site_BodyInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const onboarding_step_site_body = /** @type {((inputs?: Onboarding_Step_Site_BodyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Onboarding_Step_Site_BodyInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.onboarding_step_site_body(inputs)
	return __zh_cn2.onboarding_step_site_body(inputs)
});
/**
* | output |
* | --- |
* | "Site name (中文)" |
*
* @param {Onboarding_Step_Site_Name_ZhInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const onboarding_step_site_name_zh = /** @type {((inputs?: Onboarding_Step_Site_Name_ZhInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Onboarding_Step_Site_Name_ZhInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.onboarding_step_site_name_zh(inputs)
	return __zh_cn2.onboarding_step_site_name_zh(inputs)
});
/**
* | output |
* | --- |
* | "Site name (English)" |
*
* @param {Onboarding_Step_Site_Name_EnInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const onboarding_step_site_name_en = /** @type {((inputs?: Onboarding_Step_Site_Name_EnInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Onboarding_Step_Site_Name_EnInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.onboarding_step_site_name_en(inputs)
	return __zh_cn2.onboarding_step_site_name_en(inputs)
});
/**
* | output |
* | --- |
* | "Address" |
*
* @param {Onboarding_Step_Site_AddressInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const onboarding_step_site_address = /** @type {((inputs?: Onboarding_Step_Site_AddressInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Onboarding_Step_Site_AddressInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.onboarding_step_site_address(inputs)
	return __zh_cn2.onboarding_step_site_address(inputs)
});
/**
* | output |
* | --- |
* | "Country code" |
*
* @param {Onboarding_Step_Site_CountryInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const onboarding_step_site_country = /** @type {((inputs?: Onboarding_Step_Site_CountryInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Onboarding_Step_Site_CountryInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.onboarding_step_site_country(inputs)
	return __zh_cn2.onboarding_step_site_country(inputs)
});
/**
* | output |
* | --- |
* | "AI provider" |
*
* @param {Onboarding_Step_Ai_TitleInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const onboarding_step_ai_title = /** @type {((inputs?: Onboarding_Step_Ai_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Onboarding_Step_Ai_TitleInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.onboarding_step_ai_title(inputs)
	return __zh_cn2.onboarding_step_ai_title(inputs)
});
/**
* | output |
* | --- |
* | "carbonbook needs an AI provider to parse documents and answer questionnaires. You can configure this later in Settings; skipping is fine for now." |
*
* @param {Onboarding_Step_Ai_BodyInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const onboarding_step_ai_body = /** @type {((inputs?: Onboarding_Step_Ai_BodyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Onboarding_Step_Ai_BodyInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.onboarding_step_ai_body(inputs)
	return __zh_cn2.onboarding_step_ai_body(inputs)
});
/**
* | output |
* | --- |
* | "Skip for now (configure later in Settings)" |
*
* @param {Onboarding_Step_Ai_SkipInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const onboarding_step_ai_skip = /** @type {((inputs?: Onboarding_Step_Ai_SkipInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Onboarding_Step_Ai_SkipInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.onboarding_step_ai_skip(inputs)
	return __zh_cn2.onboarding_step_ai_skip(inputs)
});
/**
* | output |
* | --- |
* | "I have an API key (configure in Settings after onboarding)" |
*
* @param {Onboarding_Step_Ai_ByotInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const onboarding_step_ai_byot = /** @type {((inputs?: Onboarding_Step_Ai_ByotInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Onboarding_Step_Ai_ByotInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.onboarding_step_ai_byot(inputs)
	return __zh_cn2.onboarding_step_ai_byot(inputs)
});
/**
* | output |
* | --- |
* | "Finish" |
*
* @param {Onboarding_FinishInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const onboarding_finish = /** @type {((inputs?: Onboarding_FinishInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Onboarding_FinishInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.onboarding_finish(inputs)
	return __zh_cn2.onboarding_finish(inputs)
});
/**
* | output |
* | --- |
* | "Creating organization…" |
*
* @param {Onboarding_CreatingInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const onboarding_creating = /** @type {((inputs?: Onboarding_CreatingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Onboarding_CreatingInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.onboarding_creating(inputs)
	return __zh_cn2.onboarding_creating(inputs)
});