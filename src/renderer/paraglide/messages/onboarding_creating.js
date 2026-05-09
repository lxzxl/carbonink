/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Onboarding_CreatingInputs */

const en_onboarding_creating = /** @type {(inputs: Onboarding_CreatingInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Creating organization…`)
};

const zh_cn2_onboarding_creating = /** @type {(inputs: Onboarding_CreatingInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`正在创建组织…`)
};

/**
* | output |
* | --- |
* | "Creating organization…" |
*
* @param {Onboarding_CreatingInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const onboarding_creating = /** @type {((inputs?: Onboarding_CreatingInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Onboarding_CreatingInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return en_onboarding_creating(inputs)
	return zh_cn2_onboarding_creating(inputs)
});