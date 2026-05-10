import type { ServiceContext } from '@main/services/base.js';
import { OrganizationService } from '@main/services/organization-service.js';

export interface IpcContext {
  organizationService: OrganizationService;
}

export function createIpcContext(svc: ServiceContext): IpcContext {
  return {
    organizationService: new OrganizationService(svc),
  };
}
