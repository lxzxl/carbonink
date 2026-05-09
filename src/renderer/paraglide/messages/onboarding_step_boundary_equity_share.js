/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Onboarding_Step_Boundary_Equity_ShareInputs */

const en_onboarding_step_boundary_equity_share = /** @type {(inputs: Onboarding_Step_Boundary_Equity_ShareInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Equity Share — emissions allocated by ownership share of joint ventures.`)
};

const zh_cn2_onboarding_step_boundary_equity_share = /** @type {(inputs: Onboarding_Step_Boundary_Equity_ShareInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`股权比例 — 按对合资公司持股比例分配排放。`)
};

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
	if (locale === "en") return en_onboarding_step_boundary_equity_share(inputs)
	return zh_cn2_onboarding_step_boundary_equity_share(inputs)
});