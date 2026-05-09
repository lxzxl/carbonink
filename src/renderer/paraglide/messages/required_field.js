/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Required_FieldInputs */

const en_required_field = /** @type {(inputs: Required_FieldInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Required`)
};

const zh_cn2_required_field = /** @type {(inputs: Required_FieldInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`必填`)
};

/**
* | output |
* | --- |
* | "Required" |
*
* @param {Required_FieldInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const required_field = /** @type {((inputs?: Required_FieldInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Required_FieldInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return en_required_field(inputs)
	return zh_cn2_required_field(inputs)
});