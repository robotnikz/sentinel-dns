import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config.js';
import type { Db } from '../db.js';
import { requireAdmin } from '../auth.js';
import { notifyEvent } from '../notifications/notify.js';

type PauseMode = 'OFF' | 'UNTIL' | 'FOREVER';

type ProtectionPauseSetting = {
  mode: PauseMode;
  until?: string | null;
};

function parsePauseSetting(raw: any): ProtectionPauseSetting {
  if (!raw || typeof raw !== 'object') return { mode: 'OFF' };
  const mode: PauseMode = raw.mode === 'FOREVER' ? 'FOREVER' : raw.mode === 'UNTIL' ? 'UNTIL' : 'OFF';
  const until = typeof raw.until === 'string' ? raw.until : null;
  return { mode, until };
}

function computeState(setting: ProtectionPauseSetting): { active: boolean; mode: PauseMode; until: string | null; remainingMs: number | null } {
  if (setting.mode === 'FOREVER') return { active: true, mode: 'FOREVER', until: null, remainingMs: null };
  if (setting.mode === 'UNTIL') {
    const untilIso = typeof setting.until === 'string' ? setting.until : null;
    const untilMs = untilIso ? Date.parse(untilIso) : NaN;
    if (Number.isFinite(untilMs)) {
      const remainingMs = untilMs - Date.now();
      if (remainingMs > 0) return { active: true, mode: 'UNTIL', until: new Date(untilMs).toISOString(), remainingMs };
    }
  }
  return { active: false, mode: 'OFF', until: null, remainingMs: null };
}

export async function registerProtectionRoutes(app: FastifyInstance, config: AppConfig, db: Db): Promise<void> {
  app.get(
    '/api/protection/pause',
    {
      onRequest: [app.rateLimit()],
      config: {
        rateLimit: {
          max: 120,
          timeWindow: '1 minute'
        }
      }
    },
    async (request) => {
      await requireAdmin(db, request);
      const res = await db.pool.query('SELECT value FROM settings WHERE key = $1', ['protection_pause']);
      const setting = parsePauseSetting(res.rows?.[0]?.value);
      return computeState(setting);
    }
  );

  app.put(
    '/api/protection/pause',
    {
      onRequest: [app.rateLimit()],
      config: {
        rateLimit: {
          max: 60,
          timeWindow: '1 minute'
        }
      },
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            durationMinutes: { type: 'number' },
            mode: { type: 'string', enum: ['OFF', 'UNTIL', 'FOREVER'] }
          }
        }
      }
    },
    async (request: FastifyRequest<{ Body: { durationMinutes?: number; mode?: PauseMode } }>, reply: FastifyReply) => {
      await requireAdmin(db, request);

      const prevRes = await db.pool.query('SELECT value FROM settings WHERE key = $1', ['protection_pause']);
      const prevSetting = parsePauseSetting(prevRes.rows?.[0]?.value);
      const prevState = computeState(prevSetting);

      const mode = request.body.mode;
      const minutes = request.body.durationMinutes;

      let next: ProtectionPauseSetting = { mode: 'OFF', until: null };

      if (mode === 'FOREVER') {
        next = { mode: 'FOREVER', until: null };
      } else if (mode === 'OFF') {
        next = { mode: 'OFF', until: null };
      } else {
        const m = typeof minutes === 'number' ? minutes : 0;
        if (!Number.isFinite(m) || m <= 0) {
          reply.code(400);
          return { error: 'INVALID_DURATION' };
        }
        // Hard cap to avoid accidental multi-day pauses.
        const clamped = Math.min(7 * 24 * 60, Math.max(1, Math.floor(m)));
        const untilMs = Date.now() + clamped * 60_000;
        next = { mode: 'UNTIL', until: new Date(untilMs).toISOString() };
      }

      await db.pool.query(
        'INSERT INTO settings(key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()',
        ['protection_pause', next]
      );

      const nextState = computeState(next);

      // Notifications (optional): pause/resume
      try {
        if (nextState.active && (!prevState.active || prevState.mode !== nextState.mode || prevState.until !== nextState.until)) {
          const msg =
            nextState.mode === 'FOREVER'
              ? 'Protection is paused until resumed.'
              : nextState.until
                ? `Protection is paused until ${nextState.until}.`
                : 'Protection is paused.';
          await notifyEvent(db, config, 'protectionPause', {
            title: 'Protection paused',
            message: msg,
            severity: 'warning',
            meta: { mode: nextState.mode, until: nextState.until }
          });
        }
        if (!nextState.active && prevState.active) {
          await notifyEvent(db, config, 'protectionPause', {
            title: 'Protection resumed',
            message: 'Protection filtering is active again.',
            severity: 'info'
          });
        }
      } catch {
        // ignore
      }

      return nextState;
    }
  );

  void config;
}
