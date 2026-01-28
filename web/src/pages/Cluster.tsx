import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, RefreshCw, Shield, ServerCog, AlertTriangle, CheckCircle2 } from 'lucide-react';

type ClusterRole = 'standalone' | 'leader' | 'follower';

type ClusterStatus = {
  nodeId: string;
  config: {
    enabled: boolean;
    role: ClusterRole;
    leaderUrl?: string;
  };
  lastSync?: string;
  lastError?: string;
  lastSyncDurationMs?: number;
  lastSnapshotBytes?: number;
  lastSnapshotCounts?: {
    settings: number;
    clients: number;
    rules: number;
    blocklists: number;
    secrets: number;
  };
  effectiveRole?: ClusterRole;
  roleOverride?: ClusterRole | null;
};

function formatBytes(bytes?: number): string {
  if (!Number.isFinite(bytes as any) || (bytes as number) < 0) return '—';
  const b = bytes as number;
  if (b < 1024) return `${b} B`;
  const kb = b / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KiB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MiB`;
}

function formatDurationMs(ms?: number): string {
  if (!Number.isFinite(ms as any) || (ms as number) < 0) return '—';
  if ((ms as number) < 1000) return `${Math.round(ms as number)} ms`;
  return `${((ms as number) / 1000).toFixed(2)} s`;
}

type ClusterReady = {
  ok: boolean;
  role: ClusterRole;
  lastSync?: string | null;
};

type HostNetInfo = {
  detectedAt?: string;
  defaultInterface?: string;
  defaultGateway?: string;
  interfaces?: Array<{ name: string; ipv4: string; cidr: string; prefix: number }>;
};

type HaConfig = {
  enabled: boolean;
  vip?: string;
  interface?: string;
  vrid?: number;
  priority?: number;
  advertInt?: number;
  mode?: 'multicast' | 'unicast';
  unicastPeers?: string[];
  srcIp?: string;
};

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

function formatWhen(iso?: string): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toLocaleString();
}

const Cluster: React.FC = () => {
  const [status, setStatus] = useState<ClusterStatus | null>(null);
  const [ready, setReady] = useState<ClusterReady | null>(null);
  const [netinfo, setNetinfo] = useState<HostNetInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>('');
  const [msgKind, setMsgKind] = useState<'success' | 'error'>('success');

  const [leaderUrl, setLeaderUrl] = useState<string>(() => {
    try {
      return window.location.origin;
    } catch {
      return '';
    }
  });

  const uiOrigin = useMemo(() => {
    try {
      return window.location.origin;
    } catch {
      return '';
    }
  }, []);

  const [joinCode, setJoinCode] = useState<string>('');
  const [joinCodeBusy, setJoinCodeBusy] = useState(false);

  const [followerJoinCode, setFollowerJoinCode] = useState<string>('');

  const [haVip, setHaVip] = useState<string>('192.168.1.53');
  const [haInterface, setHaInterface] = useState<string>('');
  const [haPriority, setHaPriority] = useState<string>('110');
  const [haMode, setHaMode] = useState<'multicast' | 'unicast'>('multicast');
  const [haPeers, setHaPeers] = useState<string>('');
  const [haAuthPass, setHaAuthPass] = useState<string>('');
  const [haEnabled, setHaEnabled] = useState<boolean>(false);
  const [haHasStoredPass, setHaHasStoredPass] = useState<boolean>(false);

  const msgTimer = useRef<number | null>(null);

  const showMsg = useCallback((kind: 'success' | 'error', text: string) => {
    setMsgKind(kind);
    setMsg(text);
    if (msgTimer.current) window.clearTimeout(msgTimer.current);
    msgTimer.current = window.setTimeout(() => setMsg(''), 3500);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, rRes, nRes, haRes] = await Promise.all([
        fetch('/api/cluster/status', { credentials: 'include' }),
        fetch('/api/cluster/ready', { headers: { Accept: 'application/json' } }),
        fetch('/api/cluster/netinfo', { credentials: 'include' }),
        fetch('/api/cluster/ha/config', { credentials: 'include' })
      ]);

      const s = sRes.ok ? ((await safeJson(sRes)) as ClusterStatus) : null;
      const r = rRes.ok ? ((await safeJson(rRes)) as ClusterReady) : null;
      const n = nRes.ok ? ((await safeJson(nRes)) as { ok: boolean; netinfo: HostNetInfo | null }) : null;
      const ha = haRes.ok
        ? ((await safeJson(haRes)) as { ok: boolean; config: HaConfig | null; hasAuthPass: boolean })
        : null;

      setStatus(s);
      setReady(r);
      setNetinfo(n?.netinfo ?? null);

      setHaHasStoredPass(Boolean(ha?.hasAuthPass));
      if (ha?.config) {
        const c = ha.config;
        setHaEnabled(Boolean(c.enabled));
        if (c.vip) setHaVip(String(c.vip));
        if (c.interface) setHaInterface(String(c.interface));
        if (typeof c.priority === 'number') setHaPriority(String(c.priority));
        if (c.mode === 'unicast' || c.mode === 'multicast') setHaMode(c.mode);
        if (Array.isArray(c.unicastPeers)) setHaPeers(c.unicastPeers.join(','));
      }
    } catch {
      setStatus(null);
      setReady(null);
      setNetinfo(null);
      setHaHasStoredPass(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return () => {
      if (msgTimer.current) window.clearTimeout(msgTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!haInterface && netinfo?.defaultInterface) setHaInterface(String(netinfo.defaultInterface));
  }, [haInterface, netinfo]);

  const effectiveRole = (status?.effectiveRole ?? status?.config.role ?? 'standalone') as ClusterRole;

  const roleBadge = useMemo(() => {
    const r = effectiveRole;
    const base = 'inline-flex items-center gap-2 px-2.5 py-1 rounded-md text-xs font-medium border';
    if (r === 'leader') return `${base} bg-emerald-500/10 text-emerald-300 border-emerald-500/30`;
    if (r === 'follower') return `${base} bg-indigo-500/10 text-indigo-300 border-indigo-500/30`;
    return `${base} bg-zinc-500/10 text-zinc-300 border-zinc-500/30`;
  }, [effectiveRole]);

  const activeBadge = useMemo(() => {
    const base = 'inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium border';
    if (effectiveRole === 'leader') {
      return {
        text: haEnabled ? 'Active (VIP owner)' : 'Active (Leader)',
        className: `${base} bg-emerald-500/10 text-emerald-200 border-emerald-500/30`
      };
    }
    if (effectiveRole === 'follower') {
      return {
        text: haEnabled ? 'Standby (Follower)' : 'Follower',
        className: `${base} bg-zinc-500/10 text-zinc-300 border-zinc-500/30`
      };
    }
    return { text: 'Standalone', className: `${base} bg-zinc-500/10 text-zinc-300 border-zinc-500/30` };
  }, [effectiveRole, haEnabled]);

  const enableLeader = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/cluster/enable-leader', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ leaderUrl: leaderUrl.trim() })
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(String(data?.error || data?.message || `HTTP_${res.status}`));
      showMsg('success', 'Leader mode enabled.');
      await load();
    } catch (e: any) {
      showMsg('error', e?.message ? String(e.message) : 'Failed to enable leader mode');
    } finally {
      setBusy(false);
    }
  };

  const fetchJoinCode = async () => {
    setJoinCodeBusy(true);
    try {
      const res = await fetch('/api/cluster/join-code', { credentials: 'include' });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(String(data?.error || data?.message || `HTTP_${res.status}`));
      setJoinCode(String(data?.joinCode || ''));
      showMsg('success', 'Join code loaded.');
    } catch (e: any) {
      showMsg('error', e?.message ? String(e.message) : 'Failed to load join code');
    } finally {
      setJoinCodeBusy(false);
    }
  };

  const configureFollower = async () => {
    setBusy(true);
    try {
      const code = followerJoinCode.trim();
      if (!code) {
        showMsg('error', 'Please paste a join code.');
        return;
      }

      const res = await fetch('/api/cluster/configure-follower', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ joinCode: code })
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(String(data?.error || data?.message || `HTTP_${res.status}`));

      showMsg('success', 'Follower configured. Sync will start automatically.');
      await load();
    } catch (e: any) {
      showMsg('error', e?.message ? String(e.message) : 'Failed to configure follower');
    } finally {
      setBusy(false);
    }
  };

  const canShowJoinCode = status?.config.enabled && effectiveRole === 'leader' && !!status?.config.leaderUrl;
  const warningOverride = status?.roleOverride ? `Role override active: ${status.roleOverride}` : '';

  const saveHaConfig = async () => {
    setBusy(true);
    try {
      const peers = haPeers
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const body: any = {
        enabled: haEnabled,
        vip: haVip.trim(),
        interface: haInterface.trim(),
        priority: Number(haPriority || '110'),
        mode: haMode,
        unicastPeers: peers
      };

      // Only send password if user entered it (allows "keep existing" behavior).
      if (haAuthPass.trim()) body.authPass = haAuthPass.trim();

      const res = await fetch('/api/cluster/ha/config', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(String(data?.error || data?.message || `HTTP_${res.status}`));

      setHaAuthPass('');
      showMsg('success', 'HA settings saved. Keepalived will apply them automatically.');
      await load();
    } catch (e: any) {
      showMsg('error', e?.message ? String(e.message) : 'Failed to save HA settings');
    } finally {
      setBusy(false);
    }
  };

  const haChecklist = useMemo(() => {
    const items: Array<{ kind: 'ok' | 'warn' | 'error'; text: string }> = [];

    // Always show key prerequisites so non-technical users don't get stuck.
    items.push({
      kind: 'warn',
      text: 'VIP failover requires Linux host networking. Some unprivileged LXC containers block this.'
    });
    items.push({
      kind: 'warn',
      text: 'Both nodes should be in the same LAN/VLAN (usually the same subnet) for VIP failover to work reliably.'
    });
    items.push({ kind: 'warn', text: 'Port 53 must be free on the host (systemd-resolved often occupies it).' });

    if (!haEnabled) {
      return {
        title: 'Before you enable it',
        items
      };
    }

    // When enabled: validate fields.
    if (!haVip.trim()) items.unshift({ kind: 'error', text: 'Set a VIP (example: 192.168.1.53).' });
    if (!haInterface.trim()) items.unshift({ kind: 'warn', text: 'Select the LAN interface (or enter it manually).' });
    if (!haAuthPass.trim() && !haHasStoredPass)
      items.unshift({ kind: 'error', text: 'Set a shared VRRP password (must match on both nodes).' });
    if (haMode === 'unicast' && haPeers.split(',').map((s) => s.trim()).filter(Boolean).length === 0) {
      items.unshift({ kind: 'error', text: 'Unicast mode requires at least one peer IP.' });
    }
    if (!netinfo) {
      items.unshift({
        kind: 'warn',
        text: 'Autodetect is unavailable. If you are not on Linux, or host networking is blocked, keepalived may not work.'
      });
    }

    return {
      title: 'Checklist',
      items
    };
  }, [haAuthPass, haEnabled, haHasStoredPass, haInterface, haMode, haPeers, haVip, netinfo]);

  const haBlockingErrors = useMemo(() => {
    if (!haEnabled) return false;
    if (!haVip.trim()) return true;
    if (!haAuthPass.trim() && !haHasStoredPass) return true;
    if (haMode === 'unicast' && haPeers.split(',').map((s) => s.trim()).filter(Boolean).length === 0) return true;
    return false;
  }, [haAuthPass, haEnabled, haHasStoredPass, haMode, haPeers, haVip]);

  const haDisabledReason = useMemo(() => {
    if (!haEnabled) return '';

    const missing: string[] = [];
    if (!haVip.trim()) missing.push('VIP');
    if (!haAuthPass.trim() && !haHasStoredPass) missing.push('shared password');

    if (haMode === 'unicast') {
      const peers = haPeers
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (peers.length === 0) missing.push('unicast peers');
    }

    if (missing.length === 0) return '';
    return `Missing: ${missing.join(', ')}`;
  }, [haAuthPass, haEnabled, haHasStoredPass, haMode, haPeers, haVip]);

  const nextSteps = useMemo(() => {
    const steps: string[] = [];

    if (!haEnabled) {
      steps.push('Optional (recommended for HA): Enable VIP failover on both nodes (same VIP + password, different priorities).');
    } else if (haBlockingErrors) {
      steps.push(haDisabledReason ? `Fix VIP settings: ${haDisabledReason}.` : 'Fix VIP settings to continue.');
    } else {
      steps.push('VIP settings look ready. Apply the same VIP + password on the other node too.');
    }

    if (!status?.config.enabled) {
      steps.push('On the node that should be Leader (usually the VIP owner), click “Enable Leader”.');
    } else if (effectiveRole === 'leader') {
      steps.push('Generate a Join Code and paste it into the other node (Configure Follower).');
    } else if (effectiveRole === 'follower') {
      steps.push('This node is a Follower. Check “Follower last sync” in Status.');
    }

    return steps;
  }, [effectiveRole, haBlockingErrors, haDisabledReason, haEnabled, status?.config.enabled]);

  return (
    <div className="p-8 text-zinc-200">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Cluster / HA</h2>
          <p className="text-sm text-zinc-400 mt-1">
            Easy failover for home networks: one VIP (e.g. <span className="font-mono">192.168.1.53</span>) for your router, and Sentinel sync between nodes.
          </p>
        </div>

        <button
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-[#27272a] bg-[#121214] text-sm text-zinc-200 hover:bg-[#18181b] disabled:opacity-50"
        >
          <RefreshCw className={loading ? 'w-4 h-4 animate-spin' : 'w-4 h-4'} />
          Refresh
        </button>
      </div>

      {msg ? (
        <div
          className={`mb-6 rounded-md border px-4 py-3 text-sm ${
            msgKind === 'success'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
              : 'border-rose-500/30 bg-rose-500/10 text-rose-200'
          }`}
        >
          {msg}
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="rounded-xl border border-[#27272a] bg-[#0f0f12] p-5">
            <div className="text-sm font-semibold mb-2">What to do next</div>
            <ul className="text-sm text-zinc-300 space-y-1 list-disc pl-5">
              {nextSteps.map((s, idx) => (
                <li key={idx}>{s}</li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-[#27272a] bg-[#0f0f12] p-5">
            <div className="text-sm font-semibold mb-2">Quick Setup (2 nodes)</div>
            <ol className="text-sm text-zinc-300 space-y-2 list-decimal pl-5">
              <li>
                Deploy the same compose file on both Linux hosts and open the UI on each node.
                <span className="text-zinc-400"> (Keepalived is included and stays idle until enabled here.)</span>
              </li>
              <li>
                Step 1: On <span className="text-zinc-200">both</span> nodes, configure <span className="text-zinc-200">VIP / Keepalived</span>.
              </li>
              <li>
                Step 2: On the node that should own the VIP, enable Leader and generate a Join Code.
              </li>
              <li>
                Step 3: On the other node, paste the Join Code and configure it as Follower.
              </li>
            </ol>

            <div className="mt-4 text-xs text-zinc-500">
              Tip: VIP failover works best when both nodes are in the same L2/VLAN (usually the same subnet). If your network blocks VRRP multicast,
              switch to <span className="font-mono">unicast</span> mode.
            </div>
          </div>

          <div className="rounded-xl border border-[#27272a] bg-[#0f0f12] p-5">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="text-sm font-semibold">Step 1 — VIP / Keepalived (VRRP)</div>
              {haEnabled ? (
                <span
                  className={
                    haBlockingErrors
                      ? 'text-xs px-2 py-1 rounded border border-rose-500/30 bg-rose-500/10 text-rose-200'
                      : 'text-xs px-2 py-1 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                  }
                >
                  {haBlockingErrors ? 'Not ready' : 'Ready to apply'}
                </span>
              ) : null}
            </div>
            <p className="text-sm text-zinc-400 mb-4">
              Optional but recommended for HA: this enables automatic failover for the VIP (the single DNS IP you put into your router).
              When enabled, Sentinel saves a small config file into <span className="font-mono">/data</span> and the keepalived sidecar applies it.
              When this node owns the VIP, it will automatically act as <span className="text-zinc-200">leader</span>.
            </p>

            <div className="mb-4 rounded-md border border-[#27272a] bg-[#121214] px-3 py-3">
              <div className="text-sm font-medium mb-2">{haChecklist.title}</div>
              <ul className="text-sm space-y-1">
                {haChecklist.items.map((it, idx) => (
                  <li
                    key={idx}
                    className={
                      it.kind === 'error'
                        ? 'text-rose-200'
                        : it.kind === 'ok'
                          ? 'text-emerald-200'
                          : 'text-amber-200'
                    }
                  >
                    {it.kind === 'error' ? '• (fix) ' : it.kind === 'ok' ? '• (ok) ' : '• '}
                    {it.text}
                  </li>
                ))}
              </ul>
            </div>

            {netinfo ? (
              <div className="text-sm space-y-2 mb-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-zinc-500">Default interface</span>
                  <span className="font-mono text-zinc-200">{netinfo.defaultInterface || '—'}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-zinc-500">Default gateway</span>
                  <span className="font-mono text-zinc-200">{netinfo.defaultGateway || '—'}</span>
                </div>
              </div>
            ) : (
              <div className="text-sm text-zinc-500 mb-4">
                Host network info is not available yet. This usually means the keepalived sidecar hasn't started or is not supported in your environment (needs Linux host networking).
              </div>
            )}

            <div className="space-y-3">
              <label className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={haEnabled}
                  onChange={(e) => setHaEnabled(e.target.checked)}
                  className="accent-indigo-500"
                />
                <span className="text-zinc-200">Enable VIP failover on this node</span>
              </label>

              <div>
                <div className="text-xs text-zinc-500 mb-1">VIP</div>
                <input
                  value={haVip}
                  onChange={(e) => setHaVip(e.target.value)}
                  placeholder="192.168.1.53 (or 192.168.1.53/24)"
                  disabled={!haEnabled}
                  className="w-full px-3 py-2 rounded-md bg-[#09090b] border border-[#27272a] text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-zinc-500 mb-1">Interface</div>
                  {netinfo?.interfaces?.length ? (
                    <select
                      value={haInterface}
                      onChange={(e) => setHaInterface(e.target.value)}
                      disabled={!haEnabled}
                      className="w-full px-3 py-2 rounded-md bg-[#09090b] border border-[#27272a] text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                    >
                      {netinfo.interfaces.map((i) => (
                        <option key={i.name} value={i.name}>
                          {i.name} ({i.ipv4}/{i.prefix})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={haInterface}
                      onChange={(e) => setHaInterface(e.target.value)}
                      placeholder="e.g. eth0 / ens18"
                      disabled={!haEnabled}
                      className="w-full px-3 py-2 rounded-md bg-[#09090b] border border-[#27272a] text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                    />
                  )}
                </div>

                <div>
                  <div className="text-xs text-zinc-500 mb-1">Priority (per node)</div>
                  <input
                    value={haPriority}
                    onChange={(e) => setHaPriority(e.target.value)}
                    placeholder="120 (node A), 110 (node B)"
                    disabled={!haEnabled}
                    className="w-full px-3 py-2 rounded-md bg-[#09090b] border border-[#27272a] text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-zinc-500 mb-1">VRRP mode</div>
                  <select
                    value={haMode}
                    onChange={(e) => setHaMode(e.target.value as any)}
                    disabled={!haEnabled}
                    className="w-full px-3 py-2 rounded-md bg-[#09090b] border border-[#27272a] text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                  >
                    <option value="multicast">multicast</option>
                    <option value="unicast">unicast</option>
                  </select>
                </div>

                <div>
                  <div className="text-xs text-zinc-500 mb-1">Shared VRRP password</div>
                  <input
                    value={haAuthPass}
                    onChange={(e) => setHaAuthPass(e.target.value)}
                    placeholder={haHasStoredPass ? '(leave empty to keep current)' : '(required)'}
                    disabled={!haEnabled}
                    className="w-full px-3 py-2 rounded-md bg-[#09090b] border border-[#27272a] text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                  />
                  {haHasStoredPass ? <div className="text-xs text-zinc-500 mt-1">A password is already stored for this node.</div> : null}
                </div>
              </div>

              <div className="text-xs text-zinc-500">
                Same on both nodes: <span className="font-mono">VIP</span>, password, mode. Per node: <span className="font-mono">interface</span> and <span className="font-mono">priority</span>.
              </div>

              {haMode === 'unicast' ? (
                <div>
                  <div className="text-xs text-zinc-500 mb-1">Unicast peers (comma separated)</div>
                  <input
                    value={haPeers}
                    onChange={(e) => setHaPeers(e.target.value)}
                    placeholder="192.168.1.10,192.168.1.11"
                    disabled={!haEnabled}
                    className="w-full px-3 py-2 rounded-md bg-[#09090b] border border-[#27272a] text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                  />
                </div>
              ) : null}

              <div className="mt-3 flex items-center justify-end">
                <button
                  onClick={() => void saveHaConfig()}
                  disabled={busy || haBlockingErrors}
                  title={haBlockingErrors && haDisabledReason ? haDisabledReason : undefined}
                  className="px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium"
                >
                  Save & Apply
                </button>
              </div>

              {haEnabled && haBlockingErrors && haDisabledReason ? (
                <div className="mt-2 text-xs text-rose-200 text-right">{haDisabledReason}</div>
              ) : null}
            </div>
          </div>

          <div className="rounded-xl border border-[#27272a] bg-[#0f0f12] p-5">
            <div className="flex items-center gap-2 mb-3">
              <ServerCog className="w-4 h-4 text-zinc-400" />
              <h3 className="font-semibold">Step 2 — Leader Setup</h3>
            </div>
            <p className="text-sm text-zinc-400 mb-4">
              Set the Leader URL to the address that followers can reach. For this demo, use your current UI URL
              {uiOrigin ? (
                <>
                  : <span className="font-mono">{uiOrigin}</span>
                </>
              ) : null}
              . In normal compose this is typically <span className="font-mono">http://&lt;host&gt;:8080</span>.
              (If you publish the UI to a different host port, use that host port — e.g. smoke demo uses <span className="font-mono">18080</span>.)
            </p>

            <div className="flex flex-col md:flex-row gap-3">
              <input
                value={leaderUrl}
                onChange={(e) => setLeaderUrl(e.target.value)}
                placeholder={uiOrigin || 'http://<host>:8080'}
                className="flex-1 px-3 py-2 rounded-md bg-[#09090b] border border-[#27272a] text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
              />
              <button
                onClick={() => void enableLeader()}
                disabled={busy}
                className="px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium"
              >
                Enable Leader
              </button>
            </div>

            <div className="mt-5 pt-5 border-t border-[#27272a]">
              <div className="flex items-center justify-between gap-3 mb-2">
                <div>
                  <div className="text-sm font-medium">Join Code</div>
                  <div className="text-xs text-zinc-500">Copy/paste this into the follower node.</div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void fetchJoinCode()}
                    disabled={joinCodeBusy || !canShowJoinCode}
                    className="px-3 py-2 rounded-md border border-[#27272a] bg-[#121214] text-sm hover:bg-[#18181b] disabled:opacity-50"
                    title={!canShowJoinCode ? 'Enable leader first (and ensure role is leader)' : undefined}
                  >
                    {joinCodeBusy ? 'Loading…' : 'Load'}
                  </button>
                  <button
                    onClick={async () => {
                      const ok = await copyToClipboard(joinCode);
                      showMsg(ok ? 'success' : 'error', ok ? 'Copied join code.' : 'Failed to copy.');
                    }}
                    disabled={!joinCode}
                    className="px-3 py-2 rounded-md border border-[#27272a] bg-[#121214] text-sm hover:bg-[#18181b] disabled:opacity-50 inline-flex items-center gap-2"
                  >
                    <Copy className="w-4 h-4" />
                    Copy
                  </button>
                </div>
              </div>
              <textarea
                value={joinCode}
                readOnly
                placeholder="Join code will appear here…"
                className="w-full h-28 px-3 py-2 rounded-md bg-[#09090b] border border-[#27272a] text-zinc-200 placeholder:text-zinc-600 font-mono text-xs focus:outline-none"
              />
            </div>
          </div>

          <div className="rounded-xl border border-[#27272a] bg-[#0f0f12] p-5">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="w-4 h-4 text-zinc-400" />
              <h3 className="font-semibold">Step 3 — Configure Follower</h3>
            </div>
            <p className="text-sm text-zinc-400 mb-4">Paste a join code from the leader. This node will start syncing automatically.</p>

            <textarea
              value={followerJoinCode}
              onChange={(e) => setFollowerJoinCode(e.target.value)}
              placeholder="Paste join code here…"
              className="w-full h-28 px-3 py-2 rounded-md bg-[#09090b] border border-[#27272a] text-zinc-200 placeholder:text-zinc-600 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            />
            <div className="mt-3 flex items-center justify-end">
              <button
                onClick={() => void configureFollower()}
                disabled={busy}
                className="px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium"
              >
                Configure as Follower
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-xl border border-[#27272a] bg-[#0f0f12] p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-zinc-400" />
                <h3 className="font-semibold">Status</h3>
              </div>
              <div className="flex items-center gap-2">
                <span className={activeBadge.className}>{activeBadge.text}</span>
                <span className={roleBadge}>Role: {effectiveRole}</span>
              </div>
            </div>

            {loading ? (
              <div className="text-sm text-zinc-400">Loading cluster status…</div>
            ) : status ? (
              <div className="grid grid-cols-1 gap-4 text-sm">
                <div className="space-y-1">
                  <div className="text-zinc-500">Node ID</div>
                  <div className="font-mono text-zinc-200 break-all">{status.nodeId}</div>
                </div>
                <div className="space-y-1">
                  <div className="text-zinc-500">Enabled</div>
                  <div className="text-zinc-200">{status.config.enabled ? 'Yes' : 'No'}</div>
                </div>
                <div className="space-y-1">
                  <div className="text-zinc-500">Leader URL</div>
                  <div className="font-mono text-zinc-200 break-all">{status.config.leaderUrl || '—'}</div>
                </div>
                <div className="space-y-1">
                  <div className="text-zinc-500">Follower last sync</div>
                  <div className="text-zinc-200">{formatWhen(status.lastSync)}</div>
                </div>

                <div className="space-y-1">
                  <div className="text-zinc-500">Last sync duration</div>
                  <div className="text-zinc-200">{formatDurationMs(status.lastSyncDurationMs)}</div>
                </div>

                <div className="space-y-1">
                  <div className="text-zinc-500">Last snapshot</div>
                  <div className="text-zinc-200">
                    {formatBytes(status.lastSnapshotBytes)}
                    {status.lastSnapshotCounts
                      ? ` (settings ${status.lastSnapshotCounts.settings}, clients ${status.lastSnapshotCounts.clients}, rules ${status.lastSnapshotCounts.rules}, blocklists ${status.lastSnapshotCounts.blocklists}, secrets ${status.lastSnapshotCounts.secrets})`
                      : ''}
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="text-zinc-500">Last error</div>
                  <div className={status.lastError ? 'text-rose-300 font-mono break-all' : 'text-zinc-400'}>
                    {status.lastError || '—'}
                  </div>
                </div>

                {warningOverride ? (
                  <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-200 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />
                    <span>{warningOverride}</span>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="text-sm text-rose-300">Failed to load cluster status. Is the API reachable?</div>
            )}
          </div>

          <div className="rounded-xl border border-[#27272a] bg-[#0f0f12] p-5">
            <div className="text-sm font-semibold mb-3">HA / VIP Readiness</div>
            <p className="text-sm text-zinc-400 mb-4">
              Keepalived can poll <span className="font-mono">/api/cluster/ready</span> to decide whether the node is ready to own the VIP.
            </p>

            {ready ? (
              <div className="text-sm space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">Ready</span>
                  <span className={ready.ok ? 'text-emerald-300' : 'text-rose-300'}>{ready.ok ? 'OK' : 'NOT READY'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">Role</span>
                  <span className="text-zinc-200">{ready.role}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">Last sync</span>
                  <span className="text-zinc-200">{formatWhen(ready.lastSync || undefined)}</span>
                </div>
              </div>
            ) : (
              <div className="text-sm text-zinc-500">No readiness data.</div>
            )}
          </div>

          <div className="rounded-xl border border-[#27272a] bg-[#0f0f12] p-5">
            <div className="text-sm font-semibold mb-2">Notes</div>
            <ul className="text-sm text-zinc-400 space-y-2 list-disc pl-5">
              <li>For a two-host homelab, VRRP/VIP gives you one DNS IP in the router.</li>
              <li>Followers are read-only to avoid conflicting writes.</li>
              <li>Logs sync is not part of this MVP yet (needs batching/retention).</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Cluster;
