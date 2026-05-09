/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Dashboard_Inventory_BodyInputs */

const en_dashboard_inventory_body = /** @type {(inputs: Dashboard_Inventory_BodyInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`No emission data yet.`)
};

const zh_cn2_dashboard_inventory_body = /** @type {(inputs: Dashboard_Inventory_BodyInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`目前没有排放数据。`)
};

/**
* | output |
* | --- |
* | "No emission data yet." |
*
* @param {Dashboard_Inventory_BodyInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const dashboard_inventory_body = /** @type {((inputs?: Dashboard_Inventory_BodyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Dashboard_Inventory_BodyInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return en_dashboard_inventory_body(inputs)
	return zh_cn2_dashboard_inventory_body(inputs)
});