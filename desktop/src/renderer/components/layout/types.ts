import type { LinkProps } from '@tanstack/react-router';

/**
 * Navigation data types — adapted from shadcn-admin
 * (https://shadcn-admin.netlify.app/) to carbonbook's needs.
 *
 * Differences from the upstream template:
 *   - No `User` / `Team` types — carbonbook is a single-user, single-org
 *     desktop app; sign-in / team-switcher concepts don't apply.
 *   - The `url` field is typed as `Exclude<LinkProps['to'], undefined> | (string & {})`
 *     which preserves TanStack Router's autocomplete on known routes
 *     while allowing arbitrary strings (e.g. external URLs) without
 *     bypassing the type entirely.
 */

type BaseNavItem = {
  title: string;
  badge?: string;
  icon?: React.ElementType;
};

type NavLink = BaseNavItem & {
  url: Exclude<LinkProps['to'], undefined> | (string & {});
  items?: never;
};

type NavCollapsible = BaseNavItem & {
  items: (BaseNavItem & { url: Exclude<LinkProps['to'], undefined> | (string & {}) })[];
  url?: never;
};

type NavItem = NavCollapsible | NavLink;

type NavGroup = {
  title: string;
  items: NavItem[];
};

export type { NavCollapsible, NavGroup, NavItem, NavLink };
