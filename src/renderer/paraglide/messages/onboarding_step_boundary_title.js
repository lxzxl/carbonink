/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Onboarding_Step_Boundary_TitleInputs */

const en_onboarding_step_boundary_title = /** @type {(inputs: Onboarding_Step_Boundary_TitleInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Organizational boundary`)
};

const zh_cn2_onboarding_step_boundary_title = /** @type {(inputs: Onboarding_Step_Boundary_TitleInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`组织边界`)
};

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
	if (locale === "en") return en_onboarding_step_boundary_title(inputs)
	return zh_cn2_onboarding_step_boundary_title(inputs)
});