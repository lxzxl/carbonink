/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Onboarding_Step_Site_BodyInputs */

const en_onboarding_step_site_body = /** @type {(inputs: Onboarding_Step_Site_BodyInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`A site is a physical location (factory, office, warehouse). You'll add more later.`)
};

const zh_cn2_onboarding_step_site_body = /** @type {(inputs: Onboarding_Step_Site_BodyInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Site 是物理地点（工厂、办公楼、仓库）。后面可以加更多。`)
};

/**
* | output |
* | --- |
* | "A site is a physical location (factory, office, warehouse). You'll add more later." |
*
* @param {Onboarding_Step_Site_BodyInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const onboarding_step_site_body = /** @type {((inputs?: Onboarding_Step_Site_BodyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Onboarding_Step_Site_BodyInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return en_onboarding_step_site_body(inputs)
	return zh_cn2_onboarding_step_site_body(inputs)
});