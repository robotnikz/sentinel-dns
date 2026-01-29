import type { AppConfig } from '../config.js';
import type { Db } from '../db.js';
import { notifyEvent } from '../notifications/notify.js';
import { getClusterConfig } from './store.js';
import { readRoleOverride } from './role.js';

export function startHaNotificationsLoop(config: AppConfig, db: Db): { stop: () => void } {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  // Track the *override* role, not the stored one.
  // In VIP/VRRP mode keepalived writes CLUSTER_ROLE_FILE to force leader/follower.
  let lastOverride: 'leader' | 'follower' | 'none' = 'none';

  const tick = async () => {
    if (stopped) return;

    try {
      const cfg = await getClusterConfig(db);
      if (!cfg?.enabled) {
        lastOverride = 'none';
        return;
      }

      const override = readRoleOverride(config);
      const nextOverride = override === 'leader' || override === 'follower' ? override : 'none';

      // Only treat keepalived overrides as HA failover signals.
      // The intent is:
      // - stored follower + override leader => this node took over (failover active)
      // - stored follower + override leader -> (follower|none) => leader/VIP is back (failover ended)
      if (cfg.role === 'follower') {
        if (lastOverride !== 'leader' && nextOverride === 'leader') {
          await notifyEvent(db, config, 'haFailoverActive', {
            title: 'HA Failover Active',
            message: 'This node took over the VIP and is acting as leader.',
            severity: 'warning',
            meta: { storedRole: cfg.role, overrideRole: nextOverride }
          });
        }

        if (lastOverride === 'leader' && nextOverride !== 'leader') {
          await notifyEvent(db, config, 'haLeaderAvailableAgain', {
            title: 'HA Leader Available Again',
            message: 'This node relinquished the VIP and returned to follower mode.',
            severity: 'info',
            meta: { storedRole: cfg.role, overrideRole: nextOverride }
          });
        }
      }

      lastOverride = nextOverride;
    } catch {
      // Ignore monitoring errors; loop will retry.
    }
  };

  timer = setInterval(() => void tick(), 2_500);
  // Prime quickly so a running node reports promptly.
  void tick();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearInterval(timer);
    }
  };
}
