import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  deleteCredentialBlob,
  getCredentialStore,
  isSafeStorageAvailable,
} from '@main/credentials/safe-storage-backend.js';
import { ExcelParser } from '@main/excel/parser.js';
import { buildAiAgentLayer } from '@main/llm/ai-agent.js';
import { buildAiClientLayer } from '@main/llm/ai-client.js';
import { ActivityDataService } from '@main/services/activity-data-service.js';
import { AgentSkillService, type SkillResolver } from '@main/services/agent-skill-service.js';
import type { AnswerR } from '@main/services/answer-generation/tags.js';
import { AnswerToolsTag, buildAnswerLayer } from '@main/services/answer-generation/tags.js';
import { buildAnswerTools } from '@main/services/answer-generation/tools.js';
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
import { InboundQuestionnaireService } from '@main/services/inbound-questionnaire-service.js';
import { loadLicensePublicKey } from '@main/services/license-public-key.js';
import { LicenseService } from '@main/services/license-service.js';
import {
  McpIntegrationService,
  type PathResolver,
} from '@main/services/mcp-integration-service.js';
import { OrganizationService } from '@main/services/organization-service.js';
import { QuestionnairePdfDataService } from '@main/services/questionnaire-pdf-data-service.js';
import { QuestionnaireService } from '@main/services/questionnaire-service.js';
import { ReportDataService } from '@main/services/report-data-service.js';
import { buildRoutingLayer, type RoutingR } from '@main/services/routing/tags.js';
import { SettingsService } from '@main/services/settings-service.js';
import { UndoManager } from '@main/services/undo-manager.js';
import { UnitConversionService } from '@main/services/unit-conversion-service.js';
import type { ProviderConfigV2 } from '@shared/types.js';
import { Layer } from 'effect';
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
  // settingsService is the sqlite-backed provider config store,
  // documentService owns content-addressed file storage + `document`
  // rows, and extractionService orchestrates the PDF → LLM →
  // `extraction` row pipeline. (The old `llmClient` field was retired
  // when every consumer moved to AiClient — see `@main/llm/ai-client.ts`
  // for the Effect-shaped service + `buildAiClientLayer` factory.)
  credentialService: CredentialService;
  settingsService: SettingsService;
  documentService: DocumentService;
  extractionService: ExtractionService;
  // Phase 1c addition — LLM-assisted emission factor recommendation.
  efMatcherService: EfMatcherService;
  // Phase 1c Task 4 — auto-classify doc-type + run extraction.
  classificationService: ClassificationService;
  // Phase 2.2a — questionnaire upload + extract pipeline.
  customerService: CustomerService;
  questionnaireService: QuestionnaireService;
  // Phase 2.3 — inbound supplier-disclosure questionnaire pipeline.
  inboundQuestionnaireService: InboundQuestionnaireService;
  // Phase 2.2b → Step 2 — answer generation via Effect Layer.
  answerLayer: Layer.Layer<AnswerR>;
  providerConfig: ProviderConfigV2 | null;
  // Routing API — distance lookup via AMap or haversine.
  routingLayer: Layer.Layer<RoutingR>;
  // Phase 3 — report generation pipeline.
  reportDataService: import('@main/services/report-data-service').ReportDataService;
  // Phase 3 sub-project 3 — audit event log viewer.
  auditEventService: AuditEventService;
  // Phase 3 sub-project 4 — questionnaire PDF export.
  questionnairePdfDataService: QuestionnairePdfDataService;
  // Phase 4 sub-project A — license JWT verify + state machine.
  licenseService: LicenseService;
  // MCP integration — detect / configure / remove MCP clients (Claude
  // Desktop, Claude Code, Cursor, Pi). Owns the file mutations on the
  // user's other-app configs and the carbonink server-entry shape.
  mcpIntegrationService: McpIntegrationService;
  // Agent skill installer (v1.1) — manages the bundled SKILL.md under
  // `~/.agents/skills/carbonink-mcp/` plus per-host symlinks (claude-code,
  // codex, pi). Pairs with the renderer's Settings → Integrations step 1.
  agentSkillService: AgentSkillService;
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
  inboundQuestionnaireService?: InboundQuestionnaireService;
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
 * SettingsService depends on CredentialService — they share one instance so
 * the keychain isn't opened twice. In tests, `overrides` lets callers swap
 * either for a fake.
 *
 * `credentialService` / `settingsService` are exposed via lazy getters:
 * legacy IPC tests that only need DB-backed services don't touch them, so
 * the Electron `safeStorage` lookup never runs in those test paths.
 * Production accesses always go through the getter and pay a one-time
 * construction cost.
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
  let settingsServiceInstance: SettingsService | undefined;
  let documentServiceInstance: DocumentService | undefined = overrides.documentService;
  let extractionServiceInstance: ExtractionService | undefined = overrides.extractionService;
  let efMatcherServiceInstance: EfMatcherService | undefined = overrides.efMatcherService;
  let classificationServiceInstance: ClassificationService | undefined =
    overrides.classificationService;
  let customerServiceInstance: CustomerService | undefined = overrides.customerService;
  let inboundQuestionnaireServiceInstance: InboundQuestionnaireService | undefined =
    overrides.inboundQuestionnaireService;
  let questionnaireServiceInstance: QuestionnaireService | undefined =
    overrides.questionnaireService;
  let answerLayerInstance: Layer.Layer<AnswerR> | undefined;
  let routingLayerInstance: Layer.Layer<RoutingR> | undefined;
  let reportDataServiceInstance: ReportDataService | undefined;
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

  // MCP integration service — wired eagerly because the renderer's
  // Integrations sub-page polls `mcp:detect` on mount. Path resolver
  // mirrors the old `resolveBinaryPath` in handlers/mcp.ts (now
  // deleted): in production, the script lives under
  // `app.asar.unpacked/out/mcp/index.js`; in dev, `process.cwd()/out/...`.
  const mcpScriptPath = (): string => {
    if (app.isPackaged) {
      return join(
        app.getAppPath().replace('app.asar', 'app.asar.unpacked'),
        'out',
        'mcp',
        'index.js',
      );
    }
    return join(process.cwd(), 'out', 'mcp', 'index.js');
  };
  const paths: PathResolver = {
    electronBinaryPath: () => process.execPath,
    mcpScriptPath,
    mcpScriptExists: () => existsSync(mcpScriptPath()),
  };
  const mcpIntegrationService = new McpIntegrationService({
    db: svc.db,
    paths,
    now: () => new Date(),
  });

  // Agent skill installer — bundled SKILL.md ships under
  // `process.resourcesPath/agent-skill/SKILL.md` in production. Dev mode
  // tries a couple of project-relative paths because `pnpm dev` may run
  // from either `desktop/` or the workspace root depending on the script.
  const skillResolver: SkillResolver = {
    bundledSkillPath: () => {
      if (app.isPackaged) {
        return join(process.resourcesPath, 'agent-skill', 'SKILL.md');
      }
      const candidates = [
        join(process.cwd(), 'agent-skill', 'SKILL.md'),
        join(process.cwd(), 'desktop', 'agent-skill', 'SKILL.md'),
      ];
      for (const p of candidates) {
        if (existsSync(p)) return p;
      }
      // Fall back to the first candidate; AgentSkillService will surface
      // a readable ENOENT if neither path resolves at runtime.
      return candidates[0]!;
    },
  };
  const agentSkillService = new AgentSkillService({
    db: svc.db,
    resolver: skillResolver,
    now: () => new Date(),
  });

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
          credentials: getCredential(),
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
          credentials: getCredential(),
          config: providerCfg.config,
        });
      }
      return efMatcherServiceInstance;
    },
    get classificationService() {
      if (!classificationServiceInstance) {
        // Provider config is required to build the AiClient layer; without
        // it pi-ai's `getModel` lookup can't run. The previous version
        // threw "AI provider not configured" here at first access — we
        // preserve that contract so the renderer's existing error toast
        // (raised before the lazy getter is touched) keeps working.
        const providerCfg = getSettings().getProviderConfigWithKey();
        if (!providerCfg) {
          throw new Error('AI provider not configured. Open Settings to set up.');
        }
        const aiLayer = buildAiClientLayer({
          config: providerCfg.config,
          credentials: getCredential(),
        });
        classificationServiceInstance = new ClassificationService({
          db: svc.db,
          aiLayer,
          extractionService: ctx.extractionService,
          documentService: getDocument(),
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
    get inboundQuestionnaireService() {
      if (!inboundQuestionnaireServiceInstance) {
        inboundQuestionnaireServiceInstance = new InboundQuestionnaireService({
          db: svc.db,
          customerService: ctx.customerService,
          now: svc.now,
        });
      }
      return inboundQuestionnaireServiceInstance;
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
          credentials: getCredential(),
          config: providerCfg.config,
          excelParse: ExcelParser.parse,
        });
      }
      return questionnaireServiceInstance;
    },
    get answerLayer() {
      if (!answerLayerInstance) {
        // Provider config is required to build the AiClient + AiAgent layers
        // (pi-ai's `getModel(provider, model)` lookup happens at layer
        // construction). If the user hasn't configured a provider yet, the
        // IPC handler (`answer:generate`) short-circuits with "AI provider
        // not configured" before reaching ctx.answerLayer — but the lazy
        // getter still has to produce *some* layer for the type. We build
        // empty layers in that case; any consumer that yields the tag
        // without a real provider will fail with the standard Effect
        // "service not found" error, mirroring the V1 behaviour where
        // `ctx.providerConfig` was checked first.
        const providerCfg = getSettings().getProviderConfigWithKey();
        const aiLayer = providerCfg
          ? buildAiClientLayer({
              config: providerCfg.config,
              credentials: getCredential(),
            })
          : (Layer.empty as unknown as Layer.Layer<import('@main/llm/ai-client.js').AiClientTag>);
        const aiAgentLayer = providerCfg
          ? buildAiAgentLayer({
              config: providerCfg.config,
              credentials: getCredential(),
            })
          : (Layer.empty as unknown as Layer.Layer<import('@main/llm/ai-agent.js').AiAgentTag>);
        // Build the read-only inventory toolbox closed over the active
        // organization id. If no org is set up yet, hand back an empty
        // toolbox — the agent will then exhaust max-turns and the
        // single-shot fallback will run instead. Org lookup is deferred
        // to layer construction (not handler boot) so callers can spin up
        // an IpcContext before the first organization row exists.
        const currentOrg = ctx.organizationService.getCurrentOrganization();
        const tools = currentOrg
          ? buildAnswerTools({
              activityDataService,
              emissionSourceService,
              questionnaireService: ctx.questionnaireService,
              organizationId: currentOrg.id,
            })
          : [];
        const toolsLayer = Layer.succeed(AnswerToolsTag, tools);
        answerLayerInstance = buildAnswerLayer({
          db: svc.db,
          aiLayer,
          aiAgentLayer,
          toolsLayer,
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
    mcpIntegrationService,
    agentSkillService,
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
