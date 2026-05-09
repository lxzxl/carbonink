/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Onboarding_Step_Company_Name_EnInputs */

const en_onboarding_step_company_name_en = /** @type {(inputs: Onboarding_Step_Company_Name_EnInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`English name`)
};

const zh_cn2_onboarding_step_company_name_en = /** @type {(inputs: Onboarding_Step_Company_Name_EnInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`英文名`)
};

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
	if (locale === "en") return en_onboarding_step_company_name_en(inputs)
	return zh_cn2_onboarding_step_company_name_en(inputs)
});