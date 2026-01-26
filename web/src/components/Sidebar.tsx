import React, { useEffect, useMemo, useState } from 'react';
import { LayoutDashboard, Activity, ShieldAlert, Users, Network, Hexagon, Settings, Globe, Server, ChevronLeft, ChevronRight, PanelLeftClose, PanelLeftOpen } from 'lucide-react';

interface SidebarProps {
  activePage: string;
  setActivePage: (page: string) => void;
  isCollapsed: boolean;
  toggleSidebar: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ activePage, setActivePage, isCollapsed, toggleSidebar }) => {
  // Helper for icons needed inside the component
  const Share2 = Network; // Mapping the icon used for topology

  type SystemStatus = {
    ok: boolean;
    version?: string;
    windowHours?: number;
    totalQueries?: number;
    blockedQueries?: number;
    activeClients?: number;
    updatedAt?: string;
    error?: string;
  };

  const [systemStatus, setSystemStatus] = useState<SystemStatus>({ ok: false });
  const [systemLoading, setSystemLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [healthRes, versionRes, summaryRes] = await Promise.all([
          fetch('/api/health', { headers: { Accept: 'application/json' } }),
          fetch('/api/version', { headers: { Accept: 'application/json' } }),
          fetch('/api/metrics/summary?hours=24', { headers: { Accept: 'application/json' } })
        ]);

        const health = healthRes.ok ? await healthRes.json() : null;
        const version = versionRes.ok ? await versionRes.json() : null;
        const summary = summaryRes.ok ? await summaryRes.json() : null;

        if (cancelled) return;

        const ok = Boolean(health?.ok);
        setSystemStatus({
          ok,
          version: typeof version?.version === 'string' ? version.version : undefined,
          windowHours: typeof summary?.windowHours === 'number' ? summary.windowHours : undefined,
          totalQueries: typeof summary?.totalQueries === 'number' ? summary.totalQueries : undefined,
          blockedQueries: typeof summary?.blockedQueries === 'number' ? summary.blockedQueries : undefined,
          activeClients: typeof summary?.activeClients === 'number' ? summary.activeClients : undefined,
          updatedAt: new Date().toISOString(),
          error: !ok ? 'API not healthy' : undefined
        });
        setSystemLoading(false);
      } catch (err: any) {
        if (cancelled) return;
        setSystemStatus({
          ok: false,
          error: err?.message ? String(err.message) : 'Failed to load system status'
        });
        setSystemLoading(false);
      }
    };

    void load();
    const t = window.setInterval(load, 10000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);

  const blockedPct = useMemo(() => {
    const total = systemStatus.totalQueries ?? 0;
    const blocked = systemStatus.blockedQueries ?? 0;
    if (total <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((blocked / total) * 100)));
  }, [systemStatus.totalQueries, systemStatus.blockedQueries]);

  // Group 1: Monitoring (Read/Observe)
  const monitorItems = [
    { id: 'dashboard', label: 'Overview', icon: LayoutDashboard },
    { id: 'logs', label: 'Query Log', icon: Activity },
    { id: 'topology', label: 'Network Map', icon: Share2 }, 
  ];

  // Group 2: Controls (Write/Configure)
  const controlItems = [
    { id: 'blocking', label: 'Filtering', icon: ShieldAlert },
    { id: 'clients', label: 'Client Policies', icon: Users },
    { id: 'dns', label: 'Local DNS', icon: Server },
  ];
  
  const renderMenuItem = (item: any) => {
    const Icon = item.icon;
    const isActive = activePage === item.id;
    return (
      <button
        key={item.id}
        onClick={() => setActivePage(item.id)}
        title={isCollapsed ? item.label : undefined}
        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md transition-all duration-200 text-sm group ${
          isActive
            ? 'bg-[#27272a] text-white border border-[#3f3f46]'
            : 'text-zinc-500 hover:text-zinc-300 hover:bg-[#18181b]'
        } ${isCollapsed ? 'justify-center' : ''}`}
      >
        <Icon className={`w-4 h-4 transition-colors ${isActive ? 'text-white' : 'text-zinc-500 group-hover:text-zinc-400'}`} />
        {!isCollapsed && <span className="font-medium animate-fade-in">{item.label}</span>}
        {!isCollapsed && isActive && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-500 box-shadow-glow"></div>}
      </button>
    );
  };

  return (
    <aside className={`bg-[#09090b] border-r border-[#27272a] flex flex-col h-screen fixed left-0 top-0 z-20 transition-all duration-300 ${isCollapsed ? 'w-20' : 'w-64'}`}>
      {/* Brand Header */}
      <div className={`p-6 flex items-center ${isCollapsed ? 'justify-center' : 'gap-3'} mb-2 relative`}>
        <div className="w-8 h-8 bg-white rounded flex items-center justify-center shadow-[0_0_15px_rgba(255,255,255,0.2)] flex-shrink-0">
          <Hexagon className="text-black w-5 h-5 fill-black" />
        </div>
        {!isCollapsed && (
          <div className="overflow-hidden whitespace-nowrap animate-fade-in">
            <h1 className="text-lg font-bold text-white tracking-tight leading-none">
              SENTINEL
            </h1>
            <span className="text-[10px] font-mono text-zinc-500 tracking-wider">NETWORK GUARDIAN</span>
          </div>
        )}
      </div>

      <nav className="flex-1 px-3 space-y-6 overflow-y-auto overflow-x-hidden">
        
        {/* Section: MONITORING */}
        <div className="space-y-1">
          {!isCollapsed && (
              <div className="px-3 mb-2 text-[10px] font-bold text-zinc-600 uppercase tracking-widest font-mono animate-fade-in">
                Monitoring
              </div>
          )}
          {monitorItems.map(renderMenuItem)}
        </div>

        {/* Section: CONTROLS */}
        <div className="space-y-1">
           {!isCollapsed && (
              <div className="px-3 mb-2 text-[10px] font-bold text-zinc-600 uppercase tracking-widest font-mono animate-fade-in">
                Controls
              </div>
           )}
          {controlItems.map(renderMenuItem)}
        </div>

      </nav>

      {/* Footer Section: System & Settings */}
      <div className="p-4 border-t border-[#27272a] space-y-2 bg-[#09090b]">
        {/* Sidebar Toggle - Integrated Professional Look */}
        <button
           onClick={toggleSidebar}
           title={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
           className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md transition-all duration-200 text-sm group text-zinc-500 hover:text-zinc-300 hover:bg-[#18181b] ${isCollapsed ? 'justify-center' : ''}`}
        >
           {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
           {!isCollapsed && <span className="font-medium animate-fade-in">Collapse Sidebar</span>}
        </button>

        <div className="h-px bg-[#27272a] my-2"></div>

          <button
            onClick={() => setActivePage('cluster')}
            title={isCollapsed ? "Cluster / HA" : undefined}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md transition-all duration-200 text-sm group ${
            activePage === 'cluster'
              ? 'bg-[#27272a] text-white border border-[#3f3f46]'
              : 'text-zinc-500 hover:text-zinc-300 hover:bg-[#18181b]'
            } ${isCollapsed ? 'justify-center' : ''}`}
          >
            <Globe className={`w-4 h-4 transition-colors ${activePage === 'cluster' ? 'text-white' : 'text-zinc-500 group-hover:text-zinc-400'}`} />
            {!isCollapsed && <span className="font-medium animate-fade-in">Cluster / HA</span>}
          </button>

        <button
           onClick={() => setActivePage('settings')}
           title={isCollapsed ? "System Settings" : undefined}
           className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md transition-all duration-200 text-sm group ${
            activePage === 'settings'
              ? 'bg-[#27272a] text-white border border-[#3f3f46]'
              : 'text-zinc-500 hover:text-zinc-300 hover:bg-[#18181b]'
           } ${isCollapsed ? 'justify-center' : ''}`}
        >
           <Settings className={`w-4 h-4 transition-colors ${activePage === 'settings' ? 'text-white' : 'text-zinc-500 group-hover:text-zinc-400'}`} />
           {!isCollapsed && <span className="font-medium animate-fade-in">System Settings</span>}
        </button>

        {!isCollapsed ? (
          <div className="p-3 border border-[#27272a] bg-[#121214] rounded-md select-none cursor-default group hover:border-zinc-600 transition-colors animate-fade-in">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-mono text-zinc-500 uppercase group-hover:text-zinc-400 transition-colors">
                System Status
              </span>
              <div className="flex items-center gap-2">
                {systemStatus.version ? (
                  <span className="text-[10px] font-mono text-zinc-600">v{systemStatus.version}</span>
                ) : null}
                <div
                  className={`w-2 h-2 rounded-full ${
                    systemLoading ? 'bg-zinc-600' : systemStatus.ok ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'
                  }`}
                  title={systemLoading ? 'Loading…' : systemStatus.ok ? 'API healthy' : systemStatus.error || 'Offline'}
                ></div>
              </div>
            </div>

            {systemLoading ? (
              <div className="text-[11px] text-zinc-500 font-mono">Loading…</div>
            ) : systemStatus.ok ? (
              <div className="space-y-2">
                <div>
                  <div className="flex justify-between text-[11px] text-zinc-400 mb-1 font-mono">
                    <span>Queries (24h)</span>
                    <span className="text-zinc-300">{(systemStatus.totalQueries ?? 0).toLocaleString()}</span>
                  </div>
                  <div className="w-full h-1 bg-[#27272a] rounded-full overflow-hidden">
                    <div className="w-full h-full bg-indigo-500/30 rounded-full"></div>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-[11px] text-zinc-400 mb-1 font-mono">
                    <span>Blocked</span>
                    <span className="text-zinc-300">
                      {(systemStatus.blockedQueries ?? 0).toLocaleString()} ({blockedPct}%)
                    </span>
                  </div>
                  <div className="w-full h-1 bg-[#27272a] rounded-full overflow-hidden">
                    <div className="h-full bg-rose-500 rounded-full" style={{ width: `${blockedPct}%` }}></div>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-[11px] text-zinc-400 mb-1 font-mono">
                    <span>Active Clients (24h)</span>
                    <span className="text-zinc-300">{(systemStatus.activeClients ?? 0).toLocaleString()}</span>
                  </div>
                  <div className="w-full h-1 bg-[#27272a] rounded-full overflow-hidden">
                    <div className="w-full h-full bg-emerald-500/30 rounded-full"></div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-[11px] text-rose-400 font-mono">
                {systemStatus.error || 'System status unavailable'}
              </div>
            )}
          </div>
        ) : (
          <div className="flex justify-center py-2 animate-fade-in">
            <div
              className={`w-2 h-2 rounded-full ${
                systemLoading ? 'bg-zinc-600' : systemStatus.ok ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'
              }`}
              title={systemLoading ? 'Loading…' : systemStatus.ok ? 'API healthy' : systemStatus.error || 'Offline'}
            ></div>
          </div>
        )}
      </div>
    </aside>
  );
};

export default Sidebar;