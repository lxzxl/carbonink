/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Onboarding_Step_Site_TitleInputs */

const en_onboarding_step_site_title = /** @type {(inputs: Onboarding_Step_Site_TitleInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Add your first site`)
};

const zh_cn2_onboarding_step_site_title = /** @type {(inputs: Onboarding_Step_Site_TitleInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`添加第一个 Site`)
};

/**
* | output |
* | --- |
* | "Add your first site" |
*
* @param {Onboarding_Step_Site_TitleInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const onboarding_step_site_title = /** @type {((inputs?: Onboarding_Step_Site_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Onboarding_Step_Site_TitleInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return en_onboarding_step_site_title(inputs)
	return zh_cn2_onboarding_step_site_title(inputs)
});