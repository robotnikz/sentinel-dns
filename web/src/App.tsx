import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import Sidebar from './components/Sidebar';
import Setup from './pages/Setup';
import { Bell, Search, Terminal, Play, Pause, AlertTriangle, Shield, CheckCircle, Lock } from 'lucide-react';
import { RulesProvider } from './contexts/RulesContext';
import { ClientsProvider } from './contexts/ClientsContext';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const QueryLogs = lazy(() => import('./pages/QueryLogs'));
const Clients = lazy(() => import('./pages/Clients'));
const Blocking = lazy(() => import('./pages/Blocking'));
const DnsSettings = lazy(() => import('./pages/DnsSettings'));
const NetworkMap = lazy(() => import('./pages/NetworkMap'));
const Settings = lazy(() => import('./pages/Settings2'));
const Cluster = lazy(() => import('./pages/Cluster'));

const App: React.FC = () => {
  const VALID_PAGES = useRef(new Set(['dashboard', 'logs', 'clients', 'topology', 'blocking', 'dns', 'settings', 'cluster']));

  const readPageFromHash = () => {
    const raw = (window.location.hash || '').replace(/^#\/?/, '').trim();
    return raw || null;
  };

  const normalizePage = (page: any) => {
    const p = typeof page === 'string' ? page.trim() : '';
    return VALID_PAGES.current.has(p) ? p : 'dashboard';
  };

  const [activePage, _setActivePage] = useState(() => normalizePage(readPageFromHash()));

  const setActivePage = (page: string) => {
    const next = normalizePage(page);
    _setActivePage(next);
    try {
      const targetHash = `#${next}`;
      if (window.location.hash !== targetHash) window.location.hash = targetHash;
    } catch {
      // ignore
    }
  };
  const [logsPreset, setLogsPreset] = useState<any>(null);
  const [settingsTabPreset, setSettingsTabPreset] = useState<'general' | 'geoip' | 'remote' | 'notifications' | 'maintenance' | 'system' | null>(null);
  const [protectionPause, setProtectionPause] = useState<{
    active: boolean;
    mode: 'OFF' | 'UNTIL' | 'FOREVER';
    until: string | null;
    remainingMs: number | null;
  }>({ active: false, mode: 'OFF', until: null, remainingMs: null });
  const [pauseMenuOpen, setPauseMenuOpen] = useState(false);
  const [pauseBusy, setPauseBusy] = useState(false);
  const [pauseError, setPauseError] = useState('');
  const [localConfiguredRole, setLocalConfiguredRole] = useState<'standalone' | 'leader' | 'follower' | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [authGate, setAuthGate] = useState<'loading' | 'open' | 'closed'>('loading');
  const [authUsername, setAuthUsername] = useState<string>('');
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [bellUnreadCount, setBellUnreadCount] = useState(0);
  const [bellItems, setBellItems] = useState<any[]>([]);
  const [bellBusy, setBellBusy] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchIndex, setSearchIndex] = useState(0);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [cpCurrent, setCpCurrent] = useState('');
  const [cpNew, setCpNew] = useState('');
  const [cpNew2, setCpNew2] = useState('');
  const [cpBusy, setCpBusy] = useState(false);
  const [cpError, setCpError] = useState('');
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const pauseMenuRef = useRef<HTMLDivElement | null>(null);
  const bellRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // Gate the UI behind auth:
    // - if not configured -> show onboarding
    // - if configured and not logged in -> show login
    // - if logged in (cookie) -> show app
    Promise.all([
      fetch('/api/auth/status', { credentials: 'include' }).then((r) => r.json()),
      fetch('/api/auth/me', { credentials: 'include' }).then((r) => r.json()).catch(() => ({ loggedIn: false }))
    ])
      .then(([status, me]) => {
        const configured = !!status?.configured;
        const loggedIn = !!me?.loggedIn;
        setAuthUsername(me?.username ? String(me.username) : '');
        setAuthGate(configured && loggedIn ? 'closed' : 'open');
      })
      .catch(() => {
        // If backend is down, don't block the UI hard.
        setAuthGate('closed');
      });
  }, []);

  useEffect(() => {
    // Keep state in sync with URL so refresh/back/forward work.
    const onHashChange = () => {
      const next = normalizePage(readPageFromHash());
      _setActivePage(next);
    };

    // If no hash is present, initialize it once.
    if (!window.location.hash) {
      try {
        window.location.hash = `#${normalizePage(activePage)}`;
      } catch {
        // ignore
      }
    }

    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    const onNavigate = (evt: Event) => {
      const e = evt as CustomEvent<any>;
      const page = e?.detail?.page;
      if (typeof page === 'string' && page.length > 0) {
        setActivePage(page);
      }
      if (page === 'logs') {
        setLogsPreset(e?.detail?.logsPreset ?? null);
      }
      if (page === 'settings') {
        setSettingsTabPreset(e?.detail?.settingsTabPreset ?? null);
      }
    };
    window.addEventListener('sentinel:navigate', onNavigate as any);
    return () => window.removeEventListener('sentinel:navigate', onNavigate as any);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isCmdK = (e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'k';
      if (isCmdK) {
        e.preventDefault();
        setSearchOpen(true);
        setSearchQuery('');
        setSearchIndex(0);
        return;
      }

      if (e.key === 'Escape') {
        setUserMenuOpen(false);
        setPauseMenuOpen(false);
        setBellOpen(false);
        setSearchOpen(false);
        setShowChangePassword(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const onWindowBlur = () => {
      setUserMenuOpen(false);
      setPauseMenuOpen(false);
      setBellOpen(false);
      setSearchOpen(false);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') {
        setUserMenuOpen(false);
        setPauseMenuOpen(false);
        setBellOpen(false);
        setSearchOpen(false);
      }
    };

    window.addEventListener('blur', onWindowBlur);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('blur', onWindowBlur);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (activePage !== 'settings' && settingsTabPreset) {
      setSettingsTabPreset(null);
    }
  }, [activePage, settingsTabPreset]);

  useEffect(() => {
    if (!userMenuOpen) return;

    const onPointerDown = (e: PointerEvent) => {
      const root = userMenuRef.current;
      if (!root) return;
      const target = e.target as Node | null;
      if (target && !root.contains(target)) {
        setUserMenuOpen(false);
      }
    };

    // Capture phase so we can close even if other handlers stop propagation.
    document.addEventListener('pointerdown', onPointerDown, { capture: true });
    return () => document.removeEventListener('pointerdown', onPointerDown, { capture: true } as any);
  }, [userMenuOpen]);

  useEffect(() => {
    let cancelled = false;

    const refreshProtectionPause = async () => {
      try {
        const res = await fetch('/api/protection/pause');
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        if (cancelled || !data || typeof data !== 'object') return;

        setProtectionPause({
          active: !!(data as any).active,
          mode: ((data as any).mode as any) ?? 'OFF',
          until: typeof (data as any).until === 'string' ? (data as any).until : null,
          remainingMs: typeof (data as any).remainingMs === 'number' ? (data as any).remainingMs : null
        });
      } catch {
        // ignore; keep last known
      }
    };

    refreshProtectionPause();
    const t = setInterval(refreshProtectionPause, protectionPause.active ? 1000 : 10_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [protectionPause.active]);

  useEffect(() => {
    let cancelled = false;

    const refreshClusterPeerStatus = async () => {
      try {
        const res = await fetch('/api/cluster/peer-status', { headers: { Accept: 'application/json' } });
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        if (cancelled || !data || typeof data !== 'object') return;

        const role = String((data as any)?.local?.ready?.configuredRole || 'standalone');
        if (role === 'leader' || role === 'follower' || role === 'standalone') {
          setLocalConfiguredRole(role);
        } else {
          setLocalConfiguredRole(null);
        }
      } catch {
        // ignore
      }
    };

    refreshClusterPeerStatus();
    const t = setInterval(refreshClusterPeerStatus, 10_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (!pauseMenuOpen) return;

    const onPointerDown = (e: PointerEvent) => {
      const root = pauseMenuRef.current;
      if (!root) return;
      const target = e.target as Node | null;
      if (target && !root.contains(target)) {
        setPauseMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', onPointerDown, { capture: true });
    return () => document.removeEventListener('pointerdown', onPointerDown, { capture: true } as any);
  }, [pauseMenuOpen]);

  useEffect(() => {
    let cancelled = false;
    const refreshUnread = async () => {
      try {
        const res = await fetch('/api/notifications/feed/unread-count');
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        if (cancelled || !data || typeof data !== 'object') return;
        const c = Number((data as any).count);
        if (Number.isFinite(c)) setBellUnreadCount(c);
      } catch {
        // ignore
      }
    };

    refreshUnread();
    const t = setInterval(refreshUnread, 10_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (!bellOpen) return;

    const onPointerDown = (e: PointerEvent) => {
      const root = bellRef.current;
      if (!root) return;
      const target = e.target as Node | null;
      if (target && !root.contains(target)) {
        setBellOpen(false);
      }
    };

    document.addEventListener('pointerdown', onPointerDown, { capture: true });
    return () => document.removeEventListener('pointerdown', onPointerDown, { capture: true } as any);
  }, [bellOpen]);

  const openBell = async () => {
    setBellOpen(true);
    setBellBusy(true);
    try {
      const res = await fetch('/api/notifications/feed?limit=25');
      const data = await res.json().catch(() => null);
      if (res.ok && data && typeof data === 'object' && Array.isArray((data as any).items)) {
        setBellItems((data as any).items);
      }
      await fetch('/api/notifications/feed/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true })
      }).catch(() => null);
      const unread = await fetch('/api/notifications/feed/unread-count').then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (unread && typeof unread === 'object') {
        const c = Number((unread as any).count);
        if (Number.isFinite(c)) setBellUnreadCount(c);
      }
    } finally {
      setBellBusy(false);
    }
  };

  const setProtectionPauseMode = async (mode: 'OFF' | 'UNTIL' | 'FOREVER', durationMinutes?: number) => {
    setPauseBusy(true);
    setPauseError('');
    try {
      const res = await fetch('/api/protection/pause', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, durationMinutes })
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        setPauseError(String((data as any)?.error || 'FAILED'));
        return;
      }
      setProtectionPause({
        active: !!(data as any).active,
        mode: ((data as any).mode as any) ?? 'OFF',
        until: typeof (data as any).until === 'string' ? (data as any).until : null,
        remainingMs: typeof (data as any).remainingMs === 'number' ? (data as any).remainingMs : null
      });
      setPauseMenuOpen(false);
    } catch {
      setPauseError('FAILED');
    } finally {
      setPauseBusy(false);
    }
  };

  const formatRemaining = (ms: number | null) => {
    if (!ms || ms <= 0) return '';
    const totalSec = Math.floor(ms / 1000);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    if (mins >= 60) {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return `${h}h ${m}m`;
    }
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
  };

  useEffect(() => {
    if (!searchOpen) return;
    const t = setTimeout(() => {
      try {
        searchRef.current?.focus();
      } catch {
        // ignore
      }
    }, 0);
    return () => clearTimeout(t);
  }, [searchOpen]);

  const refreshMe = async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      const data = await res.json().catch(() => ({} as any));
      setAuthUsername(data?.username ? String(data.username) : '');
    } catch {
      setAuthUsername('');
    }
  };

  const doLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {
      // ignore
    }
    setUserMenuOpen(false);
    setAuthUsername('');
    setAuthGate('open');
  };

  const doChangePassword = async () => {
    setCpError('');
    if (cpNew.length < 8) {
      setCpError('New password must be at least 8 characters.');
      return;
    }
    if (cpNew !== cpNew2) {
      setCpError('Passwords do not match.');
      return;
    }
    setCpBusy(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: cpCurrent, newPassword: cpNew })
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        setCpError(data?.message || 'Password change failed.');
        return;
      }
      setShowChangePassword(false);
      setUserMenuOpen(false);
      setCpCurrent('');
      setCpNew('');
      setCpNew2('');
      await refreshMe();
    } finally {
      setCpBusy(false);
    }
  };

  const initials = (authUsername || 'Admin')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('') || 'AD';

  if (authGate === 'loading') {
    return (
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center text-zinc-400 text-sm">
        Loading…
      </div>
    );
  }

  if (authGate === 'open') {
    return <Setup onDone={async () => { setAuthGate('closed'); await refreshMe(); }} />;
  }

  const renderContent = () => {
    switch (activePage) {
      case 'dashboard': return <Dashboard />;
      case 'logs': return <QueryLogs preset={logsPreset} onPresetConsumed={() => setLogsPreset(null)} />;
      case 'clients': return <Clients />;
      case 'topology': return <NetworkMap />;
      case 'blocking': return <Blocking />;
      case 'dns': return <DnsSettings />;
      case 'settings': return <Settings presetTab={settingsTabPreset} onPresetConsumed={() => setSettingsTabPreset(null)} />;
      case 'cluster': return <Cluster />;
      default: return null;
    }
  };

  const getPageTitle = () => {
      switch(activePage) {
          case 'dashboard': return 'Network Overview';
          case 'logs': return 'Query Inspector';
          case 'clients': return 'Client Policies';
        case 'topology': return 'Clients';
          case 'blocking': return 'Filter Rules';
          case 'dns': return 'DNS Configuration';
          case 'settings': return 'System Settings';
        case 'cluster': return 'Cluster / HA';
          default: return 'Dashboard';
      }
  };

  const searchTargets: Array<{
    id: string;
    label: string;
    hint?: string;
    keywords?: string[];
    page: string;
    settingsTabPreset?: any;
  }> = [
    { id: 'dashboard', label: 'Dashboard', hint: 'Network Overview', keywords: ['overview', 'stats', 'world map'], page: 'dashboard' },
    { id: 'logs', label: 'Query Logs', hint: 'Query Inspector', keywords: ['dns logs', 'queries', 'nxdomain', 'blocked', 'permitted'], page: 'logs' },
    { id: 'clients', label: 'Client Policies', hint: 'Per-client filtering & schedules', keywords: ['clients', 'devices', 'policies', 'schedules'], page: 'clients' },
    { id: 'topology', label: 'Clients', hint: 'DNS Activity', keywords: ['clients', 'activity', 'topology', 'map'], page: 'topology' },
    { id: 'blocking', label: 'Blocking Rules', hint: 'Filter Rules', keywords: ['rules', 'allowlist', 'blocklist', 'filters'], page: 'blocking' },
    { id: 'dns', label: 'DNS Settings', hint: 'DNS Configuration', keywords: ['rewrites', 'upstream', 'resolver', 'unbound'], page: 'dns' },

    { id: 'cluster', label: 'Cluster / HA', hint: 'Sync + VIP Failover', keywords: ['cluster', 'ha', 'vip', 'vrrp', 'keepalived', 'sync', 'leader', 'follower'], page: 'cluster' },

    { id: 'settings', label: 'Settings', hint: 'System Settings', keywords: ['configuration', 'options', 'admin'], page: 'settings' },
    { id: 'settings.general', label: 'Settings: AI Keys', page: 'settings', settingsTabPreset: 'general', keywords: ['ai', 'gemini', 'openai', 'api key'] },
    { id: 'settings.geoip', label: 'Settings: GeoIP / World Map', page: 'settings', settingsTabPreset: 'geoip', keywords: ['geoip', 'maxmind', 'geolite', 'city', 'country', 'world map'] },
    { id: 'settings.remote', label: 'Settings: Tailscale / VPN', page: 'settings', settingsTabPreset: 'remote', keywords: ['tailscale', 'vpn', 'remote access', 'tailnet', 'exit node', 'routes', 'subnet router'] },
    { id: 'settings.notifications', label: 'Settings: Notifications', page: 'settings', settingsTabPreset: 'notifications', keywords: ['discord', 'webhook', 'alerts', 'events', 'bell'] },
    { id: 'settings.system', label: 'Settings: System Status', page: 'settings', settingsTabPreset: 'system', keywords: ['system', 'status', 'cpu', 'memory', 'disk', 'container', 'health'] },
    { id: 'settings.maintenance', label: 'Settings: Maintenance', page: 'settings', settingsTabPreset: 'maintenance', keywords: ['maintenance', 'clear logs', 'flush logs', 'query logs'] }
  ];

  const filteredTargets = (() => {
    const q = searchQuery.trim().toLowerCase();
    const items = q
      ? searchTargets.filter((t) => {
          const kw = Array.isArray(t.keywords) ? t.keywords.join(' ') : '';
          const hay = `${t.label} ${t.hint || ''} ${kw}`.toLowerCase();
          return hay.includes(q);
        })
      : searchTargets;
    return items.slice(0, 12);
  })();

  const navigateTo = (detail: any) => {
    window.dispatchEvent(new CustomEvent('sentinel:navigate', { detail }));
  };

  const runSearchSelection = (idx: number) => {
    const i = Math.min(Math.max(0, idx), Math.max(0, filteredTargets.length - 1));
    const target = filteredTargets[i];
    if (!target) return;
    setSearchOpen(false);
    setSearchQuery('');
    setSearchIndex(0);
    navigateTo({ page: target.page, settingsTabPreset: target.settingsTabPreset });
  };

  return (
    <ClientsProvider>
      <RulesProvider>
        <div className="flex min-h-screen">
          <Sidebar 
            activePage={activePage} 
            setActivePage={setActivePage} 
            isCollapsed={isSidebarCollapsed}
            toggleSidebar={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          />
          
          <main className={`flex-1 bg-[#09090b] flex flex-col min-h-screen transition-all duration-300 ${isSidebarCollapsed ? 'ml-20' : 'ml-64'}`}>
            {/* Top Header */}
            <header className="sticky top-0 z-30 bg-[#09090b]/90 backdrop-blur-md border-b border-[#27272a] px-8 py-4 flex justify-between items-center h-16">
              <div className="flex items-center gap-4">
                 {/* Dynamic Page Title in Header */}
                 <div className="hidden md:block border-r border-[#27272a] pr-4 mr-2">
                    <h2 className="text-sm font-bold text-white tracking-tight">{getPageTitle()}</h2>
                 </div>

                 <div className={`flex items-center gap-2 px-2 py-1 rounded border transition-colors ${protectionPause.active ? 'border-amber-900/30 bg-amber-950/20' : 'border-emerald-900/30 bg-emerald-950/20'}`}>
                  {protectionPause.active ? <AlertTriangle className="w-3.5 h-3.5 text-amber-500" /> : <Shield className="w-3.5 h-3.5 text-emerald-500" />}
                  <span className={`text-[10px] font-mono font-medium uppercase tracking-wider ${protectionPause.active ? 'text-amber-500' : 'text-emerald-500'}`}>
                    {protectionPause.active ? 'Protection Paused' : 'Active'}
                    </span>
                 </div>

                   {localConfiguredRole === 'follower' ? (
                     <div className="flex items-center gap-2 px-2 py-1 rounded border border-amber-900/30 bg-amber-950/10">
                       <Lock className="w-3.5 h-3.5 text-amber-500" />
                       <span className="text-[10px] font-mono font-medium uppercase tracking-wider text-amber-500">Failover node · read-only</span>
                     </div>
                   ) : null}
              </div>

              <div className="flex items-center gap-4">
                
                {/* Pause Protection Dropdown */}
                <div className="relative" ref={pauseMenuRef}>
                  <button 
                    onClick={() => setPauseMenuOpen((v) => !v)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-bold border transition-all ${
                      protectionPause.active 
                      ? 'bg-amber-500/10 border-amber-500 text-amber-500 hover:bg-amber-500/20' 
                      : 'bg-[#18181b] border-[#27272a] text-zinc-400 hover:text-white hover:border-zinc-500'
                    }`}
                    aria-label="Pause protection"
                  >
                    {protectionPause.active ? <Play className="w-3.5 h-3.5 fill-current" /> : <Pause className="w-3.5 h-3.5 fill-current" />}
                    {protectionPause.active
                      ? `PAUSED${protectionPause.mode === 'UNTIL' ? ` · ${formatRemaining(protectionPause.remainingMs)}` : ''}`
                      : 'PAUSE'}
                  </button>

                  {pauseMenuOpen ? (
                    <div className="absolute right-0 mt-2 w-64 bg-[#121214] border border-[#27272a] rounded-lg shadow-xl overflow-hidden z-50">
                      <div className="px-3 py-2 border-b border-[#27272a]">
                        <div className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">Protection</div>
                        <div className="text-xs text-zinc-200 font-mono">Pause filtering</div>
                        {protectionPause.active && protectionPause.mode === 'UNTIL' ? (
                          <div className="text-[10px] text-amber-400 font-mono mt-1">Remaining: {formatRemaining(protectionPause.remainingMs)}</div>
                        ) : null}
                        {protectionPause.active && protectionPause.mode === 'FOREVER' ? (
                          <div className="text-[10px] text-amber-400 font-mono mt-1">Paused until resumed</div>
                        ) : null}
                      </div>

                      <div className="p-2 space-y-1">
                        <button
                          disabled={pauseBusy}
                          onClick={() => setProtectionPauseMode('UNTIL', 15)}
                          className="w-full text-left px-3 py-2 text-xs text-zinc-200 hover:bg-[#18181b] rounded disabled:opacity-50"
                        >
                          Pause 15 minutes
                        </button>
                        <button
                          disabled={pauseBusy}
                          onClick={() => setProtectionPauseMode('UNTIL', 30)}
                          className="w-full text-left px-3 py-2 text-xs text-zinc-200 hover:bg-[#18181b] rounded disabled:opacity-50"
                        >
                          Pause 30 minutes
                        </button>
                        <button
                          disabled={pauseBusy}
                          onClick={() => setProtectionPauseMode('UNTIL', 60)}
                          className="w-full text-left px-3 py-2 text-xs text-zinc-200 hover:bg-[#18181b] rounded disabled:opacity-50"
                        >
                          Pause 60 minutes
                        </button>
                        <button
                          disabled={pauseBusy}
                          onClick={() => setProtectionPauseMode('FOREVER')}
                          className="w-full text-left px-3 py-2 text-xs text-zinc-200 hover:bg-[#18181b] rounded disabled:opacity-50"
                        >
                          Pause forever
                        </button>

                        <div className="h-px bg-[#27272a] my-1" />

                        <button
                          disabled={pauseBusy || !protectionPause.active}
                          onClick={() => setProtectionPauseMode('OFF')}
                          className="w-full text-left px-3 py-2 text-xs text-amber-300 hover:bg-[#18181b] rounded disabled:opacity-50"
                        >
                          Resume protection
                        </button>

                        {pauseError ? (
                          <div className="px-3 py-1 text-[10px] font-mono text-rose-300">{pauseError}</div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="h-6 w-px bg-[#27272a] mx-2 hidden md:block"></div>

                <div className="relative hidden md:block group">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 group-hover:text-zinc-300 transition-colors" />
                  <input 
                    type="text" 
                    placeholder="CTRL+K to search..." 
                    readOnly
                    onClick={() => setSearchOpen(true)}
                    onFocus={() => setSearchOpen(true)}
                    className="bg-[#18181b] border border-[#27272a] rounded text-zinc-300 pl-9 pr-4 py-1.5 text-xs font-mono focus:outline-none focus:border-zinc-500 transition-colors w-64 placeholder:text-zinc-600"
                  />
                </div>
                
                <div className="relative" ref={bellRef}>
                  <button
                    onClick={() => (bellOpen ? setBellOpen(false) : void openBell())}
                    className="relative p-2 text-zinc-400 hover:text-white transition-colors border border-transparent hover:border-[#27272a] hover:bg-[#18181b] rounded"
                    aria-label="Notifications"
                  >
                    <Bell className="w-4 h-4" />
                    {bellUnreadCount > 0 ? (
                      <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-red-500 rounded-full border border-[#09090b]"></span>
                    ) : null}
                  </button>

                  {bellOpen ? (
                    <div className="absolute right-0 mt-2 w-96 bg-[#121214] border border-[#27272a] rounded-lg shadow-xl overflow-hidden z-50">
                      <div className="px-3 py-2 border-b border-[#27272a] flex items-center justify-between">
                        <div>
                          <div className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">Notifications</div>
                          <div className="text-xs text-zinc-200 font-mono">Recent events</div>
                        </div>
                        <div className="text-[10px] font-mono text-zinc-500">{bellBusy ? 'Loading…' : bellUnreadCount > 0 ? `${bellUnreadCount} unread` : 'All read'}</div>
                      </div>

                      <div className="max-h-[320px] overflow-auto">
                        {bellItems.length === 0 && !bellBusy ? (
                          <div className="px-3 py-3 text-xs text-zinc-500">No notifications yet.</div>
                        ) : null}

                        {bellItems.map((it) => {
                          const entry = (it as any)?.entry ?? {};
                          const title = typeof entry?.title === 'string' ? entry.title : 'Notification';
                          const message = typeof entry?.message === 'string' ? entry.message : '';
                          const ts = (it as any)?.ts ? new Date((it as any).ts).toLocaleString() : '';
                          return (
                            <div key={String((it as any)?.id)} className="px-3 py-3 border-b border-[#27272a] last:border-b-0">
                              <div className="flex items-center justify-between gap-3">
                                <div className="text-xs text-zinc-100 font-semibold truncate">{title}</div>
                                <div className="text-[10px] text-zinc-500 font-mono shrink-0">{ts}</div>
                              </div>
                              {message ? <div className="mt-1 text-xs text-zinc-400">{message}</div> : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="relative" ref={userMenuRef}>
                  <button
                    onClick={() => setUserMenuOpen((v) => !v)}
                    className="w-8 h-8 rounded bg-zinc-800 border border-zinc-700 flex items-center justify-center text-xs font-bold text-white shadow-lg hover:border-zinc-500"
                    aria-label="User menu"
                  >
                    {initials}
                  </button>

                  {userMenuOpen ? (
                    <div className="absolute right-0 mt-2 w-56 bg-[#121214] border border-[#27272a] rounded-lg shadow-xl overflow-hidden z-50">
                      <div className="px-3 py-2 border-b border-[#27272a]">
                        <div className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">Signed in</div>
                        <div className="text-xs text-zinc-200 font-mono truncate">{authUsername || 'admin'}</div>
                      </div>
                      <button
                        onClick={() => { setShowChangePassword(true); setUserMenuOpen(false); setCpError(''); }}
                        className="w-full text-left px-3 py-2 text-xs text-zinc-300 hover:bg-[#18181b]"
                      >
                        Change password
                      </button>
                      <button
                        onClick={doLogout}
                        className="w-full text-left px-3 py-2 text-xs text-rose-300 hover:bg-[#18181b]"
                      >
                        Logout
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </header>

            {searchOpen ? (
              <div className="fixed inset-0 z-50 flex items-start justify-center p-6">
                <div
                  className="absolute inset-0 bg-black/60"
                  onClick={() => setSearchOpen(false)}
                />
                <div className="relative w-full max-w-2xl bg-[#121214] border border-[#27272a] rounded-xl shadow-2xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-[#27272a] flex items-center gap-3">
                    <Search className="w-4 h-4 text-zinc-500" />
                    <input
                      ref={searchRef}
                      value={searchQuery}
                      onChange={(e) => { setSearchQuery(e.target.value); setSearchIndex(0); }}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          setSearchOpen(false);
                          return;
                        }
                        if (e.key === 'ArrowDown') {
                          e.preventDefault();
                          setSearchIndex((v) => Math.min(v + 1, Math.max(0, filteredTargets.length - 1)));
                          return;
                        }
                        if (e.key === 'ArrowUp') {
                          e.preventDefault();
                          setSearchIndex((v) => Math.max(0, v - 1));
                          return;
                        }
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          runSearchSelection(searchIndex);
                          return;
                        }
                      }}
                      placeholder="Search pages and settings…"
                      className="flex-1 bg-transparent text-zinc-200 text-sm font-mono focus:outline-none placeholder:text-zinc-600"
                    />
                    <div className="text-[10px] font-mono text-zinc-500">ESC to close</div>
                  </div>

                  <div className="max-h-[420px] overflow-auto">
                    {filteredTargets.length === 0 ? (
                      <div className="px-4 py-6 text-sm text-zinc-500">No matches.</div>
                    ) : (
                      filteredTargets.map((t, idx) => (
                        <button
                          key={t.id}
                          onClick={() => runSearchSelection(idx)}
                          className={`w-full text-left px-4 py-3 border-b border-[#27272a] last:border-b-0 transition-colors ${
                            idx === searchIndex ? 'bg-[#18181b]' : 'bg-transparent hover:bg-[#18181b]'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-4">
                            <div className="text-sm text-zinc-100 font-semibold">{t.label}</div>
                            <div className="text-[10px] text-zinc-500 font-mono">{t.hint || t.page}</div>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            {showChangePassword ? (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
                <div
                  className="absolute inset-0 bg-black/60"
                  onClick={() => { if (!cpBusy) setShowChangePassword(false); }}
                />
                <div className="relative w-full max-w-md bg-[#121214] border border-[#27272a] rounded-xl p-6">
                  <div className="text-sm font-bold text-white">Change password</div>
                  <div className="text-xs text-zinc-500 mt-1">This will log out other browsers.</div>

                  <div className="mt-4 space-y-3">
                    <input
                      type="password"
                      value={cpCurrent}
                      onChange={(e) => setCpCurrent(e.target.value)}
                      placeholder="Current password"
                      className="w-full bg-[#09090b] border border-[#27272a] text-zinc-200 px-3 py-2 rounded text-xs font-mono focus:outline-none focus:border-zinc-500"
                    />
                    <input
                      type="password"
                      value={cpNew}
                      onChange={(e) => setCpNew(e.target.value)}
                      placeholder="New password (min 8 chars)"
                      className="w-full bg-[#09090b] border border-[#27272a] text-zinc-200 px-3 py-2 rounded text-xs font-mono focus:outline-none focus:border-zinc-500"
                    />
                    <input
                      type="password"
                      value={cpNew2}
                      onChange={(e) => setCpNew2(e.target.value)}
                      placeholder="Confirm new password"
                      className="w-full bg-[#09090b] border border-[#27272a] text-zinc-200 px-3 py-2 rounded text-xs font-mono focus:outline-none focus:border-zinc-500"
                    />
                  </div>

                  {cpError ? <div className="mt-3 text-xs text-rose-400">{cpError}</div> : null}

                  <div className="mt-5 flex justify-end gap-2">
                    <button
                      disabled={cpBusy}
                      onClick={() => setShowChangePassword(false)}
                      className="px-3 py-2 rounded text-xs font-bold bg-transparent border border-[#27272a] text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      disabled={cpBusy || !cpCurrent || !cpNew || cpNew !== cpNew2}
                      onClick={doChangePassword}
                      className={`px-3 py-2 rounded text-xs font-bold border transition-colors ${
                        !cpBusy && cpCurrent && cpNew && cpNew === cpNew2
                          ? 'bg-white text-black border-white hover:bg-zinc-200'
                          : 'bg-[#18181b] text-zinc-500 border-[#27272a] cursor-not-allowed'
                      }`}
                    >
                      {cpBusy ? 'Working…' : 'Update'}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {/* Global Pause Warning Banner */}
            {protectionPause.active && (
                <div className="bg-amber-500/10 border-b border-amber-500/20 px-8 py-2 flex items-center justify-center gap-2 animate-fade-in">
                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                    <span className="text-xs font-bold text-amber-500 uppercase tracking-wide">Protection Paused - Traffic is currently unmonitored</span>
                </div>
            )}

            <div className="p-8 max-w-[1600px] mx-auto w-full flex-1">
              <Suspense
                fallback={
                  <div className="min-h-[240px] w-full rounded-lg border border-[#27272a] bg-[#121214] flex items-center justify-center text-zinc-500 text-sm">
                    Loading page…
                  </div>
                }
              >
                {renderContent()}
              </Suspense>
            </div>
          </main>
        </div>
      </RulesProvider>
    </ClientsProvider>
  );
};

export default App;