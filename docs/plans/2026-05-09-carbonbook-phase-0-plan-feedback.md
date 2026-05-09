# Carbonbook Phase 0 Plan Review Feedback

Review target: `docs/plans/2026-05-09-carbonbook-phase-0-foundation.md`

Spec source: `docs/specs/2026-05-08-carbonbook-design.md`

Review date: 2026-05-09

## Verdict

上一轮 4 个问题已修：空字符串归一化、Task 27 ABI 顺序、postinstall 文案、Task 15 测试数口径都已处理。

当前只剩 1 个会影响 `pnpm typecheck` 的问题。

## Findings

### P1 — `optionalString` 的显式返回类型仍是 Zod 3 写法，但 plan 没有 pin Zod 版本

Task 14 通过 `pnpm add zod` 安装未 pin 版本的 Zod：`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:1708`、`docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:1711`。但新增 helper 写了显式返回类型：

```ts
z.ZodType<string | undefined, z.ZodTypeDef, unknown>
```

见 `docs/plans/2026-05-09-carbonbook-phase-0-foundation.md:1727`。

这个类型形状是 Zod 3 时代的 `ZodType<Output, Def, Input>` 写法。Zod 4 已稳定，官方 migration guide 明确 `ZodType` 的 `Def extends z.ZodTypeDef` 泛型已移除，新的基类只跟踪 `Output` / `Input`。因此在 unpinned `pnpm add zod` 拉到 Zod 4 时，这段很可能在 Task 14 的 `pnpm typecheck` 失败。

建议修改：

- 最简单：删除 `optionalString` 的显式返回类型，让 `z.preprocess(...)` 自己推断。
- 或明确 pin `zod@3`，并在 plan 中说明使用 Zod 3 API。
- 或明确使用 Zod 4，并把 helper 类型改成 Zod 4 兼容写法，例如避免 `z.ZodTypeDef`。

推荐第一种，最少耦合：

```ts
export function optionalString(opts: { max: number }) {
  return z.preprocess(
    (val) => {
      if (val === null || val === undefined) return undefined;
      if (typeof val === 'string') {
        const trimmed = val.trim();
        return trimmed === '' ? undefined : trimmed;
      }
      return val;
    },
    z.string().min(1).max(opts.max).optional(),
  );
}
```

