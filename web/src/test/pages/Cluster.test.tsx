import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import Cluster from '../../pages/Cluster';

describe('Cluster / HA page', () => {
  it('renders without crashing (regression)', async () => {
    render(<Cluster />);

    // If the component throws during render, the test will fail before this point.
    expect(await screen.findByText('Status')).toBeInTheDocument();
  });
});
