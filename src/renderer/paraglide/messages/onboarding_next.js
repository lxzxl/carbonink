/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Onboarding_NextInputs */

const en_onboarding_next = /** @type {(inputs: Onboarding_NextInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Next`)
};

const zh_cn2_onboarding_next = /** @type {(inputs: Onboarding_NextInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`下一步`)
};

/**
* | output |
* | --- |
* | "Next" |
*
* @param {Onboarding_NextInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const onboarding_next = /** @type {((inputs?: Onboarding_NextInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Onboarding_NextInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return en_onboarding_next(inputs)
	return zh_cn2_onboarding_next(inputs)
});