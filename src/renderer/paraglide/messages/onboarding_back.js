/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Onboarding_BackInputs */

const en_onboarding_back = /** @type {(inputs: Onboarding_BackInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Back`)
};

const zh_cn2_onboarding_back = /** @type {(inputs: Onboarding_BackInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`返回`)
};

/**
* | output |
* | --- |
* | "Back" |
*
* @param {Onboarding_BackInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const onboarding_back = /** @type {((inputs?: Onboarding_BackInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Onboarding_BackInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return en_onboarding_back(inputs)
	return zh_cn2_onboarding_back(inputs)
});