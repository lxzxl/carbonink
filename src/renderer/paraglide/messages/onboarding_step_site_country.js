/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Onboarding_Step_Site_CountryInputs */

const en_onboarding_step_site_country = /** @type {(inputs: Onboarding_Step_Site_CountryInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Country code`)
};

const zh_cn2_onboarding_step_site_country = /** @type {(inputs: Onboarding_Step_Site_CountryInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`国家代码`)
};

/**
* | output |
* | --- |
* | "Country code" |
*
* @param {Onboarding_Step_Site_CountryInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const onboarding_step_site_country = /** @type {((inputs?: Onboarding_Step_Site_CountryInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Onboarding_Step_Site_CountryInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return en_onboarding_step_site_country(inputs)
	return zh_cn2_onboarding_step_site_country(inputs)
});