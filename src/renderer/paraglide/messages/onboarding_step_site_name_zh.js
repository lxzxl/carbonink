/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Onboarding_Step_Site_Name_ZhInputs */

const en_onboarding_step_site_name_zh = /** @type {(inputs: Onboarding_Step_Site_Name_ZhInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Site name (中文)`)
};

const zh_cn2_onboarding_step_site_name_zh = /** @type {(inputs: Onboarding_Step_Site_Name_ZhInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Site 名称（中文）`)
};

/**
* | output |
* | --- |
* | "Site name (中文)" |
*
* @param {Onboarding_Step_Site_Name_ZhInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const onboarding_step_site_name_zh = /** @type {((inputs?: Onboarding_Step_Site_Name_ZhInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Onboarding_Step_Site_Name_ZhInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return en_onboarding_step_site_name_zh(inputs)
	return zh_cn2_onboarding_step_site_name_zh(inputs)
});