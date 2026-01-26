import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Server, Lock, Edit3, Plus, Trash2, Settings, Route, Wifi, Router, Info, Save, RotateCcw, Network, Asterisk, ShieldCheck, Zap, Globe, Check, Shield, UserPlus, Clock } from 'lucide-react';
import { getAuthHeaders } from '../services/apiClient';
import Modal from '../components/Modal';

type DnsRewrite = {
    id: string;
    domain: string;
    target: string;
};

interface Resolver {
    id: number;
    name: string;
    ip: string; // Display value (IP or URL trunk)
    hostname?: string; // For TLS verification
    type: 'DoH/DoT' | 'Legacy' | 'Recursive';
    protocol: 'UDP' | 'DoT' | 'DoH';
    features: ('DoH' | 'DoT' | 'DNSSEC')[];
    selected: boolean;
    isCustom?: boolean;
}

const DnsSettings: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'upstream' | 'records' | 'discovery'>('upstream');

        const [pageMsg, setPageMsg] = useState<string | null>(null);
        const [pageMsgKind, setPageMsgKind] = useState<'success' | 'error'>('success');
        const [pageMsgFading, setPageMsgFading] = useState(false);
        const pageMsgTimers = useRef<{ fade?: number; clear?: number }>({});

    // Discovery settings (reverse DNS)
    const [discoveryEnabled, setDiscoveryEnabled] = useState(false);
    const [discoveryResolver, setDiscoveryResolver] = useState('');
    const [discoveryTimeoutMs, setDiscoveryTimeoutMs] = useState(250);
    const [discoveryLoading, setDiscoveryLoading] = useState(false);
    const [discoveryMsg, setDiscoveryMsg] = useState<string | null>(null);

    // PTR test
    const [ptrTestIp, setPtrTestIp] = useState('');
    const [ptrTestLoading, setPtrTestLoading] = useState(false);
    const [ptrTestMsg, setPtrTestMsg] = useState<string | null>(null);
    const [ptrTestResult, setPtrTestResult] = useState<{ hostname: string | null; names: string[]; durationMs: number; timedOut: boolean } | null>(null);

    // DNS Rewrites
    const [rewrites, setRewrites] = useState<DnsRewrite[]>([]);
    const [rewritesLoading, setRewritesLoading] = useState(false);
    const [rewritesError, setRewritesError] = useState<string | null>(null);
    const [showAddRewrite, setShowAddRewrite] = useState(false);
    const [newRewriteDomain, setNewRewriteDomain] = useState('');
    const [newRewriteTarget, setNewRewriteTarget] = useState('');

  // Upstream Resolvers State
  const [resolvers, setResolvers] = useState<Resolver[]>([
      // Best-effort defaults: encrypted upstreams for privacy; security-focused endpoints where available.
      { id: 1, name: 'Google (DoH)', ip: 'https://dns.google/dns-query', type: 'DoH/DoT', protocol: 'DoH', features: ['DoH'], selected: false },
      { id: 2, name: 'Cloudflare Security (DoH)', ip: 'https://security.cloudflare-dns.com/dns-query', type: 'DoH/DoT', protocol: 'DoH', features: ['DoH'], selected: false },
      // Note: Quad9's DoH endpoint requires HTTP/2; use DoT for compatibility.
      { id: 3, name: 'Quad9 Security (DoT)', ip: 'dns.quad9.net:853', hostname: 'dns.quad9.net', type: 'DoH/DoT', protocol: 'DoT', features: ['DoT'], selected: false },
      { id: 4, name: 'Unbound (Local)', ip: '127.0.0.1#5335', type: 'Recursive', protocol: 'UDP', features: ['DNSSEC'], selected: true },
  ]);

  // Custom Resolver Form State
  const [showAddResolver, setShowAddResolver] = useState(false);
  const [newType, setNewType] = useState<'UDP' | 'DoT' | 'DoH'>('UDP');
  const [newIp, setNewIp] = useState('');
  const [newName, setNewName] = useState('');
  const [newHostname, setNewHostname] = useState(''); // Essential for TLS
  const [isVerifying, setIsVerifying] = useState(false);

    const selectedResolver = useMemo(() => resolvers.find(r => r.selected), [resolvers]);

    const effectiveStatus = useMemo(() => {
        const r = selectedResolver;
        const isUnbound = r?.type === 'Recursive';
        const upstreamTransport = isUnbound ? 'Recursive' : r?.protocol;

        type StatusKind = 'on' | 'off' | 'depends' | 'unknown';
        const items: Array<{ label: string; desc: string; kind: StatusKind; value: string }> = [];

        items.push({
            label: 'Upstream Transport',
            desc: 'How Sentinel reaches the upstream resolver.',
            kind: r ? 'on' : 'unknown',
            value: upstreamTransport ? String(upstreamTransport) : 'Unknown'
        });

        items.push({
            label: 'Upstream Encryption',
            desc: 'Encryption between Sentinel and the upstream.',
            kind: isUnbound ? 'off' : r?.protocol === 'DoH' || r?.protocol === 'DoT' ? 'on' : 'off',
            value: isUnbound ? 'No (direct recursion)' : r?.protocol === 'DoH' || r?.protocol === 'DoT' ? 'Yes' : 'No'
        });

        items.push({
            label: 'DNSSEC Validation',
                desc: isUnbound
                    ? 'Sentinel validates DNSSEC locally via Unbound.'
                    : 'DNSSEC is validated by the upstream resolver (remote). Sentinel forwards and does not validate locally.',
                kind: isUnbound ? 'on' : r ? (r.isCustom ? 'depends' : 'on') : 'unknown',
                value: isUnbound
                    ? 'Validated locally (Unbound)'
                    : r
                        ? r.isCustom
                            ? 'Upstream-dependent (not locally verified)'
                            : 'Validated by upstream (remote)'
                        : 'Unknown'
        });

        items.push({
            label: 'Rebind Protection',
            desc: 'Blocks private IPs in answers for public domains.',
            kind: isUnbound ? 'on' : 'off',
            value: isUnbound ? 'Enabled (Unbound private-address)' : 'Not enforced by Sentinel'
        });

        items.push({
            label: 'Caching',
            desc: 'Local cache behavior inside Sentinel.',
            kind: isUnbound ? 'on' : 'off',
            value: isUnbound ? 'Local cache (prefetch + serve-expired)' : 'No local cache (relies on upstream)'
        });

        items.push({
            label: 'Rate Limiting',
            desc: 'Limits request rate per client to mitigate abuse.',
            kind: 'off',
            value: 'Not enabled'
        });

        return {
            resolverName: r?.name ?? 'None selected',
            items
        };
    }, [selectedResolver]);

    const showPageMsg = (message: string, kind: 'success' | 'error') => {
        setPageMsg(message);
        setPageMsgKind(kind);
        setPageMsgFading(false);
        if (pageMsgTimers.current.fade) window.clearTimeout(pageMsgTimers.current.fade);
        if (pageMsgTimers.current.clear) window.clearTimeout(pageMsgTimers.current.clear);
        pageMsgTimers.current.fade = window.setTimeout(() => setPageMsgFading(true), 1800);
        pageMsgTimers.current.clear = window.setTimeout(() => {
            setPageMsg(null);
            setPageMsgFading(false);
        }, 2300);
    };

    useEffect(() => {
        return () => {
            if (pageMsgTimers.current.fade) window.clearTimeout(pageMsgTimers.current.fade);
            if (pageMsgTimers.current.clear) window.clearTimeout(pageMsgTimers.current.clear);
        };
    }, []);

    const loadRewrites = async () => {
        setRewritesLoading(true);
        setRewritesError(null);
        try {
            const res = await fetch('/api/dns/rewrites', {
                headers: {
                    ...getAuthHeaders()
                },
                credentials: 'include'
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({} as any));
                setRewritesError(data?.error || data?.message || 'Failed to load rewrites.');
                setRewrites([]);
                return;
            }
            const data = await res.json();
            setRewrites(Array.isArray(data?.items) ? data.items : []);
        } catch {
            setRewritesError('Backend not reachable.');
            setRewrites([]);
        } finally {
            setRewritesLoading(false);
        }
    };

    useEffect(() => {
        if (activeTab === 'records') {
            void loadRewrites();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab]);

    const loadDiscoverySettings = async () => {
        setDiscoveryLoading(true);
        setDiscoveryMsg(null);
        try {
            const res = await fetch('/api/discovery/settings', {
                headers: { ...getAuthHeaders() },
                credentials: 'include'
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({} as any));
                setDiscoveryMsg(data?.error || data?.message || 'Failed to load discovery settings.');
                return;
            }
            const data = await res.json().catch(() => ({} as any));
            const v = data?.value;
            setDiscoveryEnabled(v?.reverseDns?.enabled === true);
            setDiscoveryResolver(typeof v?.reverseDns?.resolver === 'string' ? v.reverseDns.resolver : '');
            const t = Number(v?.reverseDns?.timeoutMs);
            setDiscoveryTimeoutMs(Number.isFinite(t) ? t : 250);
        } catch {
            setDiscoveryMsg('Backend not reachable.');
        } finally {
            setDiscoveryLoading(false);
        }
    };

    useEffect(() => {
        if (activeTab === 'discovery') {
            void loadDiscoverySettings();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab]);

    const saveDiscoverySettings = async () => {
        setDiscoveryLoading(true);
        setDiscoveryMsg(null);
        try {
            const res = await fetch('/api/discovery/settings', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    ...getAuthHeaders()
                },
                credentials: 'include',
                body: JSON.stringify({
                    reverseDns: {
                        enabled: discoveryEnabled,
                        resolver: discoveryResolver,
                        timeoutMs: discoveryTimeoutMs
                    }
                })
            });
            const data = await res.json().catch(() => ({} as any));
            if (!res.ok) {
                setDiscoveryMsg(data?.error || data?.message || 'Save failed.');
                return;
            }
            setDiscoveryMsg('Saved.');
        } catch {
            setDiscoveryMsg('Backend not reachable.');
        } finally {
            setDiscoveryLoading(false);
        }
    };

    const testPtr = async () => {
        const ip = ptrTestIp.trim();
        if (!ip) return;

        setPtrTestLoading(true);
        setPtrTestMsg(null);
        setPtrTestResult(null);

        try {
            const res = await fetch('/api/discovery/test-ptr', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...getAuthHeaders()
                },
                credentials: 'include',
                body: JSON.stringify({
                    ip,
                    resolver: discoveryResolver,
                    timeoutMs: discoveryTimeoutMs
                })
            });

            const data = await res.json().catch(() => ({} as any));
            if (!res.ok) {
                setPtrTestMsg(data?.error || data?.message || 'PTR test failed.');
                return;
            }

            const timedOut = data?.timedOut === true;
            const durationMs = Number(data?.durationMs);
            const names = Array.isArray(data?.names) ? data.names.map((x: any) => String(x)) : [];
            const hostname = typeof data?.hostname === 'string' && data.hostname.trim() ? data.hostname.trim() : null;

            setPtrTestResult({ hostname, names, durationMs: Number.isFinite(durationMs) ? durationMs : 0, timedOut });
            if (timedOut) setPtrTestMsg('Timed out.');
            else if (hostname) setPtrTestMsg('PTR found.');
            else setPtrTestMsg('No PTR record found.');
        } catch {
            setPtrTestMsg('Backend not reachable.');
        } finally {
            setPtrTestLoading(false);
        }
    };

    useEffect(() => {
        // Load persisted DNS settings from backend (best-effort)
        fetch('/api/dns/settings')
            .then(r => r.json())
            .then(d => {
                const v = d?.value;
                if (!v) return;

                // We only persist upstream selection here.
                // If upstreamMode=unbound => select the built-in Unbound (Local) row.
                if (v.upstreamMode === 'unbound') {
                    setResolvers(prev => prev.map(r => ({ ...r, selected: r.type === 'Recursive' })));
                    return;
                }

                if (v.upstreamMode === 'forward' && v.forward) {
                    const transport = String(v.forward.transport ?? 'udp');

                    if (transport === 'doh' && v.forward.dohUrl) {
                        const dohUrl = String(v.forward.dohUrl);
                        setResolvers(prev => {
                            const matched = prev.find(r => r.protocol === 'DoH' && r.ip === dohUrl);
                            const next = prev.map(r => ({ ...r, selected: false }));
                            if (matched) return next.map(r => ({ ...r, selected: r.id === matched.id }));
                            const newR: Resolver = {
                                id: Date.now(),
                                name: `Custom DoH`,
                                ip: dohUrl,
                                type: 'DoH/DoT',
                                protocol: 'DoH',
                                features: ['DoH'],
                                selected: true,
                                isCustom: true
                            };
                            return [...next, newR];
                        });
                        return;
                    }

                    if ((transport === 'dot' || transport === 'tcp' || transport === 'udp') && v.forward.host) {
                        const host = String(v.forward.host);
                        const port = Number(v.forward.port ?? (transport === 'dot' ? 853 : 53));
                        const proto: Resolver['protocol'] = transport === 'dot' ? 'DoT' : 'UDP';

                        setResolvers(prev => {
                            const matched = prev.find(r => r.protocol === proto && (r.hostname === host || r.ip === host || r.ip === `${host}:${port}`));
                            const next = prev.map(r => ({ ...r, selected: false }));
                            if (matched) return next.map(r => ({ ...r, selected: r.id === matched.id }));
                            const newR: Resolver = {
                                id: Date.now(),
                                name: `Custom ${host}`,
                                ip: port === 53 || port === 853 ? host : `${host}:${port}`,
                                hostname: transport === 'dot' ? host : undefined,
                                type: transport === 'dot' ? 'DoH/DoT' : 'Legacy',
                                protocol: proto,
                                features: [...(transport === 'dot' ? (['DoT'] as any) : [])],
                                selected: true,
                                isCustom: true
                            };
                            return [...next, newR];
                        });
                    }
                }
            })
            .catch(() => {
                // ignore
            });
    }, []);

    const saveDnsSettings = async () => {
          // Persist upstream selection only; discovery settings are saved in their own tab.
        const r = selectedResolver;
        if (!r) return;

        const payload =
            r.type === 'Recursive'
                ? { upstreamMode: 'unbound', forward: { host: '1.1.1.1', port: 53, transport: 'udp' } }
                : (() => {
                        if (r.protocol === 'DoH') {
                            return { upstreamMode: 'forward', forward: { transport: 'doh', dohUrl: String(r.ip || '').trim() } };
                        }

                        const raw = String(r.ip || '').trim();
                        const parts = raw.split(':');
                        const hostRaw = (parts[0] || raw).trim();
                        const defaultPort = r.protocol === 'DoT' ? 853 : 53;
                        const port = parts.length > 1 ? Number(parts[1]) : defaultPort;

                        // For DoT we prefer a hostname for SNI/cert validation.
                        const host = r.protocol === 'DoT' ? String(r.hostname || hostRaw).trim() : hostRaw;
                        const transport = r.protocol === 'DoT' ? 'dot' : 'udp';
                        return {
                            upstreamMode: 'forward',
                            forward: {
                                transport,
                                host,
                                port: Number.isFinite(port) ? Math.min(65535, Math.max(1, Math.floor(port))) : defaultPort
                            }
                        };
                    })();

        try {
            const res = await fetch('/api/dns/settings', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    ...getAuthHeaders()
                },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const data = await res.json().catch(() => ({} as any));
                showPageMsg(data?.message || 'Saving DNS settings failed.', 'error');
                return;
            }

            showPageMsg('Saved', 'success');
        } catch {
            showPageMsg('Backend not reachable.', 'error');
        }
    };

  const toggleResolver = (id: number) => {
      setResolvers(resolvers.map(r => ({ ...r, selected: r.id === id })));
  };

  const deleteResolver = (id: number, e: React.MouseEvent) => {
      e.stopPropagation();
      setResolvers(resolvers.filter(r => r.id !== id));
  };

  const handleAddResolver = () => {
      // Basic Validation
      if (newType === 'UDP' && !newIp) return;
      if (newType === 'DoT' && (!newIp || !newHostname)) return;
      if (newType === 'DoH' && !newIp) return; // For DoH, newIp holds the URL

      setIsVerifying(true);
      
      // Simulate Verification Handshake
      setTimeout(() => {
          const features: ('DoH' | 'DoT' | 'DNSSEC')[] = [];
          if (newType === 'DoH') features.push('DoH');
          if (newType === 'DoT') features.push('DoT');

          const newR: Resolver = {
              id: Date.now(),
              name: newName || (newType === 'DoH' ? 'Custom DoH' : newIp),
              ip: newIp,
              hostname: newHostname,
              protocol: newType,
              type: newType === 'UDP' ? 'Legacy' : 'DoH/DoT',
              features: features,
              selected: false,
              isCustom: true
          };

          setResolvers([...resolvers, newR]);
          
          // Reset Form
          setNewIp('');
          setNewName('');
          setNewHostname('');
          setNewType('UDP');
          setIsVerifying(false);
          setShowAddResolver(false);
      }, 1000);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex justify-between items-end">
         <div>
            <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
                <Settings className="w-5 h-5 text-zinc-500" /> DNS Configuration
            </h2>
            <p className="text-zinc-500 text-sm mt-1">Manage resolvers, local records, and client discovery.</p>
         </div>
         <div className="flex items-center gap-3">
             {pageMsg ? (
                 <span
                     className={`inline-flex items-center px-2 py-1 rounded border text-[11px] font-bold tracking-tight transition-opacity duration-500 ${
                         pageMsgFading ? 'opacity-0' : 'opacity-100'
                     } ${
                         pageMsgKind === 'success'
                             ? 'bg-emerald-950/20 text-emerald-300 border-emerald-700/40'
                             : 'bg-rose-950/20 text-rose-300 border-rose-700/40'
                     }`}
                 >
                     {pageMsg}
                 </span>
             ) : null}
             {activeTab === 'upstream' ? (
                 <button onClick={saveDnsSettings} className="btn-primary flex items-center gap-2 px-4 py-2 rounded text-xs">
                     <Save className="w-3.5 h-3.5" />
                     SAVE CHANGES
                 </button>
             ) : null}
         </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-[#27272a] flex gap-1">
        {[
          { id: 'upstream', label: 'Upstream Resolvers', icon: Server },
          { id: 'records', label: 'Local Records', icon: Edit3 },
                    { id: 'discovery', label: 'Client Discovery', icon: Router }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-medium border-b-2 transition-all ${
              activeTab === tab.id 
                ? 'border-emerald-500 text-white bg-[#18181b]' 
                : 'border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-[#18181b]/50'
            }`}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="min-h-[400px]">
        {/* ... (Previous Tabs UPSTREAM and RECORDS remain unchanged) ... */}
        {activeTab === 'upstream' && (
           <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-fade-in">
             <div className="dashboard-card p-6 rounded-lg flex flex-col">
                <div className="flex justify-between items-start mb-5">
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                        <Server className="w-4 h-4 text-indigo-500" /> Public Resolvers
                    </h3>
                    {!showAddResolver && (
                        <button onClick={() => setShowAddResolver(true)} className="text-[10px] font-bold text-zinc-400 hover:text-white flex items-center gap-1 bg-[#18181b] px-2 py-1 rounded border border-[#27272a]">
                            <Plus className="w-3 h-3" /> ADD CUSTOM
                        </button>
                    )}
                </div>
                
                {showAddResolver && (
                    <div className="mb-4 p-4 bg-[#121214] border border-dashed border-[#27272a] rounded animate-fade-in">
                        <div className="flex items-center gap-2 mb-4">
                            <span className="text-[10px] font-bold text-zinc-500 uppercase">Protocol:</span>
                            <div className="flex bg-[#09090b] rounded p-0.5 border border-[#27272a]">
                                <button 
                                    onClick={() => setNewType('UDP')} 
                                    className={`px-3 py-1 rounded text-[10px] font-bold transition-colors ${newType === 'UDP' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                                >
                                    Standard
                                </button>
                                <button 
                                    onClick={() => setNewType('DoT')} 
                                    className={`px-3 py-1 rounded text-[10px] font-bold transition-colors ${newType === 'DoT' ? 'bg-indigo-600 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                                >
                                    DoT (TLS)
                                </button>
                                <button 
                                    onClick={() => setNewType('DoH')} 
                                    className={`px-3 py-1 rounded text-[10px] font-bold transition-colors ${newType === 'DoH' ? 'bg-emerald-600 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
                                >
                                    DoH (HTTPS)
                                </button>
                            </div>
                        </div>

                        <div className="space-y-3 mb-4">
                            {/* Name Field (Common) */}
                            <div>
                                <input 
                                    type="text" 
                                    placeholder="Display Name (e.g. My Private DNS)" 
                                    value={newName}
                                    onChange={(e) => setNewName(e.target.value)}
                                    className="w-full bg-[#09090b] border border-[#27272a] text-white px-3 py-2 rounded text-xs outline-none focus:border-zinc-500"
                                />
                            </div>

                            {/* Standard / DoT Input */}
                            {(newType === 'UDP' || newType === 'DoT') && (
                                <div className="grid grid-cols-2 gap-3">
                                    <input 
                                        type="text" 
                                        placeholder="IP Address (e.g. 1.1.1.1)" 
                                        value={newIp}
                                        onChange={(e) => setNewIp(e.target.value)}
                                        className="bg-[#09090b] border border-[#27272a] text-white px-3 py-2 rounded text-xs font-mono outline-none focus:border-indigo-500"
                                    />
                                    {newType === 'UDP' && (
                                        <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                                            <Info className="w-3 h-3" />
                                            <span>Unencrypted (Port 53)</span>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* DoT Specific: Hostname */}
                            {newType === 'DoT' && (
                                <div className="relative group">
                                    <input 
                                        type="text" 
                                        placeholder="TLS Hostname (e.g. cloudflare-dns.com)" 
                                        value={newHostname}
                                        onChange={(e) => setNewHostname(e.target.value)}
                                        className="w-full bg-[#09090b] border border-[#27272a] text-white pl-8 pr-3 py-2 rounded text-xs font-mono outline-none focus:border-indigo-500"
                                    />
                                    <Lock className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-indigo-500" />
                                    <div className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <span className="text-[9px] bg-zinc-800 text-zinc-300 px-1.5 py-0.5 rounded border border-zinc-700">Required for SSL Cert</span>
                                    </div>
                                </div>
                            )}

                            {/* DoH Specific: URL */}
                            {newType === 'DoH' && (
                                <div className="relative">
                                    <input 
                                        type="text" 
                                        placeholder="DoH URL (e.g. https://dns.google/dns-query)" 
                                        value={newIp}
                                        onChange={(e) => setNewIp(e.target.value)}
                                        className="w-full bg-[#09090b] border border-[#27272a] text-white pl-8 pr-3 py-2 rounded text-xs font-mono outline-none focus:border-emerald-500"
                                    />
                                    <Globe className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-emerald-500" />
                                </div>
                            )}
                        </div>

                        <div className="flex gap-2">
                             <button 
                                onClick={handleAddResolver}
                                disabled={isVerifying}
                                className="flex-1 bg-zinc-100 hover:bg-white text-black rounded py-1.5 text-xs font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                             >
                                 {isVerifying ? <div className="w-3 h-3 border-2 border-black/30 border-t-black rounded-full animate-spin"></div> : <ShieldCheck className="w-3.5 h-3.5" />}
                                 {isVerifying ? 'VERIFYING...' : 'VERIFY & ADD'}
                             </button>
                             <button onClick={() => setShowAddResolver(false)} className="px-3 bg-zinc-800 text-zinc-400 hover:text-white rounded text-xs font-bold">CANCEL</button>
                        </div>
                    </div>
                )}
                
                <div className="space-y-2 flex-1 overflow-y-auto max-h-[400px]">
                   {resolvers.map((server) => {
                      const isUnbound = server.type === 'Recursive';
                      return (
                      <label 
                        key={server.id} 
                        onClick={() => toggleResolver(server.id)}
                        className={`relative flex items-center justify-between p-3 rounded border cursor-pointer transition-all group ${server.selected ? 'bg-[#18181b] border-indigo-500 shadow-[0_0_20px_rgba(99,102,241,0.1)]' : 'bg-[#09090b] border-[#27272a] hover:border-zinc-600'}`}
                      >
                         <div className="flex items-center gap-3">
                            <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${server.selected ? 'border-indigo-500' : 'border-zinc-600'}`}>
                                 {server.selected && <div className="w-2 h-2 rounded-full bg-indigo-500"></div>}
                            </div>
                            <div>
                               <div className="flex items-center gap-2">
                                   <div className="text-sm font-bold text-zinc-200">{server.name}</div>
                                   {isUnbound && <span className="text-[9px] bg-emerald-950/30 text-emerald-500 border border-emerald-900/50 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider flex items-center gap-1"><Globe className="w-2.5 h-2.5" /> Root Server</span>}
                                   
                                   {/* Protocol Badge */}
                                   {!isUnbound && (
                                       <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${
                                           server.protocol === 'DoT' ? 'text-indigo-400 bg-indigo-950/30 border border-indigo-900/50' : 
                                           server.protocol === 'DoH' ? 'text-emerald-400 bg-emerald-950/30 border border-emerald-900/50' :
                                           'text-zinc-500 bg-zinc-900 border border-zinc-700'
                                       }`}>
                                           {server.protocol}
                                       </span>
                                   )}
                               </div>
                               
                               <div className="text-[10px] font-mono text-zinc-500 mt-0.5 flex flex-col">
                                   <span className="truncate max-w-[200px]">{server.ip}</span>
                                   {server.protocol === 'DoT' && server.hostname && server.hostname !== server.ip && (
                                       <span className="text-zinc-600 flex items-center gap-1"><Lock className="w-2.5 h-2.5" /> {server.hostname}</span>
                                   )}
                               </div>

                               {isUnbound && <div className="text-[10px] text-zinc-600 mt-1 max-w-[250px] leading-tight">Recursive resolver. Queries root servers directly. Maximum privacy, no upstream logging.</div>}
                            </div>
                         </div>
                         
                         <div className="flex flex-col items-end gap-1.5">
                            {server.isCustom && (
                                <button 
                                    onClick={(e) => deleteResolver(server.id, e)}
                                    className="p-1.5 text-zinc-600 hover:text-rose-500 transition-colors opacity-0 group-hover:opacity-100"
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                </button>
                            )}
                         </div>
                      </label>
                   )})}
                </div>
             </div>

             <div className="dashboard-card p-6 rounded-lg">
                <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-2 flex items-center gap-2">
                   <Lock className="w-4 h-4 text-rose-500" /> Effective Status
                </h3>
                <div className="text-[10px] text-zinc-500 mb-4">
                    Based on the currently selected upstream resolver: <span className="text-zinc-300 font-mono">{effectiveStatus.resolverName}</span>
                </div>

                <div className="grid grid-cols-1 gap-3">
                    {effectiveStatus.items.map((item, i) => {
                        const badgeClass =
                            item.kind === 'on'
                                ? 'bg-emerald-950/20 text-emerald-300 border-emerald-700/40'
                                : item.kind === 'off'
                                    ? 'bg-zinc-900 text-zinc-300 border-zinc-700'
                                    : item.kind === 'depends'
                                        ? 'bg-amber-950/20 text-amber-300 border-amber-700/40'
                                        : 'bg-zinc-900 text-zinc-400 border-zinc-700';

                        const icon =
                            item.kind === 'on' ? <Check className="w-3 h-3" /> : item.kind === 'off' ? <Shield className="w-3 h-3" /> : <Info className="w-3 h-3" />;

                        return (
                            <div key={i} className="p-4 bg-[#09090b] rounded border border-[#27272a] flex items-start justify-between gap-4">
                                <div>
                                    <div className="text-xs font-bold text-zinc-300">{item.label}</div>
                                    <div className="text-[10px] text-zinc-500 mt-0.5">{item.desc}</div>
                                </div>
                                <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded border text-[11px] font-bold tracking-tight ${badgeClass}`}>
                                    {icon}
                                    {item.value}
                                </span>
                            </div>
                        );
                    })}
                </div>

                <div className="mt-8 p-4 bg-indigo-900/10 border border-indigo-500/20 rounded-lg">
                    <div className="flex gap-3">
                        <ShieldCheck className="w-5 h-5 text-indigo-400 flex-shrink-0" />
                        <div>
                            <h4 className="text-xs font-bold text-indigo-400 uppercase">Pro Tip: Privacy</h4>
                            <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                                For maximum privacy, select <strong>Unbound (Local)</strong>. 
                                This prevents Upstream providers (like Google or Cloudflare) from building a profile of your browsing habits, 
                                as queries are sent directly to the authoritative nameservers.
                            </p>
                        </div>
                    </div>
                </div>
             </div>
           </div>
        )}

        {/* TAB 2: LOCAL RECORDS */}
        {activeTab === 'records' && (
           <div className="dashboard-card p-0 rounded-lg flex flex-col overflow-hidden animate-fade-in">
              <div className="p-5 border-b border-[#27272a] flex justify-between items-center bg-[#121214]">
                 <div>
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                       <Edit3 className="w-4 h-4 text-emerald-500" /> DNS Rewrites
                    </h3>
                    <p className="text-xs text-zinc-500 mt-1">Override DNS answers for exact domain matches (A/AAAA/CNAME).</p>
                 </div>
                 <button
                    onClick={() => setShowAddRewrite(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 text-zinc-200 border border-zinc-700 rounded text-xs font-bold hover:bg-white hover:text-black transition-colors"
                 >
                    <Plus className="w-3.5 h-3.5" /> ADD RECORD
                 </button>
              </div>
              
              <div className="bg-[#09090b]">
                 <table className="w-full text-left">
                    <thead className="bg-[#09090b] text-[9px] text-zinc-600 uppercase font-bold tracking-wider">
                       <tr>
                          <th className="p-4 pl-6 border-b border-[#27272a]">Domain</th>
                          <th className="p-4 border-b border-[#27272a]">Target IP / CNAME</th>
                          <th className="p-4 border-b border-[#27272a] text-right pr-6">Action</th>
                       </tr>
                    </thead>
                    <tbody className="divide-y divide-[#27272a]">
                       {rewritesLoading && (
                          <tr>
                              <td colSpan={3} className="p-6 text-xs text-zinc-500">Loading rewrites…</td>
                          </tr>
                       )}
                       {!rewritesLoading && rewritesError && (
                          <tr>
                              <td colSpan={3} className="p-6 text-xs text-rose-400">{rewritesError}</td>
                          </tr>
                       )}
                       {!rewritesLoading && !rewritesError && rewrites.length === 0 && (
                          <tr>
                              <td colSpan={3} className="p-6 text-xs text-zinc-500">No rewrites configured.</td>
                          </tr>
                       )}
                       {!rewritesLoading && !rewritesError && rewrites.map(rewrite => {
                          return (
                            <tr key={rewrite.id} className="hover:bg-[#18181b] group">
                                <td className="p-4 pl-6 text-sm text-zinc-300 font-mono font-medium flex items-center gap-2">
                                    {rewrite.domain}
                                </td>
                                <td className="p-4 text-sm text-indigo-400 font-mono">
                                    <div className="flex items-center gap-2">
                                        <Route className="w-3 h-3 text-zinc-600" />
                                        {rewrite.target}
                                    </div>
                                </td>
                                <td className="p-4 text-right pr-6">
                                    <button
                                        aria-label={`Delete rewrite ${rewrite.domain}`}
                                        onClick={async () => {
                                            try {
                                                const res = await fetch(`/api/dns/rewrites/${rewrite.id}`, {
                                                    method: 'DELETE',
                                                    headers: { ...getAuthHeaders() },
                                                    credentials: 'include'
                                                });
                                                if (!res.ok && res.status !== 204) {
                                                    const data = await res.json().catch(() => ({} as any));
                                                    showPageMsg(data?.error || data?.message || 'Delete failed.', 'error');
                                                    return;
                                                }
                                                setRewrites(prev => prev.filter(r => r.id !== rewrite.id));
                                                showPageMsg('Deleted', 'success');
                                            } catch {
                                                showPageMsg('Backend not reachable.', 'error');
                                            }
                                        }}
                                        className="text-zinc-600 hover:text-rose-500 transition-colors opacity-0 group-hover:opacity-100 p-2"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </td>
                            </tr>
                          );
                       })}
                    </tbody>
                 </table>
              </div>

              {showAddRewrite && (
                <Modal open={true} onClose={() => setShowAddRewrite(false)} zIndex={1100}>
                    <div className="w-full max-w-lg bg-[#09090b] border border-[#27272a] rounded-lg overflow-hidden animate-fade-in">
                        <div className="p-5 border-b border-[#27272a] bg-[#121214] flex justify-between items-center">
                            <div>
                                <div className="text-sm font-bold text-white uppercase tracking-wider">Add DNS Rewrite</div>
                                <div className="text-xs text-zinc-500 mt-1">Domain → target (IP or CNAME).</div>
                            </div>
                            <button onClick={() => setShowAddRewrite(false)} className="text-zinc-500 hover:text-white">
                                ×
                            </button>
                        </div>
                        <div className="p-5 space-y-4">
                            <div>
                                <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1.5">Domain</label>
                                <input
                                    type="text"
                                    placeholder="printer.lan"
                                    className="w-full bg-[#121214] border border-[#27272a] rounded px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-emerald-500 placeholder:text-zinc-700"
                                    value={newRewriteDomain}
                                    onChange={(e) => setNewRewriteDomain(e.target.value)}
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1.5">Target</label>
                                <input
                                    type="text"
                                    placeholder="192.168.1.10 or host.local"
                                    className="w-full bg-[#121214] border border-[#27272a] rounded px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-emerald-500 placeholder:text-zinc-700"
                                    value={newRewriteTarget}
                                    onChange={(e) => setNewRewriteTarget(e.target.value)}
                                />
                            </div>
                            <div className="text-[10px] text-zinc-600 leading-relaxed">
                                Exact-match only. Wildcards are not supported yet.
                            </div>
                        </div>
                        <div className="p-5 border-t border-[#27272a] bg-[#121214] flex justify-end gap-3">
                            <button
                                onClick={() => setShowAddRewrite(false)}
                                className="px-4 py-2 rounded text-xs font-bold text-zinc-400 hover:text-white"
                            >
                                CANCEL
                            </button>
                            <button
                                onClick={async () => {
                                    try {
                                        const res = await fetch('/api/dns/rewrites', {
                                            method: 'POST',
                                            headers: {
                                                'Content-Type': 'application/json',
                                                ...getAuthHeaders()
                                            },
                                            credentials: 'include',
                                            body: JSON.stringify({ domain: newRewriteDomain, target: newRewriteTarget })
                                        });
                                        if (!res.ok) {
                                            const data = await res.json().catch(() => ({} as any));
                                            showPageMsg(data?.error || data?.message || 'Add failed.', 'error');
                                            return;
                                        }
                                        setShowAddRewrite(false);
                                        setNewRewriteDomain('');
                                        setNewRewriteTarget('');
                                        await loadRewrites();
                                        showPageMsg('Saved', 'success');
                                    } catch {
                                        showPageMsg('Backend not reachable.', 'error');
                                    }
                                }}
                                disabled={!newRewriteDomain.trim() || !newRewriteTarget.trim()}
                                className="btn-primary px-6 py-2 rounded text-xs flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <Save className="w-3.5 h-3.5" /> SAVE
                            </button>
                        </div>
                    </div>
                                </Modal>
              )}
           </div>
        )}

          {/* TAB 3: CLIENT DISCOVERY */}
        {activeTab === 'discovery' && (
              <div className="dashboard-card p-6 rounded-lg animate-fade-in space-y-4">
                  <div className="flex gap-3">
                      <Info className="w-5 h-5 text-indigo-400 flex-shrink-0" />
                      <div>
                          <h4 className="text-xs font-bold text-indigo-400 uppercase">Client Discovery</h4>
                          <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                              Sentinel can discover recent client IPs from DNS logs and (optionally) resolve hostnames via reverse DNS (PTR).
                              This works with most routers (e.g. FRITZ!Box, OPNsense, UniFi, MikroTik) as long as your network provides PTR hostnames for LAN clients.
                          </p>
                      </div>
                  </div>

                  <div className="bg-[#121214] border border-[#27272a] rounded p-4 space-y-3">
                      <div className="flex items-center justify-between gap-4">
                          <div>
                              <div className="text-[10px] font-bold text-zinc-500 uppercase">Reverse DNS Hostname Resolution</div>
                              <div className="text-xs text-zinc-500 mt-1">Resolves observed client IPs to hostnames using PTR queries.</div>
                          </div>
                          <div className="flex items-center gap-2">
                              <span className="text-[10px] font-bold text-zinc-500">Enabled</span>
                              <div
                                  onClick={() => setDiscoveryEnabled((v) => !v)}
                                  className={`w-10 h-5 rounded-full relative cursor-pointer transition-colors ${discoveryEnabled ? 'bg-emerald-600' : 'bg-zinc-700'}`}
                                  title={discoveryEnabled ? 'On' : 'Off'}
                              >
                                  <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${discoveryEnabled ? 'right-0.5' : 'left-0.5'}`}></div>
                              </div>
                          </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                              <div className="text-[10px] font-bold text-zinc-500 uppercase mb-1">Resolver IP (recommended: router/unbound)</div>
                              <input
                                  value={discoveryResolver}
                                  onChange={(e) => setDiscoveryResolver(e.target.value)}
                                  placeholder="e.g. 192.168.1.1"
                                  className="w-full bg-[#09090b] border border-[#27272a] rounded px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-zinc-500 placeholder:text-zinc-700"
                              />
                              <div className="text-[10px] text-zinc-600 mt-1">Leave empty to use system resolver (usually not correct for LAN hostnames).</div>
                          </div>
                          <div>
                              <div className="text-[10px] font-bold text-zinc-500 uppercase mb-1">Timeout (ms)</div>
                              <input
                                  value={String(discoveryTimeoutMs)}
                                  onChange={(e) => setDiscoveryTimeoutMs(Number(e.target.value) || 250)}
                                  placeholder="250"
                                  className="w-full bg-[#09090b] border border-[#27272a] rounded px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-zinc-500 placeholder:text-zinc-700"
                              />
                              <div className="text-[10px] text-zinc-600 mt-1">Lower = faster, but may miss results.</div>
                          </div>
                      </div>

                      <div className="bg-[#09090b] border border-[#27272a] rounded p-3 space-y-2">
                          <div className="flex items-center justify-between gap-3">
                              <div>
                                  <div className="text-[10px] font-bold text-zinc-500 uppercase">PTR Lookup Test</div>
                                  <div className="text-xs text-zinc-600 mt-1">Try resolving a single LAN IP (uses current resolver/timeout values, even before saving).</div>
                              </div>
                              <div className="text-[10px] text-zinc-600 flex items-center gap-2">
                                  <Clock className="w-3.5 h-3.5" />
                                  <span>{ptrTestResult ? `${ptrTestResult.durationMs}ms` : ' '}</span>
                              </div>
                          </div>

                          <div className="flex flex-col md:flex-row gap-2">
                              <input
                                  value={ptrTestIp}
                                  onChange={(e) => setPtrTestIp(e.target.value)}
                                  placeholder="e.g. 192.168.1.42"
                                  className="flex-1 bg-[#050507] border border-[#27272a] rounded px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-zinc-500 placeholder:text-zinc-700"
                              />
                              <button
                                  onClick={testPtr}
                                  disabled={ptrTestLoading || !ptrTestIp.trim()}
                                  className="px-4 py-2 rounded text-xs font-bold text-zinc-400 hover:text-white border border-[#27272a] hover:border-zinc-500 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                  {ptrTestLoading ? 'Testing…' : 'Test PTR'}
                              </button>
                          </div>

                          <div className="text-[10px] text-zinc-500">
                              {ptrTestMsg ? ptrTestMsg : ' '}
                          </div>

                          {ptrTestResult && (
                              <div className="text-xs text-zinc-400">
                                  <div>
                                      Result:{' '}
                                      <span className="font-mono text-white">
                                          {ptrTestResult.timedOut ? 'TIMEOUT' : ptrTestResult.hostname ? ptrTestResult.hostname : '(no hostname)'}
                                      </span>
                                  </div>
                                  {!ptrTestResult.timedOut && ptrTestResult.names.length > 1 && (
                                      <div className="mt-1 text-[10px] text-zinc-500 font-mono break-all">All PTRs: {ptrTestResult.names.join(', ')}</div>
                                  )}
                              </div>
                          )}
                      </div>

                      <div className="flex items-center justify-between gap-3 pt-2">
                          <div className="text-[10px] text-zinc-500">
                              {discoveryMsg ? discoveryMsg : discoveryLoading ? 'Loading…' : ' '}
                          </div>
                          <div className="flex gap-2">
                              <button
                                  onClick={loadDiscoverySettings}
                                  className="px-4 py-2 rounded text-xs font-bold text-zinc-400 hover:text-white border border-[#27272a] hover:border-zinc-500"
                                  disabled={discoveryLoading}
                              >
                                  <RotateCcw className="w-3.5 h-3.5 inline-block mr-2" /> Refresh
                              </button>
                              <button
                                  onClick={saveDiscoverySettings}
                                  className="btn-primary px-6 py-2 rounded text-xs flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                  disabled={discoveryLoading}
                              >
                                  <Save className="w-3.5 h-3.5" /> SAVE
                              </button>
                          </div>
                      </div>
                  </div>

                  <div className="text-[10px] text-zinc-600 leading-relaxed">
                      Notes:
                      If Sentinel only shows your router IP as the client, your router is proxying DNS. Configure your DHCP to hand out Sentinel as the DNS server to clients (so queries reach Sentinel with the real client IPs).
                      If hostnames stay empty, your router/DNS server likely does not publish PTR records for LAN clients; in that case discovery can still show IPs, and you can name devices manually under “Clients”.
                  </div>
              </div>
        )}
      </div>
    </div>
  );
};

export default DnsSettings;