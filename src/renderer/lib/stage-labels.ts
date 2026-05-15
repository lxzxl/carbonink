import * as m from '@renderer/paraglide/messages';

const LABEL_MAP: Record<string, string> = {
  'china_utility.v1': '电费账单',
  'fuel_receipt.v1': '加油发票',
  'freight.v1': '货运发票',
  'purchase.v1': '采购发票',
  'travel.v1': '差旅票据',
};

/**
 * Map a stage_id (or null) to a user-facing chip label.
 *
 * For Phase 2 v1 we keep the labels inline as zh-CN strings — most users
 * speak Chinese, the audit surface is the stage_id itself which is in the
 * DB, and adding 5 paraglide keys for chip labels is premature. The
 * "未分类" (null) case uses a paraglide key so it follows the same
 * locale as the rest of the document list.
 */
export function stageLabel(stageId: string | null | undefined): string {
  if (!stageId) return m.documents_status_unclassified();
  return LABEL_MAP[stageId] ?? stageId;
}
