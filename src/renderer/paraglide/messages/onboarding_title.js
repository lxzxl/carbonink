/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Onboarding_TitleInputs */

const en_onboarding_title = /** @type {(inputs: Onboarding_TitleInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Onboarding`)
};

const zh_cn2_onboarding_title = /** @type {(inputs: Onboarding_TitleInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`引导设置`)
};

/**
* | output |
* | --- |
* | "Onboarding" |
*
* @param {Onboarding_TitleInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const onboarding_title = /** @type {((inputs?: Onboarding_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Onboarding_TitleInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return en_onboarding_title(inputs)
	return zh_cn2_onboarding_title(inputs)
});