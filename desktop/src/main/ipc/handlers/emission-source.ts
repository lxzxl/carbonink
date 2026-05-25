import {
  type EmissionSource,
  type EmissionSourceCreateInput,
  type EmissionSourceUpdateInput,
  emissionSourceCreateInput,
  emissionSourceUpdateInput,
  type PresetSource,
} from '@shared/types.js';
import { z } from 'zod';
import presetCatalog from '../../data/preset-sources.json' with { type: 'json' };
import type { IpcContext } from '../context.js';
import type { IpcTypeMap } from '../types.js';
import { withUndo } from '../undo-wrapper.js';

const idInput = z.object({ id: z.string().min(1) });
const siteScopedInput = z.object({ site_id: z.string().min(1) });
const orgScopedInput = z.object({ organization_id: z.string().min(1) });
const addFromPresetInput = z.object({
  organization_id: z.string().min(1),
  preset_id: z.string().min(1),
  site_id: z.string().min(1).optional(),
});
const addFromPresetsInput = z.object({
  organization_id: z.string().min(1),
  preset_ids: z.array(z.string().min(1)).min(1),
  site_id: z.string().min(1).optional(),
});

/**
 * Preset catalog: bundled at compile time via JSON import (same pattern as
 * `services/routing/airports.json`). v1 ships a small static seed; future
 * iterations replace the file with an AERA/Climatiq-derived export. The
 * `__comment__` key sits alongside `entries` and is ignored here.
 */
const PRESETS: PresetSource[] = (presetCatalog as { entries: PresetSource[] }).entries;

/**
 * Emission-source CRUD handlers. Delegates to `EmissionSourceService` —
 * site_id FK violations and "not found" errors propagate from the service
 * layer (sanitize() in setup.ts maps them to opaque correlation IDs).
 */
export function emissionSourceHandlers(ctx: IpcContext): {
  [K in keyof IpcTypeMap]?: IpcTypeMap[K];
} {
  const svc = ctx.emissionSourceService;
  return {
    // create / update / delete are wrapped with `withUndo`. Source
    // delete is soft (`is_active = 0` flip in the service), so the
    // create inverse is symmetric — it also calls delete(). A true
    // hard-delete-then-undo would need to re-INSERT, but the service
    // doesn't expose hard delete; soft is the canonical model.
    'source:create': withUndo<EmissionSourceCreateInput, EmissionSource, true>(
      ctx.undoManager,
      'source:create',
      'create emission source',
      () => true,
      (_captured, result) => ({
        undo: () => svc.delete(result.id),
        redo: () => {
          // Symmetric redo: flip is_active back to 1 (the row still
          // exists in the table after the soft-delete).
          ctx.db.prepare('UPDATE emission_source SET is_active = 1 WHERE id = ?').run(result.id);
        },
      }),
      (input) => svc.create(emissionSourceCreateInput.parse(input)),
    ),
    'source:get-by-id': (input) => svc.getById(idInput.parse(input).id),
    'source:list-by-site': (input) => svc.listBySite(siteScopedInput.parse(input).site_id),
    'source:list-by-org': (input) =>
      svc.listByOrganization(orgScopedInput.parse(input).organization_id),
    'source:list-by-org-with-stats': (input) =>
      svc.listByOrganizationWithStats(orgScopedInput.parse(input).organization_id),
    // For update, capture the full pre-update row so undo can restore
    // it column-for-column (including `updated_at` — see spec edge
    // case: "post-undo updated_at reflects state being restored to").
    'source:update': withUndo<EmissionSourceUpdateInput, EmissionSource, EmissionSource | null>(
      ctx.undoManager,
      'source:update',
      'update emission source',
      (input) => svc.getById(input.id),
      (oldRow, newRow) => ({
        undo: () => {
          if (!oldRow) return;
          // The update schema only accepts a subset of mutable fields
          // (`site_id` is fixed at creation). `category` is optionalString
          // — null on the DB row, but the zod schema wants string|undefined,
          // so coerce explicitly here.
          svc.update({
            id: oldRow.id,
            name: oldRow.name,
            scope: oldRow.scope,
            category: oldRow.category ?? undefined,
          });
        },
        redo: () => {
          svc.update({
            id: newRow.id,
            name: newRow.name,
            scope: newRow.scope,
            category: newRow.category ?? undefined,
          });
        },
      }),
      (input) => svc.update(emissionSourceUpdateInput.parse(input)),
    ),
    'source:delete': withUndo<{ id: string }, void, EmissionSource | null>(
      ctx.undoManager,
      'source:delete',
      'delete emission source',
      (input) => svc.getById(input.id),
      (snapshot) => ({
        undo: () => {
          // Undo: flip is_active back. Skip if the row went missing
          // (race with a hard delete from a future migration etc.).
          if (!snapshot) return;
          ctx.db.prepare('UPDATE emission_source SET is_active = 1 WHERE id = ?').run(snapshot.id);
        },
        redo: () => {
          if (!snapshot) return;
          svc.delete(snapshot.id);
        },
      }),
      (input) => {
        svc.delete(idInput.parse(input).id);
      },
    ),
    'source:list-presets': () => PRESETS,
    'source:add-from-preset': (input) => {
      const parsed = addFromPresetInput.parse(input);
      const preset = lookupPreset(parsed.preset_id);
      const siteId = resolveSiteId(ctx, parsed.organization_id, parsed.site_id);
      return svc.create(presetToCreateInput(preset, siteId));
    },
    'source:add-from-presets': (input) => {
      const parsed = addFromPresetsInput.parse(input);
      const presets = parsed.preset_ids.map(lookupPreset);
      const siteId = resolveSiteId(ctx, parsed.organization_id, parsed.site_id);
      return svc.createBatch(presets.map((p) => presetToCreateInput(p, siteId)));
    },
  };
}

/**
 * Look up one preset by id; throws if absent. The two add-from-preset
 * handlers share this so error wording stays identical between the
 * single and batch paths.
 */
function lookupPreset(presetId: string): PresetSource {
  const preset = PRESETS.find((p) => p.id === presetId);
  if (!preset) {
    throw new Error(`preset not found: ${presetId}`);
  }
  return preset;
}

/**
 * Resolve which site to put the new emission_source into. If the caller
 * supplied a site_id, use it. Otherwise fall back to the org's first
 * active site — Phase 1a/1b orgs always have exactly one site (created
 * during onboarding), so this is the dominant path.
 */
function resolveSiteId(
  ctx: IpcContext,
  organizationId: string,
  override: string | undefined,
): string {
  if (override) return override;
  const sites = ctx.organizationService.listSitesByOrganization(organizationId);
  const firstActive = sites.find((s) => s.is_active);
  if (!firstActive) {
    throw new Error('No active site found for organization. Create a site first.');
  }
  return firstActive.id;
}

/**
 * Translate a preset row into the EmissionSourceService.create input.
 * Uses the zh name (UI default locale is zh-CN; en users can rename via
 * the edit drawer). `template_origin = preset.id` so a future migration
 * can tell which presets a customer has already adopted, and so the AERA-
 * backed catalog can suppress already-adopted entries by id rather than
 * by name match.
 */
function presetToCreateInput(
  preset: PresetSource,
  siteId: string,
): {
  site_id: string;
  name: string;
  scope: 1 | 2 | 3;
  category: string;
  template_origin: string;
} {
  return {
    site_id: siteId,
    name: preset.name_zh,
    scope: preset.scope,
    category: preset.category,
    template_origin: preset.id,
  };
}
