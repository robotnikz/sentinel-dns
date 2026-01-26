import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, Ban, BarChart3, EyeOff, Globe, Info, Map as MapIcon, Percent, Shield, ShieldX, Sparkles, TrendingUp, Users, X, XCircle, Zap, Check, ArrowUpRight } from 'lucide-react';
import StatCard from '../components/StatCard';
import WorldMap, { type CountryData, type MapPoint } from '../components/WorldMap';
import Modal from '../components/Modal';
import { detectAnomalies } from '../services/anomalyService';
import { analyzeDomain } from '../services/geminiService';
import { DnsQuery, QueryStatus, type Anomaly, type ChartDataPoint } from '../types';
import { useRules } from '../contexts/RulesContext';
import { useClients } from '../contexts/ClientsContext';

const IGNORED_ANOMALY_KEY = 'sentinel_ignored_anomaly_signatures';

function signatureForAnomaly(a: Anomaly): string {
  return `${a.device}|${a.issue}`;
}

function extractDomain(text: string): string | null {
  const match = String(text || '').match(/\b([a-z0-9-]+\.)+[a-z]{2,}\b/i);
  return match ? match[0].toLowerCase() : null;
}

function computePct(items: Array<{ domain: string; count: number }>): Array<{ domain: string; count: number; pct: number }> {
  const max = items.reduce((acc, it) => Math.max(acc, it.count), 0);
  return items.map((it) => ({ ...it, pct: max > 0 ? (it.count / max) * 100 : 0 }));
}

function baseDomain(domain: string): string {
  const d = String(domain || '').toLowerCase().trim();
  const parts = d.split('.').filter(Boolean);
  if (parts.length <= 2) return d;
  return parts.slice(-2).join('.');
}

function makeDemoAnomalies(seed?: { device?: string; clientIp?: string; domainHint?: string }): Anomaly[] {
  const now = new Date().toISOString();
  const device = seed?.device || 'Demo-Device';
  const clientIp = seed?.clientIp || '192.168.1.50';
  const domainHint = seed?.domainHint || 'example.com';
  const idBase = Date.now();
  return [
    {
      id: idBase + 1,
      device,
      clientIp,
      issue: 'Possible DGA / Malware Beaconing',
      detail: `Domain looks algorithmically generated: a9k3j2l1m0n9p8q7.${domainHint}`,
      domain: domainHint,
      reasons: ['High-entropy label', 'Unusual digit ratio'],
      confidence: 0.82,
      risk: 'high',
      timestamp: now
    },
    {
      id: idBase + 2,
      device,
      clientIp,
      issue: 'Policy Risk: Adult content',
      detail: `Permitted domain matched policy keyword (xxx): xxx-${domainHint}`,
      domain: domainHint,
      reasons: ['Keyword match', 'Permitted traffic'],
      confidence: 0.7,
      risk: 'high',
      timestamp: now
    },
    {
      id: idBase + 3,
      device,
      clientIp,
      issue: 'High Infection Risk (Block Rate)',
      detail: 'Device has 62% blocked queries (possible adware/malware or aggressive tracking).',
      reasons: ['High blocked/total ratio', 'Multiple distinct blocked domains'],
      relatedDomains: [
        { domain: 'ads.badexample.com', count: 19 },
        { domain: 'track.badexample.net', count: 11 },
        { domain: 'malware.badexample.org', count: 6 }
      ],
      confidence: 0.64,
      risk: 'medium',
      timestamp: now
    }
  ];
}

function mapQueryLogRow(row: any): DnsQuery | null {
  const id = row?._db?.id ?? row?.id;
  if (typeof id !== 'string' && typeof id !== 'number') return null;

  const statusRaw = row?.status;
  const status: QueryStatus =
    statusRaw === QueryStatus.BLOCKED ||
    statusRaw === QueryStatus.PERMITTED ||
    statusRaw === QueryStatus.SHADOW_BLOCKED ||
    statusRaw === QueryStatus.CACHED
      ? statusRaw
      : QueryStatus.PERMITTED;

  return {
    id: String(id),
    timestamp: typeof row?.timestamp === 'string' ? row.timestamp : row?._db?.ts ? new Date(row._db.ts).toISOString() : new Date().toISOString(),
    domain: typeof row?.domain === 'string' ? row.domain : '',
    client: typeof row?.client === 'string' ? row.client : 'Unknown',
    clientIp: typeof row?.clientIp === 'string' ? row.clientIp : '',
    status,
    type: typeof row?.type === 'string' ? row.type : 'A',
    durationMs: typeof row?.durationMs === 'number' ? row.durationMs : 0,
    blocklistId: typeof row?.blocklistId === 'string' ? row.blocklistId : undefined
  };
}

function openLogsPreset(preset: { tab?: 'queries' | 'suspicious'; searchTerm?: string; statusFilter?: string; typeFilter?: string; clientFilter?: string; pageSize?: number }) {
  window.dispatchEvent(new CustomEvent('sentinel:navigate', { detail: { page: 'logs', logsPreset: preset } }));
}

function openDomainInLogs(domain: string, opts?: { statusFilter?: string }) {
  openLogsPreset({
    searchTerm: domain,
    statusFilter: opts?.statusFilter,
    pageSize: 200
  });
}

const Dashboard: React.FC = () => {
  const { addRule } = useRules();
  const { clients, getClientByIp, updateClient } = useClients();

  const [summary, setSummary] = useState<{ totalQueries: number; blockedQueries: number; activeClients: number } | null>(null);
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [trafficWindowHours, setTrafficWindowHours] = useState(24);
  const [topDomains, setTopDomains] = useState<Array<{ domain: string; count: number; pct: number }>>([]);
  const [blockedTargets, setBlockedTargets] = useState<Array<{ domain: string; count: number; pct: number }>>([]);

  const [geoData, setGeoData] = useState<CountryData[]>([]);
  const [geoStatus, setGeoStatus] = useState<{ available: boolean; dbPath: string } | null>(null);
  const [geoPoints, setGeoPoints] = useState<MapPoint[]>([]);

  const [queries, setQueries] = useState<DnsQuery[]>([]);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [manualAnomalies, setManualAnomalies] = useState<Anomaly[]>([]);
  const [ignoredSignatures, setIgnoredSignatures] = useState<string[]>([]);

  const [selectedAnomaly, setSelectedAnomaly] = useState<Anomaly | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<{ category: string; purpose: string; impact: string } | null>(null);

  const navTimerRef = useRef<number | null>(null);
  const [navFeedback, setNavFeedback] = useState<{ domain: string; kind: 'top' | 'blocked' } | null>(null);

  const navigateToDomainLogs = (domain: string, kind: 'top' | 'blocked') => {
    setNavFeedback({ domain, kind });
    if (navTimerRef.current) window.clearTimeout(navTimerRef.current);
    navTimerRef.current = window.setTimeout(() => {
      if (kind === 'blocked') openDomainInLogs(domain, { statusFilter: QueryStatus.BLOCKED });
      else openDomainInLogs(domain);
    }, 180);
  };

  useEffect(() => {
    return () => {
      if (navTimerRef.current) window.clearTimeout(navTimerRef.current);
    };
  }, []);

  const loadIgnoredSignatures = () => {
    void (async () => {
      try {
        const res = await fetch('/api/suspicious/ignored');
        if (res.ok) {
          const data = await res.json();
          const items = Array.isArray((data as any)?.items) ? (data as any).items : [];
          setIgnoredSignatures(
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
          setIgnoredSignatures(parsed.filter((s) => typeof s === 'string'));
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
          await fetch('/api/suspicious/ignored', {
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

  const formatTrafficTick = (ts: string): string => {
    if (!ts) return '';
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) return '';
    if (trafficWindowHours <= 6) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    if (trafficWindowHours <= 24) {
      return date.toLocaleTimeString([], { hour: '2-digit' });
    }
    return date.toLocaleDateString([], { month: 'short', day: '2-digit' });
  };

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetch('/api/metrics/summary?hours=24').then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch('/api/geo/countries?hours=24&limit=40').then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch('/api/query-logs?limit=500').then((r) => (r.ok ? r.json() : null)).catch(() => null)
    ])
      .then(([summaryRes, geoRes, logsRes]) => {
        if (cancelled) return;

        if (summaryRes && typeof summaryRes === 'object') {
          setSummary({
            totalQueries: Number((summaryRes as any).totalQueries ?? 0),
            blockedQueries: Number((summaryRes as any).blockedQueries ?? 0),
            activeClients: Number((summaryRes as any).activeClients ?? 0)
          });
        } else {
          setSummary(null);
        }

        if (geoRes && typeof geoRes === 'object') {
          const items = Array.isArray((geoRes as any).items) ? (geoRes as any).items : [];
          setGeoData(items as CountryData[]);

          const pts = Array.isArray((geoRes as any).points) ? (geoRes as any).points : [];
          setGeoPoints(pts as MapPoint[]);

          const status = (geoRes as any).geoip;
          if (status && typeof status === 'object') {
            setGeoStatus({
              available: Boolean((status as any).available),
              dbPath: typeof (status as any).dbPath === 'string' ? (status as any).dbPath : ''
            });
          } else {
            setGeoStatus(null);
          }
        } else {
          setGeoData([]);
          setGeoStatus(null);
          setGeoPoints([]);
        }

        const logItems = Array.isArray(logsRes?.items) ? logsRes.items : [];
        const mappedLogs = logItems
          .map(mapQueryLogRow)
          .filter((q): q is DnsQuery => Boolean(q && q.domain));
        setQueries(mappedLogs);
      })
      .catch(() => {
        if (cancelled) return;
        setSummary(null);
          setGeoData([]);
          setGeoStatus(null);
          setGeoPoints([]);
        setQueries([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetch(`/api/metrics/top-domains?hours=${encodeURIComponent(String(trafficWindowHours))}&limit=20&excludeUpstreams=1`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch(`/api/metrics/top-blocked?hours=${encodeURIComponent(String(trafficWindowHours))}&limit=20`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
    ])
      .then(([topRes, blockedRes]) => {
        if (cancelled) return;

        const blockedItemsRaw = Array.isArray(blockedRes?.items) ? blockedRes.items : [];
        const blockedItems = blockedItemsRaw
          .filter((r: any) => typeof r?.domain === 'string')
          .map((r: any) => ({ domain: String(r.domain), count: Number(r.count ?? 0) }));
        setBlockedTargets(computePct(blockedItems));

        const blockedSet = new Set(blockedItems.map((b) => b.domain.trim().toLowerCase()).filter(Boolean));

        const topItemsRaw = Array.isArray(topRes?.items) ? topRes.items : [];
        const topItems = topItemsRaw
          .filter((r: any) => typeof r?.domain === 'string')
          .map((r: any) => ({ domain: String(r.domain), count: Number(r.count ?? 0) }))
          .filter((r) => !blockedSet.has(r.domain.trim().toLowerCase()));
        setTopDomains(computePct(topItems));
      })
      .catch(() => {
        if (cancelled) return;
        setTopDomains([]);
        setBlockedTargets([]);
      });

    return () => {
      cancelled = true;
    };
  }, [trafficWindowHours]);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/metrics/timeseries?hours=${encodeURIComponent(String(trafficWindowHours))}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((tsRes) => {
        if (cancelled) return;
        const tsItems = Array.isArray(tsRes?.items) ? tsRes.items : [];
        const mappedTs: ChartDataPoint[] = tsItems.map((it: any) => {
          const ts = typeof it?.ts === 'string' ? it.ts : '';
          const time = ts ? formatTrafficTick(ts) : '';
          return {
            time,
            queries: Number(it?.queries ?? 0),
            ads: Number(it?.ads ?? 0)
          };
        });
        setChartData(mappedTs);
      })
      .catch(() => {
        if (!cancelled) setChartData([]);
      });

    return () => {
      cancelled = true;
    };
  }, [trafficWindowHours]);

  useEffect(() => {
    const all = detectAnomalies(queries);
    const filtered = all.filter((a) => !ignoredSignatures.includes(signatureForAnomaly(a)));
    setAnomalies(filtered);
  }, [queries, ignoredSignatures]);

  const anomaliesForUi = manualAnomalies.length > 0 ? manualAnomalies : anomalies;

  const createTestAlertFromLatestQuery = () => {
    const latest = queries[0];
    if (!latest || !latest.domain) {
      setManualAnomalies(makeDemoAnomalies());
      return;
    }
    const d = baseDomain(latest.domain);
    setManualAnomalies([
      {
        id: Date.now(),
        device: latest.client || 'Unknown',
        clientIp: latest.clientIp || undefined,
        issue: 'Test Alert (from latest query)',
        detail: `Testing workflow using recent traffic: ${latest.domain}`,
        domain: d,
        reasons: ['Manual test', 'Uses a real query for deep links'],
        confidence: 1,
        risk: 'low',
        timestamp: latest.timestamp || new Date().toISOString()
      }
    ]);
  };

  const totals = useMemo(() => {
    const total = summary?.totalQueries ?? 0;
    const blocked = summary?.blockedQueries ?? 0;
    return {
      total,
      blocked,
      blockRatePct: total > 0 ? (blocked / total) * 100 : 0,
      activeClients: summary?.activeClients ?? 0
    };
  }, [summary]);

  const handleInvestigate = (a: Anomaly) => {
    setSelectedAnomaly(a);
    setAnalysisResult(null);
    setIsAnalyzing(false);
  };

  const runAiAnalysis = async () => {
    if (!selectedAnomaly) return;

    const domain = extractDomain(selectedAnomaly.detail);
    if (!domain) {
      setAnalysisResult({ category: 'Unknown', purpose: 'Could not extract a domain from this event.', impact: 'Unknown' });
      return;
    }

    setIsAnalyzing(true);
    setAnalysisResult(null);

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

      setAnalysisResult({ category, purpose, impact });
    } catch {
      setAnalysisResult({ category: 'Error', purpose: 'Could not analyze domain.', impact: 'Unknown' });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleIgnoreAnomaly = async () => {
    if (!selectedAnomaly) return;
    const sig = signatureForAnomaly(selectedAnomaly);

    try {
      await fetch('/api/suspicious/ignored', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signature: sig })
      });
    } catch {
      // ignore
    }
    loadIgnoredSignatures();
    window.dispatchEvent(new CustomEvent('sentinel:ignored-anomalies'));
    setSelectedAnomaly(null);
  };

  const handleBlockFromAnomaly = async () => {
    if (!selectedAnomaly) return;
    const domain = selectedAnomaly.domain || extractDomain(selectedAnomaly.detail);
    if (!domain) return;
    await addRule(domain, 'BLOCKED', 'Security Threat');
    setSelectedAnomaly(null);
  };

  const handleOpenInLogs = () => {
    if (!selectedAnomaly) return;
    const domain = selectedAnomaly.domain || extractDomain(selectedAnomaly.detail) || '';
    const preset = {
      searchTerm: domain,
      statusFilter: 'ALL',
      typeFilter: 'ALL',
      clientFilter: selectedAnomaly.device || 'ALL',
      pageSize: 100
    };
    setSelectedAnomaly(null);
    openLogsPreset(preset);
  };

  const openAnomalyInLogs = (a: Anomaly) => {
    const domain = a.domain || extractDomain(a.detail) || '';
    openLogsPreset({
      searchTerm: domain,
      statusFilter: 'ALL',
      typeFilter: 'ALL',
      clientFilter: a.device || 'ALL',
      pageSize: 100
    });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Queries" value={totals.total.toLocaleString()} icon={Globe} color="indigo" />
        <StatCard title="Threats Blocked" value={totals.blocked.toLocaleString()} icon={Shield} color="emerald" />
        <StatCard title="Block Rate" value={`${totals.blockRatePct.toFixed(1)}%`} icon={Percent} color="rose" />
        <StatCard title="Active Clients" value={totals.activeClients.toLocaleString()} icon={Users} color="sky" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2 flex flex-col gap-6">
          <div className="dashboard-card rounded-lg p-6 h-[380px] flex flex-col">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-sm font-semibold text-white uppercase tracking-wider flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-indigo-400" /> Traffic Analysis
              </h2>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1 bg-[#18181b] border border-[#27272a] rounded-lg p-1">
                  {[
                    { label: '1h', hours: 1 },
                    { label: '6h', hours: 6 },
                    { label: '24h', hours: 24 },
                    { label: '7d', hours: 168 }
                  ].map((opt) => (
                    <button
                      key={opt.hours}
                      type="button"
                      onClick={() => setTrafficWindowHours(opt.hours)}
                      className={`px-2.5 py-1 rounded text-[10px] font-bold transition-all ${
                        trafficWindowHours === opt.hours
                          ? 'bg-zinc-200 text-zinc-900'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <span className="flex items-center gap-1.5 text-xs text-zinc-400">
                  <span className="w-2 h-2 rounded-full bg-indigo-500"></span> Total
                </span>
                <span className="flex items-center gap-1.5 text-xs text-zinc-400">
                  <span className="w-2 h-2 rounded-full bg-rose-500"></span> Blocked
                </span>
              </div>
            </div>
            <div className="flex-1 min-h-0 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="colorQueries" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorAds" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis dataKey="time" stroke="#52525b" fontSize={11} tickLine={false} axisLine={false} fontFamily="JetBrains Mono" />
                  <YAxis
                    stroke="#52525b"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => `${value / 1000}k`}
                    fontFamily="JetBrains Mono"
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#09090b', border: '1px solid #27272a', borderRadius: '4px' }}
                    itemStyle={{ color: '#e4e4e7', fontFamily: 'JetBrains Mono', fontSize: '12px' }}
                    labelStyle={{ color: '#a1a1aa', fontFamily: 'JetBrains Mono', fontSize: '11px', marginBottom: '4px' }}
                  />
                  <Area type="monotone" dataKey="queries" stroke="#6366f1" strokeWidth={2} fillOpacity={1} fill="url(#colorQueries)" />
                  <Area type="monotone" dataKey="ads" stroke="#f43f5e" strokeWidth={2} fillOpacity={1} fill="url(#colorAds)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="dashboard-card rounded-lg p-0 overflow-hidden">
            <div className="p-4 border-b border-[#27272a] bg-[#121214] flex justify-between items-center">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-white uppercase tracking-wider flex items-center gap-2">
                  <MapIcon className="w-4 h-4 text-emerald-500" /> Outbound Destinations
                </h2>
                <Info
                  className="w-3.5 h-3.5 text-zinc-600 cursor-help"
                  title={
                    geoStatus
                      ? geoStatus.available
                        ? `GeoIP enabled (${geoStatus.dbPath || 'mmdb'})`
                        : `GeoIP database missing at ${geoStatus.dbPath || '(unset)'}`
                      : 'GeoIP status unknown'
                  }
                />
              </div>
              <div className="flex gap-2 items-center">
                <span className="flex items-center gap-1.5 text-xs text-zinc-400">
                  <span className="w-2 h-2 rounded-full bg-blue-500"></span> Permitted
                </span>
                <span className="flex items-center gap-1.5 text-xs text-zinc-400">
                  <span className="w-2 h-2 rounded-full bg-rose-500"></span> Blocked
                </span>
                <span className="text-xs text-zinc-500">Scroll to zoom · drag to pan</span>
              </div>
            </div>
            <div className="p-4 bg-[#09090b]">
              {geoData.length > 0 || geoPoints.length > 0 ? (
                <WorldMap data={geoData} points={geoPoints} />
              ) : (
                <div className="p-8 text-center text-zinc-600 flex flex-col items-center">
                  <MapIcon className="w-8 h-8 opacity-20 mb-2" />
                  <span className="text-xs">No GeoIP data yet (no recent queries or GeoIP not configured).</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="lg:col-span-1 flex flex-col gap-6">
          <div className="dashboard-card rounded-lg p-0 overflow-hidden flex flex-col h-[260px]">
            <div className="p-4 border-b border-[#27272a] bg-[#121214] flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white uppercase tracking-wider flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-sky-400" /> Top Domains
              </h2>
              <span className="text-[10px] font-mono text-zinc-500">{topDomains.length}</span>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-4 pr-3 space-y-5">
              {topDomains.length > 0 ? (
                topDomains.map((item, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => navigateToDomainLogs(item.domain, 'top')}
                    className="group w-full text-left"
                    title="Open Query Logs filtered by this domain"
                  >
                    <div className="flex justify-between text-xs mb-1.5 font-mono">
                      <span className="text-zinc-300 group-hover:text-white group-hover:underline transition-colors truncate max-w-[70%]">
                        {item.domain}
                      </span>
                      <span className="text-zinc-500 flex items-center gap-1.5">
                        {navFeedback?.kind === 'top' && navFeedback.domain === item.domain ? (
                          <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                            OK <Check className="w-3 h-3" />
                          </span>
                        ) : (
                          <span className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-zinc-400 flex items-center gap-1">
                            LOGS <ArrowUpRight className="w-3 h-3" />
                          </span>
                        )}
                        {item.count.toLocaleString()}
                      </span>
                    </div>
                    <div className="h-1 bg-[#27272a] rounded-sm overflow-hidden">
                      <div className="h-full bg-zinc-400 rounded-sm" style={{ width: `${item.pct}%` }}></div>
                    </div>
                  </button>
                ))
              ) : (
                <div className="text-xs text-zinc-600">No traffic yet.</div>
              )}
            </div>
          </div>

          <div className="dashboard-card rounded-lg p-0 overflow-hidden flex flex-col h-[260px]">
            <div className="p-4 border-b border-[#27272a] bg-[#121214] flex items-center justify-between">
              <h2 className="text-sm font-semibold text-rose-400 uppercase tracking-wider flex items-center gap-2">
                <ShieldX className="w-4 h-4 text-rose-400" /> Blocked Targets
              </h2>
              <span className="text-[10px] font-mono text-zinc-500">{blockedTargets.length}</span>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-4 pr-3 space-y-5">
              {blockedTargets.length > 0 ? (
                blockedTargets.map((item, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => navigateToDomainLogs(item.domain, 'blocked')}
                    className="group w-full text-left"
                    title="Open Query Logs filtered by this blocked domain"
                  >
                    <div className="flex justify-between text-xs mb-1.5 font-mono">
                      <span className="text-zinc-300 group-hover:text-rose-200 group-hover:underline transition-colors truncate max-w-[70%]">
                        {item.domain}
                      </span>
                      <span className="text-zinc-500 flex items-center gap-1.5">
                        {navFeedback?.kind === 'blocked' && navFeedback.domain === item.domain ? (
                          <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                            OK <Check className="w-3 h-3" />
                          </span>
                        ) : (
                          <span className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-zinc-400 flex items-center gap-1">
                            LOGS <ArrowUpRight className="w-3 h-3" />
                          </span>
                        )}
                        {item.count.toLocaleString()}
                      </span>
                    </div>
                    <div className="h-1 bg-[#27272a] rounded-sm overflow-hidden">
                      <div className="h-full bg-rose-600 rounded-sm" style={{ width: `${item.pct}%` }}></div>
                    </div>
                  </button>
                ))
              ) : (
                <div className="text-xs text-zinc-600">No blocks yet.</div>
              )}
            </div>
          </div>

          <div className="dashboard-card rounded-lg p-0 overflow-hidden flex flex-col h-[220px]">
            <div className="p-4 border-b border-[#27272a] bg-[#121214] flex justify-between items-center">
              <h2 className="text-sm font-semibold text-white uppercase tracking-wider flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-500" /> Suspicious Activity
              </h2>
              <button
                onClick={() => openLogsPreset({ tab: 'suspicious', pageSize: 100 })}
                className="text-[10px] font-mono text-zinc-500 hover:text-zinc-300 border border-[#27272a] px-2 py-1 rounded"
                title="Open full Suspicious Activity list"
              >
                VIEW ALL
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
              {anomaliesForUi.length > 0 ? (
                anomaliesForUi.map((item) => (
                  <div
                    key={item.id}
                    className="p-4 border-b border-[#27272a] last:border-0 hover:bg-[#18181b] flex flex-col justify-between gap-4 transition-colors"
                  >
                    <div className="flex items-start gap-4">
                      <div
                        className={`mt-1.5 w-2 h-2 rounded-full ${
                          item.risk === 'critical'
                            ? 'bg-rose-600 animate-pulse'
                            : item.risk === 'high'
                              ? 'bg-orange-500'
                              : 'bg-amber-400'
                        }`}
                      ></div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-bold text-white truncate">{item.device}</span>
                          <span
                            className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${
                              item.risk === 'critical'
                                ? 'bg-rose-950/30 text-rose-500 border border-rose-900/50'
                                : item.risk === 'high'
                                  ? 'bg-orange-950/30 text-orange-500 border border-orange-900/50'
                                  : 'bg-amber-950/30 text-amber-500 border border-amber-900/50'
                            }`}
                          >
                            {item.risk} RISK
                          </span>
                          {typeof item.confidence === 'number' ? (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase bg-[#18181b] text-zinc-400 border border-[#27272a]">
                              CONF {Math.round(item.confidence * 100)}%
                            </span>
                          ) : null}
                        </div>
                        <p className="text-sm text-zinc-400 font-medium truncate">{item.issue}</p>

                        {item.reasons && item.reasons.length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {item.reasons.slice(0, 2).map((r, idx) => (
                              <span
                                key={idx}
                                className="text-[10px] font-bold px-2 py-0.5 rounded border border-[#27272a] bg-[#0b0b0d] text-zinc-500"
                              >
                                {r}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex items-center justify-between pl-6 gap-3">
                      <div className="text-xs font-mono text-zinc-500 truncate">{item.detail}</div>
                      <div className="flex gap-2 flex-shrink-0">
                        <button
                          onClick={() => openAnomalyInLogs(item)}
                          className="px-3 py-1.5 rounded border border-[#27272a] text-[10px] font-bold text-zinc-300 hover:bg-[#0b0b0d] transition-colors flex items-center gap-2"
                          title="Open Query Inspector with filters"
                        >
                          <Info className="w-3.5 h-3.5" />
                          LOGS
                        </button>
                        <button
                          onClick={() => handleInvestigate(item)}
                          className="px-3 py-1.5 rounded border border-[#27272a] text-[10px] font-bold text-zinc-300 hover:bg-white hover:text-black transition-colors"
                        >
                          INVESTIGATE
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-6 text-center text-zinc-600 flex flex-col items-center">
                  <Check className="w-7 h-7 opacity-20 mb-2" />
                  <span className="text-xs">No anomalies detected in current traffic.</span>
                  {manualAnomalies.length > 0 ? (
                    <div className="flex flex-wrap justify-center gap-2 mt-4">
                      <button
                        onClick={() => setManualAnomalies([])}
                        className="px-3 py-1.5 rounded border border-[#27272a] text-[10px] font-bold text-zinc-500 hover:text-zinc-300 hover:bg-[#18181b] transition-colors"
                        title="Return to real detections"
                      >
                        CLEAR
                      </button>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {selectedAnomaly && (
        <Modal open={true} onClose={() => setSelectedAnomaly(null)} zIndex={1100}>
          <div className="dashboard-card w-full max-w-lg rounded-lg overflow-hidden border border-[#27272a] bg-[#09090b] animate-fade-in">
            <div className="p-5 border-b border-[#27272a] flex justify-between items-start bg-[#121214]">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                  <AlertTriangle className="w-5 h-5 text-amber-500" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">Security Alert</h3>
                  <p className="text-zinc-500 text-xs mt-0.5">{selectedAnomaly.issue}</p>
                </div>
              </div>
              <button onClick={() => setSelectedAnomaly(null)} className="text-zinc-500 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {selectedAnomaly.reasons && selectedAnomaly.reasons.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {selectedAnomaly.reasons.slice(0, 4).map((r, i) => (
                    <span
                      key={i}
                      className="text-[10px] font-bold px-2 py-1 rounded border border-[#27272a] bg-[#18181b] text-zinc-400"
                    >
                      {r}
                    </span>
                  ))}
                  {typeof selectedAnomaly.confidence === 'number' ? (
                    <span className="text-[10px] font-bold px-2 py-1 rounded border border-[#27272a] bg-[#18181b] text-zinc-500">
                      CONF {Math.round(selectedAnomaly.confidence * 100)}%
                    </span>
                  ) : null}
                </div>
              ) : null}

              <div className="p-3 bg-[#18181b] border border-[#27272a] rounded">
                <div className="text-[10px] font-bold text-zinc-500 uppercase mb-1">Raw Log Detail</div>
                <code className="text-xs text-zinc-300 font-mono block break-all">{selectedAnomaly.detail}</code>
              </div>

              <div className="p-3 bg-[#18181b] border border-[#27272a] rounded">
                <div className="text-[10px] font-bold text-zinc-500 uppercase mb-1">Affected Device</div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-indigo-500"></div>
                  <span className="text-sm font-bold text-white">{selectedAnomaly.device}</span>
                  {selectedAnomaly.clientIp ? (
                    <span className="text-[10px] font-mono text-zinc-500">{selectedAnomaly.clientIp}</span>
                  ) : null}
                </div>
              </div>

              {selectedAnomaly.relatedDomains && selectedAnomaly.relatedDomains.length > 0 ? (
                <div className="p-3 bg-[#18181b] border border-[#27272a] rounded">
                  <div className="text-[10px] font-bold text-zinc-500 uppercase mb-2">Top related domains</div>
                  <div className="space-y-1">
                    {selectedAnomaly.relatedDomains.slice(0, 3).map((d, i) => (
                      <div key={i} className="flex justify-between items-center text-xs font-mono">
                        <span className="text-zinc-300 truncate max-w-[70%]">{d.domain}</span>
                        <span className="text-zinc-500">{d.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {!analysisResult ? (
                <div className="mt-4 pt-4 border-t border-[#27272a]">
                  <p className="text-xs text-zinc-400 mb-4 leading-relaxed">
                    Heuristic detection flagged this connection. You can use the AI Engine to analyze the destination domain and determine if
                    it&apos;s a false positive or a genuine threat.
                  </p>
                  <button
                    onClick={runAiAnalysis}
                    disabled={isAnalyzing}
                    className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-bold flex items-center justify-center gap-2 transition-colors"
                  >
                    {isAnalyzing ? (
                      <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                    ANALYZE THREAT WITH AI
                  </button>
                </div>
              ) : (
                <div className="mt-4 pt-4 border-t border-[#27272a] animate-fade-in space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-zinc-500 uppercase">AI Verdict</span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded border border-[#27272a] bg-[#18181b] uppercase text-zinc-300">
                      {analysisResult.category}
                    </span>
                  </div>
                  <div className="bg-[#18181b] p-3 rounded border border-[#27272a]">
                    <p className="text-xs text-zinc-300 leading-relaxed">{analysisResult.purpose}</p>
                  </div>
                  <div className="flex gap-2 items-start text-xs text-amber-500 bg-amber-950/10 p-2 rounded border border-amber-900/20">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                    <span>{analysisResult.impact}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-[#27272a] bg-[#121214] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <button
                onClick={handleIgnoreAnomaly}
                className="h-9 w-full sm:w-auto px-4 rounded text-xs font-bold inline-flex items-center justify-center gap-2 text-zinc-500 hover:text-zinc-300 border border-[#27272a] bg-[#09090b]/40 hover:bg-[#18181b] transition-all"
                title="Permanently ignore alerts for this issue on this device"
              >
                <EyeOff className="w-3.5 h-3.5" />
                IGNORE ALERT
              </button>

              <div className="flex flex-col sm:flex-row w-full sm:w-auto gap-2 sm:justify-end">
                <button
                  onClick={handleOpenInLogs}
                  className="h-9 w-full sm:w-auto px-4 rounded inline-flex items-center justify-center gap-2 bg-[#18181b] hover:bg-[#1f1f22] text-zinc-200 border border-[#27272a] transition-all text-xs font-bold"
                  title="Open Query Inspector with filters"
                >
                  <Info className="w-3.5 h-3.5" />
                  OPEN LOGS
                </button>
                <button
                  onClick={() => setSelectedAnomaly(null)}
                  className="h-9 w-full sm:w-auto px-4 rounded inline-flex items-center justify-center bg-[#09090b]/40 hover:bg-[#18181b] text-zinc-300 border border-[#27272a] transition-all text-xs font-bold"
                >
                  DISMISS
                </button>
                <button
                  onClick={handleBlockFromAnomaly}
                  className="h-9 w-full sm:w-auto px-4 rounded inline-flex items-center justify-center gap-2 bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-900/20 transition-all text-xs font-bold"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  BLOCK DOMAIN
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default Dashboard;