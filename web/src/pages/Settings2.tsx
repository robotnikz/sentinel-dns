import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  Sparkles,
  Trash2,
  Upload
} from 'lucide-react';
import { getAuthHeaders } from '../services/apiClient';
import ConfirmModal, { type ConfirmVariant } from '../components/ConfirmModal';
import { ReadOnlyFollowerBanner } from '../components/ReadOnlyFollowerBanner';
import { isReadOnlyFollower, useClusterStatus } from '../hooks/useClusterStatus';

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

function clampInt(n: any, min: number, max: number, fallback: number): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(x)));
}

type ConfirmOptions = {
  title: string;
  subtitle?: string;
  body: string;
  confirmText?: string;
  busyText?: string;
  variant?: ConfirmVariant;
  onConfirm: () => Promise<void> | void;
};

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
  presetTab?: 'general' | 'geoip' | 'remote' | 'notifications' | 'maintenance' | null;
  onPresetConsumed?: () => void;
}> = ({ presetTab, onPresetConsumed }) => {
  const [tab, setTab] = useState<'general' | 'geoip' | 'remote' | 'notifications' | 'maintenance'>('general');

  const { status: clusterStatus } = useClusterStatus();
  const readOnlyFollower = isReadOnlyFollower(clusterStatus);

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

  // Maintenance
  const [maintMsg, setMaintMsg] = useState('');
  const [maintBusy, setMaintBusy] = useState(false);
  const [purgeDays, setPurgeDays] = useState('30');
  const [importBusy, setImportBusy] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  const [importSummary, setImportSummary] = useState<any>(null);
  const [importPayload, setImportPayload] = useState<any>(null);
  const [importFileName, setImportFileName] = useState('');
  const importFileInputRef = useRef<HTMLInputElement | null>(null);

  const modalBusy = maintBusy || importBusy;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState('');
  const [confirmSubtitle, setConfirmSubtitle] = useState('');
  const [confirmBody, setConfirmBody] = useState('');
  const [confirmConfirmText, setConfirmConfirmText] = useState('CONFIRM');
  const [confirmBusyText, setConfirmBusyText] = useState('WORKING…');
  const [confirmVariant, setConfirmVariant] = useState<ConfirmVariant>('default');
  const confirmActionRef = useRef<null | (() => Promise<void> | void)>(null);

  const closeConfirm = () => {
    if (modalBusy) return;
    setConfirmOpen(false);
    confirmActionRef.current = null;
  };

  const openConfirm = (opts: ConfirmOptions) => {
    setConfirmTitle(opts.title);
    setConfirmSubtitle(String(opts.subtitle || ''));
    setConfirmBody(opts.body);
    setConfirmConfirmText(String(opts.confirmText || 'CONFIRM'));
    setConfirmBusyText(String(opts.busyText || 'WORKING…'));
    setConfirmVariant(opts.variant || 'default');
    confirmActionRef.current = opts.onConfirm;
    setConfirmOpen(true);
  };

  const runConfirm = async () => {
    if (modalBusy) return;
    const fn = confirmActionRef.current;
    try {
      await fn?.();
    } finally {
      setConfirmOpen(false);
      confirmActionRef.current = null;
    }
  };

  useEffect(() => {
    if (!confirmOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeConfirm();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [confirmOpen, modalBusy]);

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

  const doFlushQueryLogs = async () => {
    setMaintMsg('');
    setMaintBusy(true);
    try {
      const res = await fetch('/api/query-logs/flush', {
        method: 'POST',
        headers: { ...getAuthHeaders() }
      });
      const data = await safeJson(res);
      if (!res.ok) {
        setMaintMsg(data?.message || data?.error || 'Failed to clear query logs.');
        return;
      }
      const deleted = typeof data?.deleted === 'number' ? data.deleted : Number(data?.deleted || 0);
      setMaintMsg(Number.isFinite(deleted) && deleted > 0 ? `Cleared ${deleted} log entries.` : 'Query logs cleared.');
    } catch {
      setMaintMsg('Backend not reachable.');
    } finally {
      setMaintBusy(false);
    }
  };

  const flushQueryLogs = () => {
    if (maintBusy) return;
    openConfirm({
      title: 'Clear Query Logs',
      subtitle: 'Deletes all stored DNS query history.',
      body: 'This operation is irreversible. It only clears the UI log history; filtering rules and DNS settings stay unchanged.',
      confirmText: 'CLEAR LOGS',
      busyText: 'CLEARING…',
      variant: 'danger',
      onConfirm: doFlushQueryLogs
    });
  };

  const doPurgeOldQueryLogs = async (days: number) => {
    setMaintMsg('');
    setMaintBusy(true);
    try {
      const res = await fetch('/api/maintenance/query-logs/purge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ olderThanDays: days })
      });
      const data = await safeJson(res);
      if (!res.ok) {
        setMaintMsg(data?.message || data?.error || 'Failed to purge query logs.');
        return;
      }
      const deleted = typeof data?.deleted === 'number' ? data.deleted : Number(data?.deleted || 0);
      setMaintMsg(Number.isFinite(deleted) ? `Purged ${deleted} log entries.` : 'Purged.');
    } catch {
      setMaintMsg('Backend not reachable.');
    } finally {
      setMaintBusy(false);
    }
  };

  const purgeOldQueryLogs = () => {
    if (maintBusy) return;
    const days = clampInt(purgeDays, 1, 3650, 30);
    openConfirm({
      title: 'Purge Old Query Logs',
      subtitle: `Deletes entries older than ${days} days.`,
      body: 'This will permanently delete older query log entries from the database.',
      confirmText: 'PURGE',
      busyText: 'PURGING…',
      variant: 'warning',
      onConfirm: () => doPurgeOldQueryLogs(days)
    });
  };

  const doClearNotifications = async (mode: 'all' | 'read') => {
    setMaintMsg('');
    setMaintBusy(true);
    try {
      const res = await fetch('/api/maintenance/notifications/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ mode })
      });
      const data = await safeJson(res);
      if (!res.ok) {
        setMaintMsg(data?.message || data?.error || 'Failed to clear notifications.');
        return;
      }
      const deleted = typeof data?.deleted === 'number' ? data.deleted : Number(data?.deleted || 0);
      setMaintMsg(Number.isFinite(deleted) ? `Cleared ${deleted} notifications.` : 'Cleared notifications.');
    } catch {
      setMaintMsg('Backend not reachable.');
    } finally {
      setMaintBusy(false);
    }
  };

  const clearNotifications = (mode: 'all' | 'read') => {
    if (maintBusy) return;
    const label = mode === 'read' ? 'read notifications' : 'ALL notifications';
    openConfirm({
      title: 'Clear Notifications',
      subtitle: `Deletes ${label}.`,
      body: 'This will permanently delete notification feed entries from the database.',
      confirmText: 'CLEAR',
      busyText: 'CLEARING…',
      variant: mode === 'all' ? 'danger' : 'warning',
      onConfirm: () => doClearNotifications(mode)
    });
  };

  const doClearIgnoredAnomalies = async (mode: 'all' | 'expired') => {
    setMaintMsg('');
    setMaintBusy(true);
    try {
      const res = await fetch('/api/maintenance/ignored-anomalies/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ mode })
      });
      const data = await safeJson(res);
      if (!res.ok) {
        setMaintMsg(data?.message || data?.error || 'Failed to clear ignored anomalies.');
        return;
      }
      const deleted = typeof data?.deleted === 'number' ? data.deleted : Number(data?.deleted || 0);
      setMaintMsg(Number.isFinite(deleted) ? `Cleared ${deleted} ignored signatures.` : 'Cleared ignored signatures.');
    } catch {
      setMaintMsg('Backend not reachable.');
    } finally {
      setMaintBusy(false);
    }
  };

  const clearIgnoredAnomalies = (mode: 'all' | 'expired') => {
    if (maintBusy) return;
    const label = mode === 'expired' ? 'expired ignored signatures' : 'ALL ignored signatures';
    openConfirm({
      title: 'Clear Ignored Suspicious Activity',
      subtitle: `Deletes ${label}.`,
      body: 'This will permanently delete stored ignore signatures from the database.',
      confirmText: 'CLEAR',
      busyText: 'CLEARING…',
      variant: mode === 'all' ? 'danger' : 'warning',
      onConfirm: () => doClearIgnoredAnomalies(mode)
    });
  };

  const refreshEnabledBlocklistsNow = async () => {
    if (maintBusy) return;
    setMaintMsg('');
    setMaintBusy(true);
    try {
      const listRes = await fetch('/api/blocklists', { headers: { ...getAuthHeaders() } });
      const listData = await safeJson(listRes);
      if (!listRes.ok) {
        setMaintMsg(listData?.message || listData?.error || 'Failed to load blocklists.');
        return;
      }
      const items = Array.isArray(listData?.items) ? listData.items : [];
      const enabled = items.filter((b: any) => b && b.enabled === true && b.id != null);
      if (enabled.length === 0) {
        setMaintMsg('No enabled blocklists to refresh.');
        return;
      }

      let okCount = 0;
      for (let i = 0; i < enabled.length; i++) {
        const b = enabled[i];
        setMaintMsg(`Refreshing ${i + 1}/${enabled.length}: ${String(b.name || b.url)}`);
        const r = await fetch(`/api/blocklists/${encodeURIComponent(String(b.id))}/refresh`, {
          method: 'POST',
          headers: { ...getAuthHeaders() }
        });
        if (r.ok) okCount += 1;
      }
      setMaintMsg(`Refreshed ${okCount}/${enabled.length} enabled blocklists.`);
    } catch {
      setMaintMsg('Backend not reachable.');
    } finally {
      setMaintBusy(false);
    }
  };

  const doRestartResolver = async (mode: 'reload' | 'restart') => {
    setMaintMsg('');
    setMaintBusy(true);
    try {
      const url = mode === 'reload' ? '/api/maintenance/dns/reload-resolver' : '/api/maintenance/dns/restart-resolver';
      const res = await fetch(url, { method: 'POST', headers: { ...getAuthHeaders() } });
      const data = await safeJson(res);
      if (!res.ok) {
        setMaintMsg(data?.message || data?.error || 'Resolver control not supported in this deployment.');
        return;
      }
      setMaintMsg(mode === 'reload' ? 'Resolver reload requested.' : 'Resolver restart requested.');
    } catch {
      setMaintMsg('Backend not reachable.');
    } finally {
      setMaintBusy(false);
    }
  };

  const restartResolver = (mode: 'reload' | 'restart') => {
    if (maintBusy) return;
    const label = mode === 'reload' ? 'Reload resolver configuration' : 'Restart resolver (clears cache)';
    openConfirm({
      title: label,
      subtitle: mode === 'reload' ? 'Sends a HUP to Unbound (where supported).' : 'Restarts Unbound (more disruptive).',
      body: 'If you are currently testing DNS, clients may experience a brief interruption.',
      confirmText: mode === 'reload' ? 'RELOAD' : 'RESTART',
      busyText: mode === 'reload' ? 'RELOADING…' : 'RESTARTING…',
      variant: mode === 'reload' ? 'warning' : 'warning',
      onConfirm: () => doRestartResolver(mode)
    });
  };

  const downloadJson = async (url: string, filename: string) => {
    if (maintBusy) return;
    setMaintMsg('');
    setMaintBusy(true);
    try {
      const res = await fetch(url, { headers: { ...getAuthHeaders() } });
      if (!res.ok) {
        const data = await safeJson(res);
        setMaintMsg(data?.message || data?.error || 'Download failed.');
        return;
      }
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
      setMaintMsg('Downloaded.');
    } catch {
      setMaintMsg('Backend not reachable.');
    } finally {
      setMaintBusy(false);
    }
  };

  const onImportFileSelected = async (file: File | null) => {
    setImportMsg('');
    setImportSummary(null);
    setImportPayload(null);
    setImportFileName(file?.name || '');
    if (!file) return;
    setImportBusy(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      setImportPayload(parsed);

      const res = await fetch('/api/maintenance/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ dryRun: true, ...(parsed || {}) })
      });
      const data = await safeJson(res);
      if (!res.ok) {
        setImportMsg(data?.message || data?.error || 'Dry-run failed.');
        return;
      }
      setImportSummary(data?.summary || null);
      setImportMsg('Dry-run OK. Review summary and apply.');
    } catch {
      setImportMsg('Invalid JSON or backend not reachable.');
    } finally {
      setImportBusy(false);
    }
  };

  const doApplyImport = async () => {
    if (!importPayload) return;
    setImportBusy(true);
    setImportMsg('');
    try {
      const res = await fetch('/api/maintenance/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ dryRun: false, ...(importPayload || {}) })
      });
      const data = await safeJson(res);
      if (!res.ok) {
        setImportMsg(data?.message || data?.error || 'Import failed.');
        return;
      }
      setImportSummary(data?.summary || null);
      setImportMsg('Import applied.');
    } catch {
      setImportMsg('Backend not reachable.');
    } finally {
      setImportBusy(false);
    }
  };

  const applyImport = () => {
    if (!importPayload || importBusy || maintBusy) return;
    openConfirm({
      title: 'Apply Import',
      subtitle: 'Upserts settings/clients/blocklists and adds new rules (no deletes).',
      body: 'Apply the import now? This will change the running configuration and is intended for restores/migrations.',
      confirmText: 'APPLY',
      busyText: 'APPLYING…',
      variant: 'warning',
      onConfirm: doApplyImport
    });
  };

  const tabs = [
    { id: 'general' as const, label: 'AI Keys', icon: Sparkles },
    { id: 'geoip' as const, label: 'GeoIP / World Map', icon: Globe },
    { id: 'remote' as const, label: 'Tailscale', icon: Network },
    { id: 'notifications' as const, label: 'Notifications', icon: Bell },
    { id: 'maintenance' as const, label: 'Maintenance', icon: Trash2 }
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

        <div className="px-6 pt-4">
          <ReadOnlyFollowerBanner show={readOnlyFollower} />
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
                disabled={aiBusy || readOnlyFollower}
                className="btn-primary px-4 py-2 rounded text-xs font-bold flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
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
                      disabled={readOnlyFollower}
                      className="px-3 py-2 rounded text-xs font-bold bg-[#18181b] border border-[#27272a] text-zinc-300 hover:bg-white hover:text-black hover:border-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-[#18181b] disabled:hover:text-zinc-300 disabled:hover:border-[#27272a]"
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
                  disabled={geoBusy || readOnlyFollower}
                  className="btn-primary px-4 py-2 rounded text-xs font-bold flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
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
                    disabled={tailscaleBusy || tailscaleAuthPolling || readOnlyFollower}
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
                      disabled={tailscaleBusy || readOnlyFollower}
                      className="px-3 py-2 rounded text-xs font-bold bg-[#18181b] border border-[#27272a] text-zinc-300 hover:bg-white hover:text-black hover:border-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-[#18181b] disabled:hover:text-zinc-300 disabled:hover:border-[#27272a]"
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
                      disabled={readOnlyFollower}
                      className={classNames(
                        'w-12 h-6 rounded-full relative transition-colors',
                        tailscaleAdvertiseExitNode ? 'bg-emerald-600' : 'bg-zinc-700',
                        readOnlyFollower ? 'opacity-50 cursor-not-allowed' : ''
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
                      disabled={readOnlyFollower}
                      className={classNames(
                        'w-12 h-6 rounded-full relative transition-colors',
                        tailscaleSnatSubnetRoutes ? 'bg-emerald-600' : 'bg-zinc-700',
                        readOnlyFollower ? 'opacity-50 cursor-not-allowed' : ''
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
                  disabled={tailscaleBusy || readOnlyFollower}
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
                    disabled={tailscaleBusy || !isTailscaleConnected || !hasTailscaleChanges || readOnlyFollower}
                    className={classNames(
                      'btn-primary px-4 py-2 rounded text-xs font-bold flex items-center gap-2',
                      tailscaleBusy || !isTailscaleConnected || !hasTailscaleChanges || readOnlyFollower ? 'opacity-50 cursor-not-allowed' : ''
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
                  In the Tailscale admin console: DNS → Nameservers → Add nameserver → use the IP above. Make sure “Override DNS Servers” is enabled.
                  Then enable “Use Tailscale DNS” on clients.
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
                  disabled={notifBusy || readOnlyFollower}
                  className="btn-primary px-4 py-2 rounded text-xs font-bold flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {notifBusy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  SAVE
                </button>
                <button
                  onClick={testNotification}
                  disabled={notifBusy || readOnlyFollower}
                  className="px-4 py-2 rounded text-xs font-bold border bg-[#18181b] border-[#27272a] text-zinc-300 hover:bg-[#27272a] flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
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
                  disabled={notifBusy || readOnlyFollower}
                  className="btn-primary px-4 py-2 rounded text-xs font-bold flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
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

        {tab === 'maintenance' && (
          <div className="dashboard-card p-6 rounded-lg">
            <h2 className="text-white font-bold text-lg flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-rose-400" /> Maintenance
            </h2>
            <p className="text-zinc-500 text-sm mt-1">Administrative cleanup actions (admin-only).</p>

            <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="p-4 rounded border border-[#27272a] bg-[#09090b]">
                <div className="text-[10px] uppercase font-bold text-zinc-500">Log / DB Cleanup</div>

                <div className="mt-3 space-y-3">
                  <div className="p-3 rounded border border-[#27272a] bg-[#0b0b0e]">
                    <div className="text-xs text-zinc-300 font-bold">Query Logs</div>
                    <div className="text-[11px] text-zinc-500 mt-1">Purge old entries or clear everything.</div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <input
                        value={purgeDays}
                        onChange={(e) => setPurgeDays(e.target.value)}
                        placeholder="Days"
                        className="w-24 bg-[#09090b] border border-[#27272a] text-zinc-200 px-3 py-2 rounded text-xs font-mono focus:outline-none focus:border-zinc-500"
                      />
                      <button
                        onClick={purgeOldQueryLogs}
                        disabled={maintBusy}
                        className={classNames(
                          'px-3 py-2 rounded text-xs font-bold border bg-[#18181b] border-[#27272a] text-zinc-300 hover:bg-[#27272a]',
                          maintBusy ? 'opacity-50 cursor-not-allowed' : ''
                        )}
                      >
                        PURGE OLDER THAN (DAYS)
                      </button>

                      <button
                        onClick={flushQueryLogs}
                        disabled={maintBusy}
                        className={classNames(
                          'px-3 py-2 rounded text-xs font-bold border flex items-center gap-2',
                          maintBusy
                            ? 'opacity-50 cursor-not-allowed bg-[#18181b] border-[#27272a] text-zinc-400'
                            : 'bg-rose-950/30 border-rose-900/50 text-rose-300 hover:bg-rose-950/50'
                        )}
                      >
                        {maintBusy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                        CLEAR ALL
                      </button>
                    </div>
                  </div>

                  <div className="p-3 rounded border border-[#27272a] bg-[#0b0b0e]">
                    <div className="text-xs text-zinc-300 font-bold">Notifications</div>
                    <div className="text-[11px] text-zinc-500 mt-1">Clean up the bell feed storage.</div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => clearNotifications('read')}
                        disabled={maintBusy}
                        className={classNames(
                          'px-3 py-2 rounded text-xs font-bold border bg-[#18181b] border-[#27272a] text-zinc-300 hover:bg-[#27272a]',
                          maintBusy ? 'opacity-50 cursor-not-allowed' : ''
                        )}
                      >
                        CLEAR READ
                      </button>
                      <button
                        onClick={() => clearNotifications('all')}
                        disabled={maintBusy}
                        className={classNames(
                          'px-3 py-2 rounded text-xs font-bold border bg-rose-950/30 border-rose-900/50 text-rose-300 hover:bg-rose-950/50',
                          maintBusy ? 'opacity-50 cursor-not-allowed' : ''
                        )}
                      >
                        CLEAR ALL
                      </button>
                    </div>
                  </div>

                  <div className="p-3 rounded border border-[#27272a] bg-[#0b0b0e]">
                    <div className="text-xs text-zinc-300 font-bold">Ignored Suspicious Activity</div>
                    <div className="text-[11px] text-zinc-500 mt-1">Remove stored ignore signatures.</div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => clearIgnoredAnomalies('expired')}
                        disabled={maintBusy}
                        className={classNames(
                          'px-3 py-2 rounded text-xs font-bold border bg-[#18181b] border-[#27272a] text-zinc-300 hover:bg-[#27272a]',
                          maintBusy ? 'opacity-50 cursor-not-allowed' : ''
                        )}
                      >
                        PURGE EXPIRED
                      </button>
                      <button
                        onClick={() => clearIgnoredAnomalies('all')}
                        disabled={maintBusy}
                        className={classNames(
                          'px-3 py-2 rounded text-xs font-bold border bg-rose-950/30 border-rose-900/50 text-rose-300 hover:bg-rose-950/50',
                          maintBusy ? 'opacity-50 cursor-not-allowed' : ''
                        )}
                      >
                        CLEAR ALL
                      </button>
                    </div>
                  </div>

                  {maintMsg && <div className="text-xs text-zinc-400 font-mono">{maintMsg}</div>}
                </div>
              </div>

              <div className="space-y-4">
                <div className="p-4 rounded border border-[#27272a] bg-[#09090b]">
                  <div className="text-[10px] uppercase font-bold text-zinc-500">Blocklists & DNS Runtime</div>

                  <div className="mt-3 space-y-3">
                    <div className="p-3 rounded border border-[#27272a] bg-[#0b0b0e]">
                      <div className="text-xs text-zinc-300 font-bold">Blocklists</div>
                      <div className="text-[11px] text-zinc-500 mt-1">Manually refresh enabled blocklists now.</div>
                      <div className="mt-3">
                        <button
                          onClick={refreshEnabledBlocklistsNow}
                          disabled={maintBusy || readOnlyFollower}
                          className={classNames(
                            'px-4 py-2 rounded text-xs font-bold border bg-[#18181b] border-[#27272a] text-zinc-300 hover:bg-[#27272a] flex items-center gap-2',
                            maintBusy || readOnlyFollower ? 'opacity-50 cursor-not-allowed' : ''
                          )}
                        >
                          {maintBusy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                          REFRESH ENABLED BLOCKLISTS
                        </button>
                      </div>
                    </div>

                    <div className="p-3 rounded border border-[#27272a] bg-[#0b0b0e]">
                      <div className="text-xs text-zinc-300 font-bold">Resolver (Unbound)</div>
                      <div className="text-[11px] text-zinc-500 mt-1">In single-container mode this uses Supervisor to control Unbound.</div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                          onClick={() => restartResolver('reload')}
                          disabled={maintBusy || readOnlyFollower}
                          className={classNames(
                            'px-3 py-2 rounded text-xs font-bold border bg-[#18181b] border-[#27272a] text-zinc-300 hover:bg-[#27272a]',
                            maintBusy || readOnlyFollower ? 'opacity-50 cursor-not-allowed' : ''
                          )}
                        >
                          RELOAD CONFIG
                        </button>
                        <button
                          onClick={() => restartResolver('restart')}
                          disabled={maintBusy || readOnlyFollower}
                          className={classNames(
                            'px-3 py-2 rounded text-xs font-bold border bg-amber-950/30 border-amber-900/50 text-amber-300 hover:bg-amber-950/50',
                            maintBusy || readOnlyFollower ? 'opacity-50 cursor-not-allowed' : ''
                          )}
                        >
                          RESTART (CLEARS CACHE)
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-4 rounded border border-[#27272a] bg-[#09090b]">
                  <div className="text-[10px] uppercase font-bold text-zinc-500">Export / Import</div>

                  <div className="mt-3 space-y-3">
                    <div className="p-3 rounded border border-[#27272a] bg-[#0b0b0e]">
                      <div className="text-xs text-zinc-300 font-bold">Export</div>
                      <div className="text-[11px] text-zinc-500 mt-1">Downloads settings, rules, clients and blocklists (no secrets).</div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                          onClick={() =>
                            downloadJson(
                              '/api/maintenance/export?download=true',
                              `sentinel-export-${new Date().toISOString().slice(0, 10)}.json`
                            )
                          }
                          disabled={maintBusy}
                          className={classNames(
                            'px-4 py-2 rounded text-xs font-bold border bg-[#18181b] border-[#27272a] text-zinc-300 hover:bg-[#27272a] flex items-center gap-2',
                            maintBusy ? 'opacity-50 cursor-not-allowed' : ''
                          )}
                        >
                          <Copy className="w-3.5 h-3.5" /> DOWNLOAD EXPORT
                        </button>
                        <button
                          onClick={() =>
                            downloadJson(
                              '/api/maintenance/diagnostics?download=true',
                              `sentinel-diagnostics-${new Date().toISOString().slice(0, 10)}.json`
                            )
                          }
                          disabled={maintBusy}
                          className={classNames(
                            'px-4 py-2 rounded text-xs font-bold border bg-[#18181b] border-[#27272a] text-zinc-300 hover:bg-[#27272a] flex items-center gap-2',
                            maintBusy ? 'opacity-50 cursor-not-allowed' : ''
                          )}
                        >
                          <ExternalLink className="w-3.5 h-3.5" /> DOWNLOAD DIAGNOSTICS
                        </button>
                      </div>
                    </div>

                    <div className="p-3 rounded border border-[#27272a] bg-[#0b0b0e]">
                      <div className="text-xs text-zinc-300 font-bold">Import</div>
                      <div className="text-[11px] text-zinc-500 mt-1">Uploads a previous export. Dry-run first, then apply (safe upsert; no deletes).</div>

                      <div className="mt-3">
                        <input
                          ref={importFileInputRef}
                          type="file"
                          accept="application/json"
                          disabled={importBusy || maintBusy || readOnlyFollower}
                          onChange={(e) => {
                            const file = e.target.files?.[0] || null;
                            void onImportFileSelected(file);
                            // Allow selecting the same file again.
                            e.currentTarget.value = '';
                          }}
                          className="hidden"
                        />

                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            onClick={() => importFileInputRef.current?.click()}
                            disabled={importBusy || maintBusy || readOnlyFollower}
                            className={classNames(
                              'px-4 py-2 rounded text-xs font-bold border bg-[#18181b] border-[#27272a] text-zinc-300 hover:bg-[#27272a] flex items-center gap-2',
                              importBusy || maintBusy || readOnlyFollower ? 'opacity-50 cursor-not-allowed' : ''
                            )}
                          >
                            <Upload className="w-3.5 h-3.5" /> CHOOSE FILE
                          </button>

                          <div className="text-xs font-mono text-zinc-500 truncate max-w-[340px]">
                            {importFileName ? `Selected: ${importFileName}` : 'No file selected.'}
                          </div>

                          {importFileName ? (
                            <button
                              onClick={() => {
                                if (importBusy || maintBusy) return;
                                setImportMsg('');
                                setImportSummary(null);
                                setImportPayload(null);
                                setImportFileName('');
                                if (importFileInputRef.current) importFileInputRef.current.value = '';
                              }}
                              disabled={importBusy || maintBusy}
                              className={classNames(
                                'px-3 py-2 rounded text-xs font-bold border bg-[#18181b] border-[#27272a] text-zinc-300 hover:bg-[#27272a]',
                                importBusy || maintBusy ? 'opacity-50 cursor-not-allowed' : ''
                              )}
                            >
                              CLEAR
                            </button>
                          ) : null}
                        </div>
                      </div>

                      {importMsg ? <div className="mt-2 text-xs text-zinc-400">{importMsg}</div> : null}

                      {importSummary ? (
                        <div className="mt-3 p-3 rounded border border-[#27272a] bg-[#09090b]">
                          <div className="text-[10px] uppercase font-bold text-zinc-500">Dry-run summary</div>
                          <pre className="mt-2 text-[10px] text-zinc-300 font-mono whitespace-pre-wrap">{JSON.stringify(importSummary, null, 2)}</pre>
                          <div className="mt-3 flex items-center gap-2">
                            <button
                              onClick={applyImport}
                              disabled={importBusy || maintBusy || !importPayload || readOnlyFollower}
                              className={classNames(
                                'px-4 py-2 rounded text-xs font-bold border flex items-center gap-2',
                                importBusy || maintBusy || readOnlyFollower
                                  ? 'opacity-50 cursor-not-allowed bg-[#18181b] border-[#27272a] text-zinc-400'
                                  : 'bg-emerald-950/30 border-emerald-900/50 text-emerald-300 hover:bg-emerald-950/50'
                              )}
                            >
                              {importBusy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                              APPLY IMPORT
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        </div>
        </div>

        <ConfirmModal
          open={confirmOpen}
          title={confirmTitle}
          subtitle={confirmSubtitle}
          body={confirmBody}
          confirmText={confirmConfirmText}
          busyText={confirmBusyText}
          variant={confirmVariant}
          busy={modalBusy}
          onCancel={closeConfirm}
          onConfirm={() => void runConfirm()}
          message={maintMsg || importMsg ? (maintMsg ? maintMsg : importMsg) : null}
        />
    </div>
  );
};

export default Settings2;
