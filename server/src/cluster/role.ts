import fs from 'node:fs';
import type { AppConfig } from '../config.js';
import type { ClusterRole } from './types.js';

export function readRoleOverride(config: AppConfig): ClusterRole | undefined {
  const p = String((config as any).CLUSTER_ROLE_FILE || '').trim();
  if (!p) return undefined;

  try {
    const raw = fs.readFileSync(p, 'utf8').trim().toLowerCase();
    if (raw === 'leader' || raw === 'follower') return raw;
  } catch {
    // ignore
  }

  return undefined;
}

export function effectiveRole(config: AppConfig, stored: ClusterRole): ClusterRole {
  return readRoleOverride(config) ?? stored;
}
