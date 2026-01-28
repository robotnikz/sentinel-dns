import { useEffect, useState } from 'react';
import { getAuthHeaders } from '../services/apiClient';

export type ClusterRole = 'standalone' | 'leader' | 'follower';

export type ClusterStatus = {
  config?: {
    enabled?: boolean;
    role?: ClusterRole | string;
  };
  effectiveRole?: ClusterRole | string;
};

export function useClusterStatus(): {
  status: ClusterStatus | null;
  loading: boolean;
} {
  const [status, setStatus] = useState<ClusterStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/cluster/status', {
          headers: { ...getAuthHeaders(), Accept: 'application/json' },
          credentials: 'include'
        });
        const data = await res.json().catch(() => null);
        if (!cancelled) setStatus((data || null) as any);
      } catch {
        if (!cancelled) setStatus(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { status, loading };
}

export function getEffectiveRole(status: ClusterStatus | null): ClusterRole {
  const r = String((status as any)?.effectiveRole || (status as any)?.config?.role || 'standalone');
  if (r === 'leader' || r === 'follower' || r === 'standalone') return r;
  return 'standalone';
}

export function getConfiguredRole(status: ClusterStatus | null): ClusterRole {
  const r = String((status as any)?.config?.role || 'standalone');
  if (r === 'leader' || r === 'follower' || r === 'standalone') return r;
  return 'standalone';
}

export function isReadOnlyFollower(status: ClusterStatus | null): boolean {
  const enabled = Boolean((status as any)?.config?.enabled);
  if (!enabled) return false;
  // Backup-only semantics: configured follower is always read-only.
  return getConfiguredRole(status) === 'follower';
}
