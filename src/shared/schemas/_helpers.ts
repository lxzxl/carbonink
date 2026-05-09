import { z } from 'zod';

/**
 * Optional string field that:
 *   1. Treats '', '   ', null as undefined (用户没填等同于不填)
 *   2. Then applies length constraints if a real value remains
 *
 * 解决 wizard 表单的常见 pitfall：text input 默认值是 ''，原样传给
 * z.string().min(1).optional() 会报"too small"——因为 `''` 不是 `undefined`。
 *
 * 显式返回类型故意省略：Zod 4 移除了 ZodType 的 ZodTypeDef 泛型，
 * 让 z.preprocess(...) 直接推断更稳，跨 Zod 3/4 都可用。
 */
export function optionalString(opts: { max: number }) {
  return z.preprocess((val) => {
    if (val === null || val === undefined) return undefined;
    if (typeof val === 'string') {
      const trimmed = val.trim();
      return trimmed === '' ? undefined : trimmed;
    }
    return val;
  }, z.string().min(1).max(opts.max).optional());
}
