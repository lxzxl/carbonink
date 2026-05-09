import { z } from 'zod';

// DB CHECK 允许 annual / quarterly / monthly，但 v1 service / API 只暴露 annual。
// quarterly / monthly 等 Phase 1+ 实现 date range 计算时再开放。
export const granularityDbEnum = z.enum(['annual', 'quarterly', 'monthly']);
export const granularityV1Enum = z.literal('annual');

export const reportingPeriodCreateInput = z.object({
  organization_id: z.string(),
  year: z.number().int().min(2020).max(2030),
  granularity: granularityV1Enum, // v1 仅 'annual'，避免 API contract 比 service 实现宽
});

export const reportingPeriod = z.object({
  id: z.string(),
  organization_id: z.string(),
  year: z.number().int(),
  granularity: granularityDbEnum, // 读出来时仍可能是 quarterly/monthly（DB CHECK 允许；只是 v1 不会写入）
  starts_at: z.string(),
  ends_at: z.string(),
  is_active: z.number(),
  created_at: z.string(),
});

export type ReportingPeriod = z.infer<typeof reportingPeriod>;
export type ReportingPeriodCreateInput = z.infer<typeof reportingPeriodCreateInput>;
