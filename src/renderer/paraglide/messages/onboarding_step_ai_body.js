/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Onboarding_Step_Ai_BodyInputs */

const en_onboarding_step_ai_body = /** @type {(inputs: Onboarding_Step_Ai_BodyInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`carbonbook needs an AI provider to parse documents and answer questionnaires. You can configure this later in Settings; skipping is fine for now.`)
};

const zh_cn2_onboarding_step_ai_body = /** @type {(inputs: Onboarding_Step_Ai_BodyInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`carbonbook 需要 AI 提供方解析文档和回答问卷。可以稍后在设置里配置；现在跳过也可以。`)
};

/**
* | output |
* | --- |
* | "carbonbook needs an AI provider to parse documents and answer questionnaires. You can configure this later in Settings; skipping is fine for now." |
*
* @param {Onboarding_Step_Ai_BodyInputs} inputs
* @param {{ locale?: "en" | "zh-CN" }} options
* @returns {LocalizedString}
*/
export const onboarding_step_ai_body = /** @type {((inputs?: Onboarding_Step_Ai_BodyInputs, options?: { locale?: "en" | "zh-CN" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Onboarding_Step_Ai_BodyInputs, { locale?: "en" | "zh-CN" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "en") return en_onboarding_step_ai_body(inputs)
	return zh_cn2_onboarding_step_ai_body(inputs)
});