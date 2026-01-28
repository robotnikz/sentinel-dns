import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, RefreshCw, Shield, ServerCog, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { ReadOnlyFollowerBanner } from '../components/ReadOnlyFollowerBanner';

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

function vipIpOnly(input: string): string {
  const s = String(input || '').trim();
  if (!s) return '';
  // allow users to paste CIDR; keep only the IP part.
  return s.split('/')[0].trim();
}

function buildVipLeaderUrl(opts: { vip: string; fallbackOrigin: string }): string {
  const vip = vipIpOnly(opts.vip);
  if (!vip) return '';
  try {
    const u = new URL(opts.fallbackOrigin);
    const port = u.port || (u.protocol === 'https:' ? '443' : '80');
    return `${u.protocol}//${vip}:${port}`;
  } catch {
    return `http://${vip}:8080`;
  }
}

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

  const [haVip, setHaVip] = useState<string>('192.168.1.53');
  const [haInterface, setHaInterface] = useState<string>('');
  const [haPriority, setHaPriority] = useState<string>('110');
  const [haMode, setHaMode] = useState<'multicast' | 'unicast'>('multicast');
  const [haPeers, setHaPeers] = useState<string>('');
  const [haAuthPass, setHaAuthPass] = useState<string>('');
  const [haEnabled, setHaEnabled] = useState<boolean>(false);
  const [haHasStoredPass, setHaHasStoredPass] = useState<boolean>(false);

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

  const vipLeaderUrlSuggestion = useMemo(() => {
    return buildVipLeaderUrl({ vip: haVip, fallbackOrigin: uiOrigin || 'http://localhost:8080' });
  }, [haVip, uiOrigin]);

  const [joinCode, setJoinCode] = useState<string>('');
  const [joinCodeBusy, setJoinCodeBusy] = useState(false);

  const [followerJoinCode, setFollowerJoinCode] = useState<string>('');

  const [failoverTestDomain, setFailoverTestDomain] = useState<string>('example.com');

  type WizardRole = 'leader' | 'follower';
  const [wizardRole, setWizardRole] = useState<WizardRole | ''>(() => {
    try {
      const v = window.localStorage.getItem('sentinel.haWizardRole');
      if (v === 'leader' || v === 'follower') return v;
      return '';
    } catch {
      return '';
    }
  });
  const [wizardStep, setWizardStep] = useState<number>(0);
  const [showVipAdvanced, setShowVipAdvanced] = useState<boolean>(false);

  const WIZARD_VIS_KEY = 'sentinel.haWizard.show';
  const wizardVisPrefExistsRef = useRef<boolean>((() => {
    try {
      return window.localStorage.getItem(WIZARD_VIS_KEY) != null;
    } catch {
      return false;
    }
  })());

  const [showWizard, setShowWizard] = useState<boolean>(() => {
    try {
      const v = window.localStorage.getItem(WIZARD_VIS_KEY);
      if (v === '1') return true;
      if (v === '0') return false;
      // No explicit user preference yet. Default to status-only to avoid showing
      // the setup wizard on already-configured nodes (it will be enabled automatically
      // if the node is not configured).
      return false;
    } catch {
      return false;
    }
  });

  const setWizardVisible = useCallback((visible: boolean) => {
    setShowWizard(visible);
    try {
      window.localStorage.setItem(WIZARD_VIS_KEY, visible ? '1' : '0');
      wizardVisPrefExistsRef.current = true;
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      if (wizardRole) window.localStorage.setItem('sentinel.haWizardRole', wizardRole);
    } catch {
      // ignore
    }
  }, [wizardRole]);

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

  const isConfigured = Boolean(status?.config.enabled) || Boolean(haEnabled);

  // If the user has not explicitly chosen, automatically show the wizard only when needed.
  useEffect(() => {
    if (wizardVisPrefExistsRef.current) return;
    setShowWizard(!isConfigured);
  }, [isConfigured]);

  // In HA mode, keepalived can temporarily override the effective role.
  // When a configured follower becomes the VIP owner (effective leader), follower sync errors/age are expected
  // until the configured leader comes back.
  const isFailoverVipOwner = !!(
    haEnabled &&
    status?.config.enabled &&
    status?.config.role === 'follower' &&
    effectiveRole === 'leader'
  );

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
  const warningOverride = status?.roleOverride ? `Role override active: ${status.roleOverride}` : '';

  const StatusCards = (
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
              {isFailoverVipOwner ? (
                <div>
                  <div className={status.lastError ? 'text-amber-300 font-mono break-all' : 'text-zinc-400'}>{status.lastError || '—'}</div>
                  <div className="text-xs text-zinc-500 mt-1">During failover, sync errors are expected until the leader is reachable again.</div>
                </div>
              ) : (
                <div className={status.lastError ? 'text-rose-300 font-mono break-all' : 'text-zinc-400'}>
                  {status.lastError || '—'}
                </div>
              )}
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
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="text-sm font-semibold">HA / VIP config</div>
        </div>

        <div className="text-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-zinc-500">Enabled</span>
            <span className="text-zinc-200">{haEnabled ? 'Yes' : 'No'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-zinc-500">VIP</span>
            <span className="font-mono text-zinc-200">{haVip || '—'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-zinc-500">Mode</span>
            <span className="text-zinc-200">{haMode}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-zinc-500">Interface</span>
            <span className="font-mono text-zinc-200">{haInterface || '—'}</span>
          </div>
          <div className="space-y-1">
            <div className="text-zinc-500">Unicast peers</div>
            <div className="font-mono text-zinc-200 break-all">{haPeers?.trim() ? haPeers : '—'}</div>
          </div>
        </div>
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
          <li>Set router/DHCP DNS to the VIP only (avoid “two DNS IPs” if you expect seamless failover).</li>
          <li>For VIP HA, Leader URL should point to the VIP so followers always reach the active leader.</li>
          <li>Followers are read-only to avoid conflicting writes.</li>
          <li>Logs sync is not part of this MVP yet (needs batching/retention).</li>
        </ul>
      </div>
    </div>
  );

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

  // Show join code whenever this node is configured as leader.
  // In HA mode, keepalived may temporarily override the effective role (e.g. follower until VIP ownership),
  // but users still need the join code to enroll followers.
  const canShowJoinCode = status?.config.enabled && status?.config.role === 'leader' && !!status?.config.leaderUrl;

  const leaderUrlMismatchWarning = useMemo(() => {
    if (!haEnabled) return '';
    const vip = vipIpOnly(haVip);
    if (!vip) return '';
    const cur = leaderUrl.trim();
    if (!cur) return '';
    // If leaderUrl doesn't point at the VIP, failover will break follower sync.
    if (!cur.includes(vip)) {
      return `Recommended: set Leader URL to the VIP (${vip}) so followers keep syncing after failover.`;
    }
    return '';
  }, [haEnabled, haVip, leaderUrl]);

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

  const wizardSteps = useMemo(() => {
    const base = [{ key: 'role', title: 'This node' }, { key: 'vip', title: 'VIP failover' }];
    if (!wizardRole) return base;
    if (wizardRole === 'leader') {
      return [...base, { key: 'leader', title: 'Enable leader' }, { key: 'join', title: 'Join code' }, { key: 'router', title: 'Router & test' }];
    }
    return [...base, { key: 'join', title: 'Connect' }, { key: 'router', title: 'Router & test' }];
  }, [wizardRole]);

  useEffect(() => {
    // Clamp step if role changes.
    setWizardStep((s) => Math.min(s, Math.max(0, wizardSteps.length - 1)));
  }, [wizardSteps.length]);

  const wizardKey = wizardSteps[wizardStep]?.key || 'role';

  const netinfoAgeMs = useMemo(() => {
    const iso = netinfo?.detectedAt;
    if (!iso) return null;
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return null;
    return Math.max(0, Date.now() - t);
  }, [netinfo?.detectedAt]);

  const liveChecks = useMemo(() => {
    const items: Array<{ kind: 'ok' | 'warn' | 'error'; label: string; detail?: string }> = [];

    // Host netinfo (best signal that keepalived sidecar is running with the shared volume).
    if (netinfo?.interfaces?.length) {
      const age = netinfoAgeMs;
      if (typeof age === 'number' && age > 90_000) {
        items.push({ kind: 'warn', label: 'Keepalived sidecar: netinfo is stale', detail: 'Restart keepalived if needed.' });
      } else {
        items.push({ kind: 'ok', label: 'Keepalived sidecar: netinfo available' });
      }
    } else {
      items.push({
        kind: 'warn',
        label: 'Interface autodetect unavailable',
        detail: 'You can still type the interface manually (e.g. ens18 / eth0).'
      });
    }

    if (!vipIpOnly(haVip)) items.push({ kind: haEnabled ? 'error' : 'warn', label: 'VIP not set yet' });
    if (!haInterface.trim()) items.push({ kind: haEnabled ? 'warn' : 'warn', label: 'Interface not selected yet' });
    if (!haAuthPass.trim() && !haHasStoredPass) items.push({ kind: haEnabled ? 'error' : 'warn', label: 'Shared VRRP password missing' });
    if (haMode === 'unicast') {
      const peers = haPeers
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (peers.length === 0) items.push({ kind: haEnabled ? 'error' : 'warn', label: 'Unicast peers missing' });
    }

    if (haEnabled && !haBlockingErrors) items.push({ kind: 'ok', label: 'VIP settings ready to apply on this node' });

    if (!status?.config.enabled) {
      items.push({ kind: 'warn', label: 'Cluster not enabled yet', detail: 'Enable leader on the intended VIP owner.' });
    } else if (status.config.role === 'leader') {
      items.push({ kind: 'ok', label: 'This node is configured as Leader', detail: status.config.leaderUrl ? `Leader URL: ${status.config.leaderUrl}` : undefined });
    } else if (status.config.role === 'follower') {
      if (isFailoverVipOwner) {
        items.push({
          kind: 'ok',
          label: 'Failover active: this node is serving the VIP',
          detail: 'Follower sync from the leader is expected to be stale while the leader is offline.'
        });
      } else {
        const last = status.lastSync ? Date.parse(status.lastSync) : 0;
        const fresh = last > 0 && Date.now() - last < 20_000;
        items.push({
          kind: fresh ? 'ok' : 'warn',
          label: fresh ? 'Follower sync is healthy' : 'Follower has not synced recently',
          detail: fresh ? undefined : 'Paste a Join Code from the leader and ensure Leader URL points to the VIP.'
        });
      }
    }

    if (ready) {
      items.push({ kind: ready.ok ? 'ok' : 'warn', label: ready.ok ? 'Keepalived readiness: OK' : 'Keepalived readiness: NOT READY', detail: ready.role ? `Role: ${ready.role}` : undefined });
    }

    return items;
  }, [haAuthPass, haBlockingErrors, haEnabled, haHasStoredPass, haInterface, haMode, haPeers, haVip, isFailoverVipOwner, netinfo?.interfaces?.length, netinfoAgeMs, ready, status]);

  const failoverCommands = useMemo(() => {
    const vip = vipIpOnly(haVip);
    const domain = String(failoverTestDomain || 'example.com').trim() || 'example.com';
    if (!vip) return { vip: '', domain, cmds: [] as string[] };

    const cmds: string[] = [];
    // Cross-platform friendly commands users can run on any LAN client.
    cmds.push(`# Linux/macOS (dig)`);
    cmds.push(`dig @${vip} ${domain} A`);
    cmds.push('');
    cmds.push(`# Windows (PowerShell)`);
    cmds.push(`Resolve-DnsName -Server ${vip} -Name ${domain} -Type A`);
    cmds.push('');
    cmds.push(`# Windows (classic)`);
    cmds.push(`nslookup ${domain} ${vip}`);

    return { vip, domain, cmds };
  }, [failoverTestDomain, haVip]);

  const readOnlyFollower = Boolean(status?.config?.enabled && status?.config?.role === 'follower');

  return (
    <div className="p-8 text-zinc-200">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Cluster / HA</h2>
          <p className="text-sm text-zinc-400 mt-1">
            Easy failover for home networks: one VIP (e.g. <span className="font-mono">192.168.1.53</span>) for your router, and Sentinel sync between nodes.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {isConfigured && !showWizard ? (
            <button
              type="button"
              onClick={() => setWizardVisible(true)}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium"
            >
              Re-run setup
            </button>
          ) : null}
          {isConfigured && showWizard ? (
            <button
              type="button"
              onClick={() => setWizardVisible(false)}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-[#27272a] bg-[#121214] text-sm text-zinc-200 hover:bg-[#18181b]"
              title="Hide the guided wizard and show status only"
            >
              Hide setup
            </button>
          ) : null}

          <button
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-[#27272a] bg-[#121214] text-sm text-zinc-200 hover:bg-[#18181b] disabled:opacity-50"
          >
            <RefreshCw className={loading ? 'w-4 h-4 animate-spin' : 'w-4 h-4'} />
            Refresh
          </button>
        </div>
      </div>

      <ReadOnlyFollowerBanner show={readOnlyFollower} className="mb-6" />

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

      {showWizard ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="rounded-xl border border-[#27272a] bg-[#0f0f12] p-5">
            <div className="flex items-center justify-between gap-4 mb-4">
              <div>
                <div className="text-sm font-semibold">Guided HA setup</div>
                <div className="text-xs text-zinc-500 mt-1">Pick a role for this node and follow the steps in order. Most fields are auto-filled when possible.</div>
              </div>
              <div className="text-xs text-zinc-500">{wizardRole ? `Role: ${wizardRole}` : 'Choose a role'}</div>
            </div>

            <div className="mb-4 rounded-md border border-[#27272a] bg-[#121214] px-3 py-3">
              <div className="text-sm font-medium mb-2">Live checks</div>
              <div className="space-y-1 text-sm">
                {liveChecks.map((c, idx) => (
                  <div key={idx} className="flex items-start gap-2">
                    {c.kind === 'ok' ? (
                      <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-300" />
                    ) : c.kind === 'error' ? (
                      <AlertTriangle className="w-4 h-4 mt-0.5 text-rose-300" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-300" />
                    )}
                    <div className={c.kind === 'ok' ? 'text-emerald-200' : c.kind === 'error' ? 'text-rose-200' : 'text-amber-200'}>
                      <div>{c.label}</div>
                      {c.detail ? <div className="text-xs text-zinc-500 mt-0.5">{c.detail}</div> : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-2 mb-4">
              {wizardSteps.map((s, idx) => {
                const active = idx === wizardStep;
                const done = idx < wizardStep;
                return (
                  <button
                    key={s.key}
                    onClick={() => setWizardStep(idx)}
                    className={
                      'text-xs px-2.5 py-1.5 rounded-md border ' +
                      (active
                        ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-200'
                        : done
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                          : 'border-[#27272a] bg-[#0f0f12] text-zinc-300 hover:bg-[#18181b]')
                    }
                  >
                    {idx + 1}. {s.title}
                  </button>
                );
              })}
            </div>

            {wizardKey === 'role' ? (
              <div>
                <div className="text-sm font-medium mb-2">Step 1 — Choose what this node should be</div>
                <div className="text-sm text-zinc-400 mb-4">
                  This choice controls what the wizard shows. It does not change the server role until you click the relevant action (Enable Leader / Configure as Follower).
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <button
                    onClick={() => {
                      setWizardRole('leader');
                      setWizardStep(1);
                    }}
                    className={
                      'text-left rounded-xl border p-4 ' +
                      (wizardRole === 'leader'
                        ? 'border-indigo-500/40 bg-indigo-500/10'
                        : 'border-[#27272a] bg-[#0f0f12] hover:bg-[#18181b]')
                    }
                  >
                    <div className="text-sm font-semibold text-zinc-100">Leader (preferred VIP owner)</div>
                    <div className="text-xs text-zinc-500 mt-1">Use this on the node that should own the VIP most of the time.</div>
                    <div className="text-xs text-zinc-400 mt-3">Recommended priority: <span className="font-mono">120</span></div>
                  </button>
                  <button
                    onClick={() => {
                      setWizardRole('follower');
                      setWizardStep(1);
                    }}
                    className={
                      'text-left rounded-xl border p-4 ' +
                      (wizardRole === 'follower'
                        ? 'border-indigo-500/40 bg-indigo-500/10'
                        : 'border-[#27272a] bg-[#0f0f12] hover:bg-[#18181b]')
                    }
                  >
                    <div className="text-sm font-semibold text-zinc-100">Follower (standby)</div>
                    <div className="text-xs text-zinc-500 mt-1">Use this on the second node. It stays read-only and syncs from the leader.</div>
                    <div className="text-xs text-zinc-400 mt-3">Recommended priority: <span className="font-mono">110</span></div>
                  </button>
                </div>

                <div className="mt-4 text-xs text-zinc-500">
                  Current server config: <span className="font-mono">{status?.config.role || '—'}</span> / enabled: <span className="font-mono">{status?.config.enabled ? 'yes' : 'no'}</span>
                </div>
              </div>
            ) : null}

            {wizardKey === 'vip' ? (
              <div>
                <div className="text-sm font-medium mb-2">Step 2 — Configure VIP failover (Keepalived)</div>
                <div className="text-sm text-zinc-400 mb-4">
                  Do this on <span className="text-zinc-200">both nodes</span>. Use the same VIP + password on both nodes. Priority should be higher on the preferred VIP owner.
                </div>

                <div className="space-y-3">
                  <label className="flex items-center gap-3 text-sm">
                    <input type="checkbox" checked={haEnabled} onChange={(e) => setHaEnabled(e.target.checked)} className="accent-indigo-500" />
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
                          <option value="">Select…</option>
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
                          placeholder="e.g. ens18 / eth0"
                          disabled={!haEnabled}
                          className="w-full px-3 py-2 rounded-md bg-[#09090b] border border-[#27272a] text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                        />
                      )}
                      {netinfo?.defaultInterface ? (
                        <div className="text-xs text-zinc-500 mt-1">
                          Suggested: <span className="font-mono">{netinfo.defaultInterface}</span>
                        </div>
                      ) : null}
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

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <div className="text-xs text-zinc-500 mb-1">Priority</div>
                      <input
                        value={haPriority}
                        onChange={(e) => setHaPriority(e.target.value)}
                        placeholder={wizardRole === 'leader' ? '120 (recommended)' : '110 (recommended)'}
                        disabled={!haEnabled}
                        className="w-full px-3 py-2 rounded-md bg-[#09090b] border border-[#27272a] text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                      />
                      <div className="text-xs text-zinc-500 mt-1">Higher priority usually owns the VIP.</div>
                    </div>
                    <div className="flex items-end justify-between">
                      <button
                        onClick={() => setShowVipAdvanced((v) => !v)}
                        className="px-3 py-2 rounded-md border border-[#27272a] bg-[#121214] text-sm hover:bg-[#18181b]"
                        type="button"
                      >
                        {showVipAdvanced ? 'Hide advanced' : 'Show advanced'}
                      </button>
                    </div>
                  </div>

                  {showVipAdvanced ? (
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
                        <div className="text-xs text-zinc-500 mt-1">If multicast is blocked in your network, switch to unicast.</div>
                      </div>
                      <div>
                        <div className="text-xs text-zinc-500 mb-1">Unicast peers (comma separated)</div>
                        <input
                          value={haPeers}
                          onChange={(e) => setHaPeers(e.target.value)}
                          placeholder="192.168.1.10,192.168.1.11"
                          disabled={!haEnabled || haMode !== 'unicast'}
                          className="w-full px-3 py-2 rounded-md bg-[#09090b] border border-[#27272a] text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                        />
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-3 flex items-center justify-between">
                    <div className="text-xs text-zinc-500">Same on both nodes: VIP, password, mode. Per node: interface, priority.</div>
                    <button
                      onClick={() => void saveHaConfig()}
                      disabled={busy || haBlockingErrors}
                      title={haBlockingErrors && haDisabledReason ? haDisabledReason : undefined}
                      className="px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium"
                    >
                      Save & Apply
                    </button>
                  </div>

                  {haEnabled && haBlockingErrors && haDisabledReason ? <div className="mt-2 text-xs text-rose-200">{haDisabledReason}</div> : null}
                </div>
              </div>
            ) : null}

            {wizardKey === 'leader' ? (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <ServerCog className="w-4 h-4 text-zinc-400" />
                  <div className="text-sm font-medium">Step 3 — Enable Leader</div>
                </div>
                <p className="text-sm text-zinc-400 mb-4">
                  Followers must reach the leader via this URL. For real VIP HA, it should be the VIP URL.
                </p>

                {leaderUrlMismatchWarning ? (
                  <div className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-200 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 mt-0.5" />
                    <span className="text-sm">{leaderUrlMismatchWarning}</span>
                  </div>
                ) : null}

                <div className="flex flex-col md:flex-row gap-3">
                  <input
                    value={leaderUrl}
                    onChange={(e) => setLeaderUrl(e.target.value)}
                    placeholder={uiOrigin || 'http://<host>:8080'}
                    className="flex-1 px-3 py-2 rounded-md bg-[#09090b] border border-[#27272a] text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                  />
                  {haEnabled && vipLeaderUrlSuggestion ? (
                    <button
                      onClick={() => setLeaderUrl(vipLeaderUrlSuggestion)}
                      disabled={busy}
                      className="px-4 py-2 rounded-md border border-[#27272a] bg-[#121214] hover:bg-[#18181b] disabled:opacity-50 text-zinc-200 text-sm font-medium"
                      title="Recommended for VIP HA"
                      type="button"
                    >
                      Use VIP
                    </button>
                  ) : null}
                  <button
                    onClick={() => void enableLeader()}
                    disabled={busy}
                    className="px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium"
                  >
                    Enable Leader
                  </button>
                </div>

                <div className="mt-3 text-xs text-zinc-500">After enabling leader, go to the Join Code step.</div>
              </div>
            ) : null}

            {wizardKey === 'join' ? (
              <div>
                {wizardRole === 'leader' ? (
                  <div>
                    <div className="text-sm font-medium mb-2">Step 4 — Get Join Code</div>
                    <div className="text-sm text-zinc-400 mb-4">Copy/paste this into the follower node.</div>
                    <div className="flex items-center gap-2 mb-2">
                      <button
                        onClick={() => void fetchJoinCode()}
                        disabled={joinCodeBusy || !canShowJoinCode}
                        className="px-3 py-2 rounded-md border border-[#27272a] bg-[#121214] text-sm hover:bg-[#18181b] disabled:opacity-50"
                        title={!canShowJoinCode ? 'Enable leader first' : undefined}
                      >
                        {joinCodeBusy ? 'Loading…' : 'Load join code'}
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
                    <textarea
                      value={joinCode}
                      readOnly
                      placeholder="Join code will appear here…"
                      className="w-full h-28 px-3 py-2 rounded-md bg-[#09090b] border border-[#27272a] text-zinc-200 placeholder:text-zinc-600 font-mono text-xs focus:outline-none"
                    />
                  </div>
                ) : (
                  <div>
                    <div className="text-sm font-medium mb-2">Step 3 — Connect this follower to the leader</div>
                    <div className="text-sm text-zinc-400 mb-4">Paste the Join Code from the leader. Sync starts automatically.</div>

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
                )}
              </div>
            ) : null}

            {wizardKey === 'router' ? (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Shield className="w-4 h-4 text-zinc-400" />
                  <div className="text-sm font-medium">Final — Router DNS & quick test</div>
                </div>

                <ol className="text-sm text-zinc-300 space-y-2 list-decimal pl-5">
                  <li>
                    Set your router/DHCP DNS to the VIP only (example: <span className="font-mono">{vipIpOnly(haVip) || '192.168.1.53'}</span>).
                  </li>
                  <li>
                    Confirm that one node becomes VIP owner and the other stays standby. (Status card should show <span className="text-zinc-200">Leader</span> + <span className="text-zinc-200">Follower</span>.)
                  </li>
                  <li>Run a DNS query against the VIP from any LAN client (commands below).</li>
                </ol>

                <div className="mt-4">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div>
                      <div className="text-sm font-medium">DNS test commands</div>
                      <div className="text-xs text-zinc-500">Run on any LAN client.</div>
                    </div>
                    <button
                      onClick={async () => {
                        const text = failoverCommands.cmds.join('\n');
                        const ok = await copyToClipboard(text);
                        showMsg(ok ? 'success' : 'error', ok ? 'Copied DNS test commands.' : 'Failed to copy.');
                      }}
                      disabled={!failoverCommands.vip}
                      className="px-3 py-2 rounded-md border border-[#27272a] bg-[#121214] text-sm hover:bg-[#18181b] disabled:opacity-50 inline-flex items-center gap-2"
                      title={!failoverCommands.vip ? 'Set a VIP first' : undefined}
                      type="button"
                    >
                      <Copy className="w-4 h-4" />
                      Copy
                    </button>
                  </div>
                  <pre className="w-full whitespace-pre-wrap break-words px-3 py-2 rounded-md bg-[#09090b] border border-[#27272a] text-zinc-200 font-mono text-xs">
                    {failoverCommands.vip ? failoverCommands.cmds.join('\n') : 'Set a VIP to generate commands.'}
                  </pre>
                </div>
              </div>
            ) : null}

            <div className="mt-5 flex items-center justify-between">
              <button
                onClick={() => setWizardStep((s) => Math.max(0, s - 1))}
                disabled={wizardStep === 0}
                className="px-3 py-2 rounded-md border border-[#27272a] bg-[#121214] text-sm hover:bg-[#18181b] disabled:opacity-50"
                type="button"
              >
                Back
              </button>
              <button
                onClick={() => setWizardStep((s) => Math.min(wizardSteps.length - 1, s + 1))}
                disabled={wizardStep >= wizardSteps.length - 1}
                className="px-3 py-2 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium"
                type="button"
              >
                Next
              </button>
            </div>
          </div>
          </div>

          <div className="lg:col-span-1">{StatusCards}</div>
        </div>
      ) : (
        <div>{StatusCards}</div>
      )}
    </div>
  );
};

export default Cluster;
