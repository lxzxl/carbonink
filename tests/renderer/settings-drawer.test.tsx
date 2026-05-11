import { SettingsDrawer } from '@renderer/components/settings-drawer';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

describe('SettingsDrawer', () => {
  afterEach(() => {
    cleanup();
  });

  it('is not in DOM when open=false', () => {
    render(<SettingsDrawer open={false} onOpenChange={() => {}} />);
    expect(screen.queryByText('Settings')).toBeNull();
  });

  it('renders when open=true', () => {
    render(<SettingsDrawer open={true} onOpenChange={() => {}} />);
    expect(screen.getByText('Settings')).toBeTruthy();
  });

  it('shows placeholder text when no children given', () => {
    render(<SettingsDrawer open={true} onOpenChange={() => {}} />);
    expect(screen.getByText(/Settings panels will land/)).toBeTruthy();
  });

  it('renders custom children', () => {
    render(
      <SettingsDrawer open={true} onOpenChange={() => {}}>
        <div>custom content</div>
      </SettingsDrawer>,
    );
    expect(screen.getByText('custom content')).toBeTruthy();
  });
});
