import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Anomaly, DnsQuery, QueryStatus, ClientProfile } from '../types';
import { Search, Filter, Sparkles, X, Terminal, CheckCircle, XCircle, AlertTriangle, ShieldCheck, ChevronDown, Users, Shield, Eye, UserPlus, Save, Smartphone, Laptop, Tv, Gamepad2, Info, Ban, ShieldOff, Check, AlertOctagon, Zap, EyeOff } from 'lucide-react';
import { analyzeDomain } from '../services/geminiService';
import { detectAnomalies } from '../services/anomalyService';
import { useRules } from '../contexts/RulesContext';
import { useClients } from '../contexts/ClientsContext';
import { apiFetch } from '../services/apiClient';
import Modal from '../components/Modal';
import { ModalCard, ModalFooter, ModalHeader } from '../components/ModalLayout';
import { ReadOnlyFollowerBanner } from '../components/ReadOnlyFollowerBanner';
import { isReadOnlyFollower, useClusterStatus } from '../hooks/useClusterStatus';

const IGNORED_ANOMALY_KEY = 'sentinel_ignored_anomaly_signatures';

function signatureForAnomaly(a: Anomaly): string {
  return `${a.device}|${a.issue}`;
}

function extractDomain(text: string): string | null {
  const match = String(text || '').match(/\b([a-z0-9-]+\.)+[a-z]{2,}\b/i);
  return match ? match[0].toLowerCase() : null;
}

interface AnalysisResult {
  category: string;
  purpose: string;
  impact: string;
}

type QueryLogsPreset = {
  tab?: 'queries' | 'suspicious';
  searchTerm?: string;
  statusFilter?: string;
  typeFilter?: string;
  clientFilter?: string;
  pageSize?: number;
  hours?: number;
  domainExact?: string;
};

type QueryLogsProps = {
  preset?: QueryLogsPreset | null;
  onPresetConsumed?: () => void;
};

const QueryLogs: React.FC<QueryLogsProps> = ({ preset, onPresetConsumed }) => {
  const [activeTab, setActiveTab] = useState<'queries' | 'suspicious'>('queries');

  const { status: clusterStatus } = useClusterStatus();
  const readOnlyFollower = isReadOnlyFollower(clusterStatus);

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [clientFilter, setClientFilter] = useState<string>('ALL');

  const [pageSize, setPageSize] = useState<number>(100);
  const [page, setPage] = useState<number>(1);
  const [liveMode, setLiveMode] = useState(false);

  const [timeframeHours, setTimeframeHours] = useState<number>(24);

  const [rawQueries, setRawQueries] = useState<DnsQuery[]>([]);
  const [discoveredHostnamesByIp, setDiscoveredHostnamesByIp] = useState<Record<string, string>>({});

  const [serverQueryFilters, setServerQueryFilters] = useState<{ hours?: number; domain?: string; status?: string }>({});

  const serverFiltersActive = Boolean(serverQueryFilters.domain || serverQueryFilters.status);
  const serverFiltersLabel = useMemo(() => {
    if (!serverFiltersActive) return '';
    const parts: string[] = [];
    parts.push(`${timeframeHours}h`);
    if (typeof serverQueryFilters.domain === 'string' && serverQueryFilters.domain.trim()) {
      parts.push(`domain=${serverQueryFilters.domain.trim()}`);
    }
    if (typeof serverQueryFilters.status === 'string' && serverQueryFilters.status.trim()) {
      parts.push(`status=${serverQueryFilters.status.trim()}`);
    }
    return parts.length > 0 ? parts.join(' · ') : 'active';
  }, [serverFiltersActive, serverQueryFilters.domain, serverQueryFilters.status, timeframeHours]);

  const [ignoredAnomalySignatures, setIgnoredAnomalySignatures] = useState<string[]>([]);
  const [showIgnoredAnomalies, setShowIgnoredAnomalies] = useState(false);
  const [anomalySearchTerm, setAnomalySearchTerm] = useState('');

  const [selectedAnomaly, setSelectedAnomaly] = useState<Anomaly | null>(null);
  const [anomalyAnalysisResult, setAnomalyAnalysisResult] = useState<AnalysisResult | null>(null);
  const [isAnomalyAnalyzing, setIsAnomalyAnalyzing] = useState(false);
  
  const [selectedDomain, setSelectedDomain] = useState<DnsQuery | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const { addRule } = useRules();

  const [quickActionState, setQuickActionState] = useState<Record<string, 'idle' | 'saving' | 'ok' | 'err'>>({});

  const quickToggleRule = async (query: DnsQuery) => {
    if (readOnlyFollower) {
      setQuickActionState((s) => ({ ...s, [query.id]: 'err' }));
      window.setTimeout(() => {
        setQuickActionState((s) => ({ ...s, [query.id]: 'idle' }));
      }, 1200);
      return;
    }

    const domain = query.domain;
    if (!domain) return;

    setQuickActionState((s) => ({ ...s, [query.id]: 'saving' }));

    const isBlocked = query.status === QueryStatus.BLOCKED || query.status === QueryStatus.SHADOW_BLOCKED;
    const ruleType = isBlocked ? 'ALLOWED' : 'BLOCKED';
    const category = isBlocked ? 'Quick Permit' : 'Quick Block';
    try {
      await addRule(domain, ruleType as any, category);
      setQuickActionState((s) => ({ ...s, [query.id]: 'ok' }));
      window.setTimeout(() => {
        setQuickActionState((s) => ({ ...s, [query.id]: 'idle' }));
      }, 900);
    } catch {
      setQuickActionState((s) => ({ ...s, [query.id]: 'err' }));
      window.setTimeout(() => {
        setQuickActionState((s) => ({ ...s, [query.id]: 'idle' }));
      }, 1200);
    }
  };

  // Client Management Integration
  const { getClientByIp, addClient } = useClients();
  const [clientToAdd, setClientToAdd] = useState<{ip: string, name: string} | null>(null);
  const [newClientName, setNewClientName] = useState('');
  const [newClientType, setNewClientType] = useState('smartphone');

  const applyClientFilterFromQuery = useCallback(
    (q: DnsQuery) => {
      const ip = String((q as any)?.clientIp ?? '').trim();
      const label = String((q as any)?.client ?? '').trim();
      setClientFilter(ip || label || 'ALL');
    },
    []
  );

  const applyDomainFilterFromQuery = useCallback((q: DnsQuery) => {
    const d = String((q as any)?.domain ?? '').trim();
    if (!d) return;
    setSearchTerm(d);
  }, []);

  const queryLogsAbortRef = useRef<AbortController | null>(null);
  const discoveryAbortRef = useRef<AbortController | null>(null);

  const loadQueryLogs = useCallback(async () => {
    try {
      queryLogsAbortRef.current?.abort();
      const controller = new AbortController();
      queryLogsAbortRef.current = controller;

      const shouldUseServerFilters = Boolean(serverQueryFilters.domain || serverQueryFilters.status || serverQueryFilters.hours);
      const limit = shouldUseServerFilters ? 5000 : 500;

      const params = new URLSearchParams();
      params.set('limit', String(limit));
      if (typeof serverQueryFilters.hours === 'number' && Number.isFinite(serverQueryFilters.hours) && serverQueryFilters.hours > 0) {
        params.set('hours', String(serverQueryFilters.hours));
      }
      if (typeof serverQueryFilters.domain === 'string' && serverQueryFilters.domain.trim()) {
        params.set('domain', serverQueryFilters.domain.trim());
      }
      if (typeof serverQueryFilters.status === 'string' && serverQueryFilters.status.trim()) {
        params.set('status', serverQueryFilters.status.trim());
      }

      const res = await apiFetch(`/api/query-logs?${params.toString()}`, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const items = Array.isArray(data?.items) ? data.items : [];
      const mapped: DnsQuery[] = items
        .map((row: any) => row as Partial<DnsQuery>)
        .filter((q: any) => q && typeof q.id === 'string' && typeof q.domain === 'string')
        .map((q: any) => ({
          id: String(q.id),
          timestamp: typeof q.timestamp === 'string' ? q.timestamp : new Date().toISOString(),
          domain: String(q.domain),
          client: typeof q.client === 'string' ? q.client : 'Unknown',
          clientIp: typeof q.clientIp === 'string' ? q.clientIp : '',
          status:
            q.status === QueryStatus.BLOCKED ||
            q.status === QueryStatus.PERMITTED ||
            q.status === QueryStatus.SHADOW_BLOCKED ||
            q.status === QueryStatus.CACHED
              ? q.status
              : QueryStatus.PERMITTED,
          type: typeof q.type === 'string' ? q.type : 'A',
          durationMs: typeof q.durationMs === 'number' ? q.durationMs : 0,
          blocklistId: typeof q.blocklistId === 'string' ? q.blocklistId : undefined
        }));

      setRawQueries(mapped);
    } catch (err) {
      if ((err as any)?.name === 'AbortError') return;
      // Keep empty state if backend not reachable.
      setRawQueries([]);
    }
  }, [serverQueryFilters.domain, serverQueryFilters.hours, serverQueryFilters.status]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (cancelled) return;
      await loadQueryLogs();
    };

    void load();
    if (!liveMode) return () => {
      cancelled = true;
      queryLogsAbortRef.current?.abort();
    };

    const t = window.setInterval(load, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
      queryLogsAbortRef.current?.abort();
    };
  }, [liveMode, loadQueryLogs]);

  useEffect(() => {
    let cancelled = false;

    const loadDiscovery = async () => {
      try {
        discoveryAbortRef.current?.abort();
        const controller = new AbortController();
        discoveryAbortRef.current = controller;

        const res = await apiFetch('/api/discovery/clients', { signal: controller.signal });
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
      } catch (err) {
        if ((err as any)?.name === 'AbortError') return;
        // ignore
      }
    };

    void loadDiscovery();
    const t = window.setInterval(loadDiscovery, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
      discoveryAbortRef.current?.abort();
    };
  }, []);

  const resolveClientLabel = (clientIp: string, rawClient: string): string => {
    const known = clientIp ? getClientByIp(clientIp) : undefined;
    const knownName = known?.name ? String(known.name).trim() : '';
    if (knownName) return knownName;

    const discovered = clientIp ? discoveredHostnamesByIp[clientIp] : '';
    if (discovered) return discovered;

    const raw = String(rawClient ?? '').trim();
    if (raw && raw !== 'Unknown' && raw !== clientIp) return raw;
    if (clientIp) return clientIp;
    return 'Unknown';
  };

  const queries = useMemo(
    () =>
      rawQueries.map((q) => ({
        ...q,
        client: resolveClientLabel(q.clientIp, q.client)
      })),
    [rawQueries, discoveredHostnamesByIp, getClientByIp]
  );

  const loadIgnoredSignatures = () => {
    void (async () => {
      try {
        const res = await apiFetch('/api/suspicious/ignored');
        if (res.ok) {
          const data = await res.json();
          const items = Array.isArray((data as any)?.items) ? (data as any).items : [];
          setIgnoredAnomalySignatures(
            items
              .map((it: any) => String(it?.signature ?? '').trim())
              .filter((s: string) => Boolean(s))
          );
          return;
        }
      } catch {
        // ignore
      }

      // Fallback to legacy localStorage.
      try {
        const raw = localStorage.getItem(IGNORED_ANOMALY_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        if (Array.isArray(parsed)) {
          setIgnoredAnomalySignatures(parsed.filter((s) => typeof s === 'string'));
        }
      } catch {
        // ignore
      }
    })();
  };

  const migrateLegacyIgnoredSignatures = async () => {
    try {
      const raw = localStorage.getItem(IGNORED_ANOMALY_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed) || parsed.length === 0) return;

      const sigs = parsed.map((s: any) => (typeof s === 'string' ? s.trim() : '')).filter(Boolean);
      if (sigs.length === 0) return;

      for (const signature of sigs) {
        try {
          await apiFetch('/api/suspicious/ignored', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ signature })
          });
        } catch {
          // ignore
        }
      }

      localStorage.removeItem(IGNORED_ANOMALY_KEY);
    } catch {
      // ignore
    }
  };

  const ignoreSignature = async (signature: string) => {
    const sig = String(signature ?? '').trim();
    if (!sig) return;

    setIgnoredAnomalySignatures((prev) => Array.from(new Set([...prev, sig])));

    try {
      await apiFetch('/api/suspicious/ignored', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signature: sig })
      });
    } catch {
      // ignore
    }

    loadIgnoredSignatures();
    window.dispatchEvent(new CustomEvent('sentinel:ignored-anomalies'));
  };

  useEffect(() => {
    void (async () => {
      await migrateLegacyIgnoredSignatures();
      loadIgnoredSignatures();
    })();

    const onIgnored = () => loadIgnoredSignatures();

    window.addEventListener('sentinel:ignored-anomalies', onIgnored as any);
    return () => {
      window.removeEventListener('sentinel:ignored-anomalies', onIgnored as any);
    };
  }, []);

  useEffect(() => {
    if (!preset) return;
    if (typeof preset.searchTerm === 'string') setSearchTerm(preset.searchTerm);
    if (typeof preset.statusFilter === 'string') setStatusFilter(preset.statusFilter);
    if (typeof preset.typeFilter === 'string') setTypeFilter(preset.typeFilter);
    if (typeof preset.clientFilter === 'string') setClientFilter(preset.clientFilter);
    if (typeof preset.pageSize === 'number' && Number.isFinite(preset.pageSize) && preset.pageSize > 0) setPageSize(preset.pageSize);
    if (preset.tab === 'suspicious') setActiveTab('suspicious');
    else setActiveTab('queries');

    const nextHoursRaw =
      typeof preset.hours === 'number' && Number.isFinite(preset.hours) && preset.hours > 0 ? preset.hours : undefined;
    const nextHours = typeof nextHoursRaw === 'number' ? Math.min(168, nextHoursRaw) : undefined;
    const nextDomain = typeof preset.domainExact === 'string' ? preset.domainExact.trim() : '';
    const nextStatusRaw = typeof preset.statusFilter === 'string' ? preset.statusFilter.trim().toUpperCase() : '';
    const nextStatus =
      nextStatusRaw === 'BLOCKED' || nextStatusRaw === 'PERMITTED' || nextStatusRaw === 'SHADOW_BLOCKED' || nextStatusRaw === 'CACHED'
        ? nextStatusRaw
        : undefined;

    setServerQueryFilters({
      hours: nextHours,
      domain: nextDomain ? nextDomain : undefined,
      status: nextStatus
    });

    if (typeof nextHours === 'number') setTimeframeHours(nextHours);

    setPage(1);
    onPresetConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);

  useEffect(() => {
    // If the user changes the UI filters away from what the preset requested,
    // drop the server-side filters so the page behaves as expected.
    setServerQueryFilters((prev) => {
      const next: { hours?: number; domain?: string; status?: string } = { ...prev };
      const needle = searchTerm.trim();

      if (next.domain && needle !== next.domain) {
        next.domain = undefined;
      }
      if (next.status && statusFilter !== next.status) {
        next.status = undefined;
      }

      // Timeframe filter is independent and should persist.
      next.hours = Number.isFinite(timeframeHours) && timeframeHours > 0 ? Math.min(168, timeframeHours) : undefined;

      const changed = next.domain !== prev.domain || next.status !== prev.status || next.hours !== prev.hours;
      return changed ? next : prev;
    });
  }, [searchTerm, statusFilter, timeframeHours]);

  const anomalies = useMemo(() => {
    const all = detectAnomalies(queries, { limit: 0 });
    const visible = showIgnoredAnomalies
      ? all
      : all.filter((a) => !ignoredAnomalySignatures.includes(signatureForAnomaly(a)));

    const needle = anomalySearchTerm.trim().toLowerCase();
    if (!needle) return visible;

    return visible.filter((a) => {
      const hay = `${a.device} ${a.issue} ${a.domain ?? ''} ${a.detail}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [queries, showIgnoredAnomalies, ignoredAnomalySignatures, anomalySearchTerm]);

  const ignoredAnomaliesCount = useMemo(() => {
    const all = detectAnomalies(queries, { limit: 0 });
    return all.filter((a) => ignoredAnomalySignatures.includes(signatureForAnomaly(a))).length;
  }, [queries, ignoredAnomalySignatures]);

  // Extract Unique Clients from logs for the dropdown
  const uniqueClients = useMemo(
    () => Array.from(new Set(queries.map(q => q.client).filter((c): c is string => typeof c === 'string' && c.length > 0))),
    [queries]
  );

  const handleAnalyze = async (query: DnsQuery) => {
    setSelectedDomain(query);
    setIsAnalyzing(true);
    setAnalysisResult(null); 
    
    try {
      const rawText = await analyzeDomain(query.domain);
      
      // Parsing Logic (Consistent with Blocking.tsx)
      const parseSection = (header: string, nextHeader?: string) => {
        const parts = rawText.split(header);
        if (parts.length < 2) return 'Unknown';
        const content = parts[1];
        if (nextHeader) {
          return content.split(nextHeader)[0].trim();
        }
        return content.trim();
      };

      const category = parseSection('[CATEGORY]', '[PURPOSE]');
      const purpose = parseSection('[PURPOSE]', '[BLOCKING IMPACT]');
      const impact = parseSection('[BLOCKING IMPACT]');

      setAnalysisResult({ category, purpose, impact });
    } catch (e) {
      console.error(e);
      setAnalysisResult({ category: 'Error', purpose: 'Could not analyze domain.', impact: 'Unknown' });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleInvestigateAnomaly = (a: Anomaly) => {
    setSelectedAnomaly(a);
    setAnomalyAnalysisResult(null);
    setIsAnomalyAnalyzing(false);
  };

  const runAnomalyAiAnalysis = async () => {
    if (!selectedAnomaly) return;
    const domain = selectedAnomaly.domain || extractDomain(selectedAnomaly.detail);
    if (!domain) {
      setAnomalyAnalysisResult({ category: 'Unknown', purpose: 'Could not extract a domain from this event.', impact: 'Unknown' });
      return;
    }

    setIsAnomalyAnalyzing(true);
    setAnomalyAnalysisResult(null);

    try {
      const rawText = await analyzeDomain(domain);

      const parseSection = (header: string, nextHeader?: string) => {
        const parts = rawText.split(header);
        if (parts.length < 2) return 'Unknown';
        const content = parts[1];
        if (nextHeader) return content.split(nextHeader)[0].trim();
        return content.trim();
      };

      const category = parseSection('[CATEGORY]', '[PURPOSE]');
      const purpose = parseSection('[PURPOSE]', '[BLOCKING IMPACT]');
      const impact = parseSection('[BLOCKING IMPACT]');

      setAnomalyAnalysisResult({ category, purpose, impact });
    } catch {
      setAnomalyAnalysisResult({ category: 'Error', purpose: 'Could not analyze domain.', impact: 'Unknown' });
    } finally {
      setIsAnomalyAnalyzing(false);
    }
  };

  const ignoreSelectedAnomaly = async () => {
    if (!selectedAnomaly) return;
    const sig = signatureForAnomaly(selectedAnomaly);
    await ignoreSignature(sig);
    setSelectedAnomaly(null);
  };

  const blockFromSelectedAnomaly = async () => {
    if (!selectedAnomaly) return;
    if (readOnlyFollower) return;
    const domain = selectedAnomaly.domain || extractDomain(selectedAnomaly.detail);
    if (!domain) return;
    const category = anomalyAnalysisResult?.category || 'Security Threat';
    await addRule(domain, 'BLOCKED' as any, category);
    setSelectedAnomaly(null);
  };

  const openSelectedAnomalyInQueries = () => {
    if (!selectedAnomaly) return;
    const domain = selectedAnomaly.domain || extractDomain(selectedAnomaly.detail) || '';
    setActiveTab('queries');
    setSearchTerm(domain);
    setStatusFilter('ALL');
    setTypeFilter('ALL');
    setClientFilter(selectedAnomaly.device || 'ALL');
    setPage(1);
    setSelectedAnomaly(null);
  };

  const openAnomalyInQueries = (a: Anomaly) => {
    const domain = a.domain || extractDomain(a.detail) || '';
    setActiveTab('queries');
    setSearchTerm(domain);
    setStatusFilter('ALL');
    setTypeFilter('ALL');
    setClientFilter(a.device || 'ALL');
    setPage(1);
  };

  const ignoreAnomaly = (a: Anomaly) => {
    void ignoreSignature(signatureForAnomaly(a));
  };

  const getRiskBadge = (risk: Anomaly['risk']) => {
    const base = 'text-[10px] font-bold px-2 py-0.5 rounded border uppercase font-mono';
    if (risk === 'critical') return <span className={`${base} text-rose-400 border-rose-900/50 bg-rose-950/30`}>CRITICAL</span>;
    if (risk === 'high') return <span className={`${base} text-amber-400 border-amber-900/50 bg-amber-950/30`}>HIGH</span>;
    if (risk === 'medium') return <span className={`${base} text-sky-400 border-sky-900/50 bg-sky-950/30`}>MEDIUM</span>;
    return <span className={`${base} text-zinc-400 border-zinc-700 bg-zinc-800`}>LOW</span>;
  };

  const handleAction = (action: 'BLOCK' | 'WHITELIST') => {
      if (!selectedDomain) return;
      if (readOnlyFollower) return;
      
      const category = analysisResult?.category || 'Manual Log Action';
      addRule(selectedDomain.domain, action === 'BLOCK' ? 'BLOCKED' : 'ALLOWED', category);
      
      // Close modal
      setSelectedDomain(null);
  };

  const handleAddClientClick = (ip: string, suggestedName: string) => {
      setClientToAdd({ ip, name: suggestedName });
      setNewClientName(suggestedName);
  };

  // Modal.tsx handles Escape/backdrop closing per modal.

  const saveNewClient = () => {
      if(!clientToAdd) return;
      if (readOnlyFollower) return;
      const newProfile: ClientProfile = {
          id: Date.now().toString(),
          name: newClientName,
          ip: clientToAdd.ip,
          type: newClientType as any,
          status: 'online',
          policy: 'Standard',
          safeSearch: false,
          assignedBlocklists: [],
          useGlobalSettings: true,
          isInternetPaused: false,
          blockedCategories: [],
          blockedApps: [],
          schedules: []
      };
      addClient(newProfile);
      setClientToAdd(null);
  };

  const getCategoryColor = (cat: string) => {
    const lower = cat.toLowerCase();
    if (lower.includes('malware') || lower.includes('ad')) return 'text-rose-400 border-rose-900/50 bg-rose-950/30';
    if (lower.includes('telemetry')) return 'text-orange-400 border-orange-900/50 bg-orange-950/30';
    if (lower.includes('os') || lower.includes('cdn') || lower.includes('social')) return 'text-emerald-400 border-emerald-900/50 bg-emerald-950/30';
    return 'text-zinc-400 border-zinc-700 bg-zinc-800';
  };

  const getBlocklistName = (id?: string) => {
    if (!id) return 'Custom Rule';
    // Server logs `rule.category` as the "blocklistId" for now.
    // Format: "Blocklist:<id>:<name>".
    if (id.startsWith('Blocklist:')) {
      const parts = id.split(':');
      if (parts.length >= 3) return parts.slice(2).join(':') || 'Blocklist';
      return 'Blocklist';
    }
    return id;
  };

  const getStatusBadge = (query: DnsQuery) => {
    switch (query.status) {
      case QueryStatus.BLOCKED:
        return (
          <div className="flex items-center gap-2 group/badge relative">
             <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-rose-950/30 text-rose-500 border border-rose-900/50 uppercase tracking-wide cursor-help">
               BLOCKED
             </span>
             {query.blocklistId && (
               <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                  <Shield className="w-3 h-3 text-zinc-600" />
                  <span className="hidden sm:inline-block max-w-[100px] truncate">{getBlocklistName(query.blocklistId)}</span>
               </div>
             )}
          </div>
        );
      case QueryStatus.SHADOW_BLOCKED:
        return (
          <div className="flex items-center gap-2 group/badge relative">
             <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-950/30 text-amber-500 border border-amber-900/50 uppercase tracking-wide cursor-help">
               <Eye className="w-3 h-3" /> SHADOW
             </span>
             {query.blocklistId && (
               <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                  <span className="hidden sm:inline-block max-w-[100px] truncate">{getBlocklistName(query.blocklistId)}</span>
               </div>
             )}
          </div>
        );
      case QueryStatus.PERMITTED:
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950/30 text-emerald-500 border border-emerald-900/50 uppercase tracking-wide">PERMITTED</span>;
      case QueryStatus.CACHED:
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-zinc-800 text-zinc-400 border border-zinc-700 uppercase tracking-wide">CACHED</span>;
    }
  };

    const filteredQueries = queries.filter(q => {
      const needle = searchTerm.toLowerCase();
      const clientIp = String((q as any).clientIp ?? '');

      const matchesSearch =
        q.domain.toLowerCase().includes(needle) ||
        q.client.toLowerCase().includes(needle) ||
        clientIp.toLowerCase().includes(needle);

      const matchesStatus =
        statusFilter === 'ALL' ||
        q.status === statusFilter ||
        (statusFilter === QueryStatus.BLOCKED && q.status === QueryStatus.SHADOW_BLOCKED);
      const matchesType = typeFilter === 'ALL' || q.type === typeFilter;

      const matchesClient =
        clientFilter === 'ALL' ||
        q.client === clientFilter ||
        (clientIp.length > 0 && clientIp === clientFilter);

      return matchesSearch && matchesStatus && matchesType && matchesClient;
  });

  // Reset to first page when filters change.
  useEffect(() => {
    setPage(1);
  }, [searchTerm, statusFilter, typeFilter, clientFilter, pageSize]);

  const clearFilters = () => {
    setSearchTerm('');
    setStatusFilter('ALL');
    setTypeFilter('ALL');
    setClientFilter('ALL');
    setPageSize(100);
    setServerQueryFilters({});
    setTimeframeHours(24);
  };

  const pageCount = useMemo(() => {
    return Math.max(1, Math.ceil(filteredQueries.length / Math.max(1, pageSize)));
  }, [filteredQueries.length, pageSize]);

  const currentPage = Math.min(Math.max(1, page), pageCount);
  const pagedQueries = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    const end = start + pageSize;
    return filteredQueries.slice(start, end);
  }, [filteredQueries, currentPage, pageSize]);

  // Smooth live updates: animate rows shifting down when new items arrive.
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());
  const prevRowTopsRef = useRef<Map<string, number>>(new Map());
  const prevRowIdsRef = useRef<string[]>([]);

  const setRowRef = useCallback(
    (id: string) => (el: HTMLTableRowElement | null) => {
      if (el) rowRefs.current.set(id, el);
      else rowRefs.current.delete(id);
    },
    []
  );

  useLayoutEffect(() => {
    if (activeTab !== 'queries') return;
    if (!liveMode) return;
    if (currentPage !== 1) return;
    if (typeof window === 'undefined') return;

    const reduceMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) return;

    const nextIds = pagedQueries.map((q) => q.id);
    const prevIds = prevRowIdsRef.current;

    // Only animate when the top row changes (i.e. new live entries arrived).
    if (prevIds.length > 0 && nextIds.length > 0 && nextIds[0] === prevIds[0]) {
      // Still refresh cached positions for the next diff.
      const refreshed = new Map<string, number>();
      for (const [id, el] of rowRefs.current.entries()) {
        if (!el) continue;
        refreshed.set(id, el.getBoundingClientRect().top);
      }
      prevRowTopsRef.current = refreshed;
      prevRowIdsRef.current = nextIds;
      return;
    }

    const prevTops = prevRowTopsRef.current;
    const nextTops = new Map<string, number>();
    for (const [id, el] of rowRefs.current.entries()) {
      if (!el) continue;
      nextTops.set(id, el.getBoundingClientRect().top);
    }

    // Cap work to avoid excessive animations on very large pages.
    const maxAnimated = 120;
    let animated = 0;
    for (const id of nextIds) {
      const el = rowRefs.current.get(id);
      if (!el) continue;
      if (animated >= maxAnimated) break;
      animated += 1;

      const prevTop = prevTops.get(id);
      const nextTop = nextTops.get(id);
      if (nextTop == null) continue;

      const animate = (keyframes: Keyframe[], options: KeyframeAnimationOptions) => {
        const fn = (el as any).animate;
        if (typeof fn !== 'function') return;
        try {
          fn.call(el, keyframes, options);
        } catch {
          // ignore
        }
      };

      if (prevTop == null) {
        // New row: glide in from above.
        animate(
          [{ opacity: 0, transform: 'translateY(-12px)' }, { opacity: 1, transform: 'translateY(0px)' }],
          { duration: 180, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'both' }
        );
        continue;
      }

      const delta = prevTop - nextTop;
      if (!Number.isFinite(delta) || Math.abs(delta) < 1) continue;
      animate(
        [{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0px)' }],
        { duration: 180, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'both' }
      );
    }

    prevRowTopsRef.current = nextTops;
    prevRowIdsRef.current = nextIds;
  }, [activeTab, liveMode, currentPage, pagedQueries]);

  return (
    <div className="space-y-4 animate-fade-in">
      <ReadOnlyFollowerBanner
        show={readOnlyFollower}
        title="Failover node · limited actions"
        subtitle="Rules and clients are read-only on this node. Query logs and operational actions (flush / ignore suspicious items) still work."
        className="mb-2"
      />
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row justify-between gap-4 items-end">
        <div>
           <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
             <Terminal className="w-5 h-5 text-zinc-500" /> Query Log
           </h2>

           {/* Tabs (match Filtering page submenus) */}
           <div className="border-b border-[#27272a] flex gap-1 mt-3">
             {[{ id: 'queries', label: 'Queries', icon: Terminal }, { id: 'suspicious', label: 'Suspicious Activity', icon: Zap }].map(
               (tab) => (
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
               )
             )}
           </div>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          {activeTab === 'queries' ? (
          <>
            {serverFiltersActive ? (
              <button
                type="button"
                onClick={() => setServerQueryFilters((prev) => ({ ...prev, domain: undefined, status: undefined }))}
                className="px-3 py-1.5 rounded text-xs font-bold border bg-emerald-950/20 border-emerald-900/50 text-emerald-300 hover:bg-emerald-950/30 inline-flex items-center gap-2"
                title="Server-side filters are active (click to clear)"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                Server: {serverFiltersLabel}
                <X className="w-3.5 h-3.5 opacity-70" />
              </button>
            ) : null}

            {/* Status Filter */}
            <div className="relative">
              <select 
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="appearance-none bg-[#18181b] border border-[#27272a] text-zinc-300 pl-3 pr-8 py-1.5 rounded text-xs font-mono focus:outline-none focus:border-zinc-500 cursor-pointer hover:bg-[#27272a]"
              >
                <option value="ALL">All Status</option>
                <option value="BLOCKED">Blocked</option>
                <option value="PERMITTED">Permitted</option>
                <option value="SHADOW_BLOCKED">Shadow (Testing)</option>
                <option value="CACHED">Cached</option>
              </select>
              <ChevronDown className="w-3 h-3 text-zinc-500 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>

            {/* Type Filter */}
            <div className="relative">
              <select 
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="appearance-none bg-[#18181b] border border-[#27272a] text-zinc-300 pl-3 pr-8 py-1.5 rounded text-xs font-mono focus:outline-none focus:border-zinc-500 cursor-pointer hover:bg-[#27272a]"
              >
                <option value="ALL">All Types</option>
                <option value="A">A (IPv4)</option>
                <option value="AAAA">AAAA (IPv6)</option>
                <option value="HTTPS">HTTPS</option>
              </select>
              <ChevronDown className="w-3 h-3 text-zinc-500 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>

            {/* Client Filter (New) */}
            <div className="relative">
              <select 
                value={clientFilter}
                onChange={(e) => setClientFilter(e.target.value)}
                className="appearance-none bg-[#18181b] border border-[#27272a] text-zinc-300 pl-3 pr-8 py-1.5 rounded text-xs font-mono focus:outline-none focus:border-zinc-500 cursor-pointer hover:bg-[#27272a]"
              >
                <option value="ALL">All Clients</option>
                {uniqueClients.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <ChevronDown className="w-3 h-3 text-zinc-500 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>

            <div className="h-6 w-px bg-[#27272a] mx-1 hidden sm:block"></div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
              <input 
              type="text" 
              placeholder="Filter log output..."
              className="bg-[#18181b] border border-[#27272a] text-zinc-300 pl-9 pr-4 py-1.5 rounded text-xs font-mono focus:outline-none focus:border-zinc-500 w-48 sm:w-64 placeholder:text-zinc-600"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            <button
              onClick={clearFilters}
              className="px-3 py-1.5 rounded text-xs font-bold border bg-[#18181b] border-[#27272a] text-zinc-300 hover:bg-[#27272a]"
              title="Clear all filters"
            >
              Clear Filters
            </button>

            <div className="relative">
              <select
                value={String(timeframeHours)}
                onChange={(e) => {
                  const n = Number(String(e.target.value || '').trim());
                  setTimeframeHours(Number.isFinite(n) && n > 0 ? Math.min(168, n) : 24);
                }}
                className="appearance-none bg-[#18181b] border border-[#27272a] text-zinc-300 pl-3 pr-8 py-1.5 rounded text-xs font-mono focus:outline-none focus:border-zinc-500 cursor-pointer hover:bg-[#27272a]"
                title="Limit query logs to a timeframe (server-side)"
                aria-label="Timeframe"
              >
                <option value="1">1h</option>
                <option value="6">6h</option>
                <option value="24">24h</option>
                <option value="168">7d</option>
              </select>
              <ChevronDown className="w-3 h-3 text-zinc-500 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>

            <button
              onClick={() => setLiveMode((v) => !v)}
              className={`px-3 py-1.5 rounded text-xs font-bold border ${
                liveMode
                  ? 'bg-emerald-950/30 border-emerald-800 text-emerald-400'
                  : 'bg-[#18181b] border-[#27272a] text-zinc-300 hover:bg-[#27272a]'
              }`}
              title={liveMode ? 'Live updates enabled' : 'Enable live updates'}
            >
              {liveMode ? 'Live: On' : 'Live: Off'}
            </button>
          </>
          ) : (
            <>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
                <input
                  type="text"
                  placeholder="Search anomalies..."
                  className="bg-[#18181b] border border-[#27272a] text-zinc-300 pl-9 pr-4 py-1.5 rounded text-xs font-mono focus:outline-none focus:border-zinc-500 w-48 sm:w-64 placeholder:text-zinc-600"
                  value={anomalySearchTerm}
                  onChange={(e) => setAnomalySearchTerm(e.target.value)}
                />
              </div>

              <button
                onClick={() => setShowIgnoredAnomalies((v) => !v)}
                className="px-3 py-1.5 rounded text-xs font-bold border bg-[#18181b] border-[#27272a] text-zinc-300 hover:bg-[#27272a] inline-flex items-center gap-2"
                title={showIgnoredAnomalies ? 'Hide ignored anomalies' : 'Show ignored anomalies'}
              >
                {showIgnoredAnomalies ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                {showIgnoredAnomalies ? 'Hide ignored' : 'Show ignored'}
                {ignoredAnomaliesCount > 0 && (
                  <span className="text-[10px] font-mono text-zinc-500">({ignoredAnomaliesCount})</span>
                )}
              </button>
            </>
          )}
        </div>
      </div>

      {activeTab === 'queries' ? (
        <>
          {/* Table */}
          <div className="dashboard-card rounded-lg overflow-hidden border border-[#27272a]">
            <div className="px-4 py-2 border-b border-[#27272a] bg-[#121214] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div className="text-[10px] font-mono text-zinc-500">
                Showing{' '}
                {filteredQueries.length === 0
                  ? '0'
                  : `${(currentPage - 1) * pageSize + 1}-${Math.min(currentPage * pageSize, filteredQueries.length)}`}
                {' '}of {filteredQueries.length}
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value) || 100)}
                  className="appearance-none bg-[#18181b] border border-[#27272a] text-zinc-300 pl-3 pr-8 py-1.5 rounded text-xs font-mono focus:outline-none focus:border-zinc-500 cursor-pointer hover:bg-[#27272a]"
                  aria-label="Rows per page"
                >
                  <option value={50}>50 / page</option>
                  <option value={100}>100 / page</option>
                  <option value={200}>200 / page</option>
                </select>

                <div className="h-6 w-px bg-[#27272a] mx-1 hidden sm:block"></div>

                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                  className={`px-3 py-1.5 rounded text-xs font-bold border bg-[#18181b] border-[#27272a] ${currentPage <= 1 ? 'text-zinc-600 cursor-not-allowed' : 'text-zinc-300 hover:bg-[#27272a]'}`}
                >
                  Prev
                </button>
                <div className="text-[10px] font-mono text-zinc-500">
                  Page {currentPage} / {pageCount}
                </div>
                <button
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  disabled={currentPage >= pageCount}
                  className={`px-3 py-1.5 rounded text-xs font-bold border bg-[#18181b] border-[#27272a] ${currentPage >= pageCount ? 'text-zinc-600 cursor-not-allowed' : 'text-zinc-300 hover:bg-[#27272a]'}`}
                >
                  Next
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#121214] border-b border-[#27272a]">
                    <th className="p-3 pl-4 text-[10px] font-bold text-zinc-500 uppercase tracking-wider font-mono">Time</th>
                    <th className="p-3 text-[10px] font-bold text-zinc-500 uppercase tracking-wider font-mono">Status</th>
                    <th className="p-3 text-[10px] font-bold text-zinc-500 uppercase tracking-wider font-mono">Domain</th>
                    <th className="p-3 text-[10px] font-bold text-zinc-500 uppercase tracking-wider font-mono">Client</th>
                    <th className="p-3 text-[10px] font-bold text-zinc-500 uppercase tracking-wider font-mono">Type</th>
                    <th className="p-3 text-[10px] font-bold text-zinc-500 uppercase tracking-wider font-mono text-right pr-4">Analysis</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#27272a] bg-[#18181b]">
                  {pagedQueries.length > 0 ? (
                    pagedQueries.map((query) => {
                      const isKnown = !!getClientByIp(query.clientIp);
                      return (
                        <tr ref={setRowRef(query.id)} key={query.id} className="hover:bg-[#27272a]/40 transition-colors group">
                          <td className="p-3 pl-4 text-xs text-zinc-400 font-mono">{query.timestamp}</td>
                          <td className="p-3">{getStatusBadge(query)}</td>
                          <td className="p-3 text-sm font-mono tracking-tight">
                            <button
                              type="button"
                              onClick={() => applyDomainFilterFromQuery(query)}
                              className="text-zinc-200 hover:text-white hover:underline decoration-zinc-600 underline-offset-2 text-left"
                              title="Filter query log by this domain"
                            >
                              {query.domain}
                            </button>
                          </td>
                          <td className="p-3 text-xs text-zinc-400 font-mono">
                            <div className="flex items-center justify-between gap-4">
                              <button
                                type="button"
                                onClick={() => applyClientFilterFromQuery(query)}
                                className="flex flex-col text-left hover:underline decoration-zinc-600 underline-offset-2"
                                title="Filter query log by this client"
                              >
                                <span className="text-zinc-300">{query.client}</span>
                                <span className="text-[10px] text-zinc-600">{query.clientIp}</span>
                              </button>
                              {!isKnown && (
                                <button
                                  onClick={() => handleAddClientClick(query.clientIp, query.client)}
                                  disabled={readOnlyFollower}
                                  className="p-1.5 rounded bg-zinc-800 text-zinc-400 hover:text-emerald-400 hover:bg-emerald-950/20 border border-zinc-700 hover:border-emerald-500/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:text-zinc-400 disabled:hover:bg-zinc-800 disabled:hover:border-zinc-700"
                                  title="Add to Known Clients"
                                >
                                  <UserPlus className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                          <td className="p-3 text-xs text-zinc-500 font-mono">{query.type}</td>
                          <td className="p-3 text-right pr-4">
                            <div className="inline-flex items-center gap-2">
                              <button
                                onClick={() => quickToggleRule(query)}
                                disabled={quickActionState[query.id] === 'saving' || readOnlyFollower}
                                className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border transition-all text-[10px] font-bold font-mono ${
                                  query.status === QueryStatus.BLOCKED || query.status === QueryStatus.SHADOW_BLOCKED
                                    ? 'bg-emerald-950/20 text-emerald-300 border-emerald-800 hover:bg-emerald-500 hover:text-black hover:border-emerald-500'
                                    : 'bg-rose-950/20 text-rose-300 border-rose-800 hover:bg-rose-500 hover:text-black hover:border-rose-500'
                                } ${quickActionState[query.id] === 'saving' ? 'opacity-70 cursor-wait' : ''} ${readOnlyFollower ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''}`}
                                title={
                                  query.status === QueryStatus.BLOCKED || query.status === QueryStatus.SHADOW_BLOCKED
                                    ? 'Permit this domain (override blocklists)'
                                    : 'Block this domain'
                                }
                              >
                                {quickActionState[query.id] === 'saving' ? (
                                  <div className="w-3 h-3 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                                ) : quickActionState[query.id] === 'ok' ? (
                                  <Check className="w-3 h-3" />
                                ) : quickActionState[query.id] === 'err' ? (
                                  <AlertOctagon className="w-3 h-3" />
                                ) : query.status === QueryStatus.BLOCKED || query.status === QueryStatus.SHADOW_BLOCKED ? (
                                  <ShieldOff className="w-3 h-3" />
                                ) : (
                                  <Ban className="w-3 h-3" />
                                )}

                                {quickActionState[query.id] === 'saving'
                                  ? 'SAVING'
                                  : quickActionState[query.id] === 'ok'
                                    ? 'OK'
                                    : quickActionState[query.id] === 'err'
                                      ? 'ERROR'
                                      : query.status === QueryStatus.BLOCKED || query.status === QueryStatus.SHADOW_BLOCKED
                                        ? 'PERMIT'
                                        : 'BLOCK'}
                              </button>

                              <button
                                onClick={() => handleAnalyze(query)}
                                className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-zinc-800 text-zinc-300 hover:bg-white hover:text-black transition-all text-[10px] font-bold font-mono border border-zinc-700 hover:border-white"
                              >
                                <Sparkles className="w-3 h-3" />
                                INSIGHT
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-zinc-500 text-xs font-mono">
                        No queries match your filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <div className="dashboard-card rounded-lg overflow-hidden border border-[#27272a]">
          <div className="px-4 py-2 border-b border-[#27272a] bg-[#121214] flex items-center justify-between gap-3">
            <div className="text-[10px] font-mono text-zinc-500">
              Showing {anomalies.length} event{anomalies.length === 1 ? '' : 's'}
              {showIgnoredAnomalies ? '' : ignoredAnomaliesCount > 0 ? ` (${ignoredAnomaliesCount} ignored hidden)` : ''}
            </div>
            <div className="text-[10px] font-mono text-zinc-600">
              Derived from last 500 queries
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#121214] border-b border-[#27272a]">
                  <th className="p-3 pl-4 text-[10px] font-bold text-zinc-500 uppercase tracking-wider font-mono">Time</th>
                  <th className="p-3 text-[10px] font-bold text-zinc-500 uppercase tracking-wider font-mono">Risk</th>
                  <th className="p-3 text-[10px] font-bold text-zinc-500 uppercase tracking-wider font-mono">Issue</th>
                  <th className="p-3 text-[10px] font-bold text-zinc-500 uppercase tracking-wider font-mono">Device</th>
                  <th className="p-3 text-[10px] font-bold text-zinc-500 uppercase tracking-wider font-mono">Domain</th>
                  <th className="p-3 text-[10px] font-bold text-zinc-500 uppercase tracking-wider font-mono">Confidence</th>
                  <th className="p-3 text-[10px] font-bold text-zinc-500 uppercase tracking-wider font-mono text-right pr-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#27272a]">
                {anomalies.length > 0 ? (
                  anomalies.map((a) => {
                    const domain = a.domain || extractDomain(a.detail) || '';
                    const conf = typeof a.confidence === 'number' ? `${Math.round(a.confidence * 100)}%` : '—';
                    const isIgnored = ignoredAnomalySignatures.includes(signatureForAnomaly(a));

                    return (
                      <tr key={a.id} className="hover:bg-[#27272a]/40 transition-colors group">
                        <td className="p-3 pl-4 text-xs text-zinc-400 font-mono">{a.timestamp}</td>
                        <td className="p-3">{getRiskBadge(a.risk)}</td>
                        <td className="p-3 text-sm text-zinc-200 font-mono tracking-tight">{a.issue}</td>
                        <td className="p-3 text-xs text-zinc-400 font-mono">
                          <div className="flex flex-col">
                            <span className="text-zinc-300">{a.device || 'Unknown'}</span>
                            {a.clientIp ? <span className="text-[10px] text-zinc-600">{a.clientIp}</span> : null}
                          </div>
                        </td>
                        <td className="p-3 text-xs text-zinc-500 font-mono">{domain || '—'}</td>
                        <td className="p-3 text-xs text-zinc-500 font-mono">{conf}</td>
                        <td className="p-3 text-right pr-4">
                          <div className="inline-flex items-center gap-2">
                            <button
                              onClick={() => handleInvestigateAnomaly(a)}
                              className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-zinc-800 text-zinc-300 hover:bg-white hover:text-black transition-all text-[10px] font-bold font-mono border border-zinc-700 hover:border-white"
                              title="View details"
                            >
                              <AlertTriangle className="w-3 h-3" />
                              DETAILS
                            </button>

                            <button
                              onClick={() => openAnomalyInQueries(a)}
                              className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-[#27272a] bg-[#18181b] text-zinc-300 hover:bg-[#27272a] transition-all text-[10px] font-bold font-mono"
                              title="Apply filters and jump to queries"
                            >
                              <Terminal className="w-3 h-3" />
                              OPEN
                            </button>

                            <button
                              onClick={() => ignoreAnomaly(a)}
                              disabled={isIgnored}
                              className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border transition-all text-[10px] font-bold font-mono ${isIgnored ? 'border-zinc-800 bg-zinc-900 text-zinc-600 cursor-not-allowed' : 'border-[#27272a] bg-[#18181b] text-zinc-300 hover:bg-[#27272a]'}`}
                              title={isIgnored ? 'Already ignored' : 'Ignore this signature'}
                            >
                              <EyeOff className="w-3 h-3" />
                              IGNORE
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={7} className="p-10 text-center text-zinc-500 text-xs font-mono">
                      No suspicious activity detected.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal open={!!clientToAdd} onClose={() => setClientToAdd(null)}>
        {clientToAdd ? (
          <ModalCard className="max-w-sm">
            <ModalHeader
              title="Register New Device"
              icon={<UserPlus className="w-5 h-5 text-emerald-300" />}
              iconContainerClassName="bg-emerald-500/10 border-emerald-500/20"
              onClose={() => setClientToAdd(null)}
            />

            <div className="p-6 space-y-4">
              <div className="bg-[#18181b] border border-[#27272a] rounded p-3 flex items-center gap-3">
                <Info className="w-4 h-4 text-zinc-500" />
                <div>
                  <div className="text-[10px] text-zinc-500 uppercase font-bold">Detected Identifier (IP)</div>
                  <div className="text-sm font-mono text-zinc-200">{clientToAdd.ip}</div>
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold text-zinc-500 uppercase mb-1 block">Friendly Name</label>
                <input
                  type="text"
                  placeholder="e.g. Sarah's iPhone"
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  className="w-full bg-[#09090b] border border-[#27272a] text-white px-3 py-2 rounded text-xs focus:border-emerald-500 outline-none placeholder:text-zinc-700"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-zinc-500 uppercase mb-1 block">Device Type</label>
                <div className="grid grid-cols-4 gap-2">
                  {['smartphone', 'laptop', 'tv', 'game'].map((type) => (
                    <div
                      key={type}
                      onClick={() => setNewClientType(type)}
                      className={`p-2 rounded border cursor-pointer flex justify-center items-center transition-colors ${newClientType === type ? 'bg-emerald-950/30 border-emerald-500 text-emerald-500' : 'bg-[#18181b] border-[#27272a] text-zinc-500 hover:border-zinc-500'}`}
                    >
                      {type === 'smartphone' && <Smartphone className="w-4 h-4" />}
                      {type === 'laptop' && <Laptop className="w-4 h-4" />}
                      {type === 'tv' && <Tv className="w-4 h-4" />}
                      {type === 'game' && <Gamepad2 className="w-4 h-4" />}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <ModalFooter>
              <button
                onClick={() => setClientToAdd(null)}
                className="px-4 py-2 rounded border border-[#27272a] text-zinc-300 hover:bg-[#27272a] transition-all text-xs font-bold"
              >
                CANCEL
              </button>
              <button
                onClick={saveNewClient}
                disabled={readOnlyFollower}
                className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white transition-all text-xs font-bold flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-emerald-600"
              >
                <Save className="w-3.5 h-3.5" /> SAVE DEVICE
              </button>
            </ModalFooter>
          </ModalCard>
        ) : null}
      </Modal>

      <Modal open={!!selectedAnomaly} onClose={() => setSelectedAnomaly(null)}>
        {selectedAnomaly ? (
          <ModalCard className="max-w-lg">
            <ModalHeader
              title="Suspicious Activity"
              titleRight={getRiskBadge(selectedAnomaly.risk)}
              subtitle={selectedAnomaly.issue}
              subtitleClassName="text-zinc-300 font-mono text-xs mt-0.5"
              icon={<Zap className="w-5 h-5 text-amber-400" />}
              iconContainerClassName="bg-amber-500/10 border-amber-500/20"
              onClose={() => setSelectedAnomaly(null)}
            />

            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between p-3 rounded bg-[#18181b] border border-[#27272a]">
                <div className="text-xs font-mono text-zinc-500">Device</div>
                <div className="text-xs font-mono text-zinc-200">{selectedAnomaly.device || 'Unknown'}{selectedAnomaly.clientIp ? ` (${selectedAnomaly.clientIp})` : ''}</div>
              </div>

              <div className="p-3 rounded bg-[#18181b] border border-[#27272a]">
                <div className="text-[10px] font-bold text-zinc-500 uppercase mb-2">Details</div>
                <div className="text-sm text-zinc-200 leading-relaxed">{selectedAnomaly.detail}</div>
              </div>

              {Array.isArray(selectedAnomaly.reasons) && selectedAnomaly.reasons.length > 0 && (
                <div className="p-3 rounded bg-[#18181b] border border-[#27272a]">
                  <div className="text-[10px] font-bold text-zinc-500 uppercase mb-2">Reasons</div>
                  <div className="space-y-1">
                    {selectedAnomaly.reasons.map((r, idx) => (
                      <div key={idx} className="text-xs text-zinc-300 font-mono">- {r}</div>
                    ))}
                  </div>
                </div>
              )}

              {Array.isArray(selectedAnomaly.relatedDomains) && selectedAnomaly.relatedDomains.length > 0 && (
                <div className="p-3 rounded bg-[#18181b] border border-[#27272a]">
                  <div className="text-[10px] font-bold text-zinc-500 uppercase mb-2">Related Domains</div>
                  <div className="space-y-1">
                    {selectedAnomaly.relatedDomains.map((d) => (
                      <div key={d.domain} className="flex items-center justify-between text-xs font-mono">
                        <span className="text-zinc-300 truncate">{d.domain}</span>
                        <span className="text-zinc-500">{d.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="p-3 rounded bg-[#18181b] border border-[#27272a]">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] font-bold text-zinc-500 uppercase">AI Analysis</div>
                  <button
                    onClick={runAnomalyAiAnalysis}
                    disabled={isAnomalyAnalyzing}
                    className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border transition-all text-[10px] font-bold font-mono ${isAnomalyAnalyzing ? 'opacity-70 cursor-wait border-zinc-700 bg-zinc-900 text-zinc-400' : 'border-[#27272a] bg-[#121214] text-zinc-300 hover:bg-[#27272a]'}`}
                  >
                    <Sparkles className="w-3 h-3" />
                    {isAnomalyAnalyzing ? 'ANALYZING' : 'RUN'}
                  </button>
                </div>

                {anomalyAnalysisResult ? (
                  <div className="mt-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-zinc-500 uppercase">Category</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase ${getCategoryColor(anomalyAnalysisResult.category)}`}>{anomalyAnalysisResult.category}</span>
                    </div>
                    <div className="text-xs text-zinc-200">{anomalyAnalysisResult.purpose}</div>
                    <div className="text-xs text-amber-200/80">{anomalyAnalysisResult.impact}</div>
                  </div>
                ) : (
                  <div className="mt-2 text-[10px] text-zinc-600 font-mono">Optional: uses configured AI keys.</div>
                )}
              </div>
            </div>

            <ModalFooter className="flex flex-wrap justify-end">
              <button
                onClick={openSelectedAnomalyInQueries}
                className="px-4 py-2 rounded border border-[#27272a] text-zinc-300 hover:bg-[#27272a] transition-all text-xs font-bold flex items-center gap-2"
              >
                <Terminal className="w-3.5 h-3.5" /> OPEN IN QUERIES
              </button>

              <button
                onClick={ignoreSelectedAnomaly}
                className="px-4 py-2 rounded border border-[#27272a] text-zinc-300 hover:text-amber-300 hover:border-amber-500/40 hover:bg-amber-950/10 transition-all text-xs font-bold flex items-center gap-2"
              >
                <EyeOff className="w-3.5 h-3.5" /> IGNORE
              </button>

              <button
                onClick={blockFromSelectedAnomaly}
                disabled={readOnlyFollower}
                className="px-4 py-2 rounded bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-900/20 transition-all text-xs font-bold flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-rose-600"
              >
                <Ban className="w-3.5 h-3.5" /> BLOCK DOMAIN
              </button>
            </ModalFooter>
          </ModalCard>
        ) : null}
      </Modal>

      <Modal open={!!selectedDomain} onClose={() => setSelectedDomain(null)}>
        {selectedDomain ? (
          <ModalCard className="max-w-lg">
            <ModalHeader
              title="Neural Analysis"
              subtitle={selectedDomain.domain}
              subtitleClassName="text-indigo-400 font-mono text-xs mt-0.5"
              icon={<Sparkles className="w-5 h-5 text-indigo-400" />}
              iconContainerClassName="bg-indigo-500/10 border-indigo-500/20"
              onClose={() => setSelectedDomain(null)}
            />

            <div className="p-6">
              {isAnalyzing ? (
                <div className="flex flex-col items-center justify-center py-8 text-zinc-500 space-y-3">
                   <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                   <span className="text-xs font-mono animate-pulse">Consulting Neural Engine...</span>
                </div>
              ) : analysisResult ? (
                 <div className="space-y-5 animate-fade-in">
                    {/* Category */}
                    <div className="flex items-center justify-between p-3 rounded bg-[#18181b] border border-[#27272a]">
                        <span className="text-xs font-bold text-zinc-500 uppercase">Category</span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase ${getCategoryColor(analysisResult.category)}`}>
                            {analysisResult.category}
                        </span>
                    </div>

                    {/* Purpose */}
                    <div>
                        <h4 className="text-[10px] font-bold text-zinc-500 uppercase mb-2">Technical Purpose</h4>
                        <p className="text-sm text-zinc-200 leading-relaxed bg-[#18181b] p-3 rounded border border-[#27272a]">
                            {analysisResult.purpose}
                        </p>
                    </div>

                    {/* Impact */}
                    <div>
                         <h4 className="text-[10px] font-bold text-zinc-500 uppercase mb-2">Blocking Impact</h4>
                         <div className="flex gap-3 bg-amber-950/10 border border-amber-900/30 p-3 rounded">
                            <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                            <p className="text-xs text-amber-200/80 leading-relaxed">
                                {analysisResult.impact}
                            </p>
                         </div>
                    </div>
                 </div>
              ) : (
                <div className="text-center py-8 text-zinc-500 text-xs">Analysis Failed.</div>
              )}
            </div>

            <ModalFooter>
               <button 
                 onClick={() => setSelectedDomain(null)} 
                 className="px-4 py-2 rounded text-xs font-bold text-zinc-500 hover:text-white transition-colors"
               >
                 CANCEL
               </button>
               
               <div className="h-8 w-px bg-[#27272a] mx-2"></div>

               <button 
                  onClick={() => handleAction('WHITELIST')}
                disabled={readOnlyFollower}
                className="px-4 py-2 rounded border border-[#27272a] text-zinc-300 hover:text-emerald-400 hover:border-emerald-500/50 hover:bg-emerald-950/10 transition-all text-xs font-bold flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:text-zinc-300 disabled:hover:border-[#27272a] disabled:hover:bg-transparent"
               >
                  <CheckCircle className="w-3.5 h-3.5" />
                  WHITELIST
               </button>
               
               <button 
                  onClick={() => handleAction('BLOCK')}
                disabled={readOnlyFollower}
                className="px-4 py-2 rounded bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-900/20 transition-all text-xs font-bold flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-rose-600"
               >
                  <XCircle className="w-3.5 h-3.5" />
                  BLOCK DOMAIN
               </button>
            </ModalFooter>
          </ModalCard>
        ) : null}
      </Modal>
    </div>
  );
};

export default QueryLogs;