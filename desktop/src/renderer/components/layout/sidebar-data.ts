import * as m from '@renderer/paraglide/messages';
import {
  ClipboardList,
  Download,
  FileSearch,
  FileText,
  Flame,
  LayoutDashboard,
  ScrollText,
  Sliders,
} from 'lucide-react';
import type { NavGroup } from './types';

/**
 * Sidebar navigation data — carbonink IA.
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
 * Exposed as a **function** rather than a const because `m.X()` resolves
 * to a string at the time it's called. If we built the data once at
 * module init, every label would be frozen to whichever locale was active
 * when this file first loaded — and main.tsx's `initLocale()` flips the
 * locale AFTER this module is imported, so the first paint would show
 * English even when the stored preference is zh-CN. Calling
 * `getSidebarData()` inside AppSidebar's render keeps the labels in
 * sync with the live paraglide locale + the locale-change re-render
 * forced by LocaleProvider's `key={locale}`.
 */

export function getSidebarData(): { navGroups: NavGroup[] } {
  return {
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
          { title: m.nav_disclosure_filings(), url: '/questionnaires', icon: ClipboardList },
          { title: m.nav_supplier_disclosures(), url: '/supplier-disclosures', icon: Download },
        ],
      },
    ],
  };
}
