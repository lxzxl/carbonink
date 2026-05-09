/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Dashboard_Inventory_TitleInputs */

const en_dashboard_inventory_title = /** @type {(inputs: Dashboard_Inventory_TitleInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Inventory Dashboard`)
};

const zh_cn2_dashboard_inventory_title = /** @type {(inputs: Dashboard_Inventory_TitleInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`排放清单仪表盘`)
};

/**
* | output |
* | --- |
* | "Inventory Dashboard" |
*
* @param {Dashboard_Inventory_TitleInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const dashboard_inventory_title = /** @type {((inputs?: Dashboard_Inventory_TitleInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Dashboard_Inventory_TitleInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return en_dashboard_inventory_title(inputs)
	return zh_cn2_dashboard_inventory_title(inputs)
});