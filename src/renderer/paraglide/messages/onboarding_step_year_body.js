/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Onboarding_Step_Year_BodyInputs */

const en_onboarding_step_year_body = /** @type {(inputs: Onboarding_Step_Year_BodyInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Default is the current year. Select the fiscal year you'll be calculating emissions for.`)
};

const zh_cn2_onboarding_step_year_body = /** @type {(inputs: Onboarding_Step_Year_BodyInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`默认本年。选择你要核算排放的财年。`)
};

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
	if (locale === "en") return en_onboarding_step_year_body(inputs)
	return zh_cn2_onboarding_step_year_body(inputs)
});