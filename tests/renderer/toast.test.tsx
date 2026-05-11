import { Toaster, toast } from '@renderer/components/toast';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

describe('Toaster', () => {
  it('renders and shows a toast message when toast() is called', async () => {
    render(<Toaster />);
    toast.success('hello world');
    await waitFor(() => {
      expect(screen.getByText('hello world')).toBeTruthy();
    });
  });

  it('shows distinct error toast styling for toast.error()', async () => {
    render(<Toaster />);
    toast.error('oops');
    await waitFor(() => {
      expect(screen.getByText('oops')).toBeTruthy();
    });
  });
});
