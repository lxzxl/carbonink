/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Onboarding_Step_Ai_ByotInputs */

const en_onboarding_step_ai_byot = /** @type {(inputs: Onboarding_Step_Ai_ByotInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`I have an API key (configure in Settings after onboarding)`)
};

const zh_cn2_onboarding_step_ai_byot = /** @type {(inputs: Onboarding_Step_Ai_ByotInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`我有 API key（向导完成后到设置里填）`)
};

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
	if (locale === "en") return en_onboarding_step_ai_byot(inputs)
	return zh_cn2_onboarding_step_ai_byot(inputs)
});