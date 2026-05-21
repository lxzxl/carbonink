import * as m from '@renderer/paraglide/messages';
import {
  ClipboardList,
  FileSearch,
  FileText,
  Flame,
  LayoutDashboard,
  ScrollText,
  Settings as SettingsIcon,
  Sliders,
} from 'lucide-react';
import type { NavGroup } from './types';

/**
 * Sidebar navigation data — carbonbook IA.
 *
 * Three top-level sections (matching the shadcn-admin pattern):
 *
 *   1. **General** (no label visible — using empty string suppresses the
 *      uppercase header for the first group). Dashboard + audit trail —
 *      "where do I look at the system as a whole".
 *
 *   2. **Inventory** (排放清单) — the three "compute the number" routes:
 *      emission sources, activity data, and reports.
 *
 *   3. **Inputs** (输入资料) — the data-feeding routes: documents and
 *      questionnaires. These are where users put raw data IN.
 *
 *   4. **System** — settings (single item; not a real "group" but the
 *      flat shadcn-admin pattern doesn't have a footer-area concept
 *      separate from groups, so settings lives in its own pseudo-group
 *      at the bottom).
 *
 * `m.X` (the paraglide message accessor) is called at render time inside
 * `<NavGroup>`, so language switches re-render the labels without a
 * page reload.
 */

export const sidebarData = {
  navGroups: [
    {
      title: m.nav_section_general(),
      items: [
        { title: m.nav_dashboard(), url: '/', icon: LayoutDashboard },
        { title: m.audit_nav(), url: '/audit', icon: FileSearch },
      ],
    },
    {
      title: m.nav_section_inventory(),
      items: [
        { title: m.nav_sources(), url: '/sources', icon: Sliders },
        { title: m.nav_activities(), url: '/activities', icon: Flame },
        { title: m.reports_nav(), url: '/reports', icon: ScrollText },
      ],
    },
    {
      title: m.nav_section_documents_questionnaires(),
      items: [
        { title: m.nav_documents(), url: '/documents', icon: FileText },
        { title: m.nav_questionnaires(), url: '/questionnaires', icon: ClipboardList },
      ],
    },
    {
      title: m.nav_section_system(),
      items: [{ title: m.nav_settings(), url: '/settings', icon: SettingsIcon }],
    },
  ] satisfies NavGroup[],
};
