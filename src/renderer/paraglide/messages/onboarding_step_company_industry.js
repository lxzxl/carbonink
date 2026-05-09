/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Onboarding_Step_Company_IndustryInputs */

const en_onboarding_step_company_industry = /** @type {(inputs: Onboarding_Step_Company_IndustryInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Industry`)
};

const zh_cn2_onboarding_step_company_industry = /** @type {(inputs: Onboarding_Step_Company_IndustryInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`行业`)
};

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
	if (locale === "en") return en_onboarding_step_company_industry(inputs)
	return zh_cn2_onboarding_step_company_industry(inputs)
});