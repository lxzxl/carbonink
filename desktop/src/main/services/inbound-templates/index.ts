import type { InboundTemplate, InboundTemplateKind } from '@shared/types';
import { CAT1_SUPPLIER_DISCLOSURE } from './cat1.js';

/**
 * Registry of built-in inbound questionnaire templates.
 *
 * v2.0 ships exactly one template (`cat1_supplier_disclosure`). The
 * registry layer is here so v2.x — Cat 4 (upstream transport),
 * Cat 5 (waste), Cat 6 (business travel for outsourced operations) — can
 * be added by:
 *
 *   1. Extending the `InboundTemplateKind` union in `@shared/types`.
 *   2. Adding the new template constant.
 *   3. Adding one case to the switch below.
 *
 * The exhaustiveness branch at the end is a TypeScript safety net: if
 * step 1 happens without steps 2-3, `tsc` reports "Type 'X' is not
 * assignable to type 'never'" on the assignment, surfacing the omission
 * at compile time instead of runtime.
 */
export function getInboundTemplate(kind: InboundTemplateKind): InboundTemplate {
  switch (kind) {
    case 'cat1_supplier_disclosure':
      return CAT1_SUPPLIER_DISCLOSURE;
    default: {
      const _exhaustive: never = kind;
      throw new Error(`Unknown inbound template kind: ${String(_exhaustive)}`);
    }
  }
}

export { CAT1_SUPPLIER_DISCLOSURE };
