/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Onboarding_Step_Boundary_BodyInputs */

const en_onboarding_step_boundary_body = /** @type {(inputs: Onboarding_Step_Boundary_BodyInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Per GHG Protocol Corporate Standard. Choose how you account for organizational boundaries.`)
};

const zh_cn2_onboarding_step_boundary_body = /** @type {(inputs: Onboarding_Step_Boundary_BodyInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`依据 GHG Protocol Corporate Standard，选择组织边界核算方式。`)
};

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
	if (locale === "en") return en_onboarding_step_boundary_body(inputs)
	return zh_cn2_onboarding_step_boundary_body(inputs)
});