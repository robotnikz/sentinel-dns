import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import Sidebar from '../../components/Sidebar';

function mockFetchOnceJson(urlToResponse: Record<string, any>) {
  vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = urlToResponse[url];
    if (body === undefined) {
      return {
        ok: false,
        status: 404,
        json: async () => ({})
      } as any;
    }
    return {
      ok: true,
      status: 200,
      json: async () => body
    } as any;
  });
}

describe('Sidebar', () => {
  it('calls setActivePage when clicking a menu item', () => {
    const setActivePage = vi.fn();

    render(
      <Sidebar
        activePage="dashboard"
        setActivePage={setActivePage}
        isCollapsed={false}
        toggleSidebar={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Query Log' }));
    expect(setActivePage).toHaveBeenCalledWith('logs');
  });

  it('loads and renders system status metrics', async () => {
    mockFetchOnceJson({
      '/api/health': { ok: true },
      '/api/version': { version: '0.0.0-test' },
      '/api/metrics/summary?hours=24': {
        windowHours: 24,
        totalQueries: 10,
        blockedQueries: 1,
        activeClients: 2
      }
    });

    render(
      <Sidebar
        activePage="dashboard"
        setActivePage={() => undefined}
        isCollapsed={false}
        toggleSidebar={() => undefined}
      />
    );

    expect(screen.getByText('Loading…')).toBeInTheDocument();

    // Wait for the async system status to resolve.
    expect(await screen.findByText('Queries (24h)')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText(/10%/)).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('uses titles for collapsed nav items', () => {
    const setActivePage = vi.fn();

    render(
      <Sidebar
        activePage="dashboard"
        setActivePage={setActivePage}
        isCollapsed={true}
        toggleSidebar={() => undefined}
      />
    );

    // When collapsed, the label text is hidden but title should exist.
    const overview = screen.getByTitle('Overview');
    fireEvent.click(overview);
    expect(setActivePage).toHaveBeenCalledWith('dashboard');
  });
});
