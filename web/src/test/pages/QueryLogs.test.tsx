import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import QueryLogs from '../../pages/QueryLogs';
import { RulesProvider } from '../../contexts/RulesContext';
import { ClientsProvider } from '../../contexts/ClientsContext';

describe('Query logs page', () => {
  it('renders without crashing', async () => {
    render(
      <RulesProvider>
        <ClientsProvider>
          <QueryLogs />
        </ClientsProvider>
      </RulesProvider>
    );

    expect(await screen.findByText('Query Log')).toBeInTheDocument();
  });
});
