import { invoke } from '../ipc.js';

/**
 * Renderer-side wrappers for supplier (counterparty role='supplier') CRUD.
 * Distinct from `customerApi` because the role isolation is enforced
 * server-side; conflating them in one renderer module would obscure that.
 */
export const supplierApi = {
  list: () => invoke('supplier:list'),
  create: (input: { name: string; notes?: string; email?: string }) =>
    invoke('supplier:create', input),
  setEmail: (input: { id: string; email: string | null }) => invoke('supplier:set-email', input),
};
