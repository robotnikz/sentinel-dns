import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import Dashboard from '../../pages/Dashboard';
import { RulesProvider } from '../../contexts/RulesContext';
import { ClientsProvider } from '../../contexts/ClientsContext';

vi.mock('recharts', async () => {
  // Minimal stubs to avoid ResizeObserver/layout issues in jsdom.
  const React = await import('react');
  const div = () => (props: any) => React.createElement('div', null, props?.children);
  const svg = () => (props: any) => React.createElement('svg', null, props?.children);
  const g = () => (props: any) => React.createElement('g', null, props?.children);
  return {
    ResponsiveContainer: div(),
    AreaChart: svg(),
    Area: g(),
    CartesianGrid: g(),
    Tooltip: g(),
    XAxis: g(),
    YAxis: g()
  };
});

vi.mock('../../components/WorldMap', async () => {
  const React = await import('react');
  return {
    default: () => React.createElement('div', { 'data-testid': 'world-map' }),
  };
});

describe('Dashboard page', () => {
  it('renders without crashing', async () => {
    render(
      <RulesProvider>
        <ClientsProvider>
          <Dashboard />
        </ClientsProvider>
      </RulesProvider>
    );

    expect(await screen.findByText('Traffic Analysis')).toBeInTheDocument();
  });
});
