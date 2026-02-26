import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../components/Sidebar', async () => {
  const React = await import('react');
  return { default: () => React.createElement('div', null) };
});

// Keep tests focused on App gating + command palette; avoid executing full pages.
vi.mock('../pages/Setup', async () => {
  const React = await import('react');
  return { default: () => React.createElement('div', null, 'Setup') };
});
vi.mock('../pages/Dashboard', async () => {
  const React = await import('react');
  return { default: () => React.createElement('div', null, 'Dashboard') };
});
vi.mock('../pages/QueryLogs', async () => {
  const React = await import('react');
  return { default: () => React.createElement('div', null, 'QueryLogs') };
});
vi.mock('../pages/Clients', async () => {
  const React = await import('react');
  return { default: () => React.createElement('div', null, 'Clients') };
});
vi.mock('../pages/Blocking', async () => {
  const React = await import('react');
  return { default: () => React.createElement('div', null, 'Blocking') };
});
vi.mock('../pages/DnsSettings', async () => {
  const React = await import('react');
  return { default: () => React.createElement('div', null, 'DnsSettings') };
});
vi.mock('../pages/NetworkMap', async () => {
  const React = await import('react');
  return { default: () => React.createElement('div', null, 'NetworkMap') };
});
vi.mock('../pages/Settings2', async () => {
  const React = await import('react');
  return { default: () => React.createElement('div', null, 'Settings') };
});
vi.mock('../pages/Cluster', async () => {
  const React = await import('react');
  return { default: () => React.createElement('div', null, 'Cluster') };
});

import App from '../App';

type MockResponse = { ok: boolean; json: () => Promise<any> };

function okJson(body: any): MockResponse {
  return { ok: true, json: async () => body };
}

function errJson(body: any = {}): MockResponse {
  return { ok: false, json: async () => body };
}

describe('App capability gating', () => {
  it('hides Cluster/HA and Tailscale entries from Cmd/Ctrl+K search when unavailable', async () => {
    (globalThis.fetch as any) = vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : String(input?.url || '');

      if (url.startsWith('/api/auth/status')) return okJson({ configured: true });
      if (url.startsWith('/api/auth/me')) return okJson({ loggedIn: true, username: 'admin' });
      if (url.startsWith('/api/protection/pause')) return okJson({ active: false, mode: 'OFF', until: null, remainingMs: null });
      if (url.startsWith('/api/notifications/feed/unread-count')) return okJson({ count: 0 });

      if (url.startsWith('/api/cluster/peer-status')) {
        return okJson({
          clusterEnabled: false,
          haAvailable: false,
          local: { ready: { configuredRole: 'standalone' } },
          peers: []
        });
      }

      if (url.startsWith('/api/tailscale/status')) return okJson({ supported: true, available: false, running: false });

      return errJson();
    });

    const user = userEvent.setup();
    render(<App />);

    const openSearch = await screen.findByPlaceholderText('CTRL+K to search...');
    await user.click(openSearch);

    await screen.findByPlaceholderText('Search pages and settings…');

    await waitFor(() => {
      expect(screen.queryByText('Cluster / HA')).not.toBeInTheDocument();
      expect(screen.queryByText('Settings: Tailscale / VPN')).not.toBeInTheDocument();
    });
  });

  it('redirects away from #cluster when HA is unavailable', async () => {
    window.location.hash = '#cluster';

    (globalThis.fetch as any) = vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : String(input?.url || '');

      if (url.startsWith('/api/auth/status')) return okJson({ configured: true });
      if (url.startsWith('/api/auth/me')) return okJson({ loggedIn: true, username: 'admin' });
      if (url.startsWith('/api/protection/pause')) return okJson({ active: false, mode: 'OFF', until: null, remainingMs: null });
      if (url.startsWith('/api/notifications/feed/unread-count')) return okJson({ count: 0 });

      if (url.startsWith('/api/cluster/peer-status')) {
        return okJson({
          clusterEnabled: false,
          haAvailable: false,
          local: { ready: { configuredRole: 'standalone' } },
          peers: []
        });
      }

      if (url.startsWith('/api/tailscale/status')) return okJson({ supported: true, available: false, running: false });

      return errJson();
    });

    render(<App />);

    await waitFor(() => {
      expect(window.location.hash).toBe('#dashboard');
    });
  });
});
