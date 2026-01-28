import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ClientsProvider, useClients } from '../../contexts/ClientsContext';

function Consumer() {
  const { clients } = useClients();
  return <div>clients:{clients.length}</div>;
}

describe('ClientsContext', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('loads clients from /api/clients on mount', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          items: [
            {
              id: 'device-1',
              name: 'Device 1',
              type: 'smartphone',
              ip: '192.168.1.10',
              status: 'online'
            }
          ]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as any;

    render(
      <ClientsProvider>
        <Consumer />
      </ClientsProvider>
    );

    await waitFor(() => expect(screen.getByText('clients:1')).toBeInTheDocument());
    expect(globalThis.fetch).toHaveBeenCalled();
  });
});
