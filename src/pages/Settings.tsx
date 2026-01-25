import React, { useState, useEffect } from 'react';
import { 
  Settings as SettingsIcon, Cpu, HardDrive, Shield, Sparkles, Download, 
  RotateCcw, Share2, Bell, Network, Link, Copy, CheckCircle, AlertTriangle, 
  Server, RefreshCw, Power, Radio, Activity, ExternalLink, Lock, Route, Plus, Trash2, Info, Save, Zap, Check, X
} from 'lucide-react';
import { getAuthHeaders } from '../services/apiClient';

interface SubnetRoute {
    id: number;
    cidr: string;
    enabled: boolean;
    status: 'active' | 'pending_approval';
}

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

const Settings: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'general' | 'ha' | 'remote' | 'notifications'>('general');
        const [hasAiConfigured, setHasAiConfigured] = useState<boolean>(false);
        const [hasOpenAiConfigured, setHasOpenAiConfigured] = useState<boolean>(false);

        const [geminiApiKey, setGeminiApiKey] = useState('');
        const [openAiApiKey, setOpenAiApiKey] = useState('');

    // GeoIP (World Map)
    const [geoIpStatus, setGeoIpStatus] = useState<GeoIpStatus | null>(null);
    const [maxMindLicenseKey, setMaxMindLicenseKey] = useState('');
    const [isGeoIpUpdating, setIsGeoIpUpdating] = useState(false);
    const [geoIpMessage, setGeoIpMessage] = useState<string>('');

    // Tailscale (Remote Access)
    const [tailscaleStatus, setTailscaleStatus] = useState<TailscaleStatus | null>(null);
    const [tailscaleHostname, setTailscaleHostname] = useState('');
    const [tailscaleAuthKey, setTailscaleAuthKey] = useState('');
    const [tailscaleAdvertiseExitNode, setTailscaleAdvertiseExitNode] = useState(false);
    const [tailscaleRoutesInput, setTailscaleRoutesInput] = useState('');
    const [tailscaleSnatSubnetRoutes, setTailscaleSnatSubnetRoutes] = useState(true);
    const [tailscaleMessage, setTailscaleMessage] = useState<string>('');
    const [isTailscaleBusy, setIsTailscaleBusy] = useState(false);
    const [isTailscaleAuthPolling, setIsTailscaleAuthPolling] = useState(false);

    const [syncEnabled, setSyncEnabled] = useState(true);
  
  // Notification State
  const [discordUrl, setDiscordUrl] = useState('');
  
  // HA State
  const [haConfig, setHaConfig] = useState({
      replicaUrl: 'http://192.168.1.6:3000',
      authToken: 'xk9-291-002-aa1',
      lastSync: '2 mins ago',
      status: 'synced' as 'synced' | 'error' | 'syncing'
  });
  const [isSavingHa, setIsSavingHa] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionTestResult, setConnectionTestResult] = useState<'success' | 'fail' | null>(null);

  // Subnet Routing State
  const [subnetRoutes, setSubnetRoutes] = useState<SubnetRoute[]>([
      { id: 1, cidr: '192.168.1.0/24', enabled: true, status: 'active' }
  ]);
  const [newRouteInput, setNewRouteInput] = useState('');

  const saveAiKeys = async () => {
      // Store keys encrypted server-side (admin only). Empty fields are ignored.
      const gemini = geminiApiKey.trim();
      const openai = openAiApiKey.trim();

      try {
          if (gemini) {
              await fetch('/api/secrets/gemini_api_key', {
          setTailscaleMessage('Opening Tailscale login...');

          // Open synchronously to avoid popup blockers.
          const popup = window.open('about:blank', '_blank');
          if (!popup) {
              setTailscaleMessage('Popup blocked. Please allow popups for this site and try again.');
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

          setIsTailscaleBusy(true);
          setIsTailscaleAuthPolling(false);
          try {
              const res = await fetch('/api/tailscale/auth-url', {
                  method: 'POST',
                  headers: {
                      'Content-Type': 'application/json',
                      ...getAuthHeaders()
                  },
                  body: JSON.stringify({})
              });
              const data = (await res.json().catch(() => ({} as any))) as TailscaleAuthUrlResponse;

              if (!res.ok || !data || (data as any).ok !== true) {
                  const msg = (data as any)?.message || (data as any)?.error || 'Failed to start Tailscale browser authentication.';
                  setTailscaleMessage(msg);
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
                  setTailscaleMessage(msg);
                  try {
                      popup.document.body.innerHTML = `<p style="font-family: ui-sans-serif, system-ui; padding: 16px;">${msg}</p>`;
                  } catch {
                      // ignore
                  }
              } else {
                  try {
                      popup.location.href = url;
                  } catch {
                      setTailscaleMessage('Could not redirect popup. Copy the URL from the message.');
                      try {
                          popup.document.body.innerHTML = `<p style="font-family: ui-sans-serif, system-ui; padding: 16px;">Open this URL:</p><pre style="padding: 16px; white-space: pre-wrap;">${url}</pre>`;
                      } catch {
                          // ignore
                      }
                      return;
                  }
                  setTailscaleMessage('Complete login in the new tab. Waiting for connection…');
              }

              // Poll status so the UI flips to Running without manual refresh.
              setIsTailscaleAuthPolling(true);
              const startedAt = Date.now();
              const maxMs = 60_000;
              while (Date.now() - startedAt < maxMs) {
                  // eslint-disable-next-line no-await-in-loop
                  await new Promise((r) => setTimeout(r, 2000));
                  // eslint-disable-next-line no-await-in-loop
                  const st = await refreshTailscaleStatus();
                  if (st?.running && (st?.backendState || '').toLowerCase() === 'running') {
                      setTailscaleMessage('Connected.');
                      break;
                  }
              }
              if (Date.now() - startedAt >= maxMs) {
                  setTailscaleMessage('Still waiting for Tailscale. If you already completed login, click REFRESH STATUS.');
              }
          } catch {
              setTailscaleMessage('Backend not reachable.');
              try {
                  popup.document.body.innerHTML = '<p style="font-family: ui-sans-serif, system-ui; padding: 16px;">Backend not reachable.</p>';
              } catch {
                  // ignore
              }
          } finally {
              setIsTailscaleBusy(false);
              setIsTailscaleAuthPolling(false);
          }
                  'Content-Type': 'application/json',
                  ...getAuthHeaders()
              },
              body: JSON.stringify({ value: key })
          });
          const data = await res.json().catch(() => ({} as any));
          if (!res.ok) {
              setGeoIpMessage(data?.message || 'Failed to store license key.');
              return;
          }

          setMaxMindLicenseKey('');
          setGeoIpMessage('License key saved.');
          await refreshGeoIpStatus();
      } catch {
              if (!res.ok) {
                  setTailscaleMessage(data?.message || data?.error || 'Tailscale disconnect failed.');
                  return;
              }
  const updateGeoIpDb = async () => {
      setGeoIpMessage('');
      setIsGeoIpUpdating(true);
      try {
          const key = maxMindLicenseKey.trim();
          const body = key ? { licenseKey: key } : {};



      const applyTailscaleConfig = async () => {
          setTailscaleMessage('');
          setIsTailscaleBusy(true);
          try {
              const routes = tailscaleRoutesInput
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean);

              const res = await fetch('/api/tailscale/config', {
                  method: 'POST',
                  headers: {
                      'Content-Type': 'application/json',
                      ...getAuthHeaders()
                  },
                  body: JSON.stringify({
                      advertiseExitNode: tailscaleAdvertiseExitNode,
                      advertiseRoutes: routes,
                      snatSubnetRoutes: tailscaleSnatSubnetRoutes,
                      acceptDns: false
                  })
              });
              const data = await res.json().catch(() => ({} as any));
              if (!res.ok) {
                  setTailscaleMessage(data?.message || data?.error || 'Failed to apply Tailscale config.');
                  return;
              }

              if ((data as any)?.needsLogin && typeof (data as any)?.authUrl === 'string') {
                  setTailscaleMessage('Needs login. Use AUTHENTICATE IN BROWSER, then try again.');
                  return;
              }

              setTailscaleMessage('Configuration applied.');
              await refreshTailscaleStatus();
          } catch {
              setTailscaleMessage('Backend not reachable.');
          } finally {
              setIsTailscaleBusy(false);
          }
      };
     // Load webhook from backend (persistent, shared across clients)
     fetch('/api/settings')
        .then(r => r.json())
        .then(d => {
            const items = Array.isArray(d?.items) ? d.items : [];
            const row = items.find((x: any) => x?.key === 'discord_webhook');
            const v = row?.value;
            const url = typeof v === 'string' ? v : (typeof v?.url === 'string' ? v.url : '');
            if (url) setDiscordUrl(url);
        })
        .catch(() => {
            // ignore
        });

      // GeoIP status for World Map
      fetch('/api/geoip/status', { headers: { ...getAuthHeaders() } })
          .then(async (r) => (r.ok ? r.json() : null))
          .then((d) => {
              if (d && d.geoip && typeof d.geoip.available === 'boolean') {
                  setGeoIpStatus(d as GeoIpStatus);
              } else {
                  setGeoIpStatus(null);
              }
          })
          .catch(() => {
              setGeoIpStatus(null);
          });

      // Tailscale status
      fetch('/api/tailscale/status', { headers: { ...getAuthHeaders() } })
          .then(async (r) => (r.ok ? r.json() : null))
          .then((d) => {
              if (d && typeof d.supported === 'boolean') {
                  const s = d as TailscaleStatus;
                  setTailscaleStatus(s);
                  if (s?.prefs) {
                      setTailscaleAdvertiseExitNode(!!s.prefs.advertiseExitNode);
                      setTailscaleSnatSubnetRoutes(!!s.prefs.snatSubnetRoutes);
                      setTailscaleRoutesInput(Array.isArray(s.prefs.advertiseRoutes) ? s.prefs.advertiseRoutes.join(',') : '');
                  }
              }
          })
          .catch(() => {
              setTailscaleStatus(null);
          });
  }, []);

  const refreshTailscaleStatus = async (): Promise<TailscaleStatus | null> => {
      try {
          const r = await fetch('/api/tailscale/status', { headers: { ...getAuthHeaders() } });
          const d = await r.json().catch(() => null);

          if (r.ok && d && typeof (d as any).supported === 'boolean') {
              const s = d as TailscaleStatus;
              setTailscaleStatus(s);
              if (s?.prefs) {
                  setTailscaleAdvertiseExitNode(!!s.prefs.advertiseExitNode);
                  setTailscaleSnatSubnetRoutes(!!s.prefs.snatSubnetRoutes);
                  setTailscaleRoutesInput(Array.isArray(s.prefs.advertiseRoutes) ? s.prefs.advertiseRoutes.join(',') : '');
              }
              return s;
          } else {
              setTailscaleStatus(null);
              return null;
          }
      } catch {
          setTailscaleStatus(null);
          return null;
      }
  };

  const saveTailscaleAuthKey = async () => {
      setTailscaleMessage('');
      const key = tailscaleAuthKey.trim();
      if (!key) {
          setTailscaleMessage('Please enter a Tailscale auth key.');
          return;
      }
      try {
          const res = await fetch('/api/secrets/tailscale_auth_key', {
              method: 'PUT',
              headers: {
                  'Content-Type': 'application/json',
                  ...getAuthHeaders()
              },
              body: JSON.stringify({ value: key })
          });
          const data = await res.json().catch(() => ({} as any));
          if (!res.ok) {
              setTailscaleMessage(data?.message || 'Failed to store auth key.');
              return;
          }
          setTailscaleAuthKey('');
          setTailscaleMessage('Auth key saved.');
          await refreshTailscaleStatus();
      } catch {
          setTailscaleMessage('Backend not reachable.');
      }
  };

  const connectTailscale = async () => {
      setTailscaleMessage('');
      setIsTailscaleBusy(true);
      try {
          const routes = tailscaleRoutesInput
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);

          const res = await fetch('/api/tailscale/up', {
              method: 'POST',
              headers: {
                  'Content-Type': 'application/json',
                  ...getAuthHeaders()
              },
              body: JSON.stringify({
                  hostname: tailscaleHostname.trim() || undefined,
                  advertiseExitNode: tailscaleAdvertiseExitNode,
                  advertiseRoutes: routes.length > 0 ? routes : undefined,
                  snatSubnetRoutes: tailscaleSnatSubnetRoutes,
                  acceptDns: false
              })
          });
          const data = (await res.json().catch(() => ({} as any))) as TailscaleUpResponse;

          if (!res.ok) {
              setTailscaleMessage((data as any)?.message || (data as any)?.error || 'Tailscale connect failed.');
              return;
          }

          if ((data as any)?.needsLogin && typeof (data as any)?.authUrl === 'string') {
              setTailscaleMessage('Needs login. Use "AUTHENTICATE IN BROWSER" (recommended), then refresh status.');
              return;
          }

          setTailscaleMessage('Connected.');
          await refreshTailscaleStatus();
      } catch {
          setTailscaleMessage('Backend not reachable.');
      } finally {
          setIsTailscaleBusy(false);
      }
  };

  const authenticateTailscaleInBrowser = async () => {
      setTailscaleMessage('Opening Tailscale login...');

      // Open synchronously to avoid popup blockers.
      const popup = window.open('about:blank', '_blank');
      if (!popup) {
          setTailscaleMessage('Popup blocked. Please allow popups for this site and try again.');
          return;
      }

      try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (popup as any).opener = null;
          popup.document.title = 'Tailscale Login';
          popup.document.body.innerHTML = '<p style="font-family: ui-sans-serif, system-ui; padding: 16px;">Redirecting to Tailscale login…</p>';
      } catch {
          // ignore
      }

      setIsTailscaleBusy(true);
      try {
          const res = await fetch('/api/tailscale/auth-url', {
              method: 'POST',
              headers: {
                  'Content-Type': 'application/json',
                  ...getAuthHeaders()
              },
              body: JSON.stringify({})
          });
          const data = (await res.json().catch(() => ({} as any))) as TailscaleAuthUrlResponse;

          if (!res.ok || !data || (data as any).ok !== true || typeof (data as any).authUrl !== 'string') {
              const msg = (data as any)?.message || (data as any)?.error || 'Failed to start Tailscale browser authentication.';
              setTailscaleMessage(msg);
              try {
                  popup.document.body.innerHTML = `<p style="font-family: ui-sans-serif, system-ui; padding: 16px;">${msg}</p>`;
              } catch {
                  // ignore
              }
              return;
          }

          const url = String((data as any).authUrl);
          try {
              popup.location.href = url;
          } catch {
              setTailscaleMessage('Could not redirect popup. Copy the URL from the message.');
              try {
                  popup.document.body.innerHTML = `<p style="font-family: ui-sans-serif, system-ui; padding: 16px;">Open this URL:</p><pre style="padding: 16px; white-space: pre-wrap;">${url}</pre>`;
              } catch {
                  // ignore
              }
              return;
          }

          setTailscaleMessage('Complete login in the new tab, then click REFRESH.');
      } catch {
          setTailscaleMessage('Backend not reachable.');
          try {
              popup.document.body.innerHTML = '<p style="font-family: ui-sans-serif, system-ui; padding: 16px;">Backend not reachable.</p>';
          } catch {
              // ignore
          }
      } finally {
          setIsTailscaleBusy(false);
      }
  };

  const disconnectTailscale = async () => {
      setTailscaleMessage('');
      setIsTailscaleBusy(true);
      try {
          const res = await fetch('/api/tailscale/down', {
              method: 'POST',
              headers: {
                  'Content-Type': 'application/json',
                  ...getAuthHeaders()
              },
              body: JSON.stringify({})
          });
          const data = await res.json().catch(() => ({} as any));
          if (!res.ok || !data || (data as any).ok !== true) {
              const msg = (data as any)?.message || (data as any)?.error || 'Failed to start Tailscale browser authentication.';
              return;
          }
          setTailscaleMessage('Disconnected.');
          await refreshTailscaleStatus();
      } catch {
          setTailscaleMessage('Backend not reachable.');
      } finally {
          setIsTailscaleBusy(false);
      }
          const urlRaw = (data as any).authUrl;
          const url = typeof urlRaw === 'string' ? urlRaw : '';

          if (!url) {
              const msg = (data as any)?.message || ((data as any)?.alreadyLoggedIn ? 'Already logged in.' : 'No login URL returned.');
              setTailscaleMessage(msg);
              try {
                  popup.document.body.innerHTML = `<p style="font-family: ui-sans-serif, system-ui; padding: 16px;">${msg}</p>`;
              } catch {
                  // ignore
              }
          } else {
              try {
                  popup.location.href = url;
              } catch {
                  setTailscaleMessage('Could not redirect popup. Copy the URL from the message.');
                  try {
                      popup.document.body.innerHTML = `<p style="font-family: ui-sans-serif, system-ui; padding: 16px;">Open this URL:</p><pre style="padding: 16px; white-space: pre-wrap;">${url}</pre>`;
                  } catch {
                      // ignore
                  }
                  return;
              }

              setTailscaleMessage('Complete login in the new tab. Waiting for connection…');
          }

          // Poll status so the UI flips to Running without manual refresh.
          setIsTailscaleAuthPolling(true);
          const startedAt = Date.now();
          const maxMs = 60_000;
          while (Date.now() - startedAt < maxMs) {
              // eslint-disable-next-line no-await-in-loop
              await new Promise((r) => setTimeout(r, 2000));
              // eslint-disable-next-line no-await-in-loop
              const st = await refreshTailscaleStatus();
              if (st?.running && (st?.backendState || '').toLowerCase() === 'running') {
                  setTailscaleMessage('Connected.');
                  break;
              }
          }
          if (Date.now() - startedAt >= maxMs) {
              setTailscaleMessage('Still waiting for Tailscale. If you already completed login, click REFRESH STATUS.');
          }

  const applyTailscaleConfig = async () => {
      setTailscaleMessage('');
      setIsTailscaleBusy(true);
      try {
          const routes = tailscaleRoutesInput
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
          setIsTailscaleAuthPolling(false);

          const res = await fetch('/api/tailscale/config', {
              method: 'POST',
              headers: {
                  'Content-Type': 'application/json',
                  ...getAuthHeaders()
              },
              body: JSON.stringify({
                  advertiseExitNode: tailscaleAdvertiseExitNode,
                  advertiseRoutes: routes.length > 0 ? routes : undefined,
                  snatSubnetRoutes: tailscaleSnatSubnetRoutes,
                  acceptDns: false
              })
          });
          const data = await res.json().catch(() => ({} as any));
          if (!res.ok) {
              setTailscaleMessage(data?.message || data?.error || 'Failed to apply Tailscale config.');
              return;
          }
          setTailscaleMessage('Configuration applied.');
          await refreshTailscaleStatus();
      } catch {
          setTailscaleMessage('Backend not reachable.');
      } finally {
          setIsTailscaleBusy(false);
      }
  };

  const handleAddRoute = () => {
      if(!newRouteInput) return;
      const newRoute: SubnetRoute = {
          id: Date.now(),
          cidr: newRouteInput,
          enabled: true,
          status: 'pending_approval'
      };
      setSubnetRoutes([...subnetRoutes, newRoute]);
      setNewRouteInput('');
  };

  const handleRemoveRoute = (id: number) => {
      setSubnetRoutes(subnetRoutes.filter(r => r.id !== id));
  };

  const toggleRoute = (id: number) => {
      setSubnetRoutes(subnetRoutes.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r));
  };

  const handleSaveHa = () => {
      setIsSavingHa(true);
      setTimeout(() => {
          setIsSavingHa(false);
          setConnectionTestResult(null); 
      }, 1000);
  };

  const testHaConnection = () => {
      setIsTestingConnection(true);
      setConnectionTestResult(null);
      setTimeout(() => {
          setIsTestingConnection(false);
          setConnectionTestResult('success');
      }, 1500);
  };

  const generateToken = () => {
      const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
      let token = 'sk_';
      for(let i=0; i<16; i++) token += chars.charAt(Math.floor(Math.random() * chars.length));
      setHaConfig({...haConfig, authToken: token});
  };

  const renderContent = () => {
    switch(activeTab) {
      case 'general':
        return (
          <div className="space-y-6 animate-fade-in">
             <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* AI Integration Status */}
                <div className="dashboard-card p-6 rounded-lg lg:col-span-2">
                    <div className="flex items-start justify-between mb-6">
                        <div>
                            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                                <Sparkles className="w-4 h-4 text-indigo-500" /> AI Threat Analysis Engine
                            </h3>
                            <p className="text-xs text-zinc-500 mt-1">Manual on-demand investigation tool using Gemini Pro.</p>
                        </div>
                        <div className={`px-2 py-1 rounded text-[10px] font-bold uppercase border ${hasAiConfigured ? 'bg-emerald-950/30 text-emerald-500 border-emerald-900/50' : 'bg-rose-950/30 text-rose-500 border-rose-900/50'}`}>
                            {hasAiConfigured ? 'Gemini Ready' : 'Gemini Missing'}
                        </div>
                    </div>

                    <div className="bg-[#121214] border border-[#27272a] rounded p-4">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-[#09090b] rounded border border-[#27272a] flex items-center justify-center">
                                <Shield className="w-6 h-6 text-zinc-600" />
                            </div>
                            <div className="flex-1">
                                <div className="flex justify-between items-center mb-1">
                                    <span className="text-sm font-bold text-zinc-300">Privacy Mode: On-Demand Only</span>
                                </div>
                                <p className="text-xs text-zinc-500 leading-relaxed">
                                    Standard DNS queries are processed locally and are <strong>never</strong> sent to the AI. 
                                    External calls are only made when you manually click "Insight" or "Analyze" on a specific domain.
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="mt-6 grid grid-cols-3 gap-4">
                        <div className="p-3 bg-[#18181b] rounded border border-[#27272a]">
                            <div className="text-[10px] text-zinc-500 uppercase font-bold">Privacy</div>
                            <div className="text-lg font-mono text-white">Local First</div>
                        </div>
                        <div className="p-3 bg-[#18181b] rounded border border-[#27272a]">
                            <div className="text-[10px] text-zinc-500 uppercase font-bold">Latency</div>
                            <div className="text-lg font-mono text-white">~0ms (Core)</div>
                        </div>
                        <div className="p-3 bg-[#18181b] rounded border border-[#27272a]">
                            <div className="text-[10px] text-zinc-500 uppercase font-bold">Model</div>
                            <div className="text-lg font-mono text-white">Gemini 3.0</div>
                        </div>
                    </div>

                    <div className="mt-6 bg-[#121214] border border-[#27272a] rounded p-4">
                        <div className="flex items-center justify-between gap-4">
                            <div>
                                <div className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">AI Provider Keys (Server-Side)</div>
                                <div className="text-xs text-zinc-500 mt-1">Keys are stored encrypted in the backend DB. They are not shown again once saved.</div>
                                <div className="text-[10px] text-zinc-600 mt-2">Status: Gemini {hasAiConfigured ? 'configured' : 'missing'} · OpenAI {hasOpenAiConfigured ? 'configured' : 'missing'}</div>
                            </div>
                            <button
                                onClick={saveAiKeys}
                                className="px-3 py-1.5 rounded text-xs font-bold bg-[#18181b] border border-[#27272a] text-zinc-300 hover:bg-white hover:text-black hover:border-white transition-colors"
                            >
                                SAVE
                            </button>
                        </div>
                        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                            <input
                                type="password"
                                value={geminiApiKey}
                                onChange={(e) => setGeminiApiKey(e.target.value)}
                                placeholder="Gemini API Key"
                                className="w-full bg-[#09090b] border border-[#27272a] text-zinc-200 px-3 py-2 rounded text-xs font-mono focus:outline-none focus:border-zinc-500"
                            />
                            <input
                                type="password"
                                value={openAiApiKey}
                                onChange={(e) => setOpenAiApiKey(e.target.value)}
                                placeholder="OpenAI API Key"
                                className="w-full bg-[#09090b] border border-[#27272a] text-zinc-200 px-3 py-2 rounded text-xs font-mono focus:outline-none focus:border-zinc-500"
                            />
                        </div>
                    </div>

                    {/* GeoIP (World Map) */}
                    <div className="mt-6 bg-[#121214] border border-[#27272a] rounded p-4">
                        <div className="flex items-center justify-between gap-4">
                            <div>
                                <div className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">GeoIP World Map (Outbound Destinations)</div>
                                <div className="text-xs text-zinc-500 mt-1">
                                    Uses MaxMind GeoLite2 Country to geolocate DNS answer IPs for the dashboard world map.
                                </div>
                                <div className="text-[10px] text-zinc-600 mt-2">
                                    DB Path: <span className="font-mono">{geoIpStatus?.geoip?.dbPath || '/data/GeoLite2-Country.mmdb'}</span> · Status:{' '}
                                    {geoIpStatus?.geoip?.available ? (
                                        <span className="text-emerald-500 font-bold">READY</span>
                                    ) : (
                                        <span className="text-rose-500 font-bold">MISSING</span>
                                    )}
                                </div>
                                {geoIpStatus?.lastUpdatedAt && (
                                    <div className="text-[10px] text-zinc-600 mt-1">Last update: <span className="font-mono">{geoIpStatus.lastUpdatedAt}</span></div>
                                )}
                                {geoIpStatus?.lastError && (
                                    <div className="text-[10px] text-rose-500 mt-1">Error: <span className="font-mono">{geoIpStatus.lastError}</span></div>
                                )}
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={refreshGeoIpStatus}
                                    className="px-3 py-1.5 rounded text-xs font-bold bg-[#18181b] border border-[#27272a] text-zinc-300 hover:bg-white hover:text-black hover:border-white transition-colors"
                                >
                                    <span className="flex items-center gap-2"><RefreshCw className="w-3.5 h-3.5" /> REFRESH</span>
                                </button>
                                <button
                                    onClick={updateGeoIpDb}
                                    disabled={isGeoIpUpdating}
                                    className={`px-3 py-1.5 rounded text-xs font-bold border transition-colors ${isGeoIpUpdating ? 'bg-[#18181b] border-[#27272a] text-zinc-500' : 'bg-emerald-950/30 border-emerald-900/50 text-emerald-500 hover:bg-emerald-500 hover:text-black hover:border-emerald-400'}`}
                                >
                                    <span className="flex items-center gap-2"><Download className="w-3.5 h-3.5" /> {isGeoIpUpdating ? 'UPDATING…' : 'UPDATE DB'}</span>
                                </button>
                            </div>
                        </div>

                        <div className="mt-4 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
                            <input
                                type="password"
                                value={maxMindLicenseKey}
                                onChange={(e) => setMaxMindLicenseKey(e.target.value)}
                                placeholder="MaxMind License Key (stored encrypted)"
                                className="w-full bg-[#09090b] border border-[#27272a] text-zinc-200 px-3 py-2 rounded text-xs font-mono focus:outline-none focus:border-zinc-500"
                            />
                            <button
                                onClick={saveMaxMindKey}
                                className="px-3 py-2 rounded text-xs font-bold bg-[#18181b] border border-[#27272a] text-zinc-300 hover:bg-white hover:text-black hover:border-white transition-colors"
                            >
                                <span className="flex items-center gap-2"><Lock className="w-3.5 h-3.5" /> SAVE KEY</span>
                            </button>
                        </div>

                        <div className="mt-3 text-[11px] text-zinc-500 leading-relaxed">
                            You need a MaxMind account + license key. The key is stored encrypted in the backend DB and is never displayed again.
                        </div>
                        {geoIpMessage && (
                            <div className="mt-2 text-[11px] text-zinc-400">{geoIpMessage}</div>
                        )}
                    </div>
                </div>

                {/* System Information */}
                <div className="dashboard-card p-6 rounded-lg space-y-6">
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                        <Cpu className="w-4 h-4 text-emerald-500" /> System Resources
                    </h3>
                    
                    <div className="space-y-4">
                        <div>
                            <div className="flex justify-between text-xs mb-1">
                                <span className="text-zinc-400">CPU Usage</span>
                                <span className="text-zinc-200 font-mono">12%</span>
                            </div>
                            <div className="w-full h-1.5 bg-[#27272a] rounded-full overflow-hidden">
                                <div className="w-[12%] h-full bg-emerald-500 rounded-full"></div>
                            </div>
                        </div>
                        <div>
                            <div className="flex justify-between text-xs mb-1">
                                <span className="text-zinc-400">Memory (RAM)</span>
                                <span className="text-zinc-200 font-mono">2.4 / 8.0 GB</span>
                            </div>
                            <div className="w-full h-1.5 bg-[#27272a] rounded-full overflow-hidden">
                                <div className="w-[30%] h-full bg-indigo-500 rounded-full"></div>
                            </div>
                        </div>
                        <div>
                            <div className="flex justify-between text-xs mb-1">
                                <span className="text-zinc-400">Storage (Logs)</span>
                                <span className="text-zinc-200 font-mono">14.2 GB</span>
                            </div>
                            <div className="w-full h-1.5 bg-[#27272a] rounded-full overflow-hidden">
                                <div className="w-[65%] h-full bg-amber-500 rounded-full"></div>
                            </div>
                        </div>
                    </div>

                    <div className="pt-4 border-t border-[#27272a] flex gap-2">
                        <button className="flex-1 py-2 bg-[#18181b] border border-[#27272a] hover:bg-white hover:text-black hover:border-white transition-colors rounded text-xs font-bold text-zinc-400">
                            FLUSH LOGS
                        </button>
                        <button className="flex-1 py-2 bg-[#18181b] border border-[#27272a] hover:bg-rose-600 hover:text-white hover:border-rose-500 transition-colors rounded text-xs font-bold text-zinc-400">
                            REBOOT
                        </button>
                    </div>
                </div>
             </div>
          </div>
        );

      case 'ha':
        return (
          <div className="space-y-6 animate-fade-in">
             <div className="dashboard-card p-6 rounded-lg">
                <div className="flex justify-between items-start mb-6">
                   <div>
                      <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                         <Activity className="w-4 h-4 text-emerald-500" /> High Availability Cluster
                      </h3>
                      <p className="text-xs text-zinc-500 mt-1">Synchronize configuration between multiple instances for failover protection.</p>
                   </div>
                   {syncEnabled && (
                       <div className="flex items-center gap-3 bg-[#18181b] border border-[#27272a] rounded px-3 py-1.5">
                            <div className="flex flex-col items-end">
                                <span className="text-[9px] text-zinc-500 uppercase font-bold tracking-wider">Last Sync</span>
                                <span className="text-xs font-mono text-zinc-300">{haConfig.lastSync}</span>
                            </div>
                            <div className="w-px h-6 bg-[#27272a]"></div>
                            <div className="flex items-center gap-1.5">
                                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                                <span className="text-xs text-emerald-500 font-bold uppercase">Synced</span>
                            </div>
                       </div>
                   )}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
                   {/* Visualization Section */}
                   <div className="bg-[#121214] rounded border border-[#27272a] p-8 flex flex-col items-center justify-center relative h-full min-h-[300px]">
                      {/* Background Grid */}
                      <div className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(#27272a 1px, transparent 1px)', backgroundSize: '20px 20px', opacity: 0.5 }}></div>
                      
                      <div className="flex items-center gap-12 relative z-10">
                          {/* Primary Node */}
                          <div className="flex flex-col items-center gap-3">
                             <div className="w-16 h-16 bg-[#18181b] border-2 border-emerald-500 rounded-xl flex items-center justify-center shadow-[0_0_20px_rgba(16,185,129,0.2)] relative">
                                <Server className="w-8 h-8 text-white" />
                                <div className="absolute -top-2 -right-2 w-5 h-5 bg-emerald-500 rounded-full border-2 border-[#121214] flex items-center justify-center">
                                    <Check className="w-3 h-3 text-black stroke-[4]" />
                                </div>
                             </div>
                             <div className="text-center">
                                 <div className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider">Primary (You)</div>
                                 <div className="text-[10px] font-mono text-zinc-500">192.168.1.5</div>
                             </div>
                          </div>

                          {/* Data Flow Line */}
                          <div className="w-32 h-px bg-zinc-700 relative flex items-center">
                             {syncEnabled && (
                                <>
                                    <div className="absolute inset-0 bg-emerald-500/50 animate-pulse"></div>
                                    <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-[#09090b] border border-[#27272a] rounded-full flex items-center justify-center z-10">
                                        <RefreshCw className="w-4 h-4 text-emerald-500 animate-spin-slow" />
                                    </div>
                                    {/* Flying Packet */}
                                    <div className="absolute w-2 h-2 bg-white rounded-full top-1/2 -mt-1 animate-[ping_1.5s_linear_infinite]" style={{ animationDuration: '2s' }}></div>
                                </>
                             )}
                             {!syncEnabled && (
                                 <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 p-1 bg-[#121214] text-zinc-600">
                                     <X className="w-4 h-4" />
                                 </div>
                             )}
                          </div>

                          {/* Replica Node */}
                          <div className={`flex flex-col items-center gap-3 transition-all duration-500 ${syncEnabled ? 'opacity-100' : 'opacity-40 grayscale'}`}>
                             <div className="w-16 h-16 bg-[#18181b] border border-zinc-500 rounded-xl flex items-center justify-center">
                                <Server className="w-8 h-8 text-zinc-300" />
                             </div>
                             <div className="text-center">
                                 <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Replica</div>
                                 <div className="text-[10px] font-mono text-zinc-500 truncate max-w-[100px]">{haConfig.replicaUrl.split('//')[1]?.split(':')[0] || 'Unknown'}</div>
                             </div>
                          </div>
                      </div>
                      
                      <div className="mt-8 text-center max-w-xs">
                          <p className="text-xs text-zinc-500 leading-relaxed">
                              {syncEnabled 
                                ? "Configuration changes on this node are automatically pushed to the replica instance every 60 seconds." 
                                : "Synchronization is paused. Changes made here will remain local until re-enabled."}
                          </p>
                      </div>
                   </div>

                   {/* Configuration Form */}
                   <div className="space-y-6">
                      
                      {/* Master Toggle */}
                      <div className="flex items-center justify-between p-4 border border-[#27272a] rounded bg-[#18181b]">
                         <div>
                             <span className="text-sm font-bold text-zinc-200 block">Enable Configuration Sync</span>
                             <span className="text-[10px] text-zinc-500">Master Switch for HA features</span>
                         </div>
                         <div 
                           onClick={() => setSyncEnabled(!syncEnabled)}
                           className={`w-12 h-6 rounded-full relative cursor-pointer transition-colors ${syncEnabled ? 'bg-emerald-600' : 'bg-zinc-700'}`}
                         >
                            <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${syncEnabled ? 'right-1' : 'left-1'}`}></div>
                         </div>
                      </div>

                      <div className={`space-y-5 transition-all duration-300 ${syncEnabled ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
                         
                         {/* Replica URL */}
                         <div className="space-y-2">
                            <label className="text-xs font-bold text-zinc-400 uppercase flex items-center gap-2">
                                Target Replica URL
                                <Info className="w-3 h-3 text-zinc-600" />
                            </label>
                            <div className="relative">
                                <Link className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                                <input 
                                    type="text" 
                                    value={haConfig.replicaUrl}
                                    onChange={(e) => setHaConfig({...haConfig, replicaUrl: e.target.value})}
                                    placeholder="http://192.168.x.x:3000"
                                    className="w-full bg-[#09090b] border border-[#27272a] text-zinc-300 pl-10 pr-3 py-2.5 rounded text-xs font-mono focus:border-emerald-500 outline-none transition-colors" 
                                />
                            </div>
                         </div>

                         {/* Auth Token */}
                         <div className="space-y-2">
                            <div className="flex justify-between items-center">
                                <label className="text-xs font-bold text-zinc-400 uppercase flex items-center gap-2">
                                    Cluster Auth Token
                                    <Lock className="w-3 h-3 text-zinc-600" />
                                </label>
                                <button onClick={generateToken} className="text-[10px] text-emerald-500 hover:text-emerald-400 font-bold flex items-center gap-1">
                                    <RefreshCw className="w-3 h-3" /> GENERATE NEW
                                </button>
                            </div>
                            <div className="flex gap-2">
                                <div className="relative flex-1">
                                    <input 
                                        type="password" 
                                        value={haConfig.authToken} 
                                        onChange={(e) => setHaConfig({...haConfig, authToken: e.target.value})}
                                        className="w-full bg-[#09090b] border border-[#27272a] text-zinc-300 px-3 py-2.5 rounded text-xs font-mono focus:border-emerald-500 outline-none transition-colors" 
                                    />
                                </div>
                                <button className="px-3 bg-[#18181b] border border-[#27272a] text-zinc-400 rounded hover:text-white" title="Copy to Clipboard">
                                    <Copy className="w-4 h-4" />
                                </button>
                            </div>
                            <p className="text-[10px] text-zinc-500 bg-amber-950/10 border border-amber-900/20 p-2 rounded flex gap-2">
                                <AlertTriangle className="w-3 h-3 text-amber-600 flex-shrink-0" />
                                <span>This token acts as a <strong>Shared Secret</strong>. You must enter this exact token in the Replica's configuration for the sync to succeed.</span>
                            </p>
                         </div>

                         {/* Action Buttons */}
                         <div className="pt-4 border-t border-[#27272a] flex items-center gap-3">
                            <button 
                                onClick={testHaConnection}
                                disabled={isTestingConnection}
                                className={`flex-1 py-2.5 rounded text-xs font-bold border flex items-center justify-center gap-2 transition-all ${
                                    connectionTestResult === 'success' 
                                    ? 'bg-emerald-950/30 text-emerald-500 border-emerald-900/50' 
                                    : connectionTestResult === 'fail'
                                    ? 'bg-rose-950/30 text-rose-500 border-rose-900/50'
                                    : 'bg-[#18181b] border-[#27272a] text-zinc-300 hover:bg-[#27272a]'
                                }`}
                            >
                                {isTestingConnection ? (
                                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                ) : connectionTestResult === 'success' ? (
                                    <CheckCircle className="w-3.5 h-3.5" />
                                ) : (
                                    <Zap className="w-3.5 h-3.5" />
                                )}
                                {isTestingConnection ? 'PINGING...' : connectionTestResult === 'success' ? 'REACHABLE' : 'TEST CONNECTION'}
                            </button>

                            <button 
                                onClick={handleSaveHa}
                                disabled={isSavingHa}
                                className="flex-[2] btn-primary py-2.5 rounded text-xs flex items-center justify-center gap-2"
                            >
                                {isSavingHa ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                                {isSavingHa ? 'SAVING...' : 'SAVE CONFIGURATION'}
                            </button>
                         </div>
                      </div>
                   </div>
                </div>
             </div>
          </div>
        );

      case 'remote':
        return (
          <div className="space-y-6 animate-fade-in">
            <div className="dashboard-card p-6 rounded-lg">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Network className="w-4 h-4 text-white" /> Remote Access (Tailscale)
              </h3>

                            <div className="mt-3 text-xs text-zinc-500 leading-relaxed">
                                Authenticate using the official Tailscale login flow (opens <span className="font-mono">login.tailscale.com</span> in a new tab).
                                You can sign in with GitHub/Google/SSO depending on your tailnet settings.
                            </div>

                            <div className="mt-4 flex items-center justify-between gap-3">
                                <div className="text-xs text-zinc-500">
                                    {tailscaleStatus?.running
                                        ? `Status: ${tailscaleStatus.backendState || 'Running'}`
                                        : tailscaleStatus?.message || 'Status: unknown'}
                                </div>
                                <button
                                    onClick={refreshTailscaleStatus}
                                    disabled={isTailscaleBusy}
                                    className="px-3 py-1.5 rounded text-xs font-bold border bg-[#18181b] border-[#27272a] text-zinc-300 hover:bg-[#27272a]"
                                >
                                    <span className="flex items-center gap-2"><RefreshCw className="w-3.5 h-3.5" /> REFRESH</span>
                                </button>
                            </div>

                            {!tailscaleStatus?.running && (
                                <div className="mt-4 p-4 rounded border border-amber-900/30 bg-amber-950/10">
                                    <div className="flex items-start gap-2">
                                        <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5" />
                                        <div>
                                            <div className="text-sm font-bold text-zinc-200">Tailscale not available</div>
                                            <div className="text-xs text-zinc-500 mt-1 leading-relaxed">
                                                Sentinel expects <span className="font-mono">tailscaled</span> to run inside the container with <span className="font-mono">/dev/net/tun</span> and <span className="font-mono">NET_ADMIN</span>.
                                                {tailscaleStatus?.details ? (
                                                    <div className="mt-2 text-[11px] font-mono text-zinc-500 whitespace-pre-wrap">{tailscaleStatus.details}</div>
                                                ) : null}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {tailscaleStatus?.running && (
                                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="p-4 rounded border border-[#27272a] bg-[#09090b]">
                                        <div className="text-[10px] uppercase font-bold text-zinc-500">This Device</div>
                                        <div className="mt-2 text-xs text-zinc-300">
                                            <div><span className="text-zinc-500">Name:</span> <span className="font-mono">{tailscaleStatus?.self?.hostName || '-'}</span></div>
                                            <div><span className="text-zinc-500">DNS:</span> <span className="font-mono">{tailscaleStatus?.self?.dnsName || '-'}</span></div>
                                            <div><span className="text-zinc-500">IPs:</span> <span className="font-mono">{(tailscaleStatus?.self?.tailscaleIps || []).join(', ') || '-'}</span></div>
                                        </div>
                                    </div>

                                    <div className="p-4 rounded border border-[#27272a] bg-[#09090b]">
                                        <div className="text-[10px] uppercase font-bold text-zinc-500">Auth Key</div>
                                        <div className="mt-2 text-xs text-zinc-300">
                                            Stored: <span className={tailscaleStatus?.hasAuthKey ? 'text-emerald-500 font-bold' : 'text-rose-500 font-bold'}>{tailscaleStatus?.hasAuthKey ? 'YES' : 'NO'}</span>
                                        </div>
                                        <div className="mt-3 flex gap-2">
                                            <input
                                                type="password"
                                                value={tailscaleAuthKey}
                                                onChange={(e) => setTailscaleAuthKey(e.target.value)}
                                                placeholder="Tailscale auth key (stored encrypted)"
                                                className="flex-1 bg-[#09090b] border border-[#27272a] text-zinc-200 px-3 py-2 rounded text-xs font-mono focus:outline-none focus:border-zinc-500"
                                            />
                                            <button
                                                onClick={saveTailscaleAuthKey}
                                                disabled={isTailscaleBusy}
                                                className="px-3 py-2 rounded text-xs font-bold bg-[#18181b] border border-[#27272a] text-zinc-300 hover:bg-white hover:text-black hover:border-white transition-colors"
                                            >
                                                <span className="flex items-center gap-2"><Lock className="w-3.5 h-3.5" /> SAVE</span>
                                            </button>
                                        </div>
                                        <div className="mt-2 text-[11px] text-zinc-500 leading-relaxed">
                                            Create a reusable auth key in the Tailscale admin console. The key is never shown again.
                                        </div>

                                        <div className="mt-3">
                                            <button
                                                onClick={authenticateTailscaleInBrowser}
                                                disabled={isTailscaleBusy || isTailscaleAuthPolling}
                                                className="w-full py-2 rounded text-xs font-bold border bg-[#18181b] border-[#27272a] text-zinc-300 hover:bg-white hover:text-black hover:border-white transition-colors flex items-center justify-center gap-2"
                                            >
                                                {isTailscaleBusy || isTailscaleAuthPolling ? (
                                                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                                ) : (
                                                    <ExternalLink className="w-3.5 h-3.5" />
                                                )}
                                                AUTHENTICATE IN BROWSER
                                            </button>
                                            <div className="mt-2 text-[11px] text-zinc-500 leading-relaxed">
                                                Opens the official Tailscale website to log in and authorize this Sentinel instance.
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="mt-6 p-5 bg-[#18181b] border border-[#27272a] rounded-lg">
                                <div className="flex items-center justify-between gap-4">
                                    <div>
                                        <div className="text-xs font-bold text-zinc-300 uppercase">Exit Node</div>
                                        <div className="text-[11px] text-zinc-500 mt-1">
                                            Advertise Sentinel as an exit node so remote devices can route traffic through it.
                                        </div>
                                    </div>
                                    <div
                                        onClick={() => setTailscaleAdvertiseExitNode(!tailscaleAdvertiseExitNode)}
                                        className={`w-12 h-6 rounded-full relative cursor-pointer transition-colors ${tailscaleAdvertiseExitNode ? 'bg-emerald-600' : 'bg-zinc-700'}`}
                                    >
                                        <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${tailscaleAdvertiseExitNode ? 'right-1' : 'left-1'}`}></div>
                                    </div>
                                </div>

                                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-[10px] uppercase font-bold text-zinc-500">Hostname (optional)</label>
                                        <input
                                            type="text"
                                            value={tailscaleHostname}
                                            onChange={(e) => setTailscaleHostname(e.target.value)}
                                            placeholder="sentinel-dns"
                                            className="mt-2 w-full bg-[#09090b] border border-[#27272a] text-zinc-200 px-3 py-2 rounded text-xs font-mono focus:outline-none focus:border-zinc-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[10px] uppercase font-bold text-zinc-500">Advertise Routes (optional)</label>
                                        <input
                                            type="text"
                                            value={tailscaleRoutesInput}
                                            onChange={(e) => setTailscaleRoutesInput(e.target.value)}
                                            placeholder="192.168.1.0/24,10.0.0.0/24"
                                            className="mt-2 w-full bg-[#09090b] border border-[#27272a] text-zinc-200 px-3 py-2 rounded text-xs font-mono focus:outline-none focus:border-zinc-500"
                                        />
                                    </div>
                                </div>

                                <div className="mt-4 flex items-center justify-between p-3 border border-[#27272a] rounded bg-[#09090b]">
                                    <div>
                                        <div className="text-xs font-bold text-zinc-300">SNAT subnet routes</div>
                                        <div className="text-[11px] text-zinc-500">Recommended for exit-node/subnet-router in containers</div>
                                    </div>
                                    <div
                                        onClick={() => setTailscaleSnatSubnetRoutes(!tailscaleSnatSubnetRoutes)}
                                        className={`w-12 h-6 rounded-full relative cursor-pointer transition-colors ${tailscaleSnatSubnetRoutes ? 'bg-emerald-600' : 'bg-zinc-700'}`}
                                    >
                                        <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${tailscaleSnatSubnetRoutes ? 'right-1' : 'left-1'}`}></div>
                                    </div>
                                </div>

                                <div className="mt-4 flex items-center gap-3">
                                    <button
                                        onClick={refreshTailscaleStatus}
                                        disabled={isTailscaleBusy}
                                        className="px-3 py-2.5 rounded text-xs font-bold border bg-[#18181b] border-[#27272a] text-zinc-300 hover:bg-[#27272a] flex items-center justify-center gap-2"
                                    >
                                        <RefreshCw className="w-3.5 h-3.5" /> REFRESH STATUS
                                    </button>
                                    <button
                                        onClick={connectTailscale}
                                        disabled={isTailscaleBusy}
                                        className="flex-1 btn-primary py-2.5 rounded text-xs flex items-center justify-center gap-2"
                                    >
                                        {isTailscaleBusy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Power className="w-3.5 h-3.5" />}
                                        CONNECT / APPLY
                                    </button>
                                    <button
                                        onClick={applyTailscaleConfig}
                                        disabled={isTailscaleBusy}
                                        className="flex-1 py-2.5 rounded text-xs font-bold border bg-[#18181b] border-[#27272a] text-zinc-300 hover:bg-[#27272a] flex items-center justify-center gap-2"
                                    >
                                        <Route className="w-3.5 h-3.5" /> APPLY CONFIG
                                    </button>
                                    <button
                                        onClick={disconnectTailscale}
                                        disabled={isTailscaleBusy}
                                        className="flex-1 py-2.5 rounded text-xs font-bold border bg-rose-950/20 border-rose-900/40 text-rose-300 hover:bg-rose-600 hover:text-white hover:border-rose-500 flex items-center justify-center gap-2"
                                    >
                                        <Power className="w-3.5 h-3.5" /> DISCONNECT
                                    </button>
                                </div>

                                {tailscaleMessage && (
                                    <div className="mt-3 text-[11px] text-zinc-400">{tailscaleMessage}</div>
                                )}
                            </div>

                            <div className="mt-6 p-4 rounded border border-[#27272a] bg-[#09090b]">
                                <div className="text-[10px] uppercase font-bold text-zinc-500">How devices use Sentinel DNS</div>
                                <div className="mt-2 text-xs text-zinc-500 leading-relaxed">
                                    To make remote devices actually use Sentinel for DNS, set your Tailnet DNS nameserver to this node’s Tailscale IP in the Tailscale admin console.
                                    Then, on clients, enable “Use Tailscale DNS”.
                                </div>
                            </div>
            </div>
          </div>
        );

      case 'notifications':
        return (
          <div className="space-y-6 animate-fade-in">
             <div className="dashboard-card p-6 rounded-lg">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2 mb-6">
                   <Bell className="w-4 h-4 text-indigo-500" /> Notification Channels
                </h3>

                <div className="space-y-6">
                   {/* Discord Config */}
                   <div className="p-5 bg-[#18181b] border border-[#27272a] rounded-lg">
                      <div className="flex items-center gap-3 mb-4">
                         <div className="w-8 h-8 bg-[#5865F2] rounded flex items-center justify-center text-white font-bold">D</div>
                         <div>
                            <div className="font-bold text-white text-sm">Discord Webhook</div>
                            <div className="text-[10px] text-zinc-500">Send alerts to a dedicated channel.</div>
                         </div>
                      </div>

                      <div className="space-y-4">
                         <div className="flex gap-2">
                            <input 
                               type="text" 
                               value={discordUrl}
                               onChange={(e) => setDiscordUrl(e.target.value)}
                               placeholder="https://discord.com/api/webhooks/..." 
                               className="flex-1 bg-[#09090b] border border-[#27272a] text-zinc-300 px-3 py-2 rounded text-xs font-mono focus:border-[#5865F2] outline-none" 
                            />
                            <button onClick={testNotification} className="px-3 bg-zinc-800 border border-zinc-700 rounded text-xs font-bold text-zinc-300 hover:text-white">TEST</button>
                         </div>
                         
                         {discordUrl && (
                             <button onClick={saveNotificationSettings} className="w-full py-1.5 bg-[#5865F2] text-white rounded text-xs font-bold hover:bg-[#4752C4]">SAVE WEBHOOK</button>
                         )}

                         <div className="grid grid-cols-2 gap-2">
                            {['High Risk Block', 'System Updates', 'Cluster Failover', 'New Device Joined'].map(evt => (
                               <label key={evt} className="flex items-center gap-2 p-2 rounded hover:bg-[#27272a] cursor-pointer">
                                  <input type="checkbox" className="rounded bg-[#09090b] border-[#27272a] text-[#5865F2]" defaultChecked />
                                  <span className="text-xs text-zinc-400">{evt}</span>
                               </label>
                            ))}
                         </div>
                      </div>
                   </div>

                   {/* Other channels placeholder */}
                   <div className="opacity-50 pointer-events-none p-4 border border-dashed border-[#27272a] rounded flex justify-between items-center">
                      <div className="flex items-center gap-3">
                         <div className="w-8 h-8 bg-zinc-800 rounded flex items-center justify-center text-zinc-500">@</div>
                         <div className="text-xs font-bold text-zinc-500">Email (SMTP)</div>
                      </div>
                      <span className="text-[10px] uppercase font-bold text-zinc-600">Coming Soon</span>
                   </div>
                </div>
             </div>
          </div>
        );
      
      default: return null;
    }
  };

  return (
    <div className="flex gap-6 h-[calc(100vh-140px)]">
      {/* Settings Navigation Sidebar */}
      <div className="w-48 flex-shrink-0">
         <div className="space-y-1">
            <button 
               onClick={() => setActiveTab('general')}
               className={`w-full text-left px-3 py-2 rounded text-xs font-bold flex items-center gap-2 transition-all ${activeTab === 'general' ? 'bg-[#27272a] text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
               <SettingsIcon className="w-4 h-4" /> General
            </button>
            <button 
               onClick={() => setActiveTab('ha')}
               className={`w-full text-left px-3 py-2 rounded text-xs font-bold flex items-center gap-2 transition-all ${activeTab === 'ha' ? 'bg-[#27272a] text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
               <Activity className="w-4 h-4" /> High Availability
            </button>
            <button 
               onClick={() => setActiveTab('remote')}
               className={`w-full text-left px-3 py-2 rounded text-xs font-bold flex items-center gap-2 transition-all ${activeTab === 'remote' ? 'bg-[#27272a] text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
               <Network className="w-4 h-4" /> Remote Access
            </button>
            <button 
               onClick={() => setActiveTab('notifications')}
               className={`w-full text-left px-3 py-2 rounded text-xs font-bold flex items-center gap-2 transition-all ${activeTab === 'notifications' ? 'bg-[#27272a] text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
               <Bell className="w-4 h-4" /> Notifications
            </button>
         </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto pr-2">
         <div>
            <h2 className="text-xl font-bold text-white tracking-tight mb-1">
               {activeTab === 'general' && 'System Configuration'}
               {activeTab === 'ha' && 'Cluster Synchronization'}
               {activeTab === 'remote' && 'Tailscale & VPN'}
               {activeTab === 'notifications' && 'Alerts & Webhooks'}
            </h2>
            <p className="text-zinc-500 text-sm mb-6">
               {activeTab === 'general' && 'Manage core system parameters and maintenance.'}
               {activeTab === 'ha' && 'Configure failover and state replication.'}
               {activeTab === 'remote' && 'Manage secure remote connectivity.'}
               {activeTab === 'notifications' && 'Configure external notification providers.'}
            </p>
         </div>
         
         {renderContent()}
      </div>
    </div>
  );
};

export default Settings;