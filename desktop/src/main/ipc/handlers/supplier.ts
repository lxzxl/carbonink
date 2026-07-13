import { z } from 'zod';
import type { IpcContext } from '../context.js';
import type { IpcTypeMap } from '../types.js';

const createInput = z.object({
  name: z.string().min(1),
  notes: z.string().optional(),
  // Loose shape on purpose: a malformed address just yields a dud mailto,
  // and hard-failing here would strand the reminder dialog. Length only.
  email: z.string().max(320).optional(),
});

const setEmailInput = z.object({
  id: z.string().min(1),
  email: z.string().max(320).nullable(),
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
      return ctx.customerService.createSupplier({
        name: parsed.name,
        ...(parsed.notes !== undefined ? { notes: parsed.notes } : {}),
        ...(parsed.email !== undefined ? { email: parsed.email } : {}),
      });
    },
    'supplier:set-email': async (input) => {
      const parsed = setEmailInput.parse(input);
      return ctx.customerService.setSupplierEmail(parsed.id, parsed.email);
    },
  };
}
