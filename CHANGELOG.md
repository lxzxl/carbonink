# 1.0.0 (2026-05-22)


### Bug Fixes

* **answer:** LLM 'no data' becomes typed error, not a fake empty-value answer df1507e
* **answer:** unit forced to null on non-numerical kinds at insert 79a6f38
* bypass app shell on /print-render + allow cross-family EF rebind with manual amount 4649688
* **db:** migration 007 — remove broken 万度/斤 aliases + tighten test thresholds c643b07
* **db:** migration 008 — NULL fuel CH4/N2O (double-count) + GLOBAL casing + golden-value test ba0ffec, closes 2/#4 5/#9
* **db:** toggle PRAGMA foreign_keys outside the migration transaction d63db43
* **dev:** untrack auto-generated paraglide files to stop Electron HMR loop 7988fbc
* **extraction:** CSP blob: for PDF preview + DeepSeek-friendly prompt + actionable errors b5cc621
* **extraction:** relax schema + fail-fast on unreadable PDFs 964c611
* **ipc:** correct invoke<> return type (no more double-Promise) 64ac555
* **ipc:** preserve `this` binding when calling l.handle() in dispatch loop 8356227
* **pdf-to-images:** pdfjs 5.x prefers `canvas` field over `canvasContext` 9546eb0
* pin electron ^41.5.1 (better-sqlite3 12.9.0 incompatible with electron 42 V8 API) 951b0e1
* **routes:** documents_.\$id — flatten /documents/\$id out of /documents nesting f9da467
* **routes:** flatten questionnaires child routes so /new and /$id render 67225fc
* **service:** ActivityDataService — correct delete() comment + drop dead mapRow e9637ec
* **service:** UnitConversionService — validate fuel_code even when same-family fad8c15
* **smoke:** synthetic filled-in fixtures replace blank templates 28c778e
* **test:** remove unused freightStage import in registry.test.ts 8e7c45d
* **ui:** /documents — guard upload zone when AI provider not configured 9b26217
* **ui:** ActivityForm — subscribe to ef_* fields for radio + submit reactivity d3f1b31
* **ui:** ActivityForm — subscribe to emission_source_id via useStore a4a69c3
* **ui:** AnswerReviewCard now reflects answer.value when answer loads after mount 3126871
* **ui:** drop sonner richColors — let OKLch tokens style toasts 2312089
* **ui:** form review — render-phase setState, retry-toast, date errors, fuel i18n 69480bd, closes #1
* **ui:** hide Confirm/Discard on already-parsed extractions; link to /activities 3de9436
* **ui:** mount CommandPalette inside RouterProvider — fixes silent nav breakage 9df4bb1
* **ui:** onboarding route guard — redirect to dashboard if org already exists d690e0c
* **ui:** retry-after-discard now re-runs with the originally-picked stage id b6b25ac
* **ui:** SettingsDrawer — opt drawer/overlay out of window drag region dd3f1ef
* **ui:** titlebar drag region — separate from scrollable area + cover form elements cfd5198


### Features

* **activity:** rebindEf + getByIdWithEf — pin + UPDATE + audit_event 7cc212f
* **answer:** add Context.Tag classes + buildAnswerLayer helper for Effect Step 2 2cdd785
* **answer:** AnswerGenerationService.generate — Effect Step 1 production code 860933b
* **answer:** AnswerGenerationService.save + listByQuestionnaire c011a79
* **answer:** generateAllUnanswered — bounded concurrency + per-item isolation f8b085f
* **answer:** retry LLMCallFailed with exponential backoff (Effect Step 3) 8acd8b3
* **answer:** unfinalize action + read-only state for finalized cards 088d19e
* **audit:** AuditEventService.list + AuditEvent type 841aa39
* **classify:** ClassificationService — lazy classify + auto-route to stage 4506acd
* **credentials:** safeStorage backend — Electron safeStorage + 0o600 file blobs f0abc00
* **customer:** CustomerService — createOrGetByName + list + getById e1b2b10
* **db:** migration 007 — seed units (40 defs / 80+ aliases / 5 fuel_property) 06e1088
* **db:** migration 008 — seed 12 emission factors (Scope 1+2 typical + 2 Scope 3 placeholders) 4b30642
* **db:** migration 010 — FTS5 virtual table over emission_factor 500f110
* **db:** migration 011 — seed v2 EFs covering fuel/freight/travel/purchase 4fb57c7
* **db:** migration 012 — document.doc_type column 0ed4596
* **db:** migration 014 — answer.source_kind adds 'reused' for cross-questionnaire prefill b52c60f
* **db:** migration 015 — ISO 14064-1 schema (boundary_kind widen + report fields) 04cb365
* **docs:** DocumentService accepts xlsx + rename QuestionnaireService dep 54e9136
* **documents:** retry after discard + per-row status chips 3324983
* **e2e:** canned per-stage extraction + recommendation data b67ae71
* **e2e:** test harness (launch + IPC override + teardown) e3a75bf
* **effect:** Step 0 — install effect 3.21.2 + warmup exercise file 2232356
* **ef:** prefix-match on category to bridge source/catalog granularity gap 954cc7d
* **excel:** ExcelParser — flat cell list with sheet/row/col/ref 6d44c6b
* **excel:** writeAnswers — pure transform writing answers back into .xlsx 5dff8a7
* **extraction:** vision branch on PdfNotReadableError + progress emitter wiring ec74260
* **i18n:** EF matcher UX strings (en + zh-CN) b01a178
* **i18n:** freight field labels cf75413
* **i18n:** fuel-receipt field labels + stage-picker UX strings 541e52c
* **i18n:** purchase field labels + category-other warning db5671b
* **i18n:** travel field labels 718cd22
* **i18n:** vision-mode UX strings for Phase 1c fcc310f
* **ipc:** 10 channels — document:* + extraction:* + stages:list 11b5c77
* **ipc:** 12 channels — ef:* / units:* / source:* / activity:* d1f9b1d
* **ipc:** 5 channels — settings:* (provider config + ping) db5ff57
* **ipc:** activity:get-by-id + activity:rebind-ef channels 8058946
* **ipc:** answer:export-to-xlsx channel — read-modify-write + save dialog + markExported 541e144
* **ipc:** answer:generate-all-unanswered channel + handler + renderer client 0b017a4
* **ipc:** answer:generate/save/list-by-questionnaire channels + renderer API 63c1480
* **ipc:** audit:list channel + handler 3162cc1
* **ipc:** ef:recommend channel + renderer efMatcherApi client 3d27fe4
* **ipc:** extraction:classify-and-run channel + renderer extractionApi.classifyAndRun b309842
* **ipc:** progress emitter for main→renderer push events cb3151c
* **ipc:** questionnaire:create/list/get-by-id channels + renderer API 6eadb0c
* **ipc:** questionnaire:export-pdf channel + handler (renderer stub) 0a7a1d2
* **ipc:** report:generate + report:cancel + report:progress channels afe9f20
* **ipc:** routing:lookup channel + handler + renderer client 34109fc
* **license:** dev Ed25519 keypair + issue-dev-license CLI + round-trip test f88b1fe
* **license:** IPC channels + handler + bridge + renderer wrapper ee16781
* **license:** LicenseSection + LicenseBanner UI (Phase 4 sub-project B) 063546e
* **license:** LicenseService — Ed25519 verify + Keychain + state read bcb6c15
* **license:** LicenseStateMachine pure module + 9 tests 96b00da
* **license:** migration 016 + shared License types 32a02fb
* **license:** read-only gate middleware + blocked-channel set + 9 tests fff423d
* **license:** rename key constant + add build-time guard for production key swap d77e9ca
* **license:** wire read-only gate into IPC dispatcher + sanitize allowlist 302b176
* **llm:** classify question_kind during questionnaire extraction 7feed0e
* **llm:** generateAnswer prompt slices per question_kind + per-kind value length cap 679f399
* **llm:** LLMClient — AI SDK wrapper (5 providers, extract + ping) 8fc13cc
* **llm:** LLMClient.classifyDocument — 5-stage classifier with vision fallback 69a87b0
* **llm:** LLMClient.extractQuestions — find Q/A cells in Excel questionnaires 633f285
* **llm:** LLMClient.extractWithImages — multipart messages for vision path 09833bb
* **llm:** LLMClient.generateAnswer — auto-fill numerical questionnaire answers 853e28a
* **llm:** LLMClient.recommendEfs — top-K EF picker 731d777
* **llm:** pdfToImages — render PDF pages to PNG via pdfjs-dist + @napi-rs/canvas c63647f
* **llm:** report narrative generator — streamObject + progress + abort 15efc76
* **llm:** Stage Registry + china_utility v1 (extract + classify combined) f47f7b9
* **llm:** vision-capability — static gate for multimodal-capable models 22a0cd9
* **main:** honor CARBONBOOK_TEST_USER_DATA_DIR for E2E isolation eaabdb1
* **matcher:** EfMatcherService — FTS5 ranking + LLM top-K + cache 7568987
* **matcher:** per-stage hint extractor for FTS5 queries 8997678
* **mcp:** 3 write tools (set_answer, create_activity, create_emission_source) 027a938
* **mcp:** 6 read tools (list/get questionnaires, list questions, get answer, list activities, list emission sources) fc4d406
* **mcp:** resources inventory://{year} and questionnaire://{id} e617eb0
* **mcp:** Settings MCP section + one-click Claude Desktop config d717dde
* **mcp:** sidebar status chip — green/amber/gray with 10s poll, opens Settings ed59de1
* **mcp:** skeleton stdio MCP server + node:sqlite db helper + vite.mcp.config + build:mcp script 3bfda4e
* **preload:** subscribe API for main→renderer push channels e7baaf0
* **questionnaire:** auto-prefill answers from same customer's prior finalized questionnaires 47f1523
* **questionnaire:** QuestionnairePdfDataService — sheet-grouped Q&A assembly 0b85596
* **questionnaire:** QuestionnaireService.createFromUpload — parse + extract + insert 1b6a5fe
* **questionnaire:** QuestionnaireService.list + getById c6105dc
* **renderer:** IPC wrappers for document / extraction / stages 1b4991e
* **renderer:** IPC wrappers for ef-library / emission-source / activity-data 232a7d7
* **renderer:** subscribe helper for IPC push channels f97142b
* **report:** export service — printToPDF (hidden window) + exceljs appendix 746ad1e
* **report:** ReportDataService — assembles InventoryReportData from sqlite 3e3ad75
* **routing:** airports.json + haversine + parseIataFromString — air-mode distance backend 4f018ec
* **routing:** AMap client — Effect.retry + 4 typed errors for driving/transit 996760c
* **routing:** RoutingService.lookup + routing_cache migration — Effect-based dispatcher 03f1884
* **samples:** seed-test-data script + README for manual walkthrough fixtures 30830e2
* **service:** ActivityDataService — single-tx pin EF + compute CO2e + insert 65cd142
* **service:** CalculationService — amount × EF → CO2e (AR6 GWP100) e410bb4
* **service:** CredentialService — IPC-safe wrapper with prefix allowlist + masking f3f3afc
* **service:** DocumentService — sha256 content-addressed storage + dedupe 593a347
* **service:** EfService — EF lookup + pin to pinned_emission_factor e1e4fc8
* **service:** EmissionSourceService — CRUD with composite FK (id, site_id) c0bd745
* **service:** ExtractionService — pipeline with sha256+stage+model cache 03970e9
* **service:** SettingsService — provider config split (sqlite plain / keychain key) 71c51df
* **service:** UnitConversionService — normalize/convert/cross-family 502c1ad
* **settings:** organization profile section + updateReportingProfile service 4831a13
* **stages:** china_utility.v1 — buildVisionMessages mirrors buildPrompt rules ed85167
* **stages:** freight.v1 — schema + stage shell b22ac7f
* **stages:** freight.v1 — text + vision prompts with shared FIELD_RULES 911db5a
* **stages:** fuel_receipt.v1 — schema + stage shell ada1fd4
* **stages:** fuel_receipt.v1 — text + vision prompts with shared FIELD_RULES 663a901
* **stages:** purchase.v1 — schema + stage shell dbac9a4
* **stages:** purchase.v1 — text + vision prompts with shared FIELD_RULES 9760f55
* **stages:** register freight.v1 in stage registry 1d8db08
* **stages:** register fuel_receipt.v1 in stage registry ab758b1
* **stages:** register purchase.v1 in stage registry c380a5f
* **stages:** register travel.v1 in stage registry 5e951be
* **stages:** Stage interface gains optional buildVisionMessages for Phase 1c 4d3fc31
* **stages:** travel.v1 — schema + stage shell 4f45d88
* **stages:** travel.v1 — text + vision prompts with shared FIELD_RULES cd36975
* **types:** provider config discriminated union (5 providers) b35502d
* **types:** zod schemas + types for emission_source / activity_data / EF 6d5fcba
* **ui:** /activities route — list + create form with EF auto-filter 1e42af6
* **ui:** /audit route + Sidebar nav + filters + empty state 4541653
* **ui:** /documents route — drag-drop upload + list + read-bytes IPC 201ac17
* **ui:** /print-render route + renderQuestionnairePdf + Export PDF button 58c337e
* **ui:** /questionnaires list route + sidebar entry a676bfa
* **ui:** /questionnaires/$id detail route 4d2ac60
* **ui:** /questionnaires/new wizard 96be95a
* **ui:** /reports list + detail routes + sidebar nav 3e152c7
* **ui:** /sources route — list + create form 5350d5f
* **ui:** Activities list — Rebind button per row + drawer mount 0ca79ac
* **ui:** ActivityForm renders Recommended section when matcherHint is present f547a7c
* **ui:** AnswerReviewCard — per-question generate + edit + finalize 6991a81
* **ui:** AnswerReviewCard renders Textarea for narrative, hides Unit for non-numerical ec86184
* **ui:** audit event cards — dispatcher + ActivityRebind + RawJson 4a430bd
* **ui:** blue 'reused' chip on AnswerReviewCard + toast count for reused answers fe436f3
* **ui:** cmdk command palette (⌘K) — Navigation group + dashboard/onboarding commands 7b95791
* **ui:** dashboard — real CO2e totals + scope 1/2/3 breakdown eedbc09
* **ui:** document detail RunExtractionAction flips label on vision phase event 20128fa
* **ui:** document list shows doc_type chip per row 4e648ee
* **ui:** document review — PDF preview + extraction display + Confirm → ActivityForm prefill b8feaf4
* **ui:** document review — Run extraction button for unparsed docs 8e2564a
* **ui:** DocumentsUpload — remove stage dropdown, defer to review-page classify d0db828
* **ui:** DocumentsUpload — stage dropdown driven by stages:list IPC, last-pick persisted c0361fc
* **ui:** DocumentsUpload flips spinner to 'recognizing image' on vision phase event 90186ff
* **ui:** Export to Excel button on questionnaire detail page 0289914
* **ui:** ExtractionReview — add freight.v1 3rd arm to per-stage switch 707496b
* **ui:** ExtractionReview — add purchase.v1 4th arm + extend category-other warning 8c3d62b
* **ui:** ExtractionReview — add travel.v1 5th arm to per-stage switch fde0b3e
* **ui:** ExtractionReview — per-stage field renderers + ActivityForm prefill 5124866
* **ui:** Generate all unanswered button on questionnaire detail page 43bade5
* **ui:** inventory-empty banner + persistent generation-error state on cards 2011dd1
* **ui:** Look up distance button on ActivityForm + AMap key setting a967e8c
* **ui:** multi-file upload 0183657
* **ui:** native window chrome — macOS vibrancy + Windows Mica 3fdce46, closes body/html/#root
* **ui:** OKLch color token system + foreground opacity ladder 708c4b7
* **ui:** polish /questionnaires/new — drop-zone + clearer disabled state + sample fixture d6e8cd8
* **ui:** questionnaire detail page renders AnswerReviewCards + finalize button e8e0cb7
* **ui:** QuestionnairePdfPreview component + sections + print CSS 1ec464a
* **ui:** RebindEfDrawer — preview + delta + cross-family rejection b1f4189
* **ui:** ReportPreview component — single visual for in-app + print d4b9dbf
* **ui:** review page — lazy classify pipeline with 3 UI states + ManualStagePicker 833bca6
* **ui:** SettingsDrawerContent — provider config form with masked-key replace a8b1368
* **ui:** sidebar — Sources + Activities nav items + paraglide messages 14492ac
* **ui:** Sidebar Settings button + cmdk + renderer API wrapper 84cc428
* **ui:** sonner toasts — replace inline error <p> patterns 6d149e3
* **ui:** switch-stage override button on review page 2ea3d5e
* **ui:** thread matcherHint through ExtractionReview to ActivityForm d979327
* **ui:** vaul drawer — SettingsDrawer shell 991b34a
* **updater:** integrate electron-updater with Settings UI + background check on launch c2a8a87
# 1.0.0 (2026-05-22)


### Bug Fixes

* **answer:** LLM 'no data' becomes typed error, not a fake empty-value answer df1507e
* **answer:** unit forced to null on non-numerical kinds at insert 79a6f38
* bypass app shell on /print-render + allow cross-family EF rebind with manual amount 4649688
* **db:** migration 007 — remove broken 万度/斤 aliases + tighten test thresholds c643b07
* **db:** migration 008 — NULL fuel CH4/N2O (double-count) + GLOBAL casing + golden-value test ba0ffec, closes 2/#4 5/#9
* **db:** toggle PRAGMA foreign_keys outside the migration transaction d63db43
* **dev:** untrack auto-generated paraglide files to stop Electron HMR loop 7988fbc
* **extraction:** CSP blob: for PDF preview + DeepSeek-friendly prompt + actionable errors b5cc621
* **extraction:** relax schema + fail-fast on unreadable PDFs 964c611
* **ipc:** correct invoke<> return type (no more double-Promise) 64ac555
* **ipc:** preserve `this` binding when calling l.handle() in dispatch loop 8356227
* **pdf-to-images:** pdfjs 5.x prefers `canvas` field over `canvasContext` 9546eb0
* pin electron ^41.5.1 (better-sqlite3 12.9.0 incompatible with electron 42 V8 API) 951b0e1
* **routes:** documents_.\$id — flatten /documents/\$id out of /documents nesting f9da467
* **routes:** flatten questionnaires child routes so /new and /$id render 67225fc
* **service:** ActivityDataService — correct delete() comment + drop dead mapRow e9637ec
* **service:** UnitConversionService — validate fuel_code even when same-family fad8c15
* **smoke:** synthetic filled-in fixtures replace blank templates 28c778e
* **test:** remove unused freightStage import in registry.test.ts 8e7c45d
* **ui:** /documents — guard upload zone when AI provider not configured 9b26217
* **ui:** ActivityForm — subscribe to ef_* fields for radio + submit reactivity d3f1b31
* **ui:** ActivityForm — subscribe to emission_source_id via useStore a4a69c3
* **ui:** AnswerReviewCard now reflects answer.value when answer loads after mount 3126871
* **ui:** drop sonner richColors — let OKLch tokens style toasts 2312089
* **ui:** form review — render-phase setState, retry-toast, date errors, fuel i18n 69480bd, closes #1
* **ui:** hide Confirm/Discard on already-parsed extractions; link to /activities 3de9436
* **ui:** mount CommandPalette inside RouterProvider — fixes silent nav breakage 9df4bb1
* **ui:** onboarding route guard — redirect to dashboard if org already exists d690e0c
* **ui:** retry-after-discard now re-runs with the originally-picked stage id b6b25ac
* **ui:** SettingsDrawer — opt drawer/overlay out of window drag region dd3f1ef
* **ui:** titlebar drag region — separate from scrollable area + cover form elements cfd5198


### Features

* **activity:** rebindEf + getByIdWithEf — pin + UPDATE + audit_event 7cc212f
* **answer:** add Context.Tag classes + buildAnswerLayer helper for Effect Step 2 2cdd785
* **answer:** AnswerGenerationService.generate — Effect Step 1 production code 860933b
* **answer:** AnswerGenerationService.save + listByQuestionnaire c011a79
* **answer:** generateAllUnanswered — bounded concurrency + per-item isolation f8b085f
* **answer:** retry LLMCallFailed with exponential backoff (Effect Step 3) 8acd8b3
* **answer:** unfinalize action + read-only state for finalized cards 088d19e
* **audit:** AuditEventService.list + AuditEvent type 841aa39
* **classify:** ClassificationService — lazy classify + auto-route to stage 4506acd
* **credentials:** safeStorage backend — Electron safeStorage + 0o600 file blobs f0abc00
* **customer:** CustomerService — createOrGetByName + list + getById e1b2b10
* **db:** migration 007 — seed units (40 defs / 80+ aliases / 5 fuel_property) 06e1088
* **db:** migration 008 — seed 12 emission factors (Scope 1+2 typical + 2 Scope 3 placeholders) 4b30642
* **db:** migration 010 — FTS5 virtual table over emission_factor 500f110
* **db:** migration 011 — seed v2 EFs covering fuel/freight/travel/purchase 4fb57c7
* **db:** migration 012 — document.doc_type column 0ed4596
* **db:** migration 014 — answer.source_kind adds 'reused' for cross-questionnaire prefill b52c60f
* **db:** migration 015 — ISO 14064-1 schema (boundary_kind widen + report fields) 04cb365
* **docs:** DocumentService accepts xlsx + rename QuestionnaireService dep 54e9136
* **documents:** retry after discard + per-row status chips 3324983
* **e2e:** canned per-stage extraction + recommendation data b67ae71
* **e2e:** test harness (launch + IPC override + teardown) e3a75bf
* **effect:** Step 0 — install effect 3.21.2 + warmup exercise file 2232356
* **ef:** prefix-match on category to bridge source/catalog granularity gap 954cc7d
* **excel:** ExcelParser — flat cell list with sheet/row/col/ref 6d44c6b
* **excel:** writeAnswers — pure transform writing answers back into .xlsx 5dff8a7
* **extraction:** vision branch on PdfNotReadableError + progress emitter wiring ec74260
* **i18n:** EF matcher UX strings (en + zh-CN) b01a178
* **i18n:** freight field labels cf75413
* **i18n:** fuel-receipt field labels + stage-picker UX strings 541e52c
* **i18n:** purchase field labels + category-other warning db5671b
* **i18n:** travel field labels 718cd22
* **i18n:** vision-mode UX strings for Phase 1c fcc310f
* **ipc:** 10 channels — document:* + extraction:* + stages:list 11b5c77
* **ipc:** 12 channels — ef:* / units:* / source:* / activity:* d1f9b1d
* **ipc:** 5 channels — settings:* (provider config + ping) db5ff57
* **ipc:** activity:get-by-id + activity:rebind-ef channels 8058946
* **ipc:** answer:export-to-xlsx channel — read-modify-write + save dialog + markExported 541e144
* **ipc:** answer:generate-all-unanswered channel + handler + renderer client 0b017a4
* **ipc:** answer:generate/save/list-by-questionnaire channels + renderer API 63c1480
* **ipc:** audit:list channel + handler 3162cc1
* **ipc:** ef:recommend channel + renderer efMatcherApi client 3d27fe4
* **ipc:** extraction:classify-and-run channel + renderer extractionApi.classifyAndRun b309842
* **ipc:** progress emitter for main→renderer push events cb3151c
* **ipc:** questionnaire:create/list/get-by-id channels + renderer API 6eadb0c
* **ipc:** questionnaire:export-pdf channel + handler (renderer stub) 0a7a1d2
* **ipc:** report:generate + report:cancel + report:progress channels afe9f20
* **ipc:** routing:lookup channel + handler + renderer client 34109fc
* **license:** dev Ed25519 keypair + issue-dev-license CLI + round-trip test f88b1fe
* **license:** IPC channels + handler + bridge + renderer wrapper ee16781
* **license:** LicenseSection + LicenseBanner UI (Phase 4 sub-project B) 063546e
* **license:** LicenseService — Ed25519 verify + Keychain + state read bcb6c15
* **license:** LicenseStateMachine pure module + 9 tests 96b00da
* **license:** migration 016 + shared License types 32a02fb
* **license:** read-only gate middleware + blocked-channel set + 9 tests fff423d
* **license:** rename key constant + add build-time guard for production key swap d77e9ca
* **license:** wire read-only gate into IPC dispatcher + sanitize allowlist 302b176
* **llm:** classify question_kind during questionnaire extraction 7feed0e
* **llm:** generateAnswer prompt slices per question_kind + per-kind value length cap 679f399
* **llm:** LLMClient — AI SDK wrapper (5 providers, extract + ping) 8fc13cc
* **llm:** LLMClient.classifyDocument — 5-stage classifier with vision fallback 69a87b0
* **llm:** LLMClient.extractQuestions — find Q/A cells in Excel questionnaires 633f285
* **llm:** LLMClient.extractWithImages — multipart messages for vision path 09833bb
* **llm:** LLMClient.generateAnswer — auto-fill numerical questionnaire answers 853e28a
* **llm:** LLMClient.recommendEfs — top-K EF picker 731d777
* **llm:** pdfToImages — render PDF pages to PNG via pdfjs-dist + @napi-rs/canvas c63647f
* **llm:** report narrative generator — streamObject + progress + abort 15efc76
* **llm:** Stage Registry + china_utility v1 (extract + classify combined) f47f7b9
* **llm:** vision-capability — static gate for multimodal-capable models 22a0cd9
* **main:** honor CARBONBOOK_TEST_USER_DATA_DIR for E2E isolation eaabdb1
* **matcher:** EfMatcherService — FTS5 ranking + LLM top-K + cache 7568987
* **matcher:** per-stage hint extractor for FTS5 queries 8997678
* **mcp:** 3 write tools (set_answer, create_activity, create_emission_source) 027a938
* **mcp:** 6 read tools (list/get questionnaires, list questions, get answer, list activities, list emission sources) fc4d406
* **mcp:** resources inventory://{year} and questionnaire://{id} e617eb0
* **mcp:** Settings MCP section + one-click Claude Desktop config d717dde
* **mcp:** sidebar status chip — green/amber/gray with 10s poll, opens Settings ed59de1
* **mcp:** skeleton stdio MCP server + node:sqlite db helper + vite.mcp.config + build:mcp script 3bfda4e
* **preload:** subscribe API for main→renderer push channels e7baaf0
* **questionnaire:** auto-prefill answers from same customer's prior finalized questionnaires 47f1523
* **questionnaire:** QuestionnairePdfDataService — sheet-grouped Q&A assembly 0b85596
* **questionnaire:** QuestionnaireService.createFromUpload — parse + extract + insert 1b6a5fe
* **questionnaire:** QuestionnaireService.list + getById c6105dc
* **renderer:** IPC wrappers for document / extraction / stages 1b4991e
* **renderer:** IPC wrappers for ef-library / emission-source / activity-data 232a7d7
* **renderer:** subscribe helper for IPC push channels f97142b
* **report:** export service — printToPDF (hidden window) + exceljs appendix 746ad1e
* **report:** ReportDataService — assembles InventoryReportData from sqlite 3e3ad75
* **routing:** airports.json + haversine + parseIataFromString — air-mode distance backend 4f018ec
* **routing:** AMap client — Effect.retry + 4 typed errors for driving/transit 996760c
* **routing:** RoutingService.lookup + routing_cache migration — Effect-based dispatcher 03f1884
* **samples:** seed-test-data script + README for manual walkthrough fixtures 30830e2
* **service:** ActivityDataService — single-tx pin EF + compute CO2e + insert 65cd142
* **service:** CalculationService — amount × EF → CO2e (AR6 GWP100) e410bb4
* **service:** CredentialService — IPC-safe wrapper with prefix allowlist + masking f3f3afc
* **service:** DocumentService — sha256 content-addressed storage + dedupe 593a347
* **service:** EfService — EF lookup + pin to pinned_emission_factor e1e4fc8
* **service:** EmissionSourceService — CRUD with composite FK (id, site_id) c0bd745
* **service:** ExtractionService — pipeline with sha256+stage+model cache 03970e9
* **service:** SettingsService — provider config split (sqlite plain / keychain key) 71c51df
* **service:** UnitConversionService — normalize/convert/cross-family 502c1ad
* **settings:** organization profile section + updateReportingProfile service 4831a13
* **stages:** china_utility.v1 — buildVisionMessages mirrors buildPrompt rules ed85167
* **stages:** freight.v1 — schema + stage shell b22ac7f
* **stages:** freight.v1 — text + vision prompts with shared FIELD_RULES 911db5a
* **stages:** fuel_receipt.v1 — schema + stage shell ada1fd4
* **stages:** fuel_receipt.v1 — text + vision prompts with shared FIELD_RULES 663a901
* **stages:** purchase.v1 — schema + stage shell dbac9a4
* **stages:** purchase.v1 — text + vision prompts with shared FIELD_RULES 9760f55
* **stages:** register freight.v1 in stage registry 1d8db08
* **stages:** register fuel_receipt.v1 in stage registry ab758b1
* **stages:** register purchase.v1 in stage registry c380a5f
* **stages:** register travel.v1 in stage registry 5e951be
* **stages:** Stage interface gains optional buildVisionMessages for Phase 1c 4d3fc31
* **stages:** travel.v1 — schema + stage shell 4f45d88
* **stages:** travel.v1 — text + vision prompts with shared FIELD_RULES cd36975
* **types:** provider config discriminated union (5 providers) b35502d
* **types:** zod schemas + types for emission_source / activity_data / EF 6d5fcba
* **ui:** /activities route — list + create form with EF auto-filter 1e42af6
* **ui:** /audit route + Sidebar nav + filters + empty state 4541653
* **ui:** /documents route — drag-drop upload + list + read-bytes IPC 201ac17
* **ui:** /print-render route + renderQuestionnairePdf + Export PDF button 58c337e
* **ui:** /questionnaires list route + sidebar entry a676bfa
* **ui:** /questionnaires/$id detail route 4d2ac60
* **ui:** /questionnaires/new wizard 96be95a
* **ui:** /reports list + detail routes + sidebar nav 3e152c7
* **ui:** /sources route — list + create form 5350d5f
* **ui:** Activities list — Rebind button per row + drawer mount 0ca79ac
* **ui:** ActivityForm renders Recommended section when matcherHint is present f547a7c
* **ui:** AnswerReviewCard — per-question generate + edit + finalize 6991a81
* **ui:** AnswerReviewCard renders Textarea for narrative, hides Unit for non-numerical ec86184
* **ui:** audit event cards — dispatcher + ActivityRebind + RawJson 4a430bd
* **ui:** blue 'reused' chip on AnswerReviewCard + toast count for reused answers fe436f3
* **ui:** cmdk command palette (⌘K) — Navigation group + dashboard/onboarding commands 7b95791
* **ui:** dashboard — real CO2e totals + scope 1/2/3 breakdown eedbc09
* **ui:** document detail RunExtractionAction flips label on vision phase event 20128fa
* **ui:** document list shows doc_type chip per row 4e648ee
* **ui:** document review — PDF preview + extraction display + Confirm → ActivityForm prefill b8feaf4
* **ui:** document review — Run extraction button for unparsed docs 8e2564a
* **ui:** DocumentsUpload — remove stage dropdown, defer to review-page classify d0db828
* **ui:** DocumentsUpload — stage dropdown driven by stages:list IPC, last-pick persisted c0361fc
* **ui:** DocumentsUpload flips spinner to 'recognizing image' on vision phase event 90186ff
* **ui:** Export to Excel button on questionnaire detail page 0289914
* **ui:** ExtractionReview — add freight.v1 3rd arm to per-stage switch 707496b
* **ui:** ExtractionReview — add purchase.v1 4th arm + extend category-other warning 8c3d62b
* **ui:** ExtractionReview — add travel.v1 5th arm to per-stage switch fde0b3e
* **ui:** ExtractionReview — per-stage field renderers + ActivityForm prefill 5124866
* **ui:** Generate all unanswered button on questionnaire detail page 43bade5
* **ui:** inventory-empty banner + persistent generation-error state on cards 2011dd1
* **ui:** Look up distance button on ActivityForm + AMap key setting a967e8c
* **ui:** multi-file upload 0183657
* **ui:** native window chrome — macOS vibrancy + Windows Mica 3fdce46, closes body/html/#root
* **ui:** OKLch color token system + foreground opacity ladder 708c4b7
* **ui:** polish /questionnaires/new — drop-zone + clearer disabled state + sample fixture d6e8cd8
* **ui:** questionnaire detail page renders AnswerReviewCards + finalize button e8e0cb7
* **ui:** QuestionnairePdfPreview component + sections + print CSS 1ec464a
* **ui:** RebindEfDrawer — preview + delta + cross-family rejection b1f4189
* **ui:** ReportPreview component — single visual for in-app + print d4b9dbf
* **ui:** review page — lazy classify pipeline with 3 UI states + ManualStagePicker 833bca6
* **ui:** SettingsDrawerContent — provider config form with masked-key replace a8b1368
* **ui:** sidebar — Sources + Activities nav items + paraglide messages 14492ac
* **ui:** Sidebar Settings button + cmdk + renderer API wrapper 84cc428
* **ui:** sonner toasts — replace inline error <p> patterns 6d149e3
* **ui:** switch-stage override button on review page 2ea3d5e
* **ui:** thread matcherHint through ExtractionReview to ActivityForm d979327
* **ui:** vaul drawer — SettingsDrawer shell 991b34a
* **updater:** integrate electron-updater with Settings UI + background check on launch c2a8a87
# Changelog

## Phase 1d (pending tag — awaiting GUI smoke)

**Scope:** the second half of Phase 1 — adding the last 4 extraction stages on top of the `china_utility.v1` baseline shipped in `phase-1a`, refactoring the rendering surface in preparation for the EF Matcher, and shipping the EF Matcher v1 itself.

64 commits since `phase-1c`. 309 → 415 vitest tests. ExtractionReview.tsx 596 → 260 LOC.

### Extraction stages (5 total, +4 in this release)

Every stage follows the same shape: zod schema + buildPrompt (text-only) + buildVisionMessages (image-aware) + registry entry + per-stage React components in `src/renderer/components/extractions/<stage>/`. Shared `FIELD_RULES` private constants keep prompt rules DRY between the text and vision paths.

- **`fuel_receipt.v1`** — 加油票. 11 fields, 8-value `fuel_category` enum (gasoline/diesel/lpg/cng/jet_fuel/marine_fuel/biofuel/other). Prompt wrapper: `<receipt>`.
- **`freight.v1`** — 货运单/物流单. 13 fields with 4-mode discriminator (road/rail/sea/air), `vehicle_class`, free-text origin/destination, `distance_km` nullable. Prompt wrapper: `<receipt>`.
- **`purchase.v1`** — 采购发票. 9 fields with 6-value `category` enum (raw_material/component/consumable/office_supply/service/other), dual-track `quantity_kg` (numeric mass) + `amount_yuan` (currency-priced fallback). Prompt wrapper: `<invoice>`.
- **`travel.v1`** — 差旅票据. 15 fields with 3-mode discriminator (air/rail/taxi); 7 nullable fields. ActivityForm prefill is dual-track: `unit='passenger-km'` for air/rail vs `'vehicle-km'` for taxi. Prompt wrapper: `<ticket>`.

Every stage has a `tests/main/llm/stages/<stage>.test.ts` (schema + metadata) and a smoke in `tests/main/services/extraction-service.test.ts` that exercises the orchestrator's per-stage routing.

### Per-stage component split (Phase 1.5 prep)

`src/renderer/components/ExtractionReview.tsx` was a 698-LOC monolith holding all 5 stages' parsed types + `<Fields>` renderers + `build*InitialValues` builders inline. Split into:

```
src/renderer/components/
├── ExtractionReview.tsx                  (orchestrator, 260 LOC)
└── extractions/
    ├── types.ts                          (StageParsed union + parseExtraction)
    ├── shared.tsx                        (Field row + CONFIDENCE_*)
    ├── china-utility/{types,fields,prefill}
    ├── fuel-receipt/{types,fields,prefill}
    ├── freight/{types,fields,prefill}
    ├── purchase/{types,fields,prefill}
    └── travel/{types,fields,prefill}
```

Pure refactor — zero behavior change, zero test changes. Safety net: existing renderer tests + typecheck against the discriminated union.

### EF Matcher v1

The Confirm flow now overlays a "为本单据推荐" (Recommended for this document) section above the existing scope/category-filtered EF list. Implementation:

1. **Migration 010** — SQLite FTS5 virtual table `ef_fts` over `(name_zh, name_en, description_zh, description_en)` with `unicode61` tokenizer (handles English + CJK), INSERT/UPDATE/DELETE triggers keep it in sync with `emission_factor`.
2. **Migration 011** — 20 new seeded EFs covering fuel (lpg/cng/jet_a), freight (4 road variants + rail + sea + air), travel (3 air classes + 2 rail + taxi), purchase (2 material + 2 CNY-priced service). Catalog grew from 12 → 32 EFs.
3. **`extractHint(stageId, parsed)`** — per-stage hint extractor that builds the FTS5 query string from the salient free-text fields (`supplier_name` for utility, `fuel_type+fuel_category` for fuel, `mode+vehicle_class+supplier_name` for freight, etc.).
4. **`LLMClient.recommendEfs(config, parsedJson, candidates)`** — `gpt-4o-mini` call with zod-constrained output (exactly 3 recommendations with composite PKs + Chinese reasoning).
5. **`EfMatcherService.recommend({extraction_id, emission_source_id})`** — orchestrator that pulls candidates via `EfService.list`, sorts them by `bm25(ef_fts)` against the hint, sends the top 20 to the LLM, maps recommendations back to catalog rows (hallucinated PKs dropped), caches by `(extractionId, sourceId)` for the process lifetime. On LLM failure, returns `{recommended: [], ranked_full}` — the user still sees the FTS5-sorted full list.
6. **`ef:recommend` IPC channel** — zod-validated handler, allowlist entry in preload, `efMatcherApi` renderer client.
7. **`matcherHint` plumbing** — optional 3rd parameter on every `build*InitialValues` builder, threaded through `ExtractionReview` to `ActivityForm` via `initialValues.matcherHint`.
8. **ActivityForm Recommended UX** — TanStack Query against `efMatcherApi.recommend()`, fires when `matcherHint` + selectedSource both exist. Loading state shows "正在分析…"; empty state hides the section silently (failure is invisible to the user).

5 new i18n keys × 2 locales: `ef_matcher_recommended_heading`, `ef_matcher_loading`, `ef_matcher_all_candidates`, `ef_matcher_reasoning_label`, `ef_matcher_no_candidates`.

### Tests + quality

- **415 vitest tests** passing (up from 309 at `phase-1c`).
- Production build (`pnpm build`) clean — 2334 modules, paraglide compiled.
- `pnpm typecheck` clean.
- `pnpm lint --max-diagnostics=80` reports 0 errors (32 pre-existing `noNonNullAssertion` warnings unchanged).
- New: `tests/main/services/ef-matcher-service-smoke.test.ts` — 6 end-to-end matcher tests against the REAL seeded catalog (mocks only the LLM and upstream extraction/source rows).

### Known limitations carried into `phase-1d`

- **Routing API for distance_km is NOT in v1.** Freight and travel extractions often have null `distance_km`; users still enter it manually. Phase 2 work.
- **EF category granularity gap.** `emission_source.category` (user-chosen, e.g. `travel.air`) is coarser than the EF catalog's per-row category (e.g. `travel.air.economy.shorthaul`). `EfService.list({category})` does exact match, so a coarser source category may return zero candidates. Documented in `docs/PHASE-1-SMOKE.md`; pre-flagged for Phase 2 as a 2-line prefix-match change in `EfService.list`.

### Migration history

```
000_meta.sql                            (schema_migrations bookkeeping)
001_core.sql                            (org/source/period)
002_emission_factors.sql                (EF library + pinned)
003_extraction.sql                      (document + extraction)
004_inventory.sql                       (activity_data)
005_questionnaire.sql
006_audit.sql
007_seed_units.sql
008_seed_emission_factors.sql           (12 Phase 1a EFs)
009_settings.sql
010_ef_fts.sql                          ← NEW: FTS5 + triggers
011_seed_emission_factors_v2.sql        ← NEW: +20 EFs (32 total)
```

## phase-1c — 2026-04-15

Phase 1a + 1b foundation: `china_utility.v1` extraction stage, ActivityForm + Confirm flow, document upload + extraction pipeline, settings drawer, onboarding wizard. 309 vitest tests.

## phase-1b

Document upload + extraction pipeline + first stage (`china_utility.v1`).

## phase-1a

Database schema + seed EFs (12 rows) + activity data + calculation service.

## phase-0

Project scaffolding (Electron + Vite + React + TanStack Router + better-sqlite3 + paraglide).
