import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import Clients from '../../pages/Clients';
import { ClientsProvider } from '../../contexts/ClientsContext';

describe('Clients page', () => {
  it('renders without crashing', async () => {
    render(
      <ClientsProvider>
        <Clients />
      </ClientsProvider>
    );

    expect(await screen.findByText('Access Control')).toBeInTheDocument();
  });
});
