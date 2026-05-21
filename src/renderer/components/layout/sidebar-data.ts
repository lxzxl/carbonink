import * as m from '@renderer/paraglide/messages';
import {
  ClipboardList,
  FileSearch,
  FileText,
  Flame,
  LayoutDashboard,
  ScrollText,
  Sliders,
} from 'lucide-react';
import type { NavGroup } from './types';

/**
 * Sidebar navigation data — carbonbook IA.
 *
 * Three top-level sections (matching the shadcn-admin pattern):
 *
 *   1. **General** — Dashboard + audit trail: "look at the system as
 *      a whole".
 *
 *   2. **Inventory** (排放清单) — the three "compute the number" routes:
 *      emission sources, activity data, and reports.
 *
 *   3. **Inputs** (输入资料) — the data-feeding routes: documents and
 *      questionnaires. These are where users put raw data IN.
 *
 * Settings is intentionally NOT in a NavGroup — it lives in the
 * Sidebar footer, composed with the MCP status indicator into a
 * single click target. (Having Settings both in a "System" group AND
 * a footer MCP-pill that also linked to /settings was the user-
 * reported "menu item 重复" — two icons, same destination.)
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
  ] satisfies NavGroup[],
};
