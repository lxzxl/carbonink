/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Dashboard_Welcome_TitleInputs */

const en_dashboard_welcome_title = /** @type {(inputs: Dashboard_Welcome_TitleInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Welcome to carbonbook`)
};

const zh_cn2_dashboard_welcome_title = /** @type {(inputs: Dashboard_Welcome_TitleInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`欢迎使用 carbonbook`)
};

/**
* | output |
* | --- |
* | "Welcome to carbonbook" |
*
* @param {Dashboard_Welcome_TitleInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const dashboard_welcome_title = /** @type {((inputs?: Dashboard_Welcome_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Dashboard_Welcome_TitleInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return en_dashboard_welcome_title(inputs)
	return zh_cn2_dashboard_welcome_title(inputs)
});