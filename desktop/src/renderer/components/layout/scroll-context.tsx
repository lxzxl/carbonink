import { createContext, useContext } from 'react';

/**
 * ScrollContext — exposes a boolean "has scroll passed the chrome
 * threshold?" so the Header can show a shadow without each consumer
 * needing direct access to the scroll container.
 *
 * Upstream shadcn-admin's Header listens directly to
 * `document.body.scrollTop` because their entire app uses native
 * window scroll. carbonink's scroll container is the
 * `<div overflow-auto>` inside SidebarInset, not the window — so
 * `document.body.scrollTop` is always 0 and the upstream listener
 * would never fire.
 *
 * We model this as a boolean ("scrolled") rather than a number
 * ("scrollY") on purpose: setting state on every scroll pixel would
 * re-render the entire content tree at 60+ Hz. Setting it only when
 * the threshold is crossed (or returned to 0) means the provider only
 * re-renders twice per scroll arc, regardless of how far the user
 * scrolls.
 */
const ScrollContext = createContext<{ scrolled: boolean }>({ scrolled: false });

export function ScrollProvider({
  scrolled,
  children,
}: {
  scrolled: boolean;
  children: React.ReactNode;
}) {
  return <ScrollContext.Provider value={{ scrolled }}>{children}</ScrollContext.Provider>;
}

export function useIsScrolled(): boolean {
  return useContext(ScrollContext).scrolled;
}
