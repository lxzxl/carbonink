import { ActivityDataService } from '@main/services/activity-data-service.js';
import type { ServiceContext } from '@main/services/base.js';
import { CalculationService } from '@main/services/calculation-service.js';
import { EfService } from '@main/services/ef-service.js';
import { EmissionSourceService } from '@main/services/emission-source-service.js';
import { OrganizationService } from '@main/services/organization-service.js';
import { UnitConversionService } from '@main/services/unit-conversion-service.js';

/**
 * Service-layer container injected into every IPC handler factory. Wiring
 * lives here (not in `setup.ts`) so unit tests can construct an in-memory
 * context without touching the IpcListener.
 */
export interface IpcContext {
  organizationService: OrganizationService;
  emissionSourceService: EmissionSourceService;
  activityDataService: ActivityDataService;
  efService: EfService;
  unitConversionService: UnitConversionService;
  calculationService: CalculationService;
}

/**
 * Builds the full service graph. ActivityDataService composes EfService +
 * CalculationService; CalculationService composes UnitConversionService — all
 * three share the same `db` handle (no double-open).
 */
export function createIpcContext(svc: ServiceContext): IpcContext {
  const unitConversionService = new UnitConversionService(svc);
  const efService = new EfService(svc);
  const calculationService = new CalculationService({ unitConversion: unitConversionService });
  const emissionSourceService = new EmissionSourceService(svc);
  const activityDataService = new ActivityDataService({
    ...svc,
    efService,
    calculationService,
  });
  return {
    organizationService: new OrganizationService(svc),
    emissionSourceService,
    activityDataService,
    efService,
    unitConversionService,
    calculationService,
  };
}
