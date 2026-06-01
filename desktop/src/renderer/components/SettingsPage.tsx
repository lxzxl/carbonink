import { AboutSection } from '@renderer/components/settings/AboutSection';
import { AIProviderSection } from '@renderer/components/settings/AIProviderSection';
import { AmapKeySection } from '@renderer/components/settings/AmapKeySection';
import { DataSection } from '@renderer/components/settings/DataSection';
import { GeneralSection } from '@renderer/components/settings/GeneralSection';
import { McpSection } from '@renderer/components/settings/McpSection';
import { OrganizationProfileSection } from '@renderer/components/settings/OrganizationProfileSection';
import { UpdateSection } from '@renderer/components/UpdateSection';
import { cn } from '@renderer/lib/utils';
import * as m from '@renderer/paraglide/messages';
import {
  Building2,
  Cable,
  Database,
  Info,
  type LucideIcon,
  MapPin,
  RefreshCw,
  Settings as SettingsIcon,
  Sparkles,
} from 'lucide-react';
import { useState } from 'react';

/**
 * /settings — two-pane layout, left rail + right scroll pane.
 *
 * Previously the page rendered every section in one long stack glued
 * together by `border-t` lines, which made it hard to tell where one
 * setting ended and the next began ("AMap routing key" sat right under
 * the Save button for the LLM provider — they look related, but
 * aren't). The new layout matches the macOS System Settings shape:
 *
 *   ┌──────────────┬────────────────────────────────────────┐
 *   │   Sidebar    │   Section title + description          │
 *   │   ◯ AI       │   ────────────                          │
 *   │   ● AMap     │   <section body>                       │
 *   │   ◯ MCP      │                                        │
 *   │   ◯ Org      │                                        │
 *   │   ◯ Update   │                                        │
 *   └──────────────┴────────────────────────────────────────┘
 *
 * One section visible at a time → users can't conflate adjacent
 * settings. Default landing is "General" — matches macOS / Windows /
 * iOS Settings conventions where the first section is global
 * preferences (language, theme). Users opening Settings the first
 * time should see the language switcher immediately; the AI provider
 * has its own onboarding step, so it doesn't need to be the entry
 * point here.
 *
 * Active section is local state (no `/settings/$section` route). A
 * routed approach would buy bookmarkability but settings are
 * navigated-to deliberately, not deep-linked.
 */

type SectionKey = 'general' | 'ai' | 'amap' | 'mcp' | 'org' | 'data' | 'updates' | 'about';

interface SectionDef {
  key: SectionKey;
  icon: LucideIcon;
  label: () => string;
  description: () => string;
  render: () => JSX.Element;
}

const SECTIONS: SectionDef[] = [
  {
    key: 'general',
    icon: SettingsIcon,
    label: () => m.settings_section_general(),
    description: () => m.settings_section_general_description(),
    render: () => <GeneralSection />,
  },
  {
    key: 'ai',
    icon: Sparkles,
    label: () => m.settings_section_ai(),
    description: () => m.settings_section_ai_description(),
    render: () => <AIProviderSection />,
  },
  {
    key: 'amap',
    icon: MapPin,
    label: () => m.settings_section_amap(),
    description: () => m.settings_section_amap_description(),
    render: () => <AmapKeySection />,
  },
  {
    key: 'mcp',
    icon: Cable,
    label: () => m.settings_section_mcp(),
    description: () => m.settings_section_mcp_description(),
    render: () => <McpSection />,
  },
  {
    key: 'org',
    icon: Building2,
    label: () => m.settings_section_org(),
    description: () => m.settings_section_org_description(),
    render: () => <OrganizationProfileSection />,
  },
  {
    key: 'data',
    icon: Database,
    label: () => m.settings_section_data(),
    description: () => m.settings_section_data_description(),
    render: () => <DataSection />,
  },
  {
    key: 'updates',
    icon: RefreshCw,
    label: () => m.settings_section_updates(),
    description: () => m.settings_section_updates_description(),
    render: () => <UpdateSection />,
  },
  {
    key: 'about',
    icon: Info,
    label: () => m.settings_section_about(),
    description: () => m.settings_section_about_description(),
    render: () => <AboutSection />,
  },
];

export function SettingsPage() {
  const [active, setActive] = useState<SectionKey>('general');
  const section = SECTIONS.find((s) => s.key === active) ?? SECTIONS[0];
  if (!section) return null;

  return (
    <div className="-mx-6 -my-6 flex h-[calc(100%+3rem)]">
      {/* Left rail — fixed 200px, vertical button list. Sized after
          macOS System Settings (which uses ~210px). Not user-resizable;
          settings sidebars don't gain from drag-to-resize. */}
      <nav
        className="w-[200px] shrink-0 overflow-y-auto border-r border-border bg-card/30 px-2 py-4"
        aria-label={m.settings_nav_label()}
      >
        <ul className="space-y-0.5">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            const isActive = s.key === active;
            return (
              <li key={s.key}>
                <button
                  type="button"
                  onClick={() => setActive(s.key)}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                    isActive
                      ? 'bg-foreground/10 text-foreground font-medium'
                      : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground',
                  )}
                >
                  <Icon
                    className={cn(
                      'h-4 w-4 shrink-0',
                      isActive ? 'text-foreground' : 'text-muted-foreground',
                    )}
                    aria-hidden="true"
                  />
                  <span className="truncate">{s.label()}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Right pane — section title + description on top, scrolling
          body below. Body padding is controlled here (px-8 py-6) so
          each Section component stays layout-neutral. */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-8 py-6">
          <header className="mb-6 space-y-1">
            <h2 className="text-xl font-semibold text-foreground">{section.label()}</h2>
            <p className="text-sm text-muted-foreground">{section.description()}</p>
          </header>
          {section.render()}
        </div>
      </div>
    </div>
  );
}
