import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  deleteCredentialBlob,
  getCredentialStore,
  isSafeStorageAvailable,
} from '@main/credentials/safe-storage-backend.js';
import { ExcelParser } from '@main/excel/parser.js';
import { LLMClient } from '@main/llm/llm-client.js';
import type { ReportNarrativeProvider } from '@main/llm/report-narrative.js';
import { ActivityDataService } from '@main/services/activity-data-service.js';
import type { AnswerR } from '@main/services/answer-generation/tags.js';
import { buildAnswerLayer } from '@main/services/answer-generation/tags.js';
import { AuditEventService } from '@main/services/audit-event-service.js';
import type { ServiceContext } from '@main/services/base.js';
import { CalculationService } from '@main/services/calculation-service.js';
import { ClassificationService } from '@main/services/classification-service.js';
import { CredentialService } from '@main/services/credential-service.js';
import { CustomerService } from '@main/services/customer-service.js';
import { DocumentService } from '@main/services/document-service.js';
import { EfMatcherService } from '@main/services/ef-matcher-service.js';
import { EfService } from '@main/services/ef-service.js';
import { EmissionSourceService } from '@main/services/emission-source-service.js';
import { ExtractionService } from '@main/services/extraction-service.js';
import { loadLicensePublicKey } from '@main/services/license-public-key.js';
import { LicenseService } from '@main/services/license-service.js';
import { OrganizationService } from '@main/services/organization-service.js';
import { QuestionnairePdfDataService } from '@main/services/questionnaire-pdf-data-service.js';
import { QuestionnaireService } from '@main/services/questionnaire-service.js';
import { ReportDataService } from '@main/services/report-data-service.js';
import { buildRoutingLayer, type RoutingR } from '@main/services/routing/tags.js';
import { SettingsService } from '@main/services/settings-service.js';
import { UndoManager } from '@main/services/undo-manager.js';
import { UnitConversionService } from '@main/services/unit-conversion-service.js';
import type { ProviderConfig } from '@shared/types.js';
import type { Layer } from 'effect';
import { app } from 'electron';
import type { ProgressEmitter } from './progress.js';
import type { IpcPushTypeMap } from './types.js';

/**
 * Service-layer container injected into every IPC handler factory. Wiring
 * lives here (not in `setup.ts`) so unit tests can construct an in-memory
 * context without touching the IpcListener.
 */
export interface IpcContext {
  // Raw db + clock from the service context. Most handlers go through
  // services and don't touch this, but undo-wrappers occasionally need
  // raw SQL access (the inverse of a service mutation isn't always
  // expressible as another service call — e.g. re-INSERT with the
  // original generated id rather than letting the service mint a new
  // one).
  db: ServiceContext['db'];
  now: ServiceContext['now'];
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
  // Phase 1c addition — LLM-assisted emission factor recommendation.
  efMatcherService: EfMatcherService;
  // Phase 1c Task 4 — auto-classify doc-type + run extraction.
  classificationService: ClassificationService;
  // Phase 2.2a — questionnaire upload + extract pipeline.
  customerService: CustomerService;
  questionnaireService: QuestionnaireService;
  // Phase 2.2b → Step 2 — answer generation via Effect Layer.
  answerLayer: Layer.Layer<AnswerR>;
  providerConfig: ProviderConfig | null;
  // Routing API — distance lookup via AMap or haversine.
  routingLayer: Layer.Layer<RoutingR>;
  // Phase 3 — report generation pipeline.
  reportDataService: import('@main/services/report-data-service').ReportDataService;
  llmNarrativeProvider: import('@main/llm/report-narrative').ReportNarrativeProvider;
  // Phase 3 sub-project 3 — audit event log viewer.
  auditEventService: AuditEventService;
  // Phase 3 sub-project 4 — questionnaire PDF export.
  questionnairePdfDataService: QuestionnairePdfDataService;
  // Phase 4 sub-project A — license JWT verify + state machine.
  licenseService: LicenseService;
  // Post-launch (spec 2026-05-25) — session-scoped undo/redo stack.
  undoManager: UndoManager;
  // URL for the print-render route (used by PDF export for hidden BrowserWindow).
  printRenderUrl: string;
  // Main→renderer push channel emitter, shared across all services.
  pushEvent: <C extends keyof IpcPushTypeMap>(channel: C, payload: IpcPushTypeMap[C]) => void;
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
   * Test override for LicenseService — handler / integration tests pass a
   * pre-built instance backed by an in-memory blob store + a test-only
   * keypair so they don't trip the all-zero placeholder guard in
   * `license-public-key.ts`.
   */
  licenseService?: LicenseService;
  efMatcherService?: EfMatcherService;
  classificationService?: ClassificationService;
  customerService?: CustomerService;
  questionnaireService?: QuestionnaireService;
  /**
   * Optional main→renderer push channel emitter. Production wires
   * `createProgressEmitter(getMainWindow)`; tests typically supply a
   * `vi.fn()` so they can assert on emitted events without needing
   * a real Electron BrowserWindow.
   */
  progressEmitter?: ProgressEmitter;
  /**
   * URL for the print-render route. In production, derived from the main
   * renderer URL + `/print-render`; tests can override.
   */
  printRenderUrl?: string;
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
    unitConversionService,
  });

  // Memoized lazy slots so the first getter call triggers construction once
  // and subsequent accesses return the same instance.
  let credentialServiceInstance: CredentialService | undefined = overrides.credentialService;
  let llmClientInstance: LLMClient | undefined = overrides.llmClient;
  let settingsServiceInstance: SettingsService | undefined;
  let documentServiceInstance: DocumentService | undefined = overrides.documentService;
  let extractionServiceInstance: ExtractionService | undefined = overrides.extractionService;
  let efMatcherServiceInstance: EfMatcherService | undefined = overrides.efMatcherService;
  let classificationServiceInstance: ClassificationService | undefined =
    overrides.classificationService;
  let customerServiceInstance: CustomerService | undefined = overrides.customerService;
  let questionnaireServiceInstance: QuestionnaireService | undefined =
    overrides.questionnaireService;
  let answerLayerInstance: Layer.Layer<AnswerR> | undefined;
  let routingLayerInstance: Layer.Layer<RoutingR> | undefined;
  let reportDataServiceInstance: ReportDataService | undefined;
  let llmNarrativeProviderInstance: ReportNarrativeProvider | undefined;
  let licenseServiceInstance: LicenseService | undefined = overrides.licenseService;

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
    db: svc.db,
    now: svc.now,
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
    get efMatcherService() {
      if (!efMatcherServiceInstance) {
        const providerCfg = getSettings().getProviderConfigWithKey();
        if (!providerCfg) {
          throw new Error('AI provider not configured. Open Settings to set up.');
        }
        efMatcherServiceInstance = new EfMatcherService({
          db: svc.db,
          efService,
          extractionService: {
            get: (id: string) => ctx.extractionService.getById(id),
          },
          emissionSourceService: {
            get: (id: string) => emissionSourceService.getById(id),
          },
          llmClient: getLlm(),
          config: providerCfg.config,
        });
      }
      return efMatcherServiceInstance;
    },
    get classificationService() {
      if (!classificationServiceInstance) {
        const providerCfg = getSettings().getProviderConfigWithKey();
        if (!providerCfg) {
          throw new Error('AI provider not configured. Open Settings to set up.');
        }
        classificationServiceInstance = new ClassificationService({
          db: svc.db,
          llmClient: getLlm(),
          extractionService: ctx.extractionService,
          documentService: getDocument(),
          config: providerCfg.config,
          readFile: (p: string) => readFileSync(p),
          parsePdf: async (buf: Buffer) => {
            const mod = await import('pdf-parse');
            const parser = new mod.PDFParse({ data: buf });
            try {
              const result = await parser.getText();
              return { text: result.text };
            } finally {
              await parser.destroy();
            }
          },
        });
      }
      return classificationServiceInstance;
    },
    get customerService() {
      if (!customerServiceInstance) {
        customerServiceInstance = new CustomerService({ db: svc.db });
      }
      return customerServiceInstance;
    },
    get questionnaireService() {
      if (!questionnaireServiceInstance) {
        const providerCfg = getSettings().getProviderConfigWithKey();
        if (!providerCfg) {
          throw new Error('AI provider not configured. Open Settings to set up.');
        }
        questionnaireServiceInstance = new QuestionnaireService({
          db: svc.db,
          documentService: getDocument(),
          customerService: ctx.customerService,
          llmClient: getLlm(),
          config: providerCfg.config,
          excelParse: ExcelParser.parse,
        });
      }
      return questionnaireServiceInstance;
    },
    get answerLayer() {
      if (!answerLayerInstance) {
        answerLayerInstance = buildAnswerLayer({
          db: svc.db,
          llmClient: getLlm(),
          orgService: ctx.organizationService,
          activityDataService,
        });
      }
      return answerLayerInstance;
    },
    get routingLayer() {
      if (!routingLayerInstance) {
        const amapKey = getSettings().getAmapKey() ?? '';
        routingLayerInstance = buildRoutingLayer({ db: svc.db, amapKey });
      }
      return routingLayerInstance;
    },
    get providerConfig() {
      const providerCfg = getSettings().getProviderConfigWithKey();
      return providerCfg ? providerCfg.config : null;
    },
    get reportDataService() {
      if (!reportDataServiceInstance) {
        reportDataServiceInstance = new ReportDataService({ db: svc.db });
      }
      return reportDataServiceInstance;
    },
    get llmNarrativeProvider() {
      if (!llmNarrativeProviderInstance) {
        const llm = getLlm();
        const providerCfg = getSettings().getProviderConfigWithKey();
        if (!providerCfg) {
          throw new Error('AI provider not configured. Open Settings to set up.');
        }
        llmNarrativeProviderInstance = {
          streamObject: ({ schema, system, user, abortSignal }) =>
            llm.streamObject(providerCfg.config, schema, system, user, abortSignal),
        };
      }
      return llmNarrativeProviderInstance;
    },
    auditEventService: new AuditEventService({ db: svc.db }),
    questionnairePdfDataService: new QuestionnairePdfDataService({ db: svc.db }),
    get licenseService() {
      if (!licenseServiceInstance) {
        // Lazy: defer the public-key load + CredentialStore singleton
        // wakeup until something actually touches the license channel.
        // Production: real safeStorage + filesystem blob deletion.
        // Tests that need the service pass `overrides.licenseService`
        // (see `tests/main/ipc/license-handlers.test.ts` pattern).
        licenseServiceInstance = new LicenseService({
          db: svc.db,
          now: svc.now,
          nowSeconds: () => Math.floor(Date.parse(svc.now()) / 1000),
          publicKey: loadLicensePublicKey(),
          credentialStore: getCredentialStore(),
          deleteBlob: deleteCredentialBlob,
        });
      }
      return licenseServiceInstance;
    },
    printRenderUrl:
      overrides.printRenderUrl ??
      `${process.env.ELECTRON_RENDERER_URL || 'about:blank'}/print-render`,
    // Fresh undo manager per IPC context — session-scoped per design.
    // Tests get an empty manager too; they can populate it via the
    // service-exposed `push()` if they need to exercise inverse flow.
    undoManager: new UndoManager(),
    pushEvent: <C extends keyof IpcPushTypeMap>(channel: C, payload: IpcPushTypeMap[C]) => {
      // Use the progressEmitter if available; tests can inject a vi.fn()
      return;
    },
  };

  // Inject the progressEmitter as pushEvent if provided
  if (overrides.progressEmitter) {
    const emitter = overrides.progressEmitter;
    ctx.pushEvent = <C extends keyof IpcPushTypeMap>(channel: C, payload: IpcPushTypeMap[C]) => {
      emitter(channel, payload);
    };
  }

  return ctx;
}
