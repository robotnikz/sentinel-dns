import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import DnsSettings from '../../pages/DnsSettings';

describe('DNS settings page', () => {
  it('renders without crashing', async () => {
    render(<DnsSettings />);

    expect(await screen.findByText('DNS Configuration')).toBeInTheDocument();
  });
});
