import type { Db } from '../db.js';
import { refreshBlocklist } from './refresh.js';

type SeedBlocklist = {
  name: string;
  url: string;
  enabled: boolean;
  mode: 'ACTIVE' | 'SHADOW';
};

// A small, pragmatic baseline similar to what users commonly enable in Pi-hole/AdGuard setups.
// Kept intentionally minimal to avoid surprising breakage.
const DEFAULT_BLOCKLISTS: SeedBlocklist[] = [
  {
    name: 'Pi-hole: StevenBlack Unified Hosts',
    url: 'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts',
    enabled: true,
    mode: 'ACTIVE'
  },
  {
    name: 'AdGuard: DNS Filter',
    url: 'https://adguardteam.github.io/AdGuardSDNSFilter/Filters/filter.txt',
    enabled: true,
    mode: 'ACTIVE'
  },
  {
    name: 'AdGuard: Tracking Protection',
    url: 'https://filters.adtidy.org/extension/chromium/filters/3.txt',
    enabled: true,
    mode: 'ACTIVE'
  },

  // Category lists (disabled by default). Enable per-client or globally.
  {
    name: 'Category: Pornography (StevenBlack)',
    url: 'https://raw.githubusercontent.com/StevenBlack/hosts/master/alternates/porn/hosts',
    enabled: false,
    mode: 'ACTIVE'
  },
  {
    name: 'Category: Pornography (HaGeZi NSFW)',
    url: 'https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/nsfw.txt',
    enabled: false,
    mode: 'ACTIVE'
  },
  {
    name: 'Category: Gambling (StevenBlack)',
    url: 'https://raw.githubusercontent.com/StevenBlack/hosts/master/alternates/gambling/hosts',
    enabled: false,
    mode: 'ACTIVE'
  },
  {
    name: 'Category: Gambling (HaGeZi)',
    url: 'https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/gambling.txt',
    enabled: false,
    mode: 'ACTIVE'
  },
  {
    name: 'Category: Social Media (StevenBlack)',
    url: 'https://raw.githubusercontent.com/StevenBlack/hosts/master/alternates/social/hosts',
    enabled: false,
    mode: 'ACTIVE'
  },
  {
    name: 'Category: Social Media (HaGeZi)',
    url: 'https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/social.txt',
    enabled: false,
    mode: 'ACTIVE'
  },
  {
    name: 'Category: Piracy (Block List Project)',
    url: 'https://blocklistproject.github.io/Lists/alt-version/piracy-nl.txt',
    enabled: false,
    mode: 'ACTIVE'
  },
  {
    name: 'Category: Piracy (Block List Project - Torrent)',
    url: 'https://blocklistproject.github.io/Lists/alt-version/torrent-nl.txt',
    enabled: false,
    mode: 'ACTIVE'
  },
  {
    name: 'Category: Piracy (HaGeZi DNS Blocklists)',
    url: 'https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/anti.piracy.txt',
    enabled: false,
    mode: 'ACTIVE'
  },
  {
    name: 'Category: Dating (NextDNS Services)',
    url: 'https://raw.githubusercontent.com/nextdns/services/main/services/tinder',
    enabled: false,
    mode: 'ACTIVE'
  },

  // App lists (disabled by default). These are used by per-client "Blocked Applications".
  { name: 'App: 9GAG (NextDNS Services)', url: 'https://raw.githubusercontent.com/nextdns/services/main/services/9gag', enabled: false, mode: 'ACTIVE' },
  { name: 'App: Amazon (NextDNS Services)', url: 'https://raw.githubusercontent.com/nextdns/services/main/services/amazon', enabled: false, mode: 'ACTIVE' },
  { name: 'App: BeReal (NextDNS Services)', url: 'https://raw.githubusercontent.com/nextdns/services/main/services/bereal', enabled: false, mode: 'ACTIVE' },
  { name: 'App: Blizzard/Battle.net (NextDNS Services)', url: 'https://raw.githubusercontent.com/nextdns/services/main/services/blizzard', enabled: false, mode: 'ACTIVE' },
  { name: 'App: ChatGPT (NextDNS Services)', url: 'https://raw.githubusercontent.com/nextdns/services/main/services/chatgpt', enabled: false, mode: 'ACTIVE' },
  { name: 'App: Dailymotion (NextDNS Services)', url: 'https://raw.githubusercontent.com/nextdns/services/main/services/dailymotion', enabled: false, mode: 'ACTIVE' },
  { name: 'App: Discord (NextDNS Services)', url: 'https://raw.githubusercontent.com/nextdns/services/main/services/discord', enabled: false, mode: 'ACTIVE' },
  { name: 'App: Disney+ (NextDNS Services)', url: 'https://raw.githubusercontent.com/nextdns/services/main/services/disneyplus', enabled: false, mode: 'ACTIVE' },
  { name: 'App: eBay (NextDNS Services)', url: 'https://raw.githubusercontent.com/nextdns/services/main/services/ebay', enabled: false, mode: 'ACTIVE' },
  { name: 'App: Facebook (NextDNS Services)', url: 'https://raw.githubusercontent.com/nextdns/services/main/services/facebook', enabled: false, mode: 'ACTIVE' },
  { name: 'App: Fortnite (NextDNS Services)', url: 'https://raw.githubusercontent.com/nextdns/services/main/services/fortnite', enabled: false, mode: 'ACTIVE' },
  { name: 'App: Google Chat (NextDNS Services)', url: 'https://raw.githubusercontent.com/nextdns/services/main/services/google-chat', enabled: false, mode: 'ACTIVE' },
  { name: 'App: HBO Max / Max (NextDNS Services)', url: 'https://raw.githubusercontent.com/nextdns/services/main/services/hbomax', enabled: false, mode: 'ACTIVE' },
  { name: 'App: Hulu (NextDNS Services)', url: 'https://raw.githubusercontent.com/nextdns/services/main/services/hulu', enabled: false, mode: 'ACTIVE' },
  { name: 'App: Imgur (NextDNS Services)', url: 'https://raw.githubusercontent.com/nextdns/services/main/services/imgur', enabled: false, mode: 'ACTIVE' },
  { name: 'App: Instagram (NextDNS Services)', url: 'https://raw.githubusercontent.com/nextdns/services/main/services/instagram', enabled: false, mode: 'ACTIVE' },
  { name: 'App: League of Legends (NextDNS Services)', url: 'https://raw.githubusercontent.com/nextdns/services/main/services/leagueoflegends', enabled: false, mode: 'ACTIVE' },
  { name: 'App: Mastodon (NextDNS Services)', url: 'https://raw.githubusercontent.com/nextdns/services/main/services/mastodon', enabled: false, mode: 'ACTIVE' },
  { name: 'App: Messenger (NextDNS Services)', url: 'https://raw.githubusercontent.com/nextdns/services/main/services/messenger', enabled: false, mode: 'ACTIVE' },
  { name: 'App: Minecraft (NextDNS Services)', url: 'https://raw.githubusercontent.com/nextdns/services/main/services/minecraft', enabled: false, mode: 'ACTIVE' },
  { name: 'App: Netflix (NextDNS Services)', url: 'https://raw.githubusercontent.com/nextdns/services/main/services/netflix', enabled: false, mode: 'ACTIVE' },
  { name: 'App: Pinterest (NextDNS Services)', url: 'https://raw.githubusercontent.com/nextdns/services/main/services/pinterest', enabled: false, mode: 'ACTIVE' },
  { name: 'App: PlayStation Network (NextDNS Services)', url: 'https://raw.githubusercontent.com/nextdns/services/main/services/playstation-network', enabled: false, mode: 'ACTIVE' },
  { name: 'App: Prime Video (NextDNS Services)', url: 'https://raw.githubusercontent.com/nextdns/services/main/services/primevideo', enabled: false, mode: 'ACTIVE' },
  { name: 'App: Reddit (NextDNS Services)', url: 'https://raw.githubusercontent.com/nextdns/services/main/services/reddit', enabled: false, mode: 'ACTIVE' },
  { name: 'App: Roblox (NextDNS Services)', url: 'https://raw.githubusercontent.com/nextdns/services/main/services/roblox', enabled: false, mode: 'ACTIVE' },
  { name: 'App: Signal (NextDNS Services)', url: 'https://raw.githubusercontent.com/nextdns/services/main/services/signal', enabled: false, mode: 'ACTIVE' },
  { name: 'App: Skype (NextDNS Services)', url: 'https://raw.githubusercontent.com/nextdns/services/main/services/skype', enabled: false, mode: 'ACTIVE' },
  { name: 'App: Snapchat (NextDNS Services)', url: 'https://raw.githubusercontent.com/nextdns/services/main/services/snapchat', enabled: false, mode: 'ACTIVE' },
  { name: 'App: Spotify (NextDNS Services)', url: 'https://raw.githubusercontent.com/nextdns/services/main/services/spotify', enabled: false, mode: 'ACTIVE' },
  { name: 'App: Steam (NextDNS Services)', url: 'https://raw.githubusercontent.com/nextdns/services/main/services/steam', enabled: false, mode: 'ACTIVE' },
  { name: 'App: Telegram (NextDNS Services)', url: 'https://raw.githubusercontent.com/nextdns/services/main/services/telegram', enabled: false, mode: 'ACTIVE' },
  { name: 'App: TikTok (NextDNS Services)', url: 'https://raw.githubusercontent.com/nextdns/services/main/services/tiktok', enabled: false, mode: 'ACTIVE' },
  { name: 'App: Tinder (NextDNS Services)', url: 'https://raw.githubusercontent.com/nextdns/services/main/services/tinder', enabled: false, mode: 'ACTIVE' },
  { name: 'App: Tumblr (NextDNS Services)', url: 'https://raw.githubusercontent.com/nextdns/services/main/services/tumblr', enabled: false, mode: 'ACTIVE' },
  { name: 'App: Twitch (NextDNS Services)', url: 'https://raw.githubusercontent.com/nextdns/services/main/services/twitch', enabled: false, mode: 'ACTIVE' },
  { name: 'App: Twitter/X (NextDNS Services)', url: 'https://raw.githubusercontent.com/nextdns/services/main/services/twitter', enabled: false, mode: 'ACTIVE' },
  { name: 'App: Vimeo (NextDNS Services)', url: 'https://raw.githubusercontent.com/nextdns/services/main/services/vimeo', enabled: false, mode: 'ACTIVE' },
  { name: 'App: VK (NextDNS Services)', url: 'https://raw.githubusercontent.com/nextdns/services/main/services/vk', enabled: false, mode: 'ACTIVE' },
  { name: 'App: WhatsApp (NextDNS Services)', url: 'https://raw.githubusercontent.com/nextdns/services/main/services/whatsapp', enabled: false, mode: 'ACTIVE' },
  { name: 'App: Xbox Live (NextDNS Services)', url: 'https://raw.githubusercontent.com/nextdns/services/main/services/xboxlive', enabled: false, mode: 'ACTIVE' },
  { name: 'App: YouTube (NextDNS Services)', url: 'https://raw.githubusercontent.com/nextdns/services/main/services/youtube', enabled: false, mode: 'ACTIVE' },
  { name: 'App: Zoom (NextDNS Services)', url: 'https://raw.githubusercontent.com/nextdns/services/main/services/zoom', enabled: false, mode: 'ACTIVE' }
];

function normalizeMode(input: any): 'ACTIVE' | 'SHADOW' {
  return input === 'SHADOW' ? 'SHADOW' : 'ACTIVE';
}


export async function ensureDefaultBlocklists(db: Db): Promise<void> {
  const inserted: Array<{ id: number; name: string; url: string; enabled: boolean }> = [];

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    for (const bl of DEFAULT_BLOCKLISTS) {
      const res = await client.query(
        `INSERT INTO blocklists(name, url, enabled, mode, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (url) DO NOTHING
         RETURNING id, name, url, enabled`,
        [bl.name, bl.url, bl.enabled, normalizeMode(bl.mode)]
      );
      if (res.rowCount) {
        inserted.push({
          id: Number(res.rows[0].id),
          name: String(res.rows[0].name),
          url: String(res.rows[0].url),
          enabled: !!res.rows[0].enabled
        });
      }
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  if (inserted.length) {
    // Populate rules in the background so the server can come up quickly.
    // Any errors are recorded on the blocklist row as `last_error`.
    void Promise.allSettled(
      inserted
        .filter((x) => x.enabled)
        .map((x) => refreshBlocklist(db, { id: x.id, name: x.name, url: x.url }).catch(() => undefined))
    );
  }
}
