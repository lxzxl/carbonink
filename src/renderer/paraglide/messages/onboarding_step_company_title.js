/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Onboarding_Step_Company_TitleInputs */

const en_onboarding_step_company_title = /** @type {(inputs: Onboarding_Step_Company_TitleInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Company info`)
};

const zh_cn2_onboarding_step_company_title = /** @type {(inputs: Onboarding_Step_Company_TitleInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`公司基本信息`)
};

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
	if (locale === "en") return en_onboarding_step_company_title(inputs)
	return zh_cn2_onboarding_step_company_title(inputs)
});