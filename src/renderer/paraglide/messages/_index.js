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
/** @typedef {{}} Nav_DocumentsInputs */
/** @typedef {{}} Nav_SettingsInputs */
/** @typedef {{}} Cmd_Open_SettingsInputs */
/** @typedef {{}} Cmd_Open_DocumentsInputs */
/** @typedef {{}} Documents_PlaceholderInputs */
/** @typedef {{}} Documents_Upload_HintInputs */
/** @typedef {{}} Documents_Upload_Pdf_OnlyInputs */
/** @typedef {{}} Documents_UploadingInputs */
/** @typedef {{}} Documents_ExtractingInputs */
/** @typedef {{}} Documents_Upload_DoneInputs */
/** @typedef {{}} Documents_Upload_SuccessInputs */
/** @typedef {{}} Documents_Upload_FailedInputs */
/** @typedef {{}} Documents_Extraction_StartedInputs */
/** @typedef {{}} Documents_Extraction_FailedInputs */
/** @typedef {{}} Documents_Extraction_DoneInputs */
/** @typedef {{}} Documents_Ai_Required_TitleInputs */
/** @typedef {{}} Documents_Ai_Required_BodyInputs */
/** @typedef {{}} Documents_Ai_Required_CtaInputs */
/** @typedef {{}} Documents_EmptyInputs */
/** @typedef {{}} Documents_Load_FailedInputs */
/** @typedef {{}} Documents_Table_UploadedInputs */
/** @typedef {{}} Documents_Table_FilenameInputs */
/** @typedef {{}} Documents_Table_ShaInputs */
/** @typedef {{}} Documents_Table_StatusInputs */
/** @typedef {{}} Documents_Status_Review_NeededInputs */
/** @typedef {{}} Documents_Status_ParsedInputs */
/** @typedef {{}} Documents_Status_RejectedInputs */
/** @typedef {{}} Documents_Status_NoneInputs */
/** @typedef {{}} Documents_Open_RowInputs */
/** @typedef {{}} Documents_Review_BackInputs */
/** @typedef {{ date: NonNullable<unknown> }} Documents_Review_Uploaded_OnInputs */
/** @typedef {{}} Documents_Review_Sha_LabelInputs */
/** @typedef {{}} Documents_Review_No_ExtractionInputs */
/** @typedef {{}} Documents_Review_Load_FailedInputs */
/** @typedef {{}} Documents_Review_Pdf_UnavailableInputs */
/** @typedef {{}} Documents_Review_Pdf_LoadingInputs */
/** @typedef {{}} Documents_Review_StageInputs */
/** @typedef {{}} Documents_Review_ProviderInputs */
/** @typedef {{}} Documents_Review_ConfidenceInputs */
/** @typedef {{}} Documents_Review_Confidence_HighInputs */
/** @typedef {{}} Documents_Review_Confidence_MediumInputs */
/** @typedef {{}} Documents_Review_Confidence_LowInputs */
/** @typedef {{}} Documents_Review_Field_SupplierInputs */
/** @typedef {{}} Documents_Review_Field_AccountInputs */
/** @typedef {{}} Documents_Review_Field_Amount_KwhInputs */
/** @typedef {{}} Documents_Review_Field_Amount_YuanInputs */
/** @typedef {{}} Documents_Review_Field_Period_StartInputs */
/** @typedef {{}} Documents_Review_Field_Period_EndInputs */
/** @typedef {{}} Documents_Review_ConfirmInputs */
/** @typedef {{}} Documents_Review_DiscardInputs */
/** @typedef {{}} Documents_Review_Discard_ConfirmInputs */
/** @typedef {{}} Documents_Review_Discard_SuccessInputs */
/** @typedef {{}} Documents_Review_Discard_FailedInputs */
/** @typedef {{}} Documents_Review_Confirm_SuccessInputs */
/** @typedef {{}} Documents_Review_Confirm_FailedInputs */
/** @typedef {{}} Documents_Review_Parse_ErrorInputs */
/** @typedef {{}} Settings_TitleInputs */
/** @typedef {{}} Settings_Provider_LabelInputs */
/** @typedef {{}} Settings_Provider_OpenaiInputs */
/** @typedef {{}} Settings_Provider_AnthropicInputs */
/** @typedef {{}} Settings_Provider_AzureInputs */
/** @typedef {{}} Settings_Provider_DeepseekInputs */
/** @typedef {{}} Settings_Provider_Openai_CompatInputs */
/** @typedef {{}} Settings_Model_LabelInputs */
/** @typedef {{}} Settings_Apikey_LabelInputs */
/** @typedef {{}} Settings_Apikey_SavedInputs */
/** @typedef {{}} Settings_Apikey_ReplaceInputs */
/** @typedef {{}} Settings_Resource_Name_LabelInputs */
/** @typedef {{}} Settings_Api_Version_LabelInputs */
/** @typedef {{}} Settings_Base_Url_LabelInputs */
/** @typedef {{}} Settings_Compat_Name_LabelInputs */
/** @typedef {{}} Settings_Test_ConnectionInputs */
/** @typedef {{}} Settings_TestingInputs */
/** @typedef {{}} Settings_SaveInputs */
/** @typedef {{}} Settings_SavingInputs */
/** @typedef {{}} Settings_CancelInputs */
/** @typedef {{}} Settings_Test_SuccessInputs */
/** @typedef {{}} Settings_Test_FailedInputs */
/** @typedef {{}} Settings_Save_SuccessInputs */
/** @typedef {{}} Settings_Save_FailedInputs */
/** @typedef {{}} Settings_Load_FailedInputs */
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
* | "Documents" |
*
* @param {Nav_DocumentsInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const nav_documents = /** @type {((inputs?: Nav_DocumentsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Nav_DocumentsInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.nav_documents(inputs)
	return __zh_cn2.nav_documents(inputs)
});
/**
* | output |
* | --- |
* | "Settings" |
*
* @param {Nav_SettingsInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const nav_settings = /** @type {((inputs?: Nav_SettingsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Nav_SettingsInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.nav_settings(inputs)
	return __zh_cn2.nav_settings(inputs)
});
/**
* | output |
* | --- |
* | "Open Settings" |
*
* @param {Cmd_Open_SettingsInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const cmd_open_settings = /** @type {((inputs?: Cmd_Open_SettingsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Cmd_Open_SettingsInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.cmd_open_settings(inputs)
	return __zh_cn2.cmd_open_settings(inputs)
});
/**
* | output |
* | --- |
* | "Open Documents" |
*
* @param {Cmd_Open_DocumentsInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const cmd_open_documents = /** @type {((inputs?: Cmd_Open_DocumentsInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Cmd_Open_DocumentsInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.cmd_open_documents(inputs)
	return __zh_cn2.cmd_open_documents(inputs)
});
/**
* | output |
* | --- |
* | "Document upload + extraction lands in Phase 1b Task 14." |
*
* @param {Documents_PlaceholderInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const documents_placeholder = /** @type {((inputs?: Documents_PlaceholderInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Documents_PlaceholderInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.documents_placeholder(inputs)
	return __zh_cn2.documents_placeholder(inputs)
});
/**
* | output |
* | --- |
* | "Drop a PDF here, or click to browse" |
*
* @param {Documents_Upload_HintInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const documents_upload_hint = /** @type {((inputs?: Documents_Upload_HintInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Documents_Upload_HintInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.documents_upload_hint(inputs)
	return __zh_cn2.documents_upload_hint(inputs)
});
/**
* | output |
* | --- |
* | "Only PDF files are supported." |
*
* @param {Documents_Upload_Pdf_OnlyInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const documents_upload_pdf_only = /** @type {((inputs?: Documents_Upload_Pdf_OnlyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Documents_Upload_Pdf_OnlyInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.documents_upload_pdf_only(inputs)
	return __zh_cn2.documents_upload_pdf_only(inputs)
});
/**
* | output |
* | --- |
* | "Uploading…" |
*
* @param {Documents_UploadingInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const documents_uploading = /** @type {((inputs?: Documents_UploadingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Documents_UploadingInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.documents_uploading(inputs)
	return __zh_cn2.documents_uploading(inputs)
});
/**
* | output |
* | --- |
* | "Extracting…" |
*
* @param {Documents_ExtractingInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const documents_extracting = /** @type {((inputs?: Documents_ExtractingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Documents_ExtractingInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.documents_extracting(inputs)
	return __zh_cn2.documents_extracting(inputs)
});
/**
* | output |
* | --- |
* | "Done" |
*
* @param {Documents_Upload_DoneInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const documents_upload_done = /** @type {((inputs?: Documents_Upload_DoneInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Documents_Upload_DoneInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.documents_upload_done(inputs)
	return __zh_cn2.documents_upload_done(inputs)
});
/**
* | output |
* | --- |
* | "Document uploaded" |
*
* @param {Documents_Upload_SuccessInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const documents_upload_success = /** @type {((inputs?: Documents_Upload_SuccessInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Documents_Upload_SuccessInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.documents_upload_success(inputs)
	return __zh_cn2.documents_upload_success(inputs)
});
/**
* | output |
* | --- |
* | "Upload failed" |
*
* @param {Documents_Upload_FailedInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const documents_upload_failed = /** @type {((inputs?: Documents_Upload_FailedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Documents_Upload_FailedInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.documents_upload_failed(inputs)
	return __zh_cn2.documents_upload_failed(inputs)
});
/**
* | output |
* | --- |
* | "Extraction started" |
*
* @param {Documents_Extraction_StartedInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const documents_extraction_started = /** @type {((inputs?: Documents_Extraction_StartedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Documents_Extraction_StartedInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.documents_extraction_started(inputs)
	return __zh_cn2.documents_extraction_started(inputs)
});
/**
* | output |
* | --- |
* | "Extraction failed" |
*
* @param {Documents_Extraction_FailedInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const documents_extraction_failed = /** @type {((inputs?: Documents_Extraction_FailedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Documents_Extraction_FailedInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.documents_extraction_failed(inputs)
	return __zh_cn2.documents_extraction_failed(inputs)
});
/**
* | output |
* | --- |
* | "Extraction ready for review" |
*
* @param {Documents_Extraction_DoneInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const documents_extraction_done = /** @type {((inputs?: Documents_Extraction_DoneInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Documents_Extraction_DoneInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.documents_extraction_done(inputs)
	return __zh_cn2.documents_extraction_done(inputs)
});
/**
* | output |
* | --- |
* | "AI provider not configured" |
*
* @param {Documents_Ai_Required_TitleInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const documents_ai_required_title = /** @type {((inputs?: Documents_Ai_Required_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Documents_Ai_Required_TitleInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.documents_ai_required_title(inputs)
	return __zh_cn2.documents_ai_required_title(inputs)
});
/**
* | output |
* | --- |
* | "Carbonbook needs an AI provider to read documents. Set one up in Settings — you'll need an API key from your provider (OpenAI / Anthropic / Azure / DeepSeek,..." |
*
* @param {Documents_Ai_Required_BodyInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const documents_ai_required_body = /** @type {((inputs?: Documents_Ai_Required_BodyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Documents_Ai_Required_BodyInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.documents_ai_required_body(inputs)
	return __zh_cn2.documents_ai_required_body(inputs)
});
/**
* | output |
* | --- |
* | "Open Settings" |
*
* @param {Documents_Ai_Required_CtaInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const documents_ai_required_cta = /** @type {((inputs?: Documents_Ai_Required_CtaInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Documents_Ai_Required_CtaInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.documents_ai_required_cta(inputs)
	return __zh_cn2.documents_ai_required_cta(inputs)
});
/**
* | output |
* | --- |
* | "No documents yet. Drop a PDF above to get started." |
*
* @param {Documents_EmptyInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const documents_empty = /** @type {((inputs?: Documents_EmptyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Documents_EmptyInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.documents_empty(inputs)
	return __zh_cn2.documents_empty(inputs)
});
/**
* | output |
* | --- |
* | "Failed to load documents" |
*
* @param {Documents_Load_FailedInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const documents_load_failed = /** @type {((inputs?: Documents_Load_FailedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Documents_Load_FailedInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.documents_load_failed(inputs)
	return __zh_cn2.documents_load_failed(inputs)
});
/**
* | output |
* | --- |
* | "Uploaded" |
*
* @param {Documents_Table_UploadedInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const documents_table_uploaded = /** @type {((inputs?: Documents_Table_UploadedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Documents_Table_UploadedInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.documents_table_uploaded(inputs)
	return __zh_cn2.documents_table_uploaded(inputs)
});
/**
* | output |
* | --- |
* | "File" |
*
* @param {Documents_Table_FilenameInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const documents_table_filename = /** @type {((inputs?: Documents_Table_FilenameInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Documents_Table_FilenameInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.documents_table_filename(inputs)
	return __zh_cn2.documents_table_filename(inputs)
});
/**
* | output |
* | --- |
* | "Hash" |
*
* @param {Documents_Table_ShaInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const documents_table_sha = /** @type {((inputs?: Documents_Table_ShaInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Documents_Table_ShaInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.documents_table_sha(inputs)
	return __zh_cn2.documents_table_sha(inputs)
});
/**
* | output |
* | --- |
* | "Status" |
*
* @param {Documents_Table_StatusInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const documents_table_status = /** @type {((inputs?: Documents_Table_StatusInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Documents_Table_StatusInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.documents_table_status(inputs)
	return __zh_cn2.documents_table_status(inputs)
});
/**
* | output |
* | --- |
* | "Needs review" |
*
* @param {Documents_Status_Review_NeededInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const documents_status_review_needed = /** @type {((inputs?: Documents_Status_Review_NeededInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Documents_Status_Review_NeededInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.documents_status_review_needed(inputs)
	return __zh_cn2.documents_status_review_needed(inputs)
});
/**
* | output |
* | --- |
* | "Confirmed" |
*
* @param {Documents_Status_ParsedInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const documents_status_parsed = /** @type {((inputs?: Documents_Status_ParsedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Documents_Status_ParsedInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.documents_status_parsed(inputs)
	return __zh_cn2.documents_status_parsed(inputs)
});
/**
* | output |
* | --- |
* | "Discarded" |
*
* @param {Documents_Status_RejectedInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const documents_status_rejected = /** @type {((inputs?: Documents_Status_RejectedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Documents_Status_RejectedInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.documents_status_rejected(inputs)
	return __zh_cn2.documents_status_rejected(inputs)
});
/**
* | output |
* | --- |
* | "No extractions" |
*
* @param {Documents_Status_NoneInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const documents_status_none = /** @type {((inputs?: Documents_Status_NoneInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Documents_Status_NoneInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.documents_status_none(inputs)
	return __zh_cn2.documents_status_none(inputs)
});
/**
* | output |
* | --- |
* | "Open" |
*
* @param {Documents_Open_RowInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const documents_open_row = /** @type {((inputs?: Documents_Open_RowInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Documents_Open_RowInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.documents_open_row(inputs)
	return __zh_cn2.documents_open_row(inputs)
});
/**
* | output |
* | --- |
* | "Back to documents" |
*
* @param {Documents_Review_BackInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const documents_review_back = /** @type {((inputs?: Documents_Review_BackInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Documents_Review_BackInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.documents_review_back(inputs)
	return __zh_cn2.documents_review_back(inputs)
});
/**
* | output |
* | --- |
* | "Uploaded {date}" |
*
* @param {Documents_Review_Uploaded_OnInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const documents_review_uploaded_on = /** @type {((inputs: Documents_Review_Uploaded_OnInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Documents_Review_Uploaded_OnInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.documents_review_uploaded_on(inputs)
	return __zh_cn2.documents_review_uploaded_on(inputs)
});
/**
* | output |
* | --- |
* | "SHA" |
*
* @param {Documents_Review_Sha_LabelInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const documents_review_sha_label = /** @type {((inputs?: Documents_Review_Sha_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Documents_Review_Sha_LabelInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.documents_review_sha_label(inputs)
	return __zh_cn2.documents_review_sha_label(inputs)
});
/**
* | output |
* | --- |
* | "No extraction yet for this document." |
*
* @param {Documents_Review_No_ExtractionInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const documents_review_no_extraction = /** @type {((inputs?: Documents_Review_No_ExtractionInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Documents_Review_No_ExtractionInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.documents_review_no_extraction(inputs)
	return __zh_cn2.documents_review_no_extraction(inputs)
});
/**
* | output |
* | --- |
* | "Failed to load document" |
*
* @param {Documents_Review_Load_FailedInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const documents_review_load_failed = /** @type {((inputs?: Documents_Review_Load_FailedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Documents_Review_Load_FailedInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.documents_review_load_failed(inputs)
	return __zh_cn2.documents_review_load_failed(inputs)
});
/**
* | output |
* | --- |
* | "PDF preview unavailable." |
*
* @param {Documents_Review_Pdf_UnavailableInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const documents_review_pdf_unavailable = /** @type {((inputs?: Documents_Review_Pdf_UnavailableInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Documents_Review_Pdf_UnavailableInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.documents_review_pdf_unavailable(inputs)
	return __zh_cn2.documents_review_pdf_unavailable(inputs)
});
/**
* | output |
* | --- |
* | "Loading PDF preview…" |
*
* @param {Documents_Review_Pdf_LoadingInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const documents_review_pdf_loading = /** @type {((inputs?: Documents_Review_Pdf_LoadingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Documents_Review_Pdf_LoadingInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.documents_review_pdf_loading(inputs)
	return __zh_cn2.documents_review_pdf_loading(inputs)
});
/**
* | output |
* | --- |
* | "Stage" |
*
* @param {Documents_Review_StageInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const documents_review_stage = /** @type {((inputs?: Documents_Review_StageInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Documents_Review_StageInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.documents_review_stage(inputs)
	return __zh_cn2.documents_review_stage(inputs)
});
/**
* | output |
* | --- |
* | "Provider" |
*
* @param {Documents_Review_ProviderInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const documents_review_provider = /** @type {((inputs?: Documents_Review_ProviderInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Documents_Review_ProviderInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.documents_review_provider(inputs)
	return __zh_cn2.documents_review_provider(inputs)
});
/**
* | output |
* | --- |
* | "Confidence" |
*
* @param {Documents_Review_ConfidenceInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const documents_review_confidence = /** @type {((inputs?: Documents_Review_ConfidenceInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Documents_Review_ConfidenceInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.documents_review_confidence(inputs)
	return __zh_cn2.documents_review_confidence(inputs)
});
/**
* | output |
* | --- |
* | "High" |
*
* @param {Documents_Review_Confidence_HighInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const documents_review_confidence_high = /** @type {((inputs?: Documents_Review_Confidence_HighInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Documents_Review_Confidence_HighInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.documents_review_confidence_high(inputs)
	return __zh_cn2.documents_review_confidence_high(inputs)
});
/**
* | output |
* | --- |
* | "Medium" |
*
* @param {Documents_Review_Confidence_MediumInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const documents_review_confidence_medium = /** @type {((inputs?: Documents_Review_Confidence_MediumInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Documents_Review_Confidence_MediumInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.documents_review_confidence_medium(inputs)
	return __zh_cn2.documents_review_confidence_medium(inputs)
});
/**
* | output |
* | --- |
* | "Low" |
*
* @param {Documents_Review_Confidence_LowInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const documents_review_confidence_low = /** @type {((inputs?: Documents_Review_Confidence_LowInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Documents_Review_Confidence_LowInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.documents_review_confidence_low(inputs)
	return __zh_cn2.documents_review_confidence_low(inputs)
});
/**
* | output |
* | --- |
* | "Supplier" |
*
* @param {Documents_Review_Field_SupplierInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const documents_review_field_supplier = /** @type {((inputs?: Documents_Review_Field_SupplierInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Documents_Review_Field_SupplierInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.documents_review_field_supplier(inputs)
	return __zh_cn2.documents_review_field_supplier(inputs)
});
/**
* | output |
* | --- |
* | "Account" |
*
* @param {Documents_Review_Field_AccountInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const documents_review_field_account = /** @type {((inputs?: Documents_Review_Field_AccountInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Documents_Review_Field_AccountInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.documents_review_field_account(inputs)
	return __zh_cn2.documents_review_field_account(inputs)
});
/**
* | output |
* | --- |
* | "Energy (kWh)" |
*
* @param {Documents_Review_Field_Amount_KwhInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const documents_review_field_amount_kwh = /** @type {((inputs?: Documents_Review_Field_Amount_KwhInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Documents_Review_Field_Amount_KwhInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.documents_review_field_amount_kwh(inputs)
	return __zh_cn2.documents_review_field_amount_kwh(inputs)
});
/**
* | output |
* | --- |
* | "Total (CNY)" |
*
* @param {Documents_Review_Field_Amount_YuanInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const documents_review_field_amount_yuan = /** @type {((inputs?: Documents_Review_Field_Amount_YuanInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Documents_Review_Field_Amount_YuanInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.documents_review_field_amount_yuan(inputs)
	return __zh_cn2.documents_review_field_amount_yuan(inputs)
});
/**
* | output |
* | --- |
* | "Period start" |
*
* @param {Documents_Review_Field_Period_StartInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const documents_review_field_period_start = /** @type {((inputs?: Documents_Review_Field_Period_StartInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Documents_Review_Field_Period_StartInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.documents_review_field_period_start(inputs)
	return __zh_cn2.documents_review_field_period_start(inputs)
});
/**
* | output |
* | --- |
* | "Period end" |
*
* @param {Documents_Review_Field_Period_EndInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const documents_review_field_period_end = /** @type {((inputs?: Documents_Review_Field_Period_EndInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Documents_Review_Field_Period_EndInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.documents_review_field_period_end(inputs)
	return __zh_cn2.documents_review_field_period_end(inputs)
});
/**
* | output |
* | --- |
* | "Confirm → Add as activity" |
*
* @param {Documents_Review_ConfirmInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const documents_review_confirm = /** @type {((inputs?: Documents_Review_ConfirmInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Documents_Review_ConfirmInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.documents_review_confirm(inputs)
	return __zh_cn2.documents_review_confirm(inputs)
});
/**
* | output |
* | --- |
* | "Discard" |
*
* @param {Documents_Review_DiscardInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const documents_review_discard = /** @type {((inputs?: Documents_Review_DiscardInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Documents_Review_DiscardInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.documents_review_discard(inputs)
	return __zh_cn2.documents_review_discard(inputs)
});
/**
* | output |
* | --- |
* | "Discard this extraction? This can't be undone." |
*
* @param {Documents_Review_Discard_ConfirmInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const documents_review_discard_confirm = /** @type {((inputs?: Documents_Review_Discard_ConfirmInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Documents_Review_Discard_ConfirmInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.documents_review_discard_confirm(inputs)
	return __zh_cn2.documents_review_discard_confirm(inputs)
});
/**
* | output |
* | --- |
* | "Extraction discarded" |
*
* @param {Documents_Review_Discard_SuccessInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const documents_review_discard_success = /** @type {((inputs?: Documents_Review_Discard_SuccessInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Documents_Review_Discard_SuccessInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.documents_review_discard_success(inputs)
	return __zh_cn2.documents_review_discard_success(inputs)
});
/**
* | output |
* | --- |
* | "Failed to discard extraction" |
*
* @param {Documents_Review_Discard_FailedInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const documents_review_discard_failed = /** @type {((inputs?: Documents_Review_Discard_FailedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Documents_Review_Discard_FailedInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.documents_review_discard_failed(inputs)
	return __zh_cn2.documents_review_discard_failed(inputs)
});
/**
* | output |
* | --- |
* | "Extraction confirmed" |
*
* @param {Documents_Review_Confirm_SuccessInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const documents_review_confirm_success = /** @type {((inputs?: Documents_Review_Confirm_SuccessInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Documents_Review_Confirm_SuccessInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.documents_review_confirm_success(inputs)
	return __zh_cn2.documents_review_confirm_success(inputs)
});
/**
* | output |
* | --- |
* | "Failed to confirm extraction" |
*
* @param {Documents_Review_Confirm_FailedInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const documents_review_confirm_failed = /** @type {((inputs?: Documents_Review_Confirm_FailedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Documents_Review_Confirm_FailedInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.documents_review_confirm_failed(inputs)
	return __zh_cn2.documents_review_confirm_failed(inputs)
});
/**
* | output |
* | --- |
* | "Could not parse the extraction output." |
*
* @param {Documents_Review_Parse_ErrorInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const documents_review_parse_error = /** @type {((inputs?: Documents_Review_Parse_ErrorInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Documents_Review_Parse_ErrorInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.documents_review_parse_error(inputs)
	return __zh_cn2.documents_review_parse_error(inputs)
});
/**
* | output |
* | --- |
* | "Settings" |
*
* @param {Settings_TitleInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const settings_title = /** @type {((inputs?: Settings_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_TitleInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.settings_title(inputs)
	return __zh_cn2.settings_title(inputs)
});
/**
* | output |
* | --- |
* | "AI provider" |
*
* @param {Settings_Provider_LabelInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const settings_provider_label = /** @type {((inputs?: Settings_Provider_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_Provider_LabelInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.settings_provider_label(inputs)
	return __zh_cn2.settings_provider_label(inputs)
});
/**
* | output |
* | --- |
* | "OpenAI" |
*
* @param {Settings_Provider_OpenaiInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const settings_provider_openai = /** @type {((inputs?: Settings_Provider_OpenaiInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_Provider_OpenaiInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.settings_provider_openai(inputs)
	return __zh_cn2.settings_provider_openai(inputs)
});
/**
* | output |
* | --- |
* | "Anthropic" |
*
* @param {Settings_Provider_AnthropicInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const settings_provider_anthropic = /** @type {((inputs?: Settings_Provider_AnthropicInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_Provider_AnthropicInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.settings_provider_anthropic(inputs)
	return __zh_cn2.settings_provider_anthropic(inputs)
});
/**
* | output |
* | --- |
* | "Azure OpenAI" |
*
* @param {Settings_Provider_AzureInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const settings_provider_azure = /** @type {((inputs?: Settings_Provider_AzureInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_Provider_AzureInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.settings_provider_azure(inputs)
	return __zh_cn2.settings_provider_azure(inputs)
});
/**
* | output |
* | --- |
* | "DeepSeek" |
*
* @param {Settings_Provider_DeepseekInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const settings_provider_deepseek = /** @type {((inputs?: Settings_Provider_DeepseekInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_Provider_DeepseekInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.settings_provider_deepseek(inputs)
	return __zh_cn2.settings_provider_deepseek(inputs)
});
/**
* | output |
* | --- |
* | "OpenAI-compatible" |
*
* @param {Settings_Provider_Openai_CompatInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const settings_provider_openai_compat = /** @type {((inputs?: Settings_Provider_Openai_CompatInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_Provider_Openai_CompatInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.settings_provider_openai_compat(inputs)
	return __zh_cn2.settings_provider_openai_compat(inputs)
});
/**
* | output |
* | --- |
* | "Model" |
*
* @param {Settings_Model_LabelInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const settings_model_label = /** @type {((inputs?: Settings_Model_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_Model_LabelInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.settings_model_label(inputs)
	return __zh_cn2.settings_model_label(inputs)
});
/**
* | output |
* | --- |
* | "API key" |
*
* @param {Settings_Apikey_LabelInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const settings_apikey_label = /** @type {((inputs?: Settings_Apikey_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_Apikey_LabelInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.settings_apikey_label(inputs)
	return __zh_cn2.settings_apikey_label(inputs)
});
/**
* | output |
* | --- |
* | "Saved" |
*
* @param {Settings_Apikey_SavedInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const settings_apikey_saved = /** @type {((inputs?: Settings_Apikey_SavedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_Apikey_SavedInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.settings_apikey_saved(inputs)
	return __zh_cn2.settings_apikey_saved(inputs)
});
/**
* | output |
* | --- |
* | "Replace" |
*
* @param {Settings_Apikey_ReplaceInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const settings_apikey_replace = /** @type {((inputs?: Settings_Apikey_ReplaceInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_Apikey_ReplaceInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.settings_apikey_replace(inputs)
	return __zh_cn2.settings_apikey_replace(inputs)
});
/**
* | output |
* | --- |
* | "Azure resource name" |
*
* @param {Settings_Resource_Name_LabelInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const settings_resource_name_label = /** @type {((inputs?: Settings_Resource_Name_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_Resource_Name_LabelInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.settings_resource_name_label(inputs)
	return __zh_cn2.settings_resource_name_label(inputs)
});
/**
* | output |
* | --- |
* | "Azure API version" |
*
* @param {Settings_Api_Version_LabelInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const settings_api_version_label = /** @type {((inputs?: Settings_Api_Version_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_Api_Version_LabelInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.settings_api_version_label(inputs)
	return __zh_cn2.settings_api_version_label(inputs)
});
/**
* | output |
* | --- |
* | "Base URL" |
*
* @param {Settings_Base_Url_LabelInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const settings_base_url_label = /** @type {((inputs?: Settings_Base_Url_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_Base_Url_LabelInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.settings_base_url_label(inputs)
	return __zh_cn2.settings_base_url_label(inputs)
});
/**
* | output |
* | --- |
* | "Provider name (label)" |
*
* @param {Settings_Compat_Name_LabelInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const settings_compat_name_label = /** @type {((inputs?: Settings_Compat_Name_LabelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_Compat_Name_LabelInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.settings_compat_name_label(inputs)
	return __zh_cn2.settings_compat_name_label(inputs)
});
/**
* | output |
* | --- |
* | "Test connection" |
*
* @param {Settings_Test_ConnectionInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const settings_test_connection = /** @type {((inputs?: Settings_Test_ConnectionInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_Test_ConnectionInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.settings_test_connection(inputs)
	return __zh_cn2.settings_test_connection(inputs)
});
/**
* | output |
* | --- |
* | "Testing…" |
*
* @param {Settings_TestingInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const settings_testing = /** @type {((inputs?: Settings_TestingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_TestingInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.settings_testing(inputs)
	return __zh_cn2.settings_testing(inputs)
});
/**
* | output |
* | --- |
* | "Save" |
*
* @param {Settings_SaveInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const settings_save = /** @type {((inputs?: Settings_SaveInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_SaveInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.settings_save(inputs)
	return __zh_cn2.settings_save(inputs)
});
/**
* | output |
* | --- |
* | "Saving…" |
*
* @param {Settings_SavingInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const settings_saving = /** @type {((inputs?: Settings_SavingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_SavingInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.settings_saving(inputs)
	return __zh_cn2.settings_saving(inputs)
});
/**
* | output |
* | --- |
* | "Cancel" |
*
* @param {Settings_CancelInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const settings_cancel = /** @type {((inputs?: Settings_CancelInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_CancelInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.settings_cancel(inputs)
	return __zh_cn2.settings_cancel(inputs)
});
/**
* | output |
* | --- |
* | "Connection successful" |
*
* @param {Settings_Test_SuccessInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const settings_test_success = /** @type {((inputs?: Settings_Test_SuccessInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_Test_SuccessInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.settings_test_success(inputs)
	return __zh_cn2.settings_test_success(inputs)
});
/**
* | output |
* | --- |
* | "Connection failed" |
*
* @param {Settings_Test_FailedInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const settings_test_failed = /** @type {((inputs?: Settings_Test_FailedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_Test_FailedInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.settings_test_failed(inputs)
	return __zh_cn2.settings_test_failed(inputs)
});
/**
* | output |
* | --- |
* | "Settings saved" |
*
* @param {Settings_Save_SuccessInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const settings_save_success = /** @type {((inputs?: Settings_Save_SuccessInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_Save_SuccessInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.settings_save_success(inputs)
	return __zh_cn2.settings_save_success(inputs)
});
/**
* | output |
* | --- |
* | "Failed to save settings" |
*
* @param {Settings_Save_FailedInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const settings_save_failed = /** @type {((inputs?: Settings_Save_FailedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_Save_FailedInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.settings_save_failed(inputs)
	return __zh_cn2.settings_save_failed(inputs)
});
/**
* | output |
* | --- |
* | "Failed to load settings" |
*
* @param {Settings_Load_FailedInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const settings_load_failed = /** @type {((inputs?: Settings_Load_FailedInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_Load_FailedInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return __en.settings_load_failed(inputs)
	return __zh_cn2.settings_load_failed(inputs)
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