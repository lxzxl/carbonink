import {
  emissionSourceCreateInput,
  emissionSourceUpdateInput,
  type PresetSource,
} from '@shared/types.js';
import { z } from 'zod';
import presetCatalog from '../../data/preset-sources.json' with { type: 'json' };
import type { IpcContext } from '../context.js';
import type { IpcTypeMap } from '../types.js';

const idInput = z.object({ id: z.string().min(1) });
const siteScopedInput = z.object({ site_id: z.string().min(1) });
const orgScopedInput = z.object({ organization_id: z.string().min(1) });
const addFromPresetInput = z.object({
  organization_id: z.string().min(1),
  preset_id: z.string().min(1),
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
    'source:create': (input) => svc.create(emissionSourceCreateInput.parse(input)),
    'source:get-by-id': (input) => svc.getById(idInput.parse(input).id),
    'source:list-by-site': (input) => svc.listBySite(siteScopedInput.parse(input).site_id),
    'source:list-by-org': (input) =>
      svc.listByOrganization(orgScopedInput.parse(input).organization_id),
    'source:update': (input) => svc.update(emissionSourceUpdateInput.parse(input)),
    'source:delete': (input) => {
      svc.delete(idInput.parse(input).id);
    },
    'source:list-presets': () => PRESETS,
    'source:add-from-preset': (input) => {
      const parsed = addFromPresetInput.parse(input);
      const preset = PRESETS.find((p) => p.id === parsed.preset_id);
      if (!preset) {
        throw new Error(`preset not found: ${parsed.preset_id}`);
      }
      let siteId = parsed.site_id;
      if (!siteId) {
        // Default to the org's first active site. Phase 1a/1b orgs always
        // have exactly one site (created during onboarding), so this is
        // the dominant path.
        const sites = ctx.organizationService.listSitesByOrganization(parsed.organization_id);
        const firstActive = sites.find((s) => s.is_active);
        if (!firstActive) {
          throw new Error('No active site found for organization. Create a site first.');
        }
        siteId = firstActive.id;
      }
      // Use the Chinese name as the source name (UI default locale is
      // zh-CN; en users can rename via the edit drawer). category from
      // the preset propagates so AI matchers / future EF defaults can
      // pick it up.
      return svc.create({
        site_id: siteId,
        name: preset.name_zh,
        scope: preset.scope,
        category: preset.category,
        template_origin: preset.id,
      });
    },
  };
}
