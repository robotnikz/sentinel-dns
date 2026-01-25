import React, { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  Check,
  Copy,
  ExternalLink,
  Globe,
  KeyRound,
  Lock,
  Network,
  Power,
  RefreshCw,
  Route,
  Save,
  Shield,
  Sparkles
} from 'lucide-react';
import { getAuthHeaders } from '../services/apiClient';

type GeoIpStatus = {
  geoip: { available: boolean; dbPath: string };
  editionId: string;
  hasLicenseKey: boolean;
  lastUpdatedAt: string | null;
  lastError: string;
};

type TailscaleStatus = {
  supported: boolean;
  running: boolean;
  backendState?: string;
  hasAuthKey?: boolean;
  self?: {
    hostName: string;
    dnsName: string;
    tailscaleIps: string[];
  };
  prefs?: {
    advertiseExitNode: boolean;
    advertiseRoutes: string[];
    snatSubnetRoutes: boolean;
    corpDns: boolean;
    wantRunning: boolean;
    loggedOut?: boolean;
  } | null;
  error?: string;
  message?: string;
  details?: string;
};

type TailscaleUpResponse =
  | { ok: true }
  | { ok: false; needsLogin: true; authUrl: string; message?: string }
  | { error?: string; message?: string; details?: string };

type TailscaleAuthUrlResponse =
  | { ok: true; authUrl?: string; alreadyLoggedIn?: boolean; message?: string }
  | { ok: false; error?: string; message?: string; details?: string };

type SettingsResponse = { items: Array<{ key: string; value: any }> };
type SecretsStatusResponse = { configured?: { gemini?: boolean; openai?: boolean } };

function classNames(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

async function safeJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function splitAdvertiseRoutes(routes: string[]): { exitNodeDefaults: string[]; subnetRoutes: string[] } {
  const exitNodeDefaults: string[] = [];
  const subnetRoutes: string[] = [];
  for (const r of routes) {
    if (r === '0.0.0.0/0' || r === '::/0') exitNodeDefaults.push(r);
    else subnetRoutes.push(r);
  }
  return { exitNodeDefaults, subnetRoutes };
}

const Settings2: React.FC<{
  presetTab?: 'general' | 'geoip' | 'remote' | 'notifications' | null;
  onPresetConsumed?: () => void;
}> = ({ presetTab, onPresetConsumed }) => {
  const [tab, setTab] = useState<'general' | 'geoip' | 'remote' | 'notifications'>('general');

  useEffect(() => {
    if (!presetTab) return;
    setTab(presetTab);
    onPresetConsumed?.();
  }, [presetTab, onPresetConsumed]);

  // AI keys
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [openAiApiKey, setOpenAiApiKey] = useState('');
  const [aiMsg, setAiMsg] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiSecretsStatus, setAiSecretsStatus] = useState<{ gemini: boolean; openai: boolean } | null>(null);

  // GeoIP
  const [geoIpStatus, setGeoIpStatus] = useState<GeoIpStatus | null>(null);
  const [maxMindLicenseKey, setMaxMindLicenseKey] = useState('');
  const [geoBusy, setGeoBusy] = useState(false);
  const [geoMsg, setGeoMsg] = useState('');

  // Tailscale
  const [tailscaleStatus, setTailscaleStatus] = useState<TailscaleStatus | null>(null);
  const [tailscaleHostname, setTailscaleHostname] = useState('');
  const [tailscaleAuthKey, setTailscaleAuthKey] = useState('');
  const [tailscaleAdvertiseExitNode, setTailscaleAdvertiseExitNode] = useState(false);
  const [tailscaleRoutesInput, setTailscaleRoutesInput] = useState('');
  const [tailscaleSnatSubnetRoutes, setTailscaleSnatSubnetRoutes] = useState(true);
  const [tailscaleMsg, setTailscaleMsg] = useState('');
  const [tailscaleBusy, setTailscaleBusy] = useState(false);
  const [tailscaleAuthPolling, setTailscaleAuthPolling] = useState(false);

  // Notifications
  const [discordUrl, setDiscordUrl] = useState('');
  const [notificationEvents, setNotificationEvents] = useState({
    anomalyDetected: true,
    protectionPause: true,
    blocklistRefreshFailed: true,
    geoIpUpdated: true
  });
  const [notifMsg, setNotifMsg] = useState('');
  const [notifBusy, setNotifBusy] = useState(false);

  const tailscaleIp = useMemo(() => {
    const ips = tailscaleStatus?.self?.tailscaleIps || [];
    return ips.find((ip) => ip.includes('.')) || ips[0] || '';
  }, [tailscaleStatus]);

  const isTailscaleConnected = useMemo(() => {
    const backend = String(tailscaleStatus?.backendState || '').toLowerCase();
    return !!tailscaleStatus?.running && backend === 'running' && tailscaleStatus?.prefs?.loggedOut !== true;
  }, [tailscaleStatus]);

  const desiredSubnetRoutes = useMemo(() => {
    return tailscaleRoutesInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }, [tailscaleRoutesInput]);

  const effectiveAdvertisedRoutes = useMemo(() => {
    const routes = Array.isArray(tailscaleStatus?.prefs?.advertiseRoutes) ? tailscaleStatus!.prefs!.advertiseRoutes : [];
    return splitAdvertiseRoutes(routes);
  }, [tailscaleStatus]);

  const hasTailscaleChanges = useMemo(() => {
    if (!tailscaleStatus?.prefs) return false;

    const currentHostName = String(tailscaleStatus?.self?.hostName ?? '').trim();
    const desiredHostName = tailscaleHostname.trim();
    const hostNameChanged = desiredHostName !== '' && desiredHostName !== currentHostName;

    const exitNodeChanged = !!tailscaleAdvertiseExitNode !== !!tailscaleStatus.prefs.advertiseExitNode;
    const snatChanged = !!tailscaleSnatSubnetRoutes !== !!tailscaleStatus.prefs.snatSubnetRoutes;

    const currentSubnetRoutes = effectiveAdvertisedRoutes.subnetRoutes;
    const desired = desiredSubnetRoutes;

    const routesChanged =
      currentSubnetRoutes.length !== desired.length ||
      currentSubnetRoutes.some((r) => !desired.includes(r)) ||
      desired.some((r) => !currentSubnetRoutes.includes(r));

    return hostNameChanged || exitNodeChanged || snatChanged || routesChanged;
  }, [
    tailscaleStatus,
    tailscaleHostname,
    tailscaleAdvertiseExitNode,
    tailscaleSnatSubnetRoutes,
    desiredSubnetRoutes,
    effectiveAdvertisedRoutes.subnetRoutes
  ]);

  const refreshGeoIpStatus = async (): Promise<void> => {
    try {
      const res = await fetch('/api/geoip/status', { headers: { ...getAuthHeaders() } });
      const data = await safeJson(res);
      if (res.ok && data?.geoip) setGeoIpStatus(data as GeoIpStatus);
      else setGeoIpStatus(null);
    } catch {
      setGeoIpStatus(null);
    }
  };

  const refreshTailscaleStatus = async (): Promise<TailscaleStatus | null> => {
    try {
      const res = await fetch('/api/tailscale/status', { headers: { ...getAuthHeaders() } });
      const data = await safeJson(res);
      if (res.ok && data?.supported) {
        const s = data as TailscaleStatus;
        setTailscaleStatus(s);
        setTailscaleHostname((prev) => {
          if (prev.trim()) return prev;
          const hn = String(s?.self?.hostName ?? '').trim();
          return hn;
        });
        if (s.prefs) {
          setTailscaleAdvertiseExitNode(!!s.prefs.advertiseExitNode);
          setTailscaleSnatSubnetRoutes(!!s.prefs.snatSubnetRoutes);
          // Do not show exit-node default routes in the subnet routes input.
          const rawRoutes = Array.isArray(s.prefs.advertiseRoutes) ? s.prefs.advertiseRoutes : [];
          const filtered = rawRoutes.filter((r) => r !== '0.0.0.0/0' && r !== '::/0');
          setTailscaleRoutesInput(filtered.join(','));
        }
        return s;
      }
      setTailscaleStatus(null);
      return null;
    } catch {
      setTailscaleStatus(null);
      return null;
    }
  };

  const loadDiscordWebhook = async (): Promise<void> => {
    try {
      const res = await fetch('/api/settings');
      const data = (await safeJson(res)) as SettingsResponse | null;
      const item = data?.items?.find((i) => i.key === 'discord_webhook');
      const raw = item?.value;
      const url = typeof raw === 'string' ? raw : typeof raw?.url === 'string' ? raw.url : '';
      if (url) setDiscordUrl(url);
    } catch {
      // ignore
    }
  };

  const loadNotificationEvents = async (): Promise<void> => {
    try {
      const res = await fetch('/api/settings');
      const data = (await safeJson(res)) as SettingsResponse | null;
      const item = data?.items?.find((i) => i.key === 'notification_events');
      const raw = item?.value as any;
      if (!raw || typeof raw !== 'object') return;
      setNotificationEvents({
        anomalyDetected: raw.anomalyDetected !== false,
        protectionPause: raw.protectionPause !== false,
        blocklistRefreshFailed: raw.blocklistRefreshFailed !== false,
        geoIpUpdated: raw.geoIpUpdated !== false
      });
    } catch {
      // ignore
    }
  };

  const refreshSecretsStatus = async (): Promise<void> => {
    try {
      const res = await fetch('/api/secrets/status', { headers: { ...getAuthHeaders() } });
      const data = (await safeJson(res)) as SecretsStatusResponse | null;
      if (!res.ok || !data || typeof data !== 'object') {
        setAiSecretsStatus(null);
        return;
      }
      const configured = (data as any).configured || {};
      setAiSecretsStatus({ gemini: !!configured.gemini, openai: !!configured.openai });
    } catch {
      setAiSecretsStatus(null);
    }
  };

  const StatusPill = (props: {
    label: string;
    value: string;
    tone: 'ok' | 'bad' | 'neutral';
  }) => (
    <span
      className={classNames(
        'inline-flex items-center gap-2 px-2.5 py-1 rounded border text-[10px] font-bold uppercase tracking-wide',
        props.tone === 'ok'
          ? 'bg-emerald-950/30 text-emerald-400 border-emerald-900/50'
          : props.tone === 'bad'
            ? 'bg-rose-950/30 text-rose-400 border-rose-900/50'
            : 'bg-zinc-900/50 text-zinc-300 border-zinc-800'
      )}
    >
      <span className="text-zinc-500 font-mono">{props.label}</span>
      <span className="text-zinc-200">{props.value}</span>
    </span>
  );

  const yesNoPillProps = (label: string, v: boolean | null | undefined) => {
    if (v === true) return { label, value: 'YES', tone: 'ok' as const };
    if (v === false) return { label, value: 'NO', tone: 'bad' as const };
    return { label, value: 'UNKNOWN', tone: 'neutral' as const };
  };

  useEffect(() => {
    void refreshGeoIpStatus();
    void refreshTailscaleStatus();
    void refreshSecretsStatus();
    void loadDiscordWebhook();
    void loadNotificationEvents();
  }, []);

  const saveAiKeys = async () => {
    setAiMsg('');
    const gemini = geminiApiKey.trim();
    const openai = openAiApiKey.trim();
    if (!gemini && !openai) {
      setAiMsg('Enter at least one key.');
      return;
    }

    setAiBusy(true);
    try {
      if (gemini) {
        await fetch('/api/secrets/gemini_api_key', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify({ value: gemini })
        });
        setGeminiApiKey('');
      }

      if (openai) {
        await fetch('/api/secrets/openai_api_key', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify({ value: openai })
        });
        setOpenAiApiKey('');
      }

      setAiMsg('Saved');
      await refreshSecretsStatus();
    } catch {
      setAiMsg('Backend not reachable.');
    } finally {
      setAiBusy(false);
    }
  };

  const saveMaxMindKey = async () => {
    setGeoMsg('');
    const key = maxMindLicenseKey.trim();
    if (!key) {
      setGeoMsg('Please enter a MaxMind license key.');
      return;
    }
    try {
      const res = await fetch('/api/secrets/maxmind_license_key', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ value: key })
      });
      const data = await safeJson(res);
      if (!res.ok) {
        setGeoMsg(data?.message || 'Failed to store license key.');
        return;
      }
      setMaxMindLicenseKey('');

      setGeoMsg('License key saved. Downloading GeoLite2-City…');
      setGeoBusy(true);
      try {
        const upd = await fetch('/api/geoip/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify({})
        });
        const updData = await safeJson(upd);
        if (!upd.ok) {
          const msg = updData?.message || updData?.error || 'GeoIP update failed.';
          const details = typeof updData?.details === 'string' && updData.details ? ` ${updData.details}` : '';
          setGeoMsg(`${msg}${details}`);
          return;
        }
        setGeoMsg('GeoIP City database updated.');
      } finally {
        setGeoBusy(false);
        await refreshGeoIpStatus();
      }
    } catch {
      setGeoMsg('Backend not reachable.');
    }
  };

  const updateGeoIpDb = async () => {
    setGeoMsg('');
    setGeoBusy(true);
    try {
      const key = maxMindLicenseKey.trim();
      const res = await fetch('/api/geoip/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(key ? { licenseKey: key } : {})
      });
      const data = await safeJson(res);
      if (!res.ok) {
        const msg = data?.message || data?.error || 'GeoIP update failed.';
        const details = typeof data?.details === 'string' && data.details ? ` ${data.details}` : '';
        setGeoMsg(`${msg}${details}`);
        return;
      }
      setGeoMsg('GeoIP database updated.');
      await refreshGeoIpStatus();
    } catch {
      setGeoMsg('Backend not reachable.');
    } finally {
      setGeoBusy(false);
    }
  };

  const saveTailscaleAuthKey = async () => {
    setTailscaleMsg('');
    const key = tailscaleAuthKey.trim();
    if (!key) {
      setTailscaleMsg('Please enter a Tailscale auth key.');
      return;
    }
    try {
      const res = await fetch('/api/secrets/tailscale_auth_key', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ value: key })
      });
      const data = await safeJson(res);
      if (!res.ok) {
        setTailscaleMsg(data?.message || 'Failed to store auth key.');
        return;
      }
      setTailscaleAuthKey('');
      setTailscaleMsg('Auth key saved.');
      await refreshTailscaleStatus();
    } catch {
      setTailscaleMsg('Backend not reachable.');
    }
  };

  const authenticateTailscaleInBrowser = async () => {
    setTailscaleMsg('Opening Tailscale login…');

    const popup = window.open('about:blank', '_blank');
    if (!popup) {
      setTailscaleMsg('Popup blocked. Please allow popups and try again.');
      return;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (popup as any).opener = null;
      popup.document.title = 'Tailscale Login';
      popup.document.body.innerHTML = '<p style="font-family: ui-sans-serif, system-ui; padding: 16px;">Starting Tailscale login…</p>';
    } catch {
      // ignore
    }

    setTailscaleBusy(true);
    setTailscaleAuthPolling(false);
    try {
      const res = await fetch('/api/tailscale/auth-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({})
      });
      const data = (await safeJson(res)) as TailscaleAuthUrlResponse | null;

      if (!res.ok || !data || (data as any).ok !== true) {
        const msg = (data as any)?.message || (data as any)?.error || 'Failed to start Tailscale browser authentication.';
        setTailscaleMsg(msg);
        try {
          popup.document.body.innerHTML = `<p style="font-family: ui-sans-serif, system-ui; padding: 16px;">${msg}</p>`;
        } catch {
          // ignore
        }
        return;
      }

      const urlRaw = (data as any).authUrl;
      const url = typeof urlRaw === 'string' ? urlRaw : '';

      if (!url) {
        const msg = (data as any)?.message || ((data as any)?.alreadyLoggedIn ? 'Already logged in.' : 'No login URL returned.');
        setTailscaleMsg(msg);
        try {
          popup.document.body.innerHTML = `<p style="font-family: ui-sans-serif, system-ui; padding: 16px;">${msg}</p>`;
        } catch {
          // ignore
        }
      } else {
        try {
          popup.location.href = url;
        } catch {
          setTailscaleMsg('Could not redirect popup. Copy the URL manually.');
          try {
            popup.document.body.innerHTML = `<p style="font-family: ui-sans-serif, system-ui; padding: 16px;">Open this URL:</p><pre style="padding: 16px; white-space: pre-wrap;">${url}</pre>`;
          } catch {
            // ignore
          }
          return;
        }
        setTailscaleMsg('Complete login in the new tab. Waiting for connection…');
      }

      setTailscaleAuthPolling(true);
      const startedAt = Date.now();
      const maxMs = 60_000;
      while (Date.now() - startedAt < maxMs) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 2000));
        // eslint-disable-next-line no-await-in-loop
        const st = await refreshTailscaleStatus();
        if (st?.running && (st?.backendState || '').toLowerCase() === 'running') {
          setTailscaleMsg('Connected.');
          break;
        }
      }

      if (Date.now() - startedAt >= maxMs) {
        setTailscaleMsg('Still waiting for Tailscale. If you already completed login, click Refresh Status.');
      }
    } catch {
      setTailscaleMsg('Backend not reachable.');
      try {
        popup.document.body.innerHTML = '<p style="font-family: ui-sans-serif, system-ui; padding: 16px;">Backend not reachable.</p>';
      } catch {
        // ignore
      }
    } finally {
      setTailscaleBusy(false);
      setTailscaleAuthPolling(false);
    }
  };

  const connectTailscale = async () => {
    setTailscaleMsg('');
    setTailscaleBusy(true);
    try {
      const routes = desiredSubnetRoutes;

      const res = await fetch('/api/tailscale/up', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          hostname: tailscaleHostname.trim() || undefined,
          advertiseExitNode: tailscaleAdvertiseExitNode,
          advertiseRoutes: routes.length > 0 ? routes : undefined,
          snatSubnetRoutes: tailscaleSnatSubnetRoutes,
          acceptDns: false
        })
      });

      const data = (await safeJson(res)) as TailscaleUpResponse | null;
      if (!res.ok) {
        setTailscaleMsg((data as any)?.message || (data as any)?.error || 'Tailscale connect failed.');
        return;
      }

      if ((data as any)?.needsLogin && typeof (data as any)?.authUrl === 'string') {
        setTailscaleMsg('Needs login. Click Authenticate in Browser (recommended).');
        return;
      }

      setTailscaleMsg('Connected.');
      await refreshTailscaleStatus();
    } catch {
      setTailscaleMsg('Backend not reachable.');
    } finally {
      setTailscaleBusy(false);
    }
  };

  const applyTailscaleConfig = async () => {
    setTailscaleMsg('');
    setTailscaleBusy(true);
    try {
      const routes = desiredSubnetRoutes;

      const res = await fetch('/api/tailscale/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          hostname: tailscaleHostname.trim() || undefined,
          advertiseExitNode: tailscaleAdvertiseExitNode,
          advertiseRoutes: routes,
          snatSubnetRoutes: tailscaleSnatSubnetRoutes,
          acceptDns: false
        })
      });

      const data = await safeJson(res);
      if (!res.ok) {
        setTailscaleMsg(data?.message || data?.error || 'Failed to apply Tailscale config.');
        return;
      }

      if ((data as any)?.needsLogin && typeof (data as any)?.authUrl === 'string') {
        setTailscaleMsg('Needs login. Click Authenticate in Browser, then try again.');
        return;
      }

      setTailscaleMsg('Configuration applied.');
      await refreshTailscaleStatus();
    } catch {
      setTailscaleMsg('Backend not reachable.');
    } finally {
      setTailscaleBusy(false);
    }
  };

  const disconnectTailscale = async () => {
    setTailscaleMsg('');
    setTailscaleBusy(true);
    try {
      const res = await fetch('/api/tailscale/down', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({})
      });
      const data = await safeJson(res);
      if (!res.ok) {
        setTailscaleMsg(data?.message || data?.error || 'Tailscale disconnect failed.');
        return;
      }
      setTailscaleMsg('Disconnected.');
      await refreshTailscaleStatus();
    } catch {
      setTailscaleMsg('Backend not reachable.');
    } finally {
      setTailscaleBusy(false);
    }
  };

  const saveNotificationSettings = async () => {
    setNotifMsg('');
    setNotifBusy(true);
    try {
      const res = await fetch('/api/settings/discord_webhook', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ url: discordUrl.trim() })
      });
      const data = await safeJson(res);
      if (!res.ok) {
        setNotifMsg(data?.message || data?.error || 'Failed to save webhook.');
        return;
      }
      setNotifMsg('Saved.');
    } catch {
      setNotifMsg('Backend not reachable.');
    } finally {
      setNotifBusy(false);
    }
  };

  const saveNotificationEvents = async () => {
    setNotifMsg('');
    setNotifBusy(true);
    try {
      const res = await fetch('/api/settings/notification_events', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(notificationEvents)
      });
      const data = await safeJson(res);
      if (!res.ok) {
        setNotifMsg(data?.message || data?.error || 'Failed to save events.');
        return;
      }
      setNotifMsg('Saved.');
    } catch {
      setNotifMsg('Backend not reachable.');
    } finally {
      setNotifBusy(false);
    }
  };

  const testNotification = async () => {
    setNotifMsg('');
    setNotifBusy(true);
    try {
      const res = await fetch('/api/notifications/discord/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({})
      });
      const data = await safeJson(res);
      if (!res.ok) {
        setNotifMsg(data?.message || data?.error || 'Test failed.');
        return;
      }
      setNotifMsg('Test sent.');
    } catch {
      setNotifMsg('Backend not reachable.');
    } finally {
      setNotifBusy(false);
    }
  };

  const tabs = [
    { id: 'general' as const, label: 'AI Keys', icon: Sparkles },
    { id: 'geoip' as const, label: 'GeoIP / World Map', icon: Globe },
    { id: 'remote' as const, label: 'Tailscale', icon: Network },
    { id: 'notifications' as const, label: 'Notifications', icon: Bell }
  ];

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="dashboard-card rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-[#27272a] bg-[#121214] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield className="w-5 h-5 text-emerald-500" />
            <div>
              <div className="text-white font-bold text-base uppercase tracking-wider">System Settings</div>
              <div className="text-xs text-zinc-500">Configure integrations, remote access, and notifications.</div>
            </div>
          </div>
        </div>

        <div className="border-b border-[#27272a] flex gap-1">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={classNames(
                  'flex items-center gap-2 px-4 py-2.5 text-xs font-medium border-b-2 transition-all',
                  active
                    ? 'border-emerald-500 text-white bg-[#18181b]'
                    : 'border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-[#18181b]/50'
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="p-4 sm:p-6">
        {tab === 'general' && (
          <div className="dashboard-card p-6 rounded-lg">
            <h2 className="text-white font-bold text-lg flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-indigo-500" /> AI Keys
            </h2>
            <p className="text-zinc-500 text-sm mt-1">Stored encrypted server-side (admin only).</p>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <StatusPill {...yesNoPillProps('Gemini', aiSecretsStatus?.gemini)} />
              <StatusPill {...yesNoPillProps('OpenAI', aiSecretsStatus?.openai)} />
            </div>

            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] uppercase font-bold text-zinc-500">Gemini API Key</label>
                <input
                  type="password"
                  value={geminiApiKey}
                  onChange={(e) => setGeminiApiKey(e.target.value)}
                  placeholder="AIza…"
                  className="mt-2 w-full bg-[#09090b] border border-[#27272a] text-zinc-200 px-3 py-2 rounded text-xs font-mono focus:outline-none focus:border-zinc-500"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase font-bold text-zinc-500">OpenAI API Key</label>
                <input
                  type="password"
                  value={openAiApiKey}
                  onChange={(e) => setOpenAiApiKey(e.target.value)}
                  placeholder="sk-…"
                  className="mt-2 w-full bg-[#09090b] border border-[#27272a] text-zinc-200 px-3 py-2 rounded text-xs font-mono focus:outline-none focus:border-zinc-500"
                />
              </div>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={saveAiKeys}
                disabled={aiBusy}
                className="btn-primary px-4 py-2 rounded text-xs font-bold flex items-center gap-2"
              >
                {aiBusy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                SAVE
              </button>
              {aiMsg && <div className="text-xs text-zinc-400">{aiMsg}</div>}
            </div>
          </div>
        )}

        {tab === 'geoip' && (
          <div className="space-y-6">
            <div className="dashboard-card p-6 rounded-lg">
              <h2 className="text-white font-bold text-lg flex items-center gap-2">
                <Globe className="w-5 h-5 text-indigo-500" /> GeoIP / World Map
              </h2>
              <p className="text-zinc-500 text-sm mt-1">Used to geolocate DNS answer IPs for the dashboard map.</p>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <StatusPill {...yesNoPillProps('GeoIP DB', geoIpStatus?.geoip?.available)} />
                <StatusPill {...yesNoPillProps('MaxMind Key', geoIpStatus?.hasLicenseKey)} />
              </div>

              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded border border-[#27272a] bg-[#09090b]">
                  <div className="text-[10px] uppercase font-bold text-zinc-500">DB Status</div>
                  <div className="mt-2 text-xs text-zinc-300">
                    Available: <span className={geoIpStatus?.geoip?.available ? 'text-emerald-500 font-bold' : 'text-rose-500 font-bold'}>{geoIpStatus?.geoip?.available ? 'YES' : 'NO'}</span>
                  </div>
                  <div className="mt-1 text-[11px] text-zinc-500">Edition: <span className="font-mono">{geoIpStatus?.editionId || '-'}</span></div>
                  <div className="mt-1 text-[11px] text-zinc-500">Path: <span className="font-mono">{geoIpStatus?.geoip?.dbPath || '-'}</span></div>
                  <div className="mt-1 text-[11px] text-zinc-500">Last update: <span className="font-mono">{geoIpStatus?.lastUpdatedAt || '-'}</span></div>
                  {geoIpStatus?.lastError ? <div className="mt-2 text-[11px] text-rose-400">{geoIpStatus.lastError}</div> : null}
                </div>

                <div className="p-4 rounded border border-[#27272a] bg-[#09090b]">
                  <div className="text-[10px] uppercase font-bold text-zinc-500">MaxMind License Key</div>
                  <div className="mt-2 text-xs text-zinc-300">
                    Stored: <span className={geoIpStatus?.hasLicenseKey ? 'text-emerald-500 font-bold' : 'text-rose-500 font-bold'}>{geoIpStatus?.hasLicenseKey ? 'YES' : 'NO'}</span>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <input
                      type="password"
                      value={maxMindLicenseKey}
                      onChange={(e) => setMaxMindLicenseKey(e.target.value)}
                      placeholder="MaxMind license key (stored encrypted)"
                      className="flex-1 bg-[#09090b] border border-[#27272a] text-zinc-200 px-3 py-2 rounded text-xs font-mono focus:outline-none focus:border-zinc-500"
                    />
                    <button
                      onClick={saveMaxMindKey}
                      className="px-3 py-2 rounded text-xs font-bold bg-[#18181b] border border-[#27272a] text-zinc-300 hover:bg-white hover:text-black hover:border-white transition-colors"
                    >
                      <span className="flex items-center gap-2"><Lock className="w-3.5 h-3.5" /> SAVE</span>
                    </button>
                  </div>
                  <div className="mt-2 text-[11px] text-zinc-500">Create a key in MaxMind and paste it here.</div>
                </div>
              </div>

              <div className="mt-4 flex items-center gap-3">
                <button
                  onClick={refreshGeoIpStatus}
                  className="px-3 py-2 rounded text-xs font-bold border bg-[#18181b] border-[#27272a] text-zinc-300 hover:bg-[#27272a] flex items-center gap-2"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> REFRESH
                </button>
                <button
                  onClick={updateGeoIpDb}
                  disabled={geoBusy}
                  className="btn-primary px-4 py-2 rounded text-xs font-bold flex items-center gap-2"
                >
                  {geoBusy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Globe className="w-3.5 h-3.5" />}
                  UPDATE DB
                </button>
                {geoMsg && <div className="text-xs text-zinc-400">{geoMsg}</div>}
              </div>
            </div>
          </div>
        )}

        {tab === 'remote' && (
          <div className="space-y-6">
            <div className="dashboard-card p-6 rounded-lg">
              <h2 className="text-white font-bold text-lg flex items-center gap-2">
                <Network className="w-5 h-5 text-indigo-500" /> Tailscale Remote Access
              </h2>
              <p className="text-zinc-500 text-sm mt-1">Official browser login (GitHub/Google/SSO) + accurate status from tailscaled.</p>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <StatusPill
                  label="Connection"
                  value={tailscaleStatus?.prefs?.loggedOut ? 'LOGGED OUT' : isTailscaleConnected ? 'OK' : 'NOT CONNECTED'}
                  tone={tailscaleStatus?.prefs?.loggedOut ? 'bad' : isTailscaleConnected ? 'ok' : 'bad'}
                />
                <StatusPill {...yesNoPillProps('Auth Key', tailscaleStatus?.hasAuthKey)} />
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <button
                    onClick={refreshTailscaleStatus}
                    disabled={tailscaleBusy}
                    className="px-3 py-2 rounded text-xs font-bold border bg-[#18181b] border-[#27272a] text-zinc-300 hover:bg-[#27272a] flex items-center gap-2"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Refresh Status
                  </button>

                  <button
                    onClick={authenticateTailscaleInBrowser}
                    disabled={tailscaleBusy || tailscaleAuthPolling}
                    className="px-3 py-2 rounded text-xs font-bold border bg-[#18181b] border-[#27272a] text-zinc-300 hover:bg-white hover:text-black hover:border-white transition-colors flex items-center gap-2"
                  >
                    {tailscaleBusy || tailscaleAuthPolling ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5" />}
                    {tailscaleStatus?.running && !tailscaleStatus?.prefs?.loggedOut ? 'Re-authenticate' : 'Authenticate'}
                  </button>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="p-4 rounded border border-[#27272a] bg-[#09090b]">
                  <div className="text-[10px] uppercase font-bold text-zinc-500">Status</div>
                  <div className="mt-2 text-xs text-zinc-300">
                    Backend: <span className="font-mono">{tailscaleStatus?.backendState || '-'}</span>
                  </div>
                  <div className="mt-1 text-[11px] text-zinc-500">DNS name: <span className="font-mono">{tailscaleStatus?.self?.dnsName || '-'}</span></div>
                  <div className="mt-1 text-[11px] text-zinc-500">IPs: <span className="font-mono">{(tailscaleStatus?.self?.tailscaleIps || []).join(', ') || '-'}</span></div>

                  <div className="mt-3 pt-3 border-t border-[#27272a]">
                    <div className="text-[10px] uppercase font-bold text-zinc-500">Effective Advertised Routes</div>
                    <div className="mt-2 text-[11px] text-zinc-500">
                      Exit-node defaults:
                      <span className="ml-2 font-mono text-zinc-300">
                        {effectiveAdvertisedRoutes.exitNodeDefaults.length > 0 ? effectiveAdvertisedRoutes.exitNodeDefaults.join(',') : '-'}
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] text-zinc-500">
                      Subnet routes:
                      <span className="ml-2 font-mono text-zinc-300">
                        {effectiveAdvertisedRoutes.subnetRoutes.length > 0 ? effectiveAdvertisedRoutes.subnetRoutes.join(',') : '-'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="p-4 rounded border border-[#27272a] bg-[#09090b]">
                  <div className="text-[10px] uppercase font-bold text-zinc-500">Auth Key (optional)</div>
                  <div className="mt-2 text-xs text-zinc-300">
                    Stored: <span className={tailscaleStatus?.hasAuthKey ? 'text-emerald-500 font-bold' : 'text-rose-500 font-bold'}>{tailscaleStatus?.hasAuthKey ? 'YES' : 'NO'}</span>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <input
                      type="password"
                      value={tailscaleAuthKey}
                      onChange={(e) => setTailscaleAuthKey(e.target.value)}
                      placeholder="Reusable auth key (stored encrypted)"
                      className="flex-1 bg-[#09090b] border border-[#27272a] text-zinc-200 px-3 py-2 rounded text-xs font-mono focus:outline-none focus:border-zinc-500"
                    />
                    <button
                      onClick={saveTailscaleAuthKey}
                      disabled={tailscaleBusy}
                      className="px-3 py-2 rounded text-xs font-bold bg-[#18181b] border border-[#27272a] text-zinc-300 hover:bg-white hover:text-black hover:border-white transition-colors"
                    >
                      <span className="flex items-center gap-2"><Lock className="w-3.5 h-3.5" /> SAVE</span>
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 lg:grid-cols-1 gap-4">
                <div className="p-4 rounded border border-[#27272a] bg-[#09090b]">
                  <div className="text-[10px] uppercase font-bold text-zinc-500">Routing Features</div>

                  <div className="mt-3 flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-zinc-300">Offer as exit node</div>
                      <div className="text-[11px] text-zinc-500">Other devices can choose this as an exit node.</div>
                    </div>
                    <button
                      onClick={() => setTailscaleAdvertiseExitNode((v) => !v)}
                      className={classNames(
                        'w-12 h-6 rounded-full relative transition-colors',
                        tailscaleAdvertiseExitNode ? 'bg-emerald-600' : 'bg-zinc-700'
                      )}
                      aria-label="Toggle exit node advertisement"
                      type="button"
                    >
                      <div
                        className={classNames(
                          'absolute top-1 w-4 h-4 bg-white rounded-full transition-all',
                          tailscaleAdvertiseExitNode ? 'right-1' : 'left-1'
                        )}
                      />
                    </button>
                  </div>

                  <div className="mt-3">
                    <label className="text-[10px] uppercase font-bold text-zinc-500">Advertise subnet routes (optional)</label>
                    <input
                      type="text"
                      value={tailscaleRoutesInput}
                      onChange={(e) => setTailscaleRoutesInput(e.target.value)}
                      placeholder="192.168.1.0/24,10.0.0.0/24"
                      className="mt-2 w-full bg-[#09090b] border border-[#27272a] text-zinc-200 px-3 py-2 rounded text-xs font-mono focus:outline-none focus:border-zinc-500"
                    />
                    <div className="mt-2 text-[11px] text-zinc-500">
                      Subnet routes must be approved in the Tailscale admin console. Exit-node default routes (0.0.0.0/0, ::/0) are managed by the toggle above and are hidden here.
                    </div>

                    {effectiveAdvertisedRoutes.subnetRoutes.length > 0 && (
                      <div className="mt-3 text-[11px] text-zinc-500">
                        Currently advertised subnet routes:
                        <span className="ml-2 font-mono text-zinc-300">{effectiveAdvertisedRoutes.subnetRoutes.join(',')}</span>
                      </div>
                    )}
                  </div>

                  <div className="mt-3 flex items-center justify-between p-3 border border-[#27272a] rounded bg-[#0b0b0d]">
                    <div>
                      <div className="text-xs font-bold text-zinc-300">SNAT subnet routes</div>
                      <div className="text-[11px] text-zinc-500">Recommended for containers</div>
                    </div>
                    <button
                      onClick={() => setTailscaleSnatSubnetRoutes((v) => !v)}
                      className={classNames(
                        'w-12 h-6 rounded-full relative transition-colors',
                        tailscaleSnatSubnetRoutes ? 'bg-emerald-600' : 'bg-zinc-700'
                      )}
                      aria-label="Toggle SNAT"
                      type="button"
                    >
                      <div
                        className={classNames(
                          'absolute top-1 w-4 h-4 bg-white rounded-full transition-all',
                          tailscaleSnatSubnetRoutes ? 'right-1' : 'left-1'
                        )}
                      />
                    </button>
                  </div>

                  <div className="mt-3">
                    <label className="text-[10px] uppercase font-bold text-zinc-500">Hostname (optional)</label>
                    <input
                      type="text"
                      value={tailscaleHostname}
                      onChange={(e) => setTailscaleHostname(e.target.value)}
                      placeholder="sentinel-dns"
                      className="mt-2 w-full bg-[#09090b] border border-[#27272a] text-zinc-200 px-3 py-2 rounded text-xs font-mono focus:outline-none focus:border-zinc-500"
                    />
                    <div className="mt-2 text-[11px] text-zinc-500">
                      Hostname changes require “Apply Changes” while connected.
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                    onClick={isTailscaleConnected ? disconnectTailscale : connectTailscale}
                  disabled={tailscaleBusy}
                    className={classNames(
                      'px-4 py-2 rounded text-xs font-bold flex items-center gap-2 border transition-colors',
                      isTailscaleConnected
                        ? 'bg-rose-950/20 border-rose-900/40 text-rose-300 hover:bg-rose-600 hover:text-white hover:border-rose-500'
                        : 'btn-primary'
                    )}
                >
                    {tailscaleBusy ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Power className="w-3.5 h-3.5" />
                    )}
                    {isTailscaleConnected ? 'Disconnect' : 'Connect'}
                </button>
                  <button
                    onClick={applyTailscaleConfig}
                    disabled={tailscaleBusy || !isTailscaleConnected || !hasTailscaleChanges}
                    className={classNames(
                      'btn-primary px-4 py-2 rounded text-xs font-bold flex items-center gap-2',
                      tailscaleBusy || !isTailscaleConnected || !hasTailscaleChanges ? 'opacity-50 cursor-not-allowed' : ''
                    )}
                  >
                    <Save className="w-3.5 h-3.5" /> Apply Changes
                  </button>
                {tailscaleMsg && <div className="text-xs text-zinc-400">{tailscaleMsg}</div>}
              </div>

              <div className="mt-6 p-4 rounded border border-[#27272a] bg-[#09090b]">
                <div className="text-[10px] uppercase font-bold text-zinc-500">Why you see 0 DNS requests</div>
                <div className="mt-2 text-xs text-zinc-500 leading-relaxed">
                  Sentinel only logs DNS that is sent to its DNS server (port 53). Being an exit node does not automatically make other devices use Sentinel for DNS.
                  To log queries from your tailnet devices, set your tailnet DNS nameserver to this node’s Tailscale IP.
                </div>

                <div className="mt-3 flex items-center gap-2">
                  <div className="text-xs text-zinc-400">Tailscale DNS IP:</div>
                  <div className="text-xs font-mono text-zinc-200">{tailscaleIp || '-'}</div>
                  <button
                    disabled={!tailscaleIp}
                    onClick={async () => {
                      if (!tailscaleIp) return;
                      const ok = await copyToClipboard(tailscaleIp);
                      setTailscaleMsg(ok ? 'Copied DNS IP.' : 'Copy failed.');
                    }}
                    className="ml-auto px-3 py-1.5 rounded text-xs font-bold border bg-[#18181b] border-[#27272a] text-zinc-300 hover:bg-[#27272a] flex items-center gap-2"
                  >
                    <Copy className="w-3.5 h-3.5" /> Copy
                  </button>
                </div>

                <div className="mt-3 text-[11px] text-zinc-500">
                  In the Tailscale admin console: DNS → Nameservers → Add nameserver → use the IP above. Then enable “Use Tailscale DNS” on clients.
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === 'notifications' && (
          <div className="dashboard-card p-6 rounded-lg">
            <h2 className="text-white font-bold text-lg flex items-center gap-2">
              <Bell className="w-5 h-5 text-indigo-500" /> Notifications
            </h2>
            <p className="text-zinc-500 text-sm mt-1">Discord webhook alerts (admin-only).</p>

            <div className="mt-6 p-4 rounded border border-[#27272a] bg-[#09090b]">
              <label className="text-[10px] uppercase font-bold text-zinc-500">Discord Webhook URL</label>
              <input
                type="text"
                value={discordUrl}
                onChange={(e) => setDiscordUrl(e.target.value)}
                placeholder="https://discord.com/api/webhooks/..."
                className="mt-2 w-full bg-[#09090b] border border-[#27272a] text-zinc-200 px-3 py-2 rounded text-xs font-mono focus:outline-none focus:border-zinc-500"
              />

              <div className="mt-3 flex items-center gap-3">
                <button
                  onClick={saveNotificationSettings}
                  disabled={notifBusy}
                  className="btn-primary px-4 py-2 rounded text-xs font-bold flex items-center gap-2"
                >
                  {notifBusy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  SAVE
                </button>
                <button
                  onClick={testNotification}
                  disabled={notifBusy}
                  className="px-4 py-2 rounded text-xs font-bold border bg-[#18181b] border-[#27272a] text-zinc-300 hover:bg-[#27272a] flex items-center gap-2"
                >
                  <Shield className="w-3.5 h-3.5" /> TEST
                </button>
                {notifMsg && <div className="text-xs text-zinc-400">{notifMsg}</div>}
              </div>

              <div className="mt-2 text-[11px] text-zinc-500">Only https://discord.com/api/webhooks/... is accepted.</div>
            </div>

            <div className="mt-4 p-4 rounded border border-[#27272a] bg-[#09090b]">
              <div className="text-[10px] uppercase font-bold text-zinc-500">Notification Events</div>
              <div className="mt-3 space-y-2">
                <label className="flex items-center gap-2 text-xs text-zinc-300">
                  <input
                    type="checkbox"
                    checked={notificationEvents.anomalyDetected}
                    onChange={(e) => setNotificationEvents((v) => ({ ...v, anomalyDetected: e.target.checked }))}
                  />
                  Suspicious activity detected
                </label>
                <label className="flex items-center gap-2 text-xs text-zinc-300">
                  <input
                    type="checkbox"
                    checked={notificationEvents.protectionPause}
                    onChange={(e) => setNotificationEvents((v) => ({ ...v, protectionPause: e.target.checked }))}
                  />
                  Protection paused/resumed
                </label>
                <label className="flex items-center gap-2 text-xs text-zinc-300">
                  <input
                    type="checkbox"
                    checked={notificationEvents.blocklistRefreshFailed}
                    onChange={(e) => setNotificationEvents((v) => ({ ...v, blocklistRefreshFailed: e.target.checked }))}
                  />
                  Blocklist refresh failed
                </label>
                <label className="flex items-center gap-2 text-xs text-zinc-300">
                  <input
                    type="checkbox"
                    checked={notificationEvents.geoIpUpdated}
                    onChange={(e) => setNotificationEvents((v) => ({ ...v, geoIpUpdated: e.target.checked }))}
                  />
                  GeoIP database updated
                </label>
              </div>

              <div className="mt-4 flex items-center gap-3">
                <button
                  onClick={saveNotificationEvents}
                  disabled={notifBusy}
                  className="btn-primary px-4 py-2 rounded text-xs font-bold flex items-center gap-2"
                >
                  {notifBusy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  SAVE EVENTS
                </button>
                {notifMsg && <div className="text-xs text-zinc-400">{notifMsg}</div>}
              </div>

              <div className="mt-2 text-[11px] text-zinc-500">This controls which events are eligible for notifications and the bell feed.</div>
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  );
};

export default Settings2;
