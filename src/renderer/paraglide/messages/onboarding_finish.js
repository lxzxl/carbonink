/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Onboarding_FinishInputs */

const en_onboarding_finish = /** @type {(inputs: Onboarding_FinishInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Finish`)
};

const zh_cn2_onboarding_finish = /** @type {(inputs: Onboarding_FinishInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`完成`)
};

/**
* | output |
* | --- |
* | "Finish" |
*
* @param {Onboarding_FinishInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const onboarding_finish = /** @type {((inputs?: Onboarding_FinishInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Onboarding_FinishInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return en_onboarding_finish(inputs)
	return zh_cn2_onboarding_finish(inputs)
});