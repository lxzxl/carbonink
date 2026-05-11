/* eslint-disable */
import { getLocale, experimentalStaticLocale } from "../runtime.js"

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */
/** @typedef {{}} App_TitleInputs */
/** @typedef {{}} Dashboard_Welcome_TitleInputs */
/** @typedef {{}} Dashboard_Welcome_BodyInputs */
/** @typedef {{}} Dashboard_Inventory_TitleInputs */
/** @typedef {{}} Dashboard_Inventory_BodyInputs */
/** @typedef {{}} Nav_DashboardInputs */
/** @typedef {{}} Nav_SourcesInputs */
/** @typedef {{}} Nav_ActivitiesInputs */
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
/** @typedef {{}} Sources_Add_ButtonInputs */
/** @typedef {{}} Sources_Cancel_ButtonInputs */
/** @typedef {{}} Sources_EmptyInputs */
/** @typedef {{}} Sources_Form_NameInputs */
/** @typedef {{}} Sources_Form_ScopeInputs */
/** @typedef {{}} Sources_Form_Scope_1Inputs */
/** @typedef {{}} Sources_Form_Scope_2Inputs */
/** @typedef {{}} Sources_Form_Scope_3Inputs */
/** @typedef {{}} Sources_Form_CategoryInputs */
/** @typedef {{}} Sources_Form_Category_PlaceholderInputs */
/** @typedef {{}} Sources_Form_SiteInputs */
/** @typedef {{}} Sources_Form_SubmitInputs */
/** @typedef {{}} Sources_Form_SubmittingInputs */
/** @typedef {{}} Sources_Table_NameInputs */
/** @typedef {{}} Sources_Table_ScopeInputs */
/** @typedef {{}} Sources_Table_CategoryInputs */
/** @typedef {{}} Sources_Table_ActiveInputs */
/** @typedef {{}} Sources_Active_YesInputs */
/** @typedef {{}} Sources_Active_NoInputs */
/** @typedef {{}} Sources_Load_FailedInputs */
/** @typedef {{}} Sources_Create_FailedInputs */
/** @typedef {{}} Activities_Add_ButtonInputs */
/** @typedef {{}} Activities_EmptyInputs */
/** @typedef {{}} Activities_Load_FailedInputs */
/** @typedef {{}} Activities_Create_FailedInputs */
/** @typedef {{}} Activities_Create_SuccessInputs */
/** @typedef {{}} Activities_Table_OccurredInputs */
/** @typedef {{}} Activities_Table_SourceInputs */
/** @typedef {{}} Activities_Table_AmountInputs */
/** @typedef {{}} Activities_Table_Co2eInputs */
/** @typedef {{}} Activities_Table_EfInputs */
/** @typedef {{}} Activities_Form_SourceInputs */
/** @typedef {{}} Activities_Form_Source_PlaceholderInputs */
/** @typedef {{}} Activities_Form_No_SourcesInputs */
/** @typedef {{}} Activities_Form_PeriodInputs */
/** @typedef {{}} Activities_Form_Period_PlaceholderInputs */
/** @typedef {{}} Activities_Form_No_PeriodsInputs */
/** @typedef {{}} Activities_Form_Occurred_StartInputs */
/** @typedef {{}} Activities_Form_Occurred_EndInputs */
/** @typedef {{}} Activities_Form_AmountInputs */
/** @typedef {{}} Activities_Form_UnitInputs */
/** @typedef {{}} Activities_Form_Unit_PlaceholderInputs */
/** @typedef {{}} Activities_Form_EfInputs */
/** @typedef {{}} Activities_Form_Ef_Pick_Source_FirstInputs */
/** @typedef {{}} Activities_Form_Ef_LoadingInputs */
/** @typedef {{}} Activities_Form_Ef_NoneInputs */
/** @typedef {{}} Activities_Form_Ef_SelectedInputs */
/** @typedef {{}} Activities_Form_FuelInputs */
/** @typedef {{}} Activities_Form_Fuel_HintInputs */
/** @typedef {{}} Activities_Form_Fuel_NoneInputs */
/** @typedef {{}} Fuel_GasolineInputs */
/** @typedef {{}} Fuel_DieselInputs */
/** @typedef {{}} Fuel_Natural_GasInputs */
/** @typedef {{}} Fuel_LpgInputs */
/** @typedef {{}} Fuel_Coal_AnthraciteInputs */
/** @typedef {{}} Activities_Form_NotesInputs */
/** @typedef {{}} Activities_Form_SubmitInputs */
/** @typedef {{}} Activities_Form_SubmittingInputs */
/** @typedef {{}} Dashboard_Total_Co2eInputs */
/** @typedef {{}} Dashboard_Scope_1Inputs */
/** @typedef {{}} Dashboard_Scope_2Inputs */
/** @typedef {{}} Dashboard_Scope_3Inputs */
/** @typedef {{}} Dashboard_Empty_HintInputs */
/** @typedef {{}} Dashboard_Add_First_ActivityInputs */
/** @typedef {{}} Unit_Kg_Co2eInputs */
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
* | "Sources" |
*
* @param {Nav_SourcesInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const nav_sources = /** @type {((inputs?: Nav_SourcesInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Nav_SourcesInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.nav_sources(inputs)
	return __zh_cn2.nav_sources(inputs)
});
/**
* | output |
* | --- |
* | "Activities" |
*
* @param {Nav_ActivitiesInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const nav_activities = /** @type {((inputs?: Nav_ActivitiesInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Nav_ActivitiesInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.nav_activities(inputs)
	return __zh_cn2.nav_activities(inputs)
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
/**
* | output |
* | --- |
* | "Add Source" |
*
* @param {Sources_Add_ButtonInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const sources_add_button = /** @type {((inputs?: Sources_Add_ButtonInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Sources_Add_ButtonInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.sources_add_button(inputs)
	return __zh_cn2.sources_add_button(inputs)
});
/**
* | output |
* | --- |
* | "Cancel" |
*
* @param {Sources_Cancel_ButtonInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const sources_cancel_button = /** @type {((inputs?: Sources_Cancel_ButtonInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Sources_Cancel_ButtonInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.sources_cancel_button(inputs)
	return __zh_cn2.sources_cancel_button(inputs)
});
/**
* | output |
* | --- |
* | "No sources yet. Click \"Add Source\" above." |
*
* @param {Sources_EmptyInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const sources_empty = /** @type {((inputs?: Sources_EmptyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Sources_EmptyInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.sources_empty(inputs)
	return __zh_cn2.sources_empty(inputs)
});
/**
* | output |
* | --- |
* | "Name" |
*
* @param {Sources_Form_NameInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const sources_form_name = /** @type {((inputs?: Sources_Form_NameInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Sources_Form_NameInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.sources_form_name(inputs)
	return __zh_cn2.sources_form_name(inputs)
});
/**
* | output |
* | --- |
* | "Scope" |
*
* @param {Sources_Form_ScopeInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const sources_form_scope = /** @type {((inputs?: Sources_Form_ScopeInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Sources_Form_ScopeInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.sources_form_scope(inputs)
	return __zh_cn2.sources_form_scope(inputs)
});
/**
* | output |
* | --- |
* | "Scope 1 — direct emissions" |
*
* @param {Sources_Form_Scope_1Inputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const sources_form_scope_1 = /** @type {((inputs?: Sources_Form_Scope_1Inputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Sources_Form_Scope_1Inputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.sources_form_scope_1(inputs)
	return __zh_cn2.sources_form_scope_1(inputs)
});
/**
* | output |
* | --- |
* | "Scope 2 — purchased energy" |
*
* @param {Sources_Form_Scope_2Inputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const sources_form_scope_2 = /** @type {((inputs?: Sources_Form_Scope_2Inputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Sources_Form_Scope_2Inputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.sources_form_scope_2(inputs)
	return __zh_cn2.sources_form_scope_2(inputs)
});
/**
* | output |
* | --- |
* | "Scope 3 — value chain" |
*
* @param {Sources_Form_Scope_3Inputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const sources_form_scope_3 = /** @type {((inputs?: Sources_Form_Scope_3Inputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Sources_Form_Scope_3Inputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.sources_form_scope_3(inputs)
	return __zh_cn2.sources_form_scope_3(inputs)
});
/**
* | output |
* | --- |
* | "Category (optional)" |
*
* @param {Sources_Form_CategoryInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const sources_form_category = /** @type {((inputs?: Sources_Form_CategoryInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Sources_Form_CategoryInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.sources_form_category(inputs)
	return __zh_cn2.sources_form_category(inputs)
});
/**
* | output |
* | --- |
* | "e.g. electricity.grid or fuel.mobile" |
*
* @param {Sources_Form_Category_PlaceholderInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const sources_form_category_placeholder = /** @type {((inputs?: Sources_Form_Category_PlaceholderInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Sources_Form_Category_PlaceholderInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.sources_form_category_placeholder(inputs)
	return __zh_cn2.sources_form_category_placeholder(inputs)
});
/**
* | output |
* | --- |
* | "Site" |
*
* @param {Sources_Form_SiteInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const sources_form_site = /** @type {((inputs?: Sources_Form_SiteInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Sources_Form_SiteInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.sources_form_site(inputs)
	return __zh_cn2.sources_form_site(inputs)
});
/**
* | output |
* | --- |
* | "Create source" |
*
* @param {Sources_Form_SubmitInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const sources_form_submit = /** @type {((inputs?: Sources_Form_SubmitInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Sources_Form_SubmitInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.sources_form_submit(inputs)
	return __zh_cn2.sources_form_submit(inputs)
});
/**
* | output |
* | --- |
* | "Creating…" |
*
* @param {Sources_Form_SubmittingInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const sources_form_submitting = /** @type {((inputs?: Sources_Form_SubmittingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Sources_Form_SubmittingInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.sources_form_submitting(inputs)
	return __zh_cn2.sources_form_submitting(inputs)
});
/**
* | output |
* | --- |
* | "Name" |
*
* @param {Sources_Table_NameInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const sources_table_name = /** @type {((inputs?: Sources_Table_NameInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Sources_Table_NameInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.sources_table_name(inputs)
	return __zh_cn2.sources_table_name(inputs)
});
/**
* | output |
* | --- |
* | "Scope" |
*
* @param {Sources_Table_ScopeInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const sources_table_scope = /** @type {((inputs?: Sources_Table_ScopeInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Sources_Table_ScopeInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.sources_table_scope(inputs)
	return __zh_cn2.sources_table_scope(inputs)
});
/**
* | output |
* | --- |
* | "Category" |
*
* @param {Sources_Table_CategoryInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const sources_table_category = /** @type {((inputs?: Sources_Table_CategoryInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Sources_Table_CategoryInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.sources_table_category(inputs)
	return __zh_cn2.sources_table_category(inputs)
});
/**
* | output |
* | --- |
* | "Active" |
*
* @param {Sources_Table_ActiveInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const sources_table_active = /** @type {((inputs?: Sources_Table_ActiveInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Sources_Table_ActiveInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.sources_table_active(inputs)
	return __zh_cn2.sources_table_active(inputs)
});
/**
* | output |
* | --- |
* | "Yes" |
*
* @param {Sources_Active_YesInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const sources_active_yes = /** @type {((inputs?: Sources_Active_YesInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Sources_Active_YesInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.sources_active_yes(inputs)
	return __zh_cn2.sources_active_yes(inputs)
});
/**
* | output |
* | --- |
* | "No" |
*
* @param {Sources_Active_NoInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const sources_active_no = /** @type {((inputs?: Sources_Active_NoInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Sources_Active_NoInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.sources_active_no(inputs)
	return __zh_cn2.sources_active_no(inputs)
});
/**
* | output |
* | --- |
* | "Failed to load sources" |
*
* @param {Sources_Load_FailedInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const sources_load_failed = /** @type {((inputs?: Sources_Load_FailedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Sources_Load_FailedInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.sources_load_failed(inputs)
	return __zh_cn2.sources_load_failed(inputs)
});
/**
* | output |
* | --- |
* | "Failed to create source" |
*
* @param {Sources_Create_FailedInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const sources_create_failed = /** @type {((inputs?: Sources_Create_FailedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Sources_Create_FailedInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.sources_create_failed(inputs)
	return __zh_cn2.sources_create_failed(inputs)
});
/**
* | output |
* | --- |
* | "Add Activity" |
*
* @param {Activities_Add_ButtonInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const activities_add_button = /** @type {((inputs?: Activities_Add_ButtonInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Activities_Add_ButtonInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.activities_add_button(inputs)
	return __zh_cn2.activities_add_button(inputs)
});
/**
* | output |
* | --- |
* | "No activities yet. Click \"Add Activity\" above." |
*
* @param {Activities_EmptyInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const activities_empty = /** @type {((inputs?: Activities_EmptyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Activities_EmptyInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.activities_empty(inputs)
	return __zh_cn2.activities_empty(inputs)
});
/**
* | output |
* | --- |
* | "Failed to load activities" |
*
* @param {Activities_Load_FailedInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const activities_load_failed = /** @type {((inputs?: Activities_Load_FailedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Activities_Load_FailedInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.activities_load_failed(inputs)
	return __zh_cn2.activities_load_failed(inputs)
});
/**
* | output |
* | --- |
* | "Failed to create activity" |
*
* @param {Activities_Create_FailedInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const activities_create_failed = /** @type {((inputs?: Activities_Create_FailedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Activities_Create_FailedInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.activities_create_failed(inputs)
	return __zh_cn2.activities_create_failed(inputs)
});
/**
* | output |
* | --- |
* | "Activity recorded" |
*
* @param {Activities_Create_SuccessInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const activities_create_success = /** @type {((inputs?: Activities_Create_SuccessInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Activities_Create_SuccessInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.activities_create_success(inputs)
	return __zh_cn2.activities_create_success(inputs)
});
/**
* | output |
* | --- |
* | "Date" |
*
* @param {Activities_Table_OccurredInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const activities_table_occurred = /** @type {((inputs?: Activities_Table_OccurredInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Activities_Table_OccurredInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.activities_table_occurred(inputs)
	return __zh_cn2.activities_table_occurred(inputs)
});
/**
* | output |
* | --- |
* | "Source" |
*
* @param {Activities_Table_SourceInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const activities_table_source = /** @type {((inputs?: Activities_Table_SourceInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Activities_Table_SourceInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.activities_table_source(inputs)
	return __zh_cn2.activities_table_source(inputs)
});
/**
* | output |
* | --- |
* | "Amount" |
*
* @param {Activities_Table_AmountInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const activities_table_amount = /** @type {((inputs?: Activities_Table_AmountInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Activities_Table_AmountInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.activities_table_amount(inputs)
	return __zh_cn2.activities_table_amount(inputs)
});
/**
* | output |
* | --- |
* | "CO2e" |
*
* @param {Activities_Table_Co2eInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const activities_table_co2e = /** @type {((inputs?: Activities_Table_Co2eInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Activities_Table_Co2eInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.activities_table_co2e(inputs)
	return __zh_cn2.activities_table_co2e(inputs)
});
/**
* | output |
* | --- |
* | "Emission factor" |
*
* @param {Activities_Table_EfInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const activities_table_ef = /** @type {((inputs?: Activities_Table_EfInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Activities_Table_EfInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.activities_table_ef(inputs)
	return __zh_cn2.activities_table_ef(inputs)
});
/**
* | output |
* | --- |
* | "Emission source" |
*
* @param {Activities_Form_SourceInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const activities_form_source = /** @type {((inputs?: Activities_Form_SourceInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Activities_Form_SourceInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.activities_form_source(inputs)
	return __zh_cn2.activities_form_source(inputs)
});
/**
* | output |
* | --- |
* | "Select a source…" |
*
* @param {Activities_Form_Source_PlaceholderInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const activities_form_source_placeholder = /** @type {((inputs?: Activities_Form_Source_PlaceholderInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Activities_Form_Source_PlaceholderInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.activities_form_source_placeholder(inputs)
	return __zh_cn2.activities_form_source_placeholder(inputs)
});
/**
* | output |
* | --- |
* | "No sources yet. Add one in the Sources page first." |
*
* @param {Activities_Form_No_SourcesInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const activities_form_no_sources = /** @type {((inputs?: Activities_Form_No_SourcesInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Activities_Form_No_SourcesInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.activities_form_no_sources(inputs)
	return __zh_cn2.activities_form_no_sources(inputs)
});
/**
* | output |
* | --- |
* | "Reporting period" |
*
* @param {Activities_Form_PeriodInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const activities_form_period = /** @type {((inputs?: Activities_Form_PeriodInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Activities_Form_PeriodInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.activities_form_period(inputs)
	return __zh_cn2.activities_form_period(inputs)
});
/**
* | output |
* | --- |
* | "Select a reporting period…" |
*
* @param {Activities_Form_Period_PlaceholderInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const activities_form_period_placeholder = /** @type {((inputs?: Activities_Form_Period_PlaceholderInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Activities_Form_Period_PlaceholderInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.activities_form_period_placeholder(inputs)
	return __zh_cn2.activities_form_period_placeholder(inputs)
});
/**
* | output |
* | --- |
* | "No reporting periods yet. Finish onboarding first." |
*
* @param {Activities_Form_No_PeriodsInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const activities_form_no_periods = /** @type {((inputs?: Activities_Form_No_PeriodsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Activities_Form_No_PeriodsInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.activities_form_no_periods(inputs)
	return __zh_cn2.activities_form_no_periods(inputs)
});
/**
* | output |
* | --- |
* | "Start date" |
*
* @param {Activities_Form_Occurred_StartInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const activities_form_occurred_start = /** @type {((inputs?: Activities_Form_Occurred_StartInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Activities_Form_Occurred_StartInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.activities_form_occurred_start(inputs)
	return __zh_cn2.activities_form_occurred_start(inputs)
});
/**
* | output |
* | --- |
* | "End date" |
*
* @param {Activities_Form_Occurred_EndInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const activities_form_occurred_end = /** @type {((inputs?: Activities_Form_Occurred_EndInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Activities_Form_Occurred_EndInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.activities_form_occurred_end(inputs)
	return __zh_cn2.activities_form_occurred_end(inputs)
});
/**
* | output |
* | --- |
* | "Amount" |
*
* @param {Activities_Form_AmountInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const activities_form_amount = /** @type {((inputs?: Activities_Form_AmountInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Activities_Form_AmountInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.activities_form_amount(inputs)
	return __zh_cn2.activities_form_amount(inputs)
});
/**
* | output |
* | --- |
* | "Unit" |
*
* @param {Activities_Form_UnitInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const activities_form_unit = /** @type {((inputs?: Activities_Form_UnitInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Activities_Form_UnitInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.activities_form_unit(inputs)
	return __zh_cn2.activities_form_unit(inputs)
});
/**
* | output |
* | --- |
* | "e.g. kWh, L, kg, t, 度, 公里" |
*
* @param {Activities_Form_Unit_PlaceholderInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const activities_form_unit_placeholder = /** @type {((inputs?: Activities_Form_Unit_PlaceholderInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Activities_Form_Unit_PlaceholderInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.activities_form_unit_placeholder(inputs)
	return __zh_cn2.activities_form_unit_placeholder(inputs)
});
/**
* | output |
* | --- |
* | "Emission factor" |
*
* @param {Activities_Form_EfInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const activities_form_ef = /** @type {((inputs?: Activities_Form_EfInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Activities_Form_EfInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.activities_form_ef(inputs)
	return __zh_cn2.activities_form_ef(inputs)
});
/**
* | output |
* | --- |
* | "Pick an emission source above to load EF candidates." |
*
* @param {Activities_Form_Ef_Pick_Source_FirstInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const activities_form_ef_pick_source_first = /** @type {((inputs?: Activities_Form_Ef_Pick_Source_FirstInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Activities_Form_Ef_Pick_Source_FirstInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.activities_form_ef_pick_source_first(inputs)
	return __zh_cn2.activities_form_ef_pick_source_first(inputs)
});
/**
* | output |
* | --- |
* | "Loading emission factors…" |
*
* @param {Activities_Form_Ef_LoadingInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const activities_form_ef_loading = /** @type {((inputs?: Activities_Form_Ef_LoadingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Activities_Form_Ef_LoadingInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.activities_form_ef_loading(inputs)
	return __zh_cn2.activities_form_ef_loading(inputs)
});
/**
* | output |
* | --- |
* | "No matching emission factors. Try a different source category." |
*
* @param {Activities_Form_Ef_NoneInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const activities_form_ef_none = /** @type {((inputs?: Activities_Form_Ef_NoneInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Activities_Form_Ef_NoneInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.activities_form_ef_none(inputs)
	return __zh_cn2.activities_form_ef_none(inputs)
});
/**
* | output |
* | --- |
* | "Selected" |
*
* @param {Activities_Form_Ef_SelectedInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const activities_form_ef_selected = /** @type {((inputs?: Activities_Form_Ef_SelectedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Activities_Form_Ef_SelectedInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.activities_form_ef_selected(inputs)
	return __zh_cn2.activities_form_ef_selected(inputs)
});
/**
* | output |
* | --- |
* | "Fuel (optional)" |
*
* @param {Activities_Form_FuelInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const activities_form_fuel = /** @type {((inputs?: Activities_Form_FuelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Activities_Form_FuelInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.activities_form_fuel(inputs)
	return __zh_cn2.activities_form_fuel(inputs)
});
/**
* | output |
* | --- |
* | "Only needed for cross-family unit conversion (e.g. kg gasoline ↔ L)." |
*
* @param {Activities_Form_Fuel_HintInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const activities_form_fuel_hint = /** @type {((inputs?: Activities_Form_Fuel_HintInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Activities_Form_Fuel_HintInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.activities_form_fuel_hint(inputs)
	return __zh_cn2.activities_form_fuel_hint(inputs)
});
/**
* | output |
* | --- |
* | "— None —" |
*
* @param {Activities_Form_Fuel_NoneInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const activities_form_fuel_none = /** @type {((inputs?: Activities_Form_Fuel_NoneInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Activities_Form_Fuel_NoneInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.activities_form_fuel_none(inputs)
	return __zh_cn2.activities_form_fuel_none(inputs)
});
/**
* | output |
* | --- |
* | "Gasoline" |
*
* @param {Fuel_GasolineInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const fuel_gasoline = /** @type {((inputs?: Fuel_GasolineInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Fuel_GasolineInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.fuel_gasoline(inputs)
	return __zh_cn2.fuel_gasoline(inputs)
});
/**
* | output |
* | --- |
* | "Diesel" |
*
* @param {Fuel_DieselInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const fuel_diesel = /** @type {((inputs?: Fuel_DieselInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Fuel_DieselInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.fuel_diesel(inputs)
	return __zh_cn2.fuel_diesel(inputs)
});
/**
* | output |
* | --- |
* | "Natural gas" |
*
* @param {Fuel_Natural_GasInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const fuel_natural_gas = /** @type {((inputs?: Fuel_Natural_GasInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Fuel_Natural_GasInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.fuel_natural_gas(inputs)
	return __zh_cn2.fuel_natural_gas(inputs)
});
/**
* | output |
* | --- |
* | "LPG" |
*
* @param {Fuel_LpgInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const fuel_lpg = /** @type {((inputs?: Fuel_LpgInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Fuel_LpgInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.fuel_lpg(inputs)
	return __zh_cn2.fuel_lpg(inputs)
});
/**
* | output |
* | --- |
* | "Anthracite coal" |
*
* @param {Fuel_Coal_AnthraciteInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const fuel_coal_anthracite = /** @type {((inputs?: Fuel_Coal_AnthraciteInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Fuel_Coal_AnthraciteInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.fuel_coal_anthracite(inputs)
	return __zh_cn2.fuel_coal_anthracite(inputs)
});
/**
* | output |
* | --- |
* | "Notes (optional)" |
*
* @param {Activities_Form_NotesInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const activities_form_notes = /** @type {((inputs?: Activities_Form_NotesInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Activities_Form_NotesInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.activities_form_notes(inputs)
	return __zh_cn2.activities_form_notes(inputs)
});
/**
* | output |
* | --- |
* | "Record activity" |
*
* @param {Activities_Form_SubmitInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const activities_form_submit = /** @type {((inputs?: Activities_Form_SubmitInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Activities_Form_SubmitInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.activities_form_submit(inputs)
	return __zh_cn2.activities_form_submit(inputs)
});
/**
* | output |
* | --- |
* | "Recording…" |
*
* @param {Activities_Form_SubmittingInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const activities_form_submitting = /** @type {((inputs?: Activities_Form_SubmittingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Activities_Form_SubmittingInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.activities_form_submitting(inputs)
	return __zh_cn2.activities_form_submitting(inputs)
});
/**
* | output |
* | --- |
* | "Total CO2e" |
*
* @param {Dashboard_Total_Co2eInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const dashboard_total_co2e = /** @type {((inputs?: Dashboard_Total_Co2eInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Dashboard_Total_Co2eInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.dashboard_total_co2e(inputs)
	return __zh_cn2.dashboard_total_co2e(inputs)
});
/**
* | output |
* | --- |
* | "Scope 1" |
*
* @param {Dashboard_Scope_1Inputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const dashboard_scope_1 = /** @type {((inputs?: Dashboard_Scope_1Inputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Dashboard_Scope_1Inputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.dashboard_scope_1(inputs)
	return __zh_cn2.dashboard_scope_1(inputs)
});
/**
* | output |
* | --- |
* | "Scope 2" |
*
* @param {Dashboard_Scope_2Inputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const dashboard_scope_2 = /** @type {((inputs?: Dashboard_Scope_2Inputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Dashboard_Scope_2Inputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.dashboard_scope_2(inputs)
	return __zh_cn2.dashboard_scope_2(inputs)
});
/**
* | output |
* | --- |
* | "Scope 3" |
*
* @param {Dashboard_Scope_3Inputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const dashboard_scope_3 = /** @type {((inputs?: Dashboard_Scope_3Inputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Dashboard_Scope_3Inputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.dashboard_scope_3(inputs)
	return __zh_cn2.dashboard_scope_3(inputs)
});
/**
* | output |
* | --- |
* | "No emissions data yet." |
*
* @param {Dashboard_Empty_HintInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const dashboard_empty_hint = /** @type {((inputs?: Dashboard_Empty_HintInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Dashboard_Empty_HintInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.dashboard_empty_hint(inputs)
	return __zh_cn2.dashboard_empty_hint(inputs)
});
/**
* | output |
* | --- |
* | "Add your first activity →" |
*
* @param {Dashboard_Add_First_ActivityInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const dashboard_add_first_activity = /** @type {((inputs?: Dashboard_Add_First_ActivityInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Dashboard_Add_First_ActivityInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.dashboard_add_first_activity(inputs)
	return __zh_cn2.dashboard_add_first_activity(inputs)
});
/**
* | output |
* | --- |
* | "kg CO2e" |
*
* @param {Unit_Kg_Co2eInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const unit_kg_co2e = /** @type {((inputs?: Unit_Kg_Co2eInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Unit_Kg_Co2eInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.unit_kg_co2e(inputs)
	return __zh_cn2.unit_kg_co2e(inputs)
});