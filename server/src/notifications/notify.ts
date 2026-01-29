import type { AppConfig } from '../config.js';
import type { Db } from '../db.js';

export type NotificationSeverity = 'info' | 'warning' | 'error';

export type NotificationEventKey =
  | 'anomalyDetected'
  | 'protectionPause'
  | 'blocklistRefreshFailed'
  | 'geoIpUpdated'
  | 'haFailoverActive'
  | 'haLeaderAvailableAgain';

type NotificationEventsSetting = {
  anomalyDetected?: boolean;
  protectionPause?: boolean;
  blocklistRefreshFailed?: boolean;
  geoIpUpdated?: boolean;
  haFailoverActive?: boolean;
  haLeaderAvailableAgain?: boolean;
};

function normalizeDiscordWebhookUrl(raw: unknown): string {
  const url = String(raw ?? '').trim();
  if (!url) return '';
  // Admin-only, but still avoid accidental SSRF.
  if (!url.startsWith('https://discord.com/api/webhooks/')) return '';
  return url;
}

async function getSetting(db: Db, key: string): Promise<any> {
  const res = await db.pool.query('SELECT value FROM settings WHERE key = $1', [key]);
  return res.rows?.[0]?.value;
}

async function getNotificationEvents(db: Db): Promise<Required<NotificationEventsSetting>> {
  const raw = await getSetting(db, 'notification_events');
  const r = raw && typeof raw === 'object' ? (raw as NotificationEventsSetting) : {};
  return {
    anomalyDetected: r.anomalyDetected !== false,
    protectionPause: r.protectionPause !== false,
    blocklistRefreshFailed: r.blocklistRefreshFailed !== false,
    geoIpUpdated: r.geoIpUpdated !== false,
    haFailoverActive: r.haFailoverActive !== false,
    haLeaderAvailableAgain: r.haLeaderAvailableAgain !== false
  };
}

function isEventEnabled(events: Required<NotificationEventsSetting>, event: NotificationEventKey): boolean {
  switch (event) {
    case 'anomalyDetected':
      return events.anomalyDetected;
    case 'protectionPause':
      return events.protectionPause;
    case 'blocklistRefreshFailed':
      return events.blocklistRefreshFailed;
    case 'geoIpUpdated':
      return events.geoIpUpdated;
    case 'haFailoverActive':
      return events.haFailoverActive;
    case 'haLeaderAvailableAgain':
      return events.haLeaderAvailableAgain;
    default:
      return true;
  }
}

function discordColor(severity: NotificationSeverity): number {
  if (severity === 'error') return 0xef4444;
  if (severity === 'warning') return 0xf59e0b;
  return 0x3b82f6;
}

async function sendDiscordWebhook(url: string, payload: any): Promise<{ sent: boolean; error?: string }> {
  if (!url) return { sent: false };
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 5000);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ac.signal
    });
    if (!r.ok) return { sent: false, error: `Webhook returned ${r.status}` };
    return { sent: true };
  } catch (e: any) {
    return { sent: false, error: typeof e?.message === 'string' ? e.message : 'Webhook request failed.' };
  } finally {
    clearTimeout(t);
  }
}

export async function notifyEvent(
  db: Db,
  config: AppConfig,
  event: NotificationEventKey,
  entry: {
    title: string;
    message: string;
    severity?: NotificationSeverity;
    meta?: any;
  }
): Promise<{ ok: boolean; discord?: { sent: boolean; error?: string } }> {
  const events = await getNotificationEvents(db);
  if (!isEventEnabled(events, event)) {
    return { ok: false };
  }

  const severity: NotificationSeverity = entry.severity ?? 'info';

  // Discord channel (optional)
  const webhookSetting = await getSetting(db, 'discord_webhook');
  const candidate =
    typeof webhookSetting === 'string'
      ? webhookSetting
      : typeof (webhookSetting as any)?.url === 'string'
        ? (webhookSetting as any).url
        : '';
  const webhookUrl = normalizeDiscordWebhookUrl(candidate);

  const discordPayload = {
    username: 'Sentinel DNS',
    embeds: [
      {
        title: entry.title,
        description: String(entry.message || '').slice(0, 2000),
        color: discordColor(severity),
        timestamp: new Date().toISOString()
      }
    ]
  };

  const discord = webhookUrl ? await sendDiscordWebhook(webhookUrl, discordPayload) : { sent: false };

  // Persist in bell feed regardless of channel availability; includes channel status.
  try {
    await db.pool.query('INSERT INTO notifications(entry) VALUES ($1)', [
      {
        event,
        title: entry.title,
        message: entry.message,
        severity,
        createdAt: new Date().toISOString(),
        channels: {
          discord: webhookUrl ? discord : { sent: false }
        },
        meta: entry.meta ?? null
      }
    ]);
  } catch {
    // ignore
  }

  void config;
  return { ok: true, discord };
}
