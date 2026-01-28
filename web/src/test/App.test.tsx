import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Keep this test focused on App gating logic; avoid executing the full setup wizard.
vi.mock('../pages/Setup', async () => {
  const React = await import('react');
  return { default: () => React.createElement('div', null, 'Setup') };
});

import App from '../App';

describe('App', () => {
  it('renders initial loading state and does not crash', () => {
    render(<App />);

    // Initial state before auth gate resolves.
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });
});
