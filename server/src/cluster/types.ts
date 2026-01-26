export type ClusterRole = 'standalone' | 'leader' | 'follower';

export type ClusterConfig = {
  enabled: boolean;
  role: ClusterRole;
  leaderUrl?: string;
};

export type ClusterStatus = {
  nodeId: string;
  config: ClusterConfig;
  lastSync?: string;
  lastError?: string;
};

export type ClusterJoinCode = {
  leaderUrl: string;
  psk: string;
  createdAt: string;
};

export type ClusterExportSnapshot = {
  exportedAt: string;
  nodeId: string;
  settings: Array<{ key: string; value: unknown; updatedAt: string }>;
  clients: Array<{ id: string; profile: unknown; updatedAt: string }>;
  rules: Array<{ domain: string; type: string; category: string; createdAt: string }>;
  blocklists: Array<{
    id: number;
    name: string;
    url: string;
    enabled: boolean;
    mode: string;
    lastUpdatedAt: string | null;
    lastError: string | null;
    lastRuleCount: number;
    createdAt: string;
    updatedAt: string;
  }>;
  secrets: Array<{ name: string; value: string }>;
};
