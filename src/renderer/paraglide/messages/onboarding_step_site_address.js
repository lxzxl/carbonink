/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Onboarding_Step_Site_AddressInputs */

const en_onboarding_step_site_address = /** @type {(inputs: Onboarding_Step_Site_AddressInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Address`)
};

const zh_cn2_onboarding_step_site_address = /** @type {(inputs: Onboarding_Step_Site_AddressInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`地址`)
};

/**
* | output |
* | --- |
* | "Address" |
*
* @param {Onboarding_Step_Site_AddressInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const onboarding_step_site_address = /** @type {((inputs?: Onboarding_Step_Site_AddressInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Onboarding_Step_Site_AddressInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return en_onboarding_step_site_address(inputs)
	return zh_cn2_onboarding_step_site_address(inputs)
});