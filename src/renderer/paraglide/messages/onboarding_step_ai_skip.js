/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Onboarding_Step_Ai_SkipInputs */

const en_onboarding_step_ai_skip = /** @type {(inputs: Onboarding_Step_Ai_SkipInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Skip for now (configure later in Settings)`)
};

const zh_cn2_onboarding_step_ai_skip = /** @type {(inputs: Onboarding_Step_Ai_SkipInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`稍后在设置里配置`)
};

/**
* | output |
* | --- |
* | "Skip for now (configure later in Settings)" |
*
* @param {Onboarding_Step_Ai_SkipInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const onboarding_step_ai_skip = /** @type {((inputs?: Onboarding_Step_Ai_SkipInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Onboarding_Step_Ai_SkipInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return en_onboarding_step_ai_skip(inputs)
	return zh_cn2_onboarding_step_ai_skip(inputs)
});