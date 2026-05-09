/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Onboarding_Step_Boundary_Operational_ControlInputs */

const en_onboarding_step_boundary_operational_control = /** @type {(inputs: Onboarding_Step_Boundary_Operational_ControlInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Operational Control — emissions from facilities you operate, regardless of ownership.`)
};

const zh_cn2_onboarding_step_boundary_operational_control = /** @type {(inputs: Onboarding_Step_Boundary_Operational_ControlInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`经营控制 — 算自己运营的设施排放，无论是否持股。多数小厂适用。`)
};

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
	if (locale === "en") return en_onboarding_step_boundary_operational_control(inputs)
	return zh_cn2_onboarding_step_boundary_operational_control(inputs)
});