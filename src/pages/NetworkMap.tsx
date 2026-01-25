import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Share2, Search, ShieldCheck, BarChart3, Table2, Network, Clock, ArrowRight, ChevronDown } from 'lucide-react';
import { useClients } from '../contexts/ClientsContext';

type ClientActivity = {
   client: string;
   totalQueries: number;
   blockedQueries: number;
   uniqueDomains: number;
   lastSeen: string | null;
};

type ClientDetail = {
   windowHours: number;
   client: string;
   topAllowed: Array<{ domain: string; count: number }>;
   topBlocked: Array<{ domain: string; count: number }>;
};

function clamp(n: number, min: number, max: number): number {
   return Math.max(min, Math.min(max, n));
}

function isLikelyIp(text: string): boolean {
   return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(text);
}

function formatAgo(iso: string | null): string {
   if (!iso) return '—';
   const t = new Date(iso).getTime();
   if (!Number.isFinite(t)) return '—';
   const diff = Date.now() - t;
   const sec = Math.max(0, Math.floor(diff / 1000));
   if (sec < 60) return `${sec}s ago`;
   const min = Math.floor(sec / 60);
   if (min < 60) return `${min}m ago`;
   const hr = Math.floor(min / 60);
   if (hr < 48) return `${hr}h ago`;
   const d = Math.floor(hr / 24);
   return `${d}d ago`;
}

function useElementSize<T extends HTMLElement>() {
   const ref = useRef<T | null>(null);
   const [size, setSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

   useEffect(() => {
      const el = ref.current;
      if (!el) return;
      const ro = new ResizeObserver((entries) => {
         const entry = entries[0];
         const cr = entry?.contentRect;
         if (!cr) return;
         setSize({ width: cr.width, height: cr.height });
      });
      ro.observe(el);
      return () => ro.disconnect();
   }, []);

   return { ref, size };
}

type MenuOption<T extends string | number> = { value: T; label: string };

function useClickAway(open: boolean, onClose: () => void) {
   useEffect(() => {
      if (!open) return;
      const onPointerDown = (e: PointerEvent) => {
         const target = e.target as HTMLElement | null;
         if (!target) return;
         const root = target.closest?.('[data-menu-root="true"]');
         if (root) return;
         onClose();
      };
      const onKeyDown = (e: KeyboardEvent) => {
         if (e.key === 'Escape') onClose();
      };
      document.addEventListener('pointerdown', onPointerDown, { capture: true });
      document.addEventListener('keydown', onKeyDown);
      return () => {
         document.removeEventListener('pointerdown', onPointerDown, { capture: true } as any);
         document.removeEventListener('keydown', onKeyDown);
      };
   }, [open, onClose]);
}

function MenuSelect<T extends string | number>(props: {
   value: T;
   onChange: (v: T) => void;
   options: Array<MenuOption<T>>;
   buttonClassName?: string;
}) {
   const { value, onChange, options, buttonClassName } = props;
   const [open, setOpen] = useState(false);

   useClickAway(open, () => setOpen(false));

   const selected = options.find((o) => o.value === value) ?? options[0];

   return (
      <div className="relative" data-menu-root="true">
         <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className={
               buttonClassName ??
               'flex items-center gap-2 bg-transparent text-xs text-zinc-300 outline-none pr-1 cursor-pointer'
            }
            aria-haspopup="listbox"
            aria-expanded={open}
         >
            <span className="whitespace-nowrap">{selected?.label ?? String(value)}</span>
            <ChevronDown className={`w-4 h-4 text-zinc-600 transition-transform ${open ? 'rotate-180' : ''}`} />
         </button>

         {open ? (
            <div
               role="listbox"
               className="absolute left-0 mt-2 min-w-[140px] rounded-lg border border-[#27272a] bg-[#09090b] shadow-xl z-50 overflow-hidden"
            >
               {options.map((o) => {
                  const isActive = o.value === value;
                  return (
                     <button
                        key={String(o.value)}
                        type="button"
                        role="option"
                        aria-selected={isActive}
                        onClick={() => {
                           onChange(o.value);
                           setOpen(false);
                        }}
                        className={
                           `w-full text-left px-3 py-2 text-xs transition-colors ` +
                           (isActive
                              ? 'bg-[#18181b] text-white'
                              : 'text-zinc-300 hover:bg-[#18181b]/70 hover:text-white')
                        }
                     >
                        {o.label}
                     </button>
                  );
               })}
            </div>
         ) : null}
      </div>
   );
}

const NetworkMap: React.FC = () => {
   const [windowHours, setWindowHours] = useState<number>(24);
   const [viewMode, setViewMode] = useState<'graph' | 'table'>('graph');
   const [sortBy, setSortBy] = useState<'queries' | 'blockedPct' | 'lastSeen'>('queries');
   const [search, setSearch] = useState('');
   const [loading, setLoading] = useState(true);
   const [error, setError] = useState('');
   const [items, setItems] = useState<ClientActivity[]>([]);
   const [selectedClient, setSelectedClient] = useState<string | null>(null);
   const [detail, setDetail] = useState<ClientDetail | null>(null);
   const [detailBusy, setDetailBusy] = useState(false);

   const { clients } = useClients();
   const [discoveredHostnamesByIp, setDiscoveredHostnamesByIp] = useState<Record<string, string>>({});

   const { ref: graphRef, size: graphSize } = useElementSize<HTMLDivElement>();

   useEffect(() => {
      let cancelled = false;

      const load = async () => {
         try {
            setError('');
            const res = await fetch(`/api/metrics/clients?hours=${encodeURIComponent(String(windowHours))}&limit=250`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (cancelled) return;
            const list = Array.isArray(data?.items) ? data.items : [];
            setItems(
               list
                  .map((r: any) => ({
                     client: String(r?.client ?? 'Unknown'),
                     totalQueries: Number(r?.totalQueries ?? 0),
                     blockedQueries: Number(r?.blockedQueries ?? 0),
                     uniqueDomains: Number(r?.uniqueDomains ?? 0),
                     lastSeen: typeof r?.lastSeen === 'string' ? r.lastSeen : null
                  }))
                  .filter((r: ClientActivity) => r.client.length > 0)
            );
            setLoading(false);
         } catch (e: any) {
            if (cancelled) return;
            setError(e?.message ? String(e.message) : 'Failed to load metrics');
            setLoading(false);
         }
      };

      setLoading(true);
      void load();
      const t = window.setInterval(load, 10_000);
      return () => {
         cancelled = true;
         window.clearInterval(t);
      };
   }, [windowHours]);

   const policyNameByIp = useMemo(() => {
      const map: Record<string, string> = {};
      for (const c of clients) {
         const ip = typeof c.ip === 'string' ? c.ip : '';
         const name = typeof c.name === 'string' ? c.name.trim() : '';
         if (ip && name) map[ip] = name;
      }
      return map;
   }, [clients]);

   const displayFor = useCallback(
      (clientId: string): { primary: string; secondary: string } => {
         const raw = String(clientId ?? '');
         if (!raw) return { primary: 'Unknown', secondary: '' };
         if (!isLikelyIp(raw)) return { primary: raw, secondary: '' };

         const policyName = policyNameByIp[raw];
         if (policyName && policyName !== raw) return { primary: policyName, secondary: raw };

         const discovered = discoveredHostnamesByIp[raw];
         if (discovered && discovered !== raw) return { primary: discovered, secondary: raw };

         return { primary: raw, secondary: '' };
      },
      [discoveredHostnamesByIp, policyNameByIp]
   );

   useEffect(() => {
      let cancelled = false;

      const load = async () => {
         try {
            const res = await fetch('/api/discovery/clients', { credentials: 'include' });
            if (cancelled) return;

            if (res.status === 401 || res.status === 403) {
               setDiscoveredHostnamesByIp({});
               return;
            }

            if (!res.ok) return;
            const data = await res.json();
            if (cancelled) return;

            const list = Array.isArray(data?.items) ? data.items : [];
            const map: Record<string, string> = {};
            for (const row of list) {
               const ip = typeof row?.ip === 'string' ? row.ip : String(row?.ip ?? '');
               const hostname = typeof row?.hostname === 'string' ? row.hostname.trim() : '';
               if (ip && hostname) map[ip] = hostname;
            }
            setDiscoveredHostnamesByIp(map);
         } catch {
            // ignore
         }
      };

      void load();
      const t = window.setInterval(load, 30_000);
      return () => {
         cancelled = true;
         window.clearInterval(t);
      };
   }, []);

   const filtered = useMemo(() => {
      const q = search.trim().toLowerCase();
      const list = q
         ? items.filter((i) => {
              const raw = i.client.toLowerCase();
              const display = displayFor(i.client).primary.toLowerCase();
              return raw.includes(q) || display.includes(q);
           })
         : items;

      const scoreBlocked = (i: ClientActivity) => {
         const total = i.totalQueries || 0;
         const blocked = i.blockedQueries || 0;
         if (total <= 0) return 0;
         return blocked / total;
      };
      const scoreLastSeen = (i: ClientActivity) => (i.lastSeen ? new Date(i.lastSeen).getTime() : 0);

      const sorted = [...list].sort((a, b) => {
         if (sortBy === 'blockedPct') return scoreBlocked(b) - scoreBlocked(a);
         if (sortBy === 'lastSeen') return scoreLastSeen(b) - scoreLastSeen(a);
         return (b.totalQueries || 0) - (a.totalQueries || 0);
      });

      return sorted;
   }, [displayFor, items, search, sortBy]);

   const selected = useMemo(() => {
      if (!selectedClient) return null;
      return filtered.find((i) => i.client === selectedClient) || items.find((i) => i.client === selectedClient) || null;
   }, [filtered, items, selectedClient]);

   useEffect(() => {
      let cancelled = false;
      if (!selectedClient) {
         setDetail(null);
         return;
      }
      setDetailBusy(true);
      fetch(
         `/api/metrics/client-detail?hours=${encodeURIComponent(String(windowHours))}&limit=8&client=${encodeURIComponent(
            selectedClient
         )}`
      )
         .then(async (r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
         })
         .then((data) => {
            if (cancelled) return;
            setDetail({
               windowHours: Number(data?.windowHours ?? windowHours),
               client: String(data?.client ?? selectedClient),
               topAllowed: Array.isArray(data?.topAllowed) ? data.topAllowed : [],
               topBlocked: Array.isArray(data?.topBlocked) ? data.topBlocked : []
            });
         })
         .catch(() => {
            if (cancelled) return;
            setDetail(null);
         })
         .finally(() => {
            if (cancelled) return;
            setDetailBusy(false);
         });
      return () => {
         cancelled = true;
      };
   }, [selectedClient, windowHours]);

   const graphLayout = useMemo(() => {
      const width = graphSize.width || 1;
      const height = graphSize.height || 1;
      const cx = width / 2;
      const cy = height / 2;
      const maxR = Math.max(120, Math.min(width, height) * 0.4);

      const clients = filtered.slice(0, 48);
      const positions: Array<{ client: string; x: number; y: number; ring: number; idx: number }> = [];

      let placed = 0;
      let ring = 0;
      while (placed < clients.length) {
         const capacity = 10 + ring * 6;
         const ringClients = clients.slice(placed, placed + capacity);
         const radius = maxR * (0.45 + ring * 0.22);
         ringClients.forEach((c, idx) => {
            const angle = (idx / ringClients.length) * Math.PI * 2 - Math.PI / 2;
            const x = cx + Math.cos(angle) * radius;
            const y = cy + Math.sin(angle) * radius;
            positions.push({ client: c.client, x, y, ring, idx });
         });
         placed += ringClients.length;
         ring += 1;
         if (ring > 4) break;
      }

      return { cx, cy, width, height, nodes: positions };
   }, [filtered, graphSize.height, graphSize.width]);

   const blockedPct = (i: ClientActivity | null) => {
      if (!i) return 0;
      const total = i.totalQueries || 0;
      const blocked = i.blockedQueries || 0;
      if (total <= 0) return 0;
      return Math.round((blocked / total) * 100);
   };

   const nodeTone = (i: ClientActivity) => {
      const pct = blockedPct(i);
      if (pct >= 25) return 'rose';
      if (pct >= 10) return 'orange';
      return 'emerald';
   };

   const goToLogs = () => {
      if (!selectedClient) return;
      const preset: any = isLikelyIp(selectedClient)
         ? { clientFilter: selectedClient, pageSize: 100 }
         : { searchTerm: selectedClient, pageSize: 100 };
      window.dispatchEvent(new CustomEvent('sentinel:navigate', { detail: { page: 'logs', logsPreset: preset } }));
   };

   return (
      <div className="space-y-4 h-[calc(100vh-140px)] flex flex-col">
         <div className="flex flex-col gap-3">
            <div className="flex justify-between items-end">
               <div>
                  <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
                     <Share2 className="w-5 h-5 text-zinc-500" /> Network Map
                  </h2>
                  <p className="text-zinc-500 text-sm mt-1">DNS activity map of clients talking through Sentinel.</p>
               </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
               <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2 bg-[#121214] border border-[#27272a] rounded px-2 py-1.5">
                     <Clock className="w-4 h-4 text-zinc-500" />
                     <MenuSelect
                        value={windowHours}
                        onChange={setWindowHours}
                        options={[
                           { value: 1, label: 'Last 1h' },
                           { value: 6, label: 'Last 6h' },
                           { value: 24, label: 'Last 24h' },
                           { value: 168, label: 'Last 7d' }
                        ]}
                        buttonClassName="flex items-center gap-2 bg-transparent text-xs text-zinc-300 outline-none cursor-pointer"
                     />
                  </div>

                  <div className="flex gap-1 border-b border-[#27272a]">
                     {[{ id: 'graph', label: 'Graph', icon: Network }, { id: 'table', label: 'Table', icon: Table2 }].map((t) => (
                        <button
                           key={t.id}
                           onClick={() => setViewMode(t.id as any)}
                           className={`flex items-center gap-2 px-4 py-2.5 text-xs font-medium border-b-2 transition-all ${
                              viewMode === (t.id as any)
                                 ? 'border-emerald-500 text-white bg-[#18181b]'
                                 : 'border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-[#18181b]/50'
                           }`}
                        >
                           <t.icon className="w-3.5 h-3.5" />
                           {t.label}
                        </button>
                     ))}
                  </div>
               </div>

               <div className="flex items-center gap-2">
                  <div className="relative">
                     <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
                     <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search client…"
                        className="bg-[#121214] border border-[#27272a] text-zinc-300 pl-9 pr-3 py-2 rounded text-xs font-mono focus:outline-none focus:border-zinc-500 w-64 placeholder:text-zinc-600"
                     />
                  </div>

                  <div className="flex items-center gap-2 bg-[#121214] border border-[#27272a] rounded px-2 py-1.5">
                     <BarChart3 className="w-4 h-4 text-zinc-500" />
                     <MenuSelect
                        value={sortBy}
                        onChange={(v) => setSortBy(v as any)}
                        options={[
                           { value: 'queries', label: 'Sort: Queries' },
                           { value: 'blockedPct', label: 'Sort: Blocked %' },
                           { value: 'lastSeen', label: 'Sort: Last Seen' }
                        ]}
                        buttonClassName="flex items-center gap-2 bg-transparent text-xs text-zinc-300 outline-none cursor-pointer"
                     />
                  </div>
               </div>
            </div>
         </div>

         <div className="flex-1 dashboard-card p-0 rounded-lg overflow-hidden bg-[#09090b] border border-[#27272a] flex">
            <div className="flex-1 relative">
               <div
                  className="absolute inset-0"
                  style={{
                     backgroundImage:
                        'radial-gradient(circle at 50% 50%, rgba(16,185,129,0.08), transparent 50%), linear-gradient(#18181b 1px, transparent 1px), linear-gradient(90deg, #18181b 1px, transparent 1px)',
                     backgroundSize: '100% 100%, 44px 44px, 44px 44px',
                     opacity: 0.35
                  }}
               ></div>

               <div className="absolute inset-0 p-4">
                  {error ? (
                     <div className="p-3 rounded border border-rose-900/40 bg-rose-950/20 text-xs text-rose-300">{error}</div>
                  ) : null}

                  {loading && !error ? (
                     <div className="text-xs text-zinc-500 font-mono">Loading…</div>
                  ) : null}
               </div>

               {viewMode === 'table' ? (
                  <div className="absolute inset-0 pt-12">
                     <div className="px-4 pb-3 text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
                        Clients ({filtered.length})
                     </div>
                     <div className="overflow-auto h-full">
                        <table className="w-full text-xs">
                           <thead className="sticky top-0 bg-[#09090b]">
                              <tr className="text-zinc-500">
                                 <th className="text-left font-mono px-4 py-2 border-b border-[#27272a]">Client</th>
                                 <th className="text-right font-mono px-3 py-2 border-b border-[#27272a]">Queries</th>
                                 <th className="text-right font-mono px-3 py-2 border-b border-[#27272a]">Blocked</th>
                                 <th className="text-right font-mono px-3 py-2 border-b border-[#27272a]">Unique</th>
                                 <th className="text-right font-mono px-4 py-2 border-b border-[#27272a]">Last seen</th>
                              </tr>
                           </thead>
                           <tbody>
                              {filtered.map((i) => {
                                 const pct = blockedPct(i);
                                 const active = selectedClient === i.client;
                                 const tone = nodeTone(i);
                                 const toneText =
                                    tone === 'rose' ? 'text-rose-400' : tone === 'orange' ? 'text-orange-400' : 'text-emerald-400';
                                 const display = displayFor(i.client);
                                 return (
                                    <tr
                                       key={i.client}
                                       className={`cursor-pointer ${active ? 'bg-[#18181b]' : 'hover:bg-[#121214]'}`}
                                       onClick={() => setSelectedClient(i.client)}
                                    >
                                       <td className="px-4 py-2 text-zinc-200 border-b border-[#121214]">
                                          <div className="font-medium text-zinc-200 truncate max-w-[320px]">{display.primary}</div>
                                          {display.secondary ? (
                                             <div className="text-[10px] font-mono text-zinc-500 truncate max-w-[320px]">{display.secondary}</div>
                                          ) : null}
                                       </td>
                                       <td className="px-3 py-2 text-right text-zinc-300 font-mono border-b border-[#121214]">{i.totalQueries.toLocaleString()}</td>
                                       <td className={`px-3 py-2 text-right font-mono border-b border-[#121214] ${toneText}`}
                                          title="Blocked percentage"
                                       >
                                          {i.blockedQueries.toLocaleString()} ({pct}%)
                                       </td>
                                       <td className="px-3 py-2 text-right text-zinc-400 font-mono border-b border-[#121214]">{i.uniqueDomains.toLocaleString()}</td>
                                       <td className="px-4 py-2 text-right text-zinc-400 font-mono border-b border-[#121214]">{formatAgo(i.lastSeen)}</td>
                                    </tr>
                                 );
                              })}
                           </tbody>
                        </table>
                     </div>
                  </div>
               ) : (
                  <div ref={graphRef} className="absolute inset-0">
                     <svg className="absolute inset-0 w-full h-full pointer-events-none">
                        {graphLayout.nodes.map((n) => {
                           const isSelected = selectedClient === n.client;
                           return (
                              <line
                                 key={n.client}
                                 x1={graphLayout.cx}
                                 y1={graphLayout.cy}
                                 x2={n.x}
                                 y2={n.y}
                                 stroke={isSelected ? '#10b981' : '#27272a'}
                                 strokeWidth={isSelected ? 2.5 : 1}
                                 opacity={isSelected ? 0.9 : 0.55}
                              />
                           );
                        })}
                     </svg>

                     <div
                        className="absolute transform -translate-x-1/2 -translate-y-1/2 flex flex-col items-center"
                        style={{ left: graphLayout.cx, top: graphLayout.cy }}
                     >
                        <div className="absolute w-28 h-28 bg-emerald-500/8 rounded-full animate-pulse"></div>
                        <div className="w-14 h-14 rounded-lg flex items-center justify-center border border-[#27272a] bg-[#09090b] shadow-lg relative">
                           <ShieldCheck className="w-7 h-7 text-emerald-500" />
                        </div>
                        <div className="mt-2 text-center opacity-90">
                           <div className="text-xs font-bold text-white bg-[#09090b]/80 px-2 py-0.5 rounded backdrop-blur-sm border border-[#27272a]">
                              Sentinel
                           </div>
                           <div className="text-[10px] font-mono text-zinc-500 mt-0.5">DNS gateway</div>
                        </div>
                     </div>

                     {graphLayout.nodes.map((n) => {
                        const item = filtered.find((i) => i.client === n.client);
                        if (!item) return null;

                        const display = displayFor(item.client);

                        const pct = blockedPct(item);
                        const tone = nodeTone(item);
                        const dot = tone === 'rose' ? 'bg-rose-500' : tone === 'orange' ? 'bg-orange-500' : 'bg-emerald-500';
                        const border =
                           selectedClient === item.client ? 'border-white' : 'border-[#27272a] group-hover:border-zinc-500';

                        const activity = item.totalQueries / Math.max(1, windowHours);
                        const size = clamp(44 + Math.log10(Math.max(1, activity)) * 10, 44, 68);

                        return (
                           <div
                              key={item.client}
                              className={`absolute transform -translate-x-1/2 -translate-y-1/2 flex flex-col items-center cursor-pointer group transition-all duration-200 ${
                                 selectedClient === item.client ? 'scale-105 z-10' : 'z-0'
                              }`}
                              style={{ left: n.x, top: n.y }}
                              onClick={() => setSelectedClient(item.client)}
                              title={`${display.primary}${display.secondary ? `\nIP: ${display.secondary}` : ''}\nQueries: ${item.totalQueries}\nBlocked: ${pct}%`}
                           >
                              <div
                                 className={`rounded-lg flex items-center justify-center border transition-colors shadow-lg relative bg-[#09090b] ${border}`}
                                 style={{ width: size, height: size }}
                              >
                                 <div className={`absolute -top-1 -right-1 w-2.5 h-2.5 ${dot} rounded-full border-2 border-[#09090b]`}></div>
                                 <div className="w-7 h-7 rounded-md bg-[#18181b] border border-[#27272a] flex items-center justify-center">
                                    <span className="text-[10px] font-bold text-zinc-200">DNS</span>
                                 </div>
                              </div>

                              <div className={`mt-2 text-center transition-opacity ${selectedClient === item.client ? 'opacity-100' : 'opacity-60 group-hover:opacity-100'}`}>
                                 <div className="text-xs font-bold text-white bg-[#09090b]/80 px-2 py-0.5 rounded backdrop-blur-sm border border-[#27272a] max-w-[160px] truncate">
                                    {display.primary}
                                 </div>
                                 {display.secondary ? (
                                    <div className="text-[9px] font-mono text-zinc-500 mt-0.5 max-w-[160px] truncate">{display.secondary}</div>
                                 ) : null}
                                 <div className="text-[9px] font-mono text-zinc-400 mt-0.5">{Math.round(activity)} q/h · {pct}% blocked</div>
                              </div>
                           </div>
                        );
                     })}
                  </div>
               )}
            </div>

            <div className="w-[360px] border-l border-[#27272a] bg-[#09090b]">
               <div className="p-4 border-b border-[#27272a] bg-[#121214]">
                  <div className="flex items-center justify-between">
                     <div>
                        <div className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">Client Details</div>
                        <div className="text-sm font-bold text-white mt-1">
                           {selected ? displayFor(selected.client).primary : 'Select a node'}
                        </div>
                        {selected && displayFor(selected.client).secondary ? (
                           <div className="text-[10px] font-mono text-zinc-500 mt-0.5 truncate">
                              {displayFor(selected.client).secondary}
                           </div>
                        ) : null}
                     </div>
                     {selected ? (
                        <button
                           onClick={goToLogs}
                           className="flex items-center gap-2 px-3 py-2 rounded border border-[#27272a] text-zinc-300 hover:text-white hover:bg-[#18181b] transition-colors text-xs"
                           title="Open Query Logs"
                        >
                           View Logs <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                     ) : null}
                  </div>
               </div>

               <div className="p-4 space-y-4 overflow-auto h-[calc(100%-72px)]">
                  {!selected ? (
                     <div className="text-xs text-zinc-500">
                        Pick a client to see DNS activity, blocked rate, and top domains.
                     </div>
                  ) : (
                     <>
                        <div className="grid grid-cols-2 gap-3">
                           <div className="p-3 rounded border border-[#27272a] bg-[#121214]">
                              <div className="text-[10px] font-mono text-zinc-500 uppercase">Queries</div>
                              <div className="text-lg font-bold text-white mt-1">{selected.totalQueries.toLocaleString()}</div>
                              <div className="text-[10px] text-zinc-500 font-mono">in last {windowHours}h</div>
                           </div>
                           <div className="p-3 rounded border border-[#27272a] bg-[#121214]">
                              <div className="text-[10px] font-mono text-zinc-500 uppercase">Blocked</div>
                              <div className="text-lg font-bold text-white mt-1">{selected.blockedQueries.toLocaleString()}</div>
                              <div className="text-[10px] text-zinc-500 font-mono">{blockedPct(selected)}%</div>
                           </div>
                           <div className="p-3 rounded border border-[#27272a] bg-[#121214]">
                              <div className="text-[10px] font-mono text-zinc-500 uppercase">Unique Domains</div>
                              <div className="text-lg font-bold text-white mt-1">{selected.uniqueDomains.toLocaleString()}</div>
                           </div>
                           <div className="p-3 rounded border border-[#27272a] bg-[#121214]">
                              <div className="text-[10px] font-mono text-zinc-500 uppercase">Last Seen</div>
                              <div className="text-lg font-bold text-white mt-1">{formatAgo(selected.lastSeen)}</div>
                              <div className="text-[10px] text-zinc-500 font-mono">{selected.lastSeen ? new Date(selected.lastSeen).toLocaleString() : '—'}</div>
                           </div>
                        </div>

                        <div>
                           <div className="flex items-center justify-between">
                              <div className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">Blocked rate</div>
                              <div className="text-[10px] font-mono text-zinc-400">{blockedPct(selected)}%</div>
                           </div>
                           <div className="w-full h-1.5 bg-[#27272a] rounded-full overflow-hidden mt-2">
                              <div
                                 className="h-full bg-rose-500 rounded-full"
                                 style={{ width: `${clamp(blockedPct(selected), 0, 100)}%` }}
                              ></div>
                           </div>
                        </div>

                        <div className="grid grid-cols-1 gap-4">
                           <div className="p-3 rounded border border-[#27272a] bg-[#121214]">
                              <div className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">Top allowed domains</div>
                              {detailBusy ? (
                                 <div className="text-xs text-zinc-500 font-mono mt-2">Loading…</div>
                              ) : detail?.topAllowed?.length ? (
                                 <div className="mt-2 space-y-1">
                                    {detail.topAllowed.slice(0, 6).map((d) => (
                                       <div key={d.domain} className="flex justify-between text-xs">
                                          <span className="text-zinc-300 font-mono truncate max-w-[230px]">{d.domain}</span>
                                          <span className="text-zinc-500 font-mono">{d.count}</span>
                                       </div>
                                    ))}
                                 </div>
                              ) : (
                                 <div className="text-xs text-zinc-600 font-mono mt-2">—</div>
                              )}
                           </div>

                           <div className="p-3 rounded border border-[#27272a] bg-[#121214]">
                              <div className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">Top blocked domains</div>
                              {detailBusy ? (
                                 <div className="text-xs text-zinc-500 font-mono mt-2">Loading…</div>
                              ) : detail?.topBlocked?.length ? (
                                 <div className="mt-2 space-y-1">
                                    {detail.topBlocked.slice(0, 6).map((d) => (
                                       <div key={d.domain} className="flex justify-between text-xs">
                                          <span className="text-zinc-300 font-mono truncate max-w-[230px]">{d.domain}</span>
                                          <span className="text-rose-400 font-mono">{d.count}</span>
                                       </div>
                                    ))}
                                 </div>
                              ) : (
                                 <div className="text-xs text-zinc-600 font-mono mt-2">—</div>
                              )}
                           </div>
                        </div>
                     </>
                  )}
               </div>
            </div>
         </div>
      </div>
   );
};

export default NetworkMap;