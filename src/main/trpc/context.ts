import type { ServiceContext } from '@main/services/base.js';
import { OrganizationService } from '@main/services/organization-service.js';

export interface TrpcContext {
  organizationService: OrganizationService;
}

export function createTrpcContext(svc: ServiceContext): TrpcContext {
  return {
    organizationService: new OrganizationService(svc),
  };
}
