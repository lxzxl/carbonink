/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Onboarding_Step_Company_Name_ZhInputs */

const en_onboarding_step_company_name_zh = /** @type {(inputs: Onboarding_Step_Company_Name_ZhInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Chinese name`)
};

const zh_cn2_onboarding_step_company_name_zh = /** @type {(inputs: Onboarding_Step_Company_Name_ZhInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`中文名`)
};

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
	if (locale === "en") return en_onboarding_step_company_name_zh(inputs)
	return zh_cn2_onboarding_step_company_name_zh(inputs)
});