import { join } from 'node:path';
import {
  deleteCredentialBlob,
  getCredentialStore,
  isSafeStorageAvailable,
} from '@main/credentials/safe-storage-backend.js';
import { LLMClient } from '@main/llm/llm-client.js';
import { ActivityDataService } from '@main/services/activity-data-service.js';
import type { ServiceContext } from '@main/services/base.js';
import { CalculationService } from '@main/services/calculation-service.js';
import { CredentialService } from '@main/services/credential-service.js';
import { DocumentService } from '@main/services/document-service.js';
import { EfService } from '@main/services/ef-service.js';
import { EmissionSourceService } from '@main/services/emission-source-service.js';
import { ExtractionService } from '@main/services/extraction-service.js';
import { OrganizationService } from '@main/services/organization-service.js';
import { SettingsService } from '@main/services/settings-service.js';
import { UnitConversionService } from '@main/services/unit-conversion-service.js';
import { app } from 'electron';
import type { ProgressEmitter } from './progress.js';

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
  // Phase 1b additions — credentialService is the keychain wrapper,
  // settingsService is the sqlite-backed provider config store, llmClient
  // is the AI SDK adapter, documentService owns content-addressed file
  // storage + `document` rows, and extractionService orchestrates the
  // PDF → LLM → `extraction` row pipeline.
  credentialService: CredentialService;
  settingsService: SettingsService;
  llmClient: LLMClient;
  documentService: DocumentService;
  extractionService: ExtractionService;
}

/**
 * Optional dependency overrides for `createIpcContext`. Tests pass fakes for
 * credential/LLM-related services so they don't have to spin up Electron's
 * `safeStorage` or hit live AI provider endpoints. Production code calls
 * `createIpcContext({ db, now })` and gets the real singletons.
 */
export interface IpcContextOverrides {
  credentialService?: CredentialService;
  llmClient?: LLMClient;
  /**
   * Test override for the uploads directory used by DocumentService. In
   * production this resolves to `app.getPath('userData') + '/uploads'`; tests
   * supply a `mkdtempSync` path so they don't write into the user's real
   * Application Support directory.
   */
  uploadsDir?: string;
  documentService?: DocumentService;
  extractionService?: ExtractionService;
  /**
   * Optional main→renderer push channel emitter. Production wires
   * `createProgressEmitter(getMainWindow)`; tests typically supply a
   * `vi.fn()` so they can assert on emitted events without needing
   * a real Electron BrowserWindow.
   */
  progressEmitter?: ProgressEmitter;
}

/**
 * Lazy factory for the production CredentialService. Wrapped in a function so
 * existing IPC tests (which only exercise non-settings handlers via
 * `createIpcContext` without overrides) don't trip Electron's `app.getPath`
 * at import time — `getCredentialStore` is only resolved on first access via
 * the getter below.
 */
function defaultCredentialService(): CredentialService {
  return new CredentialService({
    store: getCredentialStore(),
    deleteBlob: deleteCredentialBlob,
    isAvailable: isSafeStorageAvailable,
  });
}

/**
 * Builds the full service graph. ActivityDataService composes EfService +
 * CalculationService; CalculationService composes UnitConversionService — all
 * three share the same `db` handle (no double-open).
 *
 * SettingsService depends on CredentialService; LLMClient also depends on
 * CredentialService — they share one instance so the keychain isn't opened
 * twice. In tests, `overrides` lets callers swap either for a fake.
 *
 * `credentialService` / `llmClient` / `settingsService` are exposed via
 * lazy getters: legacy IPC tests that only need DB-backed services don't
 * touch them, so the Electron `safeStorage` lookup never runs in those
 * test paths. Production accesses always go through the getter and pay a
 * one-time construction cost.
 */
export function createIpcContext(
  svc: ServiceContext,
  overrides: IpcContextOverrides = {},
): IpcContext {
  const unitConversionService = new UnitConversionService(svc);
  const efService = new EfService(svc);
  const calculationService = new CalculationService({ unitConversion: unitConversionService });
  const emissionSourceService = new EmissionSourceService(svc);
  const activityDataService = new ActivityDataService({
    ...svc,
    efService,
    calculationService,
  });

  // Memoized lazy slots so the first getter call triggers construction once
  // and subsequent accesses return the same instance.
  let credentialServiceInstance: CredentialService | undefined = overrides.credentialService;
  let llmClientInstance: LLMClient | undefined = overrides.llmClient;
  let settingsServiceInstance: SettingsService | undefined;
  let documentServiceInstance: DocumentService | undefined = overrides.documentService;
  let extractionServiceInstance: ExtractionService | undefined = overrides.extractionService;

  const getCredential = (): CredentialService => {
    if (!credentialServiceInstance) credentialServiceInstance = defaultCredentialService();
    return credentialServiceInstance;
  };
  const getSettings = (): SettingsService => {
    if (!settingsServiceInstance) {
      settingsServiceInstance = new SettingsService({ ...svc, credentials: getCredential() });
    }
    return settingsServiceInstance;
  };
  const getLlm = (): LLMClient => {
    if (!llmClientInstance) {
      llmClientInstance = new LLMClient({ credentials: getCredential() });
    }
    return llmClientInstance;
  };
  const getDocument = (): DocumentService => {
    if (!documentServiceInstance) {
      // Resolve uploads dir lazily — `app.getPath` errors before Electron is
      // ready, and tests typically supply an explicit `uploadsDir` override
      // (or inject a pre-built DocumentService) so we never hit this branch.
      const uploadsDir = overrides.uploadsDir ?? join(app.getPath('userData'), 'uploads');
      documentServiceInstance = new DocumentService({ ...svc, uploadsDir });
    }
    return documentServiceInstance;
  };

  const ctx: IpcContext = {
    organizationService: new OrganizationService(svc),
    emissionSourceService,
    activityDataService,
    efService,
    unitConversionService,
    calculationService,
    get credentialService() {
      return getCredential();
    },
    get llmClient() {
      return getLlm();
    },
    get settingsService() {
      return getSettings();
    },
    get documentService() {
      return getDocument();
    },
    get extractionService() {
      if (!extractionServiceInstance) {
        extractionServiceInstance = new ExtractionService({
          ...svc,
          documentService: getDocument(),
          settingsService: getSettings(),
          llmClient: getLlm(),
          ...(overrides.progressEmitter && { emitProgress: overrides.progressEmitter }),
        });
      }
      return extractionServiceInstance;
    },
  };
  return ctx;
}
