import { z } from 'zod';
import type { IpcContext } from '../context.js';
import type { IpcTypeMap } from '../types.js';

const createInput = z.object({
  name: z.string().min(1),
  notes: z.string().optional(),
});

/**
 * Supplier CRUD over the `customer` table (role='supplier'). Mirrors the
 * customer-side surface but with role isolation enforced at the service
 * layer — `customerService.listSuppliers()` only returns rows where
 * role='supplier', and `createSupplier()` always writes role='supplier'.
 *
 * Why two separate channel namespaces instead of one polymorphic
 * `counterparty:*`: outbound + inbound have semantically different intent
 * (a customer is the entity sending us a form; a supplier is the entity
 * we're sending a form to) and the v2.0 renderer wants to type-narrow
 * on the role at the call site without runtime checks.
 */
export function supplierHandlers(ctx: IpcContext): {
  [K in keyof IpcTypeMap]?: IpcTypeMap[K];
} {
  return {
    'supplier:list': async () => ctx.customerService.listSuppliers(),
    'supplier:create': async (input) => {
      const parsed = createInput.parse(input);
      return ctx.customerService.createSupplier(
        parsed.notes !== undefined
          ? { name: parsed.name, notes: parsed.notes }
          : { name: parsed.name },
      );
    },
  };
}
