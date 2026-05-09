/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Dashboard_Welcome_BodyInputs */

const en_dashboard_welcome_body = /** @type {(inputs: Dashboard_Welcome_BodyInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`You haven't set up your organization yet. The onboarding wizard will guide you next.`)
};

const zh_cn2_dashboard_welcome_body = /** @type {(inputs: Dashboard_Welcome_BodyInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`你还没有设置组织。下一步引导向导会带你完成。`)
};

/**
* | output |
* | --- |
* | "You haven't set up your organization yet. The onboarding wizard will guide you next." |
*
* @param {Dashboard_Welcome_BodyInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const dashboard_welcome_body = /** @type {((inputs?: Dashboard_Welcome_BodyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Dashboard_Welcome_BodyInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return en_dashboard_welcome_body(inputs)
	return zh_cn2_dashboard_welcome_body(inputs)
});