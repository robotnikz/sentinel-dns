import dgram from 'node:dgram';
import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';
import http2 from 'node:http2';
import * as dns from 'node:dns';
import dnsPacket from 'dns-packet';
import ipaddr from 'ipaddr.js';
import { Agent, request } from 'undici';

import type { AppConfig } from '../config.js';
import type { Db } from '../db.js';
import { refreshBlocklist } from '../blocklists/refresh.js';

export type DnsRuntimeStats = {
  startedAt: string | null;
  lastQueryAt: string | null;
  lastClientIp: string | null;
  lastTransport: 'udp' | 'tcp' | null;
  totalQueries: number;
  tailscaleQueries: number;
  tailscaleV4Queries: number;
  tailscaleV6Queries: number;
};

export const dnsRuntimeStats: DnsRuntimeStats = {
  startedAt: null,
  lastQueryAt: null,
  lastClientIp: null,
  lastTransport: null,
  totalQueries: 0,
  tailscaleQueries: 0,
  tailscaleV4Queries: 0,
  tailscaleV6Queries: 0
};

const TS_V4_CIDR = ipaddr.parseCIDR('100.64.0.0/10') as [ipaddr.IPv4, number];
const TS_V6_CIDR = ipaddr.parseCIDR('fd7a:115c:a1e0::/48') as [ipaddr.IPv6, number];

function normalizeClientIp(ipRaw: string): string {
  const raw = String(ipRaw ?? '').trim();
  if (!raw) return '0.0.0.0';
  // Drop zone id (e.g. fe80::1%eth0). Not expected for Tailscale, but harmless.
  const noZone = raw.includes('%') ? raw.slice(0, raw.indexOf('%')) : raw;
  // Normalize IPv4-mapped IPv6.
  return noZone.startsWith('::ffff:') ? noZone.slice('::ffff:'.length) : noZone;
}

function isTailscaleClientIp(ip: string): { isTailscale: boolean; version: 'v4' | 'v6' | null } {
  try {
    const addr = ipaddr.parse(ip);
    if (addr.kind() === 'ipv4') {
      return { isTailscale: (addr as ipaddr.IPv4).match(TS_V4_CIDR), version: 'v4' };
    }
    return { isTailscale: (addr as ipaddr.IPv6).match(TS_V6_CIDR), version: 'v6' };
  } catch {
    return { isTailscale: false, version: null };
  }
}

function recordDnsQuerySeen(clientIp: string, transport: 'udp' | 'tcp'): void {
  dnsRuntimeStats.totalQueries += 1;
  dnsRuntimeStats.lastQueryAt = new Date().toISOString();
  dnsRuntimeStats.lastClientIp = clientIp;
  dnsRuntimeStats.lastTransport = transport;

  const ts = isTailscaleClientIp(clientIp);
  if (ts.isTailscale) {
    dnsRuntimeStats.tailscaleQueries += 1;
    if (ts.version === 'v4') dnsRuntimeStats.tailscaleV4Queries += 1;
    if (ts.version === 'v6') dnsRuntimeStats.tailscaleV6Queries += 1;
  }
}

type RuleMatchDecision = {
  decision: 'ALLOWED' | 'BLOCKED' | 'SHADOW_BLOCKED' | 'NONE';
  blocklistId?: string;
};

type RulesIndex = {
  globalManualAllowed: Set<string>;
  globalManualBlocked: Set<string>;

  manualAllowedByClientId: Map<string, Set<string>>;
  manualBlockedByClientId: Map<string, Set<string>>;

  manualAllowedBySubnetId: Map<string, Set<string>>;
  manualBlockedBySubnetId: Map<string, Set<string>>;
  // Domain -> blocklist id(s) that contain it.
  blockedByDomain: Map<string, string | string[]>;
};

type RulesCache = {
  loadedAt: number;
  maxId: number;
  includedIdsKey: string;
  index: RulesIndex;
};

type BlocklistStatus = {
  enabled: boolean;
  mode: 'ACTIVE' | 'SHADOW';
  name: string;
};

type BlocklistsCache = {
  loadedAt: number;
  byId: Map<string, BlocklistStatus>;
};

type ContentCategory =
  | 'adult'
  | 'gambling'
  | 'social'
  | 'piracy'
  | 'crypto'
  | 'shopping'
  | 'news'
  | 'game'
  | 'video';

const CONTENT_CATEGORIES: ContentCategory[] = [
  'adult',
  'gambling',
  'social',
  'piracy',
  'crypto',
  'shopping',
  'news',
  'game',
  'video'
];

function isContentCategory(v: string): v is ContentCategory {
  return (CONTENT_CATEGORIES as string[]).includes(v);
}

function isAppService(v: string): v is AppService {
  return Object.prototype.hasOwnProperty.call(APP_DOMAIN_SUFFIXES, v);
}

type AppService =
  | '9gag'
  | 'amazon'
  | 'bereal'
  | 'blizzard'
  | 'chatgpt'
  | 'dailymotion'
  | 'discord'
  | 'disneyplus'
  | 'ebay'
  | 'facebook'
  | 'fortnite'
  | 'google-chat'
  | 'hbomax'
  | 'hulu'
  | 'imgur'
  | 'instagram'
  | 'leagueoflegends'
  | 'mastodon'
  | 'messenger'
  | 'minecraft'
  | 'netflix'
  | 'pinterest'
  | 'playstation-network'
  | 'primevideo'
  | 'reddit'
  | 'roblox'
  | 'signal'
  | 'skype'
  | 'snapchat'
  | 'spotify'
  | 'steam'
  | 'telegram'
  | 'tiktok'
  | 'tinder'
  | 'tumblr'
  | 'twitch'
  | 'twitter'
  | 'vimeo'
  | 'vk'
  | 'whatsapp'
  | 'xboxlive'
  | 'youtube'
  | 'zoom';

type ScheduleModeType = 'sleep' | 'homework' | 'total_block' | 'custom';

type Schedule = {
  id: string;
  name: string;
  days: Array<'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun'>;
  startTime: string;
  endTime: string;
  active: boolean;
  mode: ScheduleModeType;
  blockedCategories: ContentCategory[];
  blockedApps: AppService[];
  blockAll?: boolean;
};

type ClientProfile = {
  id: string;
  name: string;
  ip?: string;
  cidr?: string;
  useGlobalSettings?: boolean;
  useGlobalCategories?: boolean;
  useGlobalApps?: boolean;
  assignedBlocklists?: string[];
  isInternetPaused?: boolean;
  blockedCategories?: ContentCategory[];
  blockedApps?: AppService[];
  schedules?: Schedule[];
};

function normalizeScheduleMode(value: any): ScheduleModeType {
  const mode = String(value ?? '').trim();
  if (mode === 'sleep') return 'sleep';
  if (mode === 'homework') return 'homework';
  if (mode === 'total_block') return 'total_block';
  return 'custom';
}

type ClientsCache = {
  loadedAt: number;
  clients: ClientProfile[];
};

type CategoryBlocklistsCache = {
  loadedAt: number;
  byCategory: Map<ContentCategory, string[]>;
};

type AppBlocklistsCache = {
  loadedAt: number;
  byApp: Map<AppService, string[]>;
};

type RewriteEntry = {
  id: string;
  domain: string;
  target: string;
  wildcard?: boolean;
};

type RewritesCache = {
  loadedAt: number;
  byDomain: Map<string, RewriteEntry>;
  wildcards: RewriteEntry[];
};

type UpstreamCache = {
  loadedAt: number;
  upstream:
    | { transport: 'udp' | 'tcp' | 'dot'; host: string; port: number }
    | { transport: 'doh'; dohUrl: string };
};

export type DnsUpstreamConfigured =
  | { upstreamMode: 'unbound' }
  | {
      upstreamMode: 'forward';
      forward: {
        transport: 'udp' | 'tcp' | 'dot' | 'doh';
        host?: string;
        port?: number;
        dohUrl?: string;
      };
    };

export type DnsUpstreamDebug = {
  refreshedAt: string | null;
  refreshedAtMs: number;
  refreshIntervalMs: number;
  configured: DnsUpstreamConfigured | null;
  effective: UpstreamCache['upstream'] | null;
  lastForwardOkAt: string | null;
  lastForwardOkAtMs: number;
  lastForwardError:
    | {
        at: string;
        atMs: number;
        transport: UpstreamCache['upstream']['transport'];
        target: string;
        name?: string;
        code?: string;
        message: string;
      }
    | null;
};

const DNS_CACHE_REFRESH_INTERVAL_MS = 5000;

export const dnsUpstreamDebug: DnsUpstreamDebug = {
  refreshedAt: null,
  refreshedAtMs: 0,
  refreshIntervalMs: DNS_CACHE_REFRESH_INTERVAL_MS,
  configured: null,
  effective: null,
  lastForwardOkAt: null,
  lastForwardOkAtMs: 0,
  lastForwardError: null
};

type ProtectionPauseState =
  | { mode: 'OFF' }
  | { mode: 'FOREVER' }
  | { mode: 'UNTIL'; untilMs: number };

function parseProtectionPauseSetting(value: any): ProtectionPauseState {
  if (!value || typeof value !== 'object') return { mode: 'OFF' };
  const mode = value.mode === 'FOREVER' ? 'FOREVER' : value.mode === 'UNTIL' ? 'UNTIL' : 'OFF';
  if (mode === 'FOREVER') return { mode: 'FOREVER' };
  if (mode === 'UNTIL') {
    const untilIso = typeof value.until === 'string' ? value.until : '';
    const untilMs = untilIso ? Date.parse(untilIso) : NaN;
    if (Number.isFinite(untilMs)) return { mode: 'UNTIL', untilMs };
  }
  return { mode: 'OFF' };
}

function isProtectionPaused(state: ProtectionPauseState): boolean {
  if (state.mode === 'FOREVER') return true;
  if (state.mode === 'UNTIL') return Date.now() < state.untilMs;
  return false;
}

function parseGlobalBlockedAppsSetting(value: any): AppService[] {
  if (Array.isArray(value)) return value.map((x: any) => String(x)).filter(isAppService);
  if (!value || typeof value !== 'object') return [];
  const raw = (value as any).blockedApps;
  if (!Array.isArray(raw)) return [];
  return raw.map((x: any) => String(x)).filter(isAppService);
}

function parseGlobalShadowAppsSetting(value: any): AppService[] {
  if (!value || typeof value !== 'object') return [];
  const raw = (value as any).shadowApps;
  if (!Array.isArray(raw)) return [];
  return raw.map((x: any) => String(x)).filter(isAppService);
}

function parseHostPort(value: string): { host: string; port: number } {
  const trimmed = value.trim();
  const idx = trimmed.lastIndexOf(':');
  if (idx <= 0) return { host: trimmed, port: 53 };
  const host = trimmed.slice(0, idx);
  const port = Number(trimmed.slice(idx + 1));
  return { host, port: Number.isFinite(port) ? port : 53 };
}

function normalizeName(name: string): string {
  const n = String(name || '').trim().toLowerCase();
  return n.endsWith('.') ? n.slice(0, -1) : n;
}

function matchesDomain(ruleDomain: string, queryName: string): boolean {
  const r = normalizeName(ruleDomain);
  const q = normalizeName(queryName);
  return q === r || q.endsWith(`.${r}`);
}

function extractBlocklistId(category?: string): string | null {
  if (!category) return null;
  if (!category.startsWith('Blocklist:')) return null;
  const rest = category.slice('Blocklist:'.length);
  const idx = rest.indexOf(':');
  if (idx <= 0) return null;
  const id = rest.slice(0, idx).trim();
  return id ? id : null;
}

function formatBlocklistCategory(id: string, name?: string): string {
  const safeId = String(id ?? '').trim();
  const safeName = String(name ?? '').trim();
  if (!safeId) return 'Blocklist:unknown';
  return safeName ? `Blocklist:${safeId}:${safeName}` : `Blocklist:${safeId}`;
}

function buildCandidateDomains(queryName: string): string[] {
  const q = normalizeName(queryName);
  if (!q) return [];
  const parts = q.split('.').filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    out.push(parts.slice(i).join('.'));
  }
  return out;
}

function decideManualRule(
  candidates: string[],
  allowed: Set<string> | undefined,
  blocked: Set<string> | undefined
): 'ALLOWED' | 'BLOCKED' | 'NONE' {
  if (!candidates.length) return 'NONE';
  const a = allowed ?? EMPTY_STRING_SET;
  const b = blocked ?? EMPTY_STRING_SET;

  // Allow should win over block.
  for (const c of candidates) {
    if (a.has(c)) return 'ALLOWED';
  }
  for (const c of candidates) {
    if (b.has(c)) return 'BLOCKED';
  }
  return 'NONE';
}

const EMPTY_STRING_SET = new Set<string>();

function getOrCreateSet(map: Map<string, Set<string>>, key: string): Set<string> {
  const k = String(key ?? '').trim();
  if (!k) return EMPTY_STRING_SET;
  const cur = map.get(k);
  if (cur) return cur;
  const next = new Set<string>();
  map.set(k, next);
  return next;
}

function decideRuleIndexed(
  index: RulesIndex,
  queryName: string,
  blocklistsById: Map<string, BlocklistStatus>,
  selectedBlocklists: Set<string>
): RuleMatchDecision {
  const candidates = buildCandidateDomains(queryName);
  if (!candidates.length) return { decision: 'NONE' };

  for (const c of candidates) {
    const hit = index.blockedByDomain.get(c);
    if (!hit) continue;

    const ids = typeof hit === 'string' ? [hit] : hit;
    let shadowId: string | undefined;

    for (const id of ids) {
      if (!selectedBlocklists.has(id)) continue;
      const st = blocklistsById.get(id);
      if (!st) continue;

      if (st.mode === 'SHADOW') {
        shadowId ??= id;
        continue;
      }

      return { decision: 'BLOCKED', blocklistId: id };
    }

    if (shadowId) return { decision: 'SHADOW_BLOCKED', blocklistId: shadowId };
  }

  return { decision: 'NONE' };
}

const CATEGORY_BLOCKLIST_URLS: Record<ContentCategory, string[]> = {
  adult: ['https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/nsfw.txt'],
  gambling: ['https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/gambling.txt'],
  social: ['https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/social.txt'],
  piracy: ['https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/anti.piracy.txt'],
  crypto: [],
  shopping: [],
  news: [],
  game: [],
  video: []
};

const APP_BLOCKLIST_URLS: Record<AppService, string[]> = {
  '9gag': ['https://raw.githubusercontent.com/nextdns/services/main/services/9gag'],
  amazon: ['https://raw.githubusercontent.com/nextdns/services/main/services/amazon'],
  bereal: ['https://raw.githubusercontent.com/nextdns/services/main/services/bereal'],
  blizzard: ['https://raw.githubusercontent.com/nextdns/services/main/services/blizzard'],
  chatgpt: ['https://raw.githubusercontent.com/nextdns/services/main/services/chatgpt'],
  dailymotion: ['https://raw.githubusercontent.com/nextdns/services/main/services/dailymotion'],
  discord: ['https://raw.githubusercontent.com/nextdns/services/main/services/discord'],
  disneyplus: ['https://raw.githubusercontent.com/nextdns/services/main/services/disneyplus'],
  ebay: ['https://raw.githubusercontent.com/nextdns/services/main/services/ebay'],
  facebook: ['https://raw.githubusercontent.com/nextdns/services/main/services/facebook'],
  fortnite: ['https://raw.githubusercontent.com/nextdns/services/main/services/fortnite'],
  'google-chat': ['https://raw.githubusercontent.com/nextdns/services/main/services/google-chat'],
  hbomax: ['https://raw.githubusercontent.com/nextdns/services/main/services/hbomax'],
  hulu: ['https://raw.githubusercontent.com/nextdns/services/main/services/hulu'],
  imgur: ['https://raw.githubusercontent.com/nextdns/services/main/services/imgur'],
  instagram: ['https://raw.githubusercontent.com/nextdns/services/main/services/instagram'],
  leagueoflegends: ['https://raw.githubusercontent.com/nextdns/services/main/services/leagueoflegends'],
  mastodon: ['https://raw.githubusercontent.com/nextdns/services/main/services/mastodon'],
  messenger: ['https://raw.githubusercontent.com/nextdns/services/main/services/messenger'],
  minecraft: ['https://raw.githubusercontent.com/nextdns/services/main/services/minecraft'],
  netflix: ['https://raw.githubusercontent.com/nextdns/services/main/services/netflix'],
  pinterest: ['https://raw.githubusercontent.com/nextdns/services/main/services/pinterest'],
  'playstation-network': ['https://raw.githubusercontent.com/nextdns/services/main/services/playstation-network'],
  primevideo: ['https://raw.githubusercontent.com/nextdns/services/main/services/primevideo'],
  reddit: ['https://raw.githubusercontent.com/nextdns/services/main/services/reddit'],
  roblox: ['https://raw.githubusercontent.com/nextdns/services/main/services/roblox'],
  signal: ['https://raw.githubusercontent.com/nextdns/services/main/services/signal'],
  skype: ['https://raw.githubusercontent.com/nextdns/services/main/services/skype'],
  snapchat: ['https://raw.githubusercontent.com/nextdns/services/main/services/snapchat'],
  spotify: ['https://raw.githubusercontent.com/nextdns/services/main/services/spotify'],
  steam: ['https://raw.githubusercontent.com/nextdns/services/main/services/steam'],
  telegram: ['https://raw.githubusercontent.com/nextdns/services/main/services/telegram'],
  tiktok: ['https://raw.githubusercontent.com/nextdns/services/main/services/tiktok'],
  tinder: ['https://raw.githubusercontent.com/nextdns/services/main/services/tinder'],
  tumblr: ['https://raw.githubusercontent.com/nextdns/services/main/services/tumblr'],
  twitch: ['https://raw.githubusercontent.com/nextdns/services/main/services/twitch'],
  twitter: ['https://raw.githubusercontent.com/nextdns/services/main/services/twitter'],
  vimeo: ['https://raw.githubusercontent.com/nextdns/services/main/services/vimeo'],
  vk: ['https://raw.githubusercontent.com/nextdns/services/main/services/vk'],
  whatsapp: ['https://raw.githubusercontent.com/nextdns/services/main/services/whatsapp'],
  xboxlive: ['https://raw.githubusercontent.com/nextdns/services/main/services/xboxlive'],
  youtube: ['https://raw.githubusercontent.com/nextdns/services/main/services/youtube'],
  zoom: ['https://raw.githubusercontent.com/nextdns/services/main/services/zoom']
};

const APP_DOMAIN_SUFFIXES: Record<AppService, string[]> = {
  '9gag': ['9gag.com'],
  amazon: ['amazon.com', 'amazon.de', 'amazon.co.uk'],
  bereal: ['bereal.com', 'bere.al'],
  blizzard: ['blizzard.com', 'battle.net'],
  chatgpt: ['chatgpt.com', 'openai.com', 'oaistatic.com', 'oaiusercontent.com'],
  dailymotion: ['dailymotion.com', 'dmcdn.net'],
  discord: ['discord.com', 'discord.gg', 'discordapp.com', 'discordapp.net', 'discord.media'],
  disneyplus: ['disneyplus.com', 'dssott.com'],
  ebay: ['ebay.com', 'ebay.de', 'ebayimg.com', 'ebaystatic.com'],
  facebook: ['facebook.com', 'fbcdn.net', 'facebook.net', 'fb.com', 'messenger.com', 'm.me'],
  fortnite: ['fortnite.com', 'epicgames.com', 'epicgamescdn.com'],
  'google-chat': ['chat.google.com', 'googlechat.com'],
  hbomax: ['hbomax.com', 'max.com'],
  hulu: ['hulu.com', 'huluim.com'],
  imgur: ['imgur.com'],
  instagram: ['instagram.com', 'cdninstagram.com'],
  leagueoflegends: ['leagueoflegends.com', 'riotgames.com', 'riotcdn.net'],
  mastodon: ['mastodon.social'],
  messenger: ['messenger.com', 'm.me'],
  minecraft: ['minecraft.net', 'mojang.com', 'minecraftservices.com'],
  netflix: ['netflix.com', 'nflximg.net', 'nflxvideo.net', 'nflxso.net', 'nflxext.com'],
  pinterest: ['pinterest.com', 'pinimg.com'],
  'playstation-network': ['playstation.com', 'playstation.net', 'sonyentertainmentnetwork.com'],
  primevideo: ['primevideo.com', 'amazonvideo.com'],
  reddit: ['reddit.com', 'redd.it', 'redditstatic.com', 'redditmedia.com'],
  roblox: ['roblox.com', 'rbxcdn.com'],
  signal: ['signal.org'],
  skype: ['skype.com', 'skypeassets.com', 'skype.net'],
  snapchat: ['snapchat.com', 'sc-cdn.net', 'sc-gw.com', 'snapkit.com'],
  spotify: ['spotify.com', 'scdn.co'],
  steam: ['steampowered.com', 'steamcommunity.com', 'steamstatic.com', 'steamcontent.com'],
  telegram: ['telegram.org', 't.me', 'telegram.me', 'telesco.pe'],
  tiktok: ['tiktok.com', 'tiktokcdn.com', 'tiktokv.com', 'tiktokcdn-us.com', 'byteoversea.com', 'ibyteimg.com'],
  tinder: ['tinder.com', 'gotinder.com'],
  tumblr: ['tumblr.com'],
  twitch: ['twitch.tv', 'ttvnw.net', 'jtvnw.net', 'twitchcdn.net'],
  twitter: ['twitter.com', 'x.com', 't.co', 'twimg.com'],
  vimeo: ['vimeo.com', 'vimeocdn.com'],
  vk: ['vk.com', 'vk.me'],
  whatsapp: ['whatsapp.com', 'whatsapp.net'],
  xboxlive: ['xboxlive.com', 'xbox.com'],
  youtube: ['youtube.com', 'youtu.be', 'ytimg.com', 'googlevideo.com', 'youtubei.googleapis.com'],
  zoom: ['zoom.us', 'zoom.com']
};

function parseTimeToMinutes(value: string): number | null {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String(value || ''));
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23) return null;
  if (mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function isScheduleActiveNow(schedule: Schedule, now: Date): boolean {
  if (!schedule.active) return false;
  const start = parseTimeToMinutes(schedule.startTime);
  const end = parseTimeToMinutes(schedule.endTime);
  if (start == null || end == null) return false;

  const dayKey = (['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const)[now.getDay()];
  const nowMin = now.getHours() * 60 + now.getMinutes();

  if (start === end) return false;

  if (start < end) {
    if (!schedule.days.includes(dayKey)) return false;
    return nowMin >= start && nowMin < end;
  }

  // Spans midnight: treat schedule.days as the start-day.
  if (nowMin >= start) {
    return schedule.days.includes(dayKey);
  }

  const yesterdayKey = (['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const)[(now.getDay() + 6) % 7];
  if (nowMin < end) {
    return schedule.days.includes(yesterdayKey);
  }
  return false;
}

function isAppBlockedByPolicy(queryName: string, apps: AppService[]): AppService | null {
  for (const app of apps) {
    const suffixes = APP_DOMAIN_SUFFIXES[app] ?? [];
    for (const s of suffixes) {
      if (matchesDomain(s, queryName)) return app;
    }
  }
  return null;
}

function findClient(clients: ClientProfile[], clientIp: string): ClientProfile | null {
  return findExactClient(clients, clientIp) ?? findBestCidrClient(clients, clientIp);
}

function findExactClient(clients: ClientProfile[], clientIp: string): ClientProfile | null {
  for (const c of clients) {
    if (c.ip && c.ip === clientIp) return c;
  }
  return null;
}

function findBestCidrClient(clients: ClientProfile[], clientIp: string): ClientProfile | null {
  let addr: ipaddr.IPv4 | ipaddr.IPv6 | null = null;
  try {
    addr = ipaddr.parse(clientIp);
  } catch {
    addr = null;
  }

  if (!addr) return null;

  let best: ClientProfile | null = null;
  let bestPrefixLen = -1;

  for (const c of clients) {
    if (!c.cidr) continue;
    try {
      const [range, prefixLen] = ipaddr.parseCIDR(c.cidr);
      if (addr.kind() !== range.kind()) continue;
      if (!addr.match([range, prefixLen])) continue;
      if (prefixLen > bestPrefixLen) {
        best = c;
        bestPrefixLen = prefixLen;
      }
    } catch {
      // ignore invalid CIDR
    }
  }

  return best;
}

async function getRulesMaxId(db: Db): Promise<number> {
  const res = await db.pool.query('SELECT COALESCE(MAX(id), 0) AS max_id FROM rules');
  const v = Number(res.rows?.[0]?.max_id ?? 0);
  return Number.isFinite(v) ? v : 0;
}

function normalizeRuleDomain(value: any): string {
  return normalizeName(String(value ?? ''));
}

async function loadRulesIndex(db: Db, neededBlocklistIds: number[]): Promise<RulesIndex> {
  const globalManualAllowed = new Set<string>();
  const globalManualBlocked = new Set<string>();

  const manualAllowedByClientId = new Map<string, Set<string>>();
  const manualBlockedByClientId = new Map<string, Set<string>>();
  const manualAllowedBySubnetId = new Map<string, Set<string>>();
  const manualBlockedBySubnetId = new Map<string, Set<string>>();

  // Manual rules (Allow/Block tab) are not tied to a blocklist selection.
  const manualRes = await db.pool.query(
    `
    SELECT domain, type, category
    FROM rules
    WHERE category NOT LIKE 'Blocklist:%'
    `
  );

  const parseScope = (raw: unknown): { scope: 'global' } | { scope: 'client' | 'subnet'; id: string } => {
    const c = typeof raw === 'string' ? raw.trim() : '';
    if (!c) return { scope: 'global' };

    const parseId = (prefix: string): string | null => {
      if (!c.startsWith(prefix)) return null;
      const rest = c.slice(prefix.length);
      const id = (rest.includes(':') ? rest.slice(0, rest.indexOf(':')) : rest).trim();
      return id ? id : null;
    };

    const clientId = parseId('Client:');
    if (clientId) return { scope: 'client', id: clientId };

    const subnetId = parseId('Subnet:');
    if (subnetId) return { scope: 'subnet', id: subnetId };

    return { scope: 'global' };
  };

  for (const r of manualRes.rows) {
    const domain = normalizeRuleDomain(r?.domain);
    if (!domain) continue;
    const type = r?.type === 'ALLOWED' ? 'ALLOWED' : 'BLOCKED';

    const scope = parseScope(r?.category);
    if (scope.scope === 'global') {
      if (type === 'ALLOWED') globalManualAllowed.add(domain);
      else globalManualBlocked.add(domain);
      continue;
    }

    if (scope.scope === 'client') {
      if (type === 'ALLOWED') getOrCreateSet(manualAllowedByClientId, scope.id).add(domain);
      else getOrCreateSet(manualBlockedByClientId, scope.id).add(domain);
      continue;
    }

    if (type === 'ALLOWED') getOrCreateSet(manualAllowedBySubnetId, scope.id).add(domain);
    else getOrCreateSet(manualBlockedBySubnetId, scope.id).add(domain);
  }

  const blockedByDomain = new Map<string, string | string[]>();
  const ids = neededBlocklistIds.filter((n) => Number.isFinite(n));
  if (!ids.length)
    return {
      globalManualAllowed,
      globalManualBlocked,
      manualAllowedByClientId,
      manualBlockedByClientId,
      manualAllowedBySubnetId,
      manualBlockedBySubnetId,
      blockedByDomain
    };

  const blocklistRes = await db.pool.query(
    `
    SELECT domain, category
    FROM rules
    WHERE category LIKE 'Blocklist:%'
      AND split_part(category, ':', 2)::int = ANY($1::int[])
    `,
    [ids]
  );

  for (const r of blocklistRes.rows) {
    const domain = normalizeRuleDomain(r?.domain);
    if (!domain) continue;
    const id = extractBlocklistId(typeof r?.category === 'string' ? r.category : undefined);
    if (!id) continue;

    const cur = blockedByDomain.get(domain);
    if (!cur) {
      blockedByDomain.set(domain, id);
      continue;
    }

    if (typeof cur === 'string') {
      if (cur !== id) blockedByDomain.set(domain, [cur, id]);
      continue;
    }

    if (!cur.includes(id)) cur.push(id);
  }

  return {
    globalManualAllowed,
    globalManualBlocked,
    manualAllowedByClientId,
    manualBlockedByClientId,
    manualAllowedBySubnetId,
    manualBlockedBySubnetId,
    blockedByDomain
  };
}

async function loadClients(db: Db): Promise<ClientProfile[]> {
  // Keep ordering deterministic so ties (e.g. multiple matching CIDRs with same prefix)
  // resolve consistently.
  const res = await db.pool.query('SELECT profile FROM clients ORDER BY updated_at DESC, id ASC');
  return res.rows
    .map((r) => r.profile)
    .filter(Boolean)
    .map((p: any) => ({
      id: String(p.id ?? ''),
      name: String(p.name ?? 'Unknown'),
      ip: typeof p.ip === 'string' ? p.ip : undefined,
      cidr: typeof p.cidr === 'string' ? p.cidr : undefined,
      useGlobalSettings: p.useGlobalSettings !== false,
      useGlobalCategories: p.useGlobalCategories !== false,
      useGlobalApps: p.useGlobalApps !== false,
      assignedBlocklists: Array.isArray(p.assignedBlocklists)
        ? p.assignedBlocklists.map((x: any) => String(x)).filter(Boolean)
        : [],
      isInternetPaused: p.isInternetPaused === true,
      blockedCategories: Array.isArray(p.blockedCategories)
        ? p.blockedCategories.map((x: any) => String(x)).filter(isContentCategory)
        : [],
      blockedApps: Array.isArray(p.blockedApps) ? p.blockedApps.map((x: any) => String(x)).filter(isAppService) : [],
      schedules: Array.isArray(p.schedules)
        ? p.schedules
            .filter((s: any) => s && typeof s === 'object')
            .map(
              (s: any): Schedule => ({
                id: String(s.id ?? ''),
                name: String(s.name ?? 'Schedule'),
                days: Array.isArray(s.days) ? s.days.map((d: any) => String(d)).filter(Boolean) : [],
                startTime: String(s.startTime ?? ''),
                endTime: String(s.endTime ?? ''),
                active: s.active === true,
                mode: normalizeScheduleMode(s.mode),
                blockedCategories: Array.isArray(s.blockedCategories)
                  ? s.blockedCategories.map((x: any) => String(x)).filter(isContentCategory)
                  : [],
                blockedApps: Array.isArray(s.blockedApps) ? s.blockedApps.map((x: any) => String(x)).filter(isAppService) : [],
                blockAll: s.blockAll === true
              })
            )
            .filter((s: Schedule) => !!s.id)
        : []
    }))
    .filter((c) => c.id && c.name);
}

export type DomainPolicyCheckDecision = 'ALLOWED' | 'BLOCKED' | 'SHADOW_BLOCKED' | 'NONE';

export type DomainPolicyCheckResponse = {
  domain: string;
  decision: DomainPolicyCheckDecision;
  reason: string | null;
  blocklist?: { id: string; name: string; mode: 'ACTIVE' | 'SHADOW' } | null;
};

export async function domainPolicyCheck(
  db: Db,
  inputDomain: string,
  opts?: { clientIp?: string }
): Promise<DomainPolicyCheckResponse> {
  const domain = normalizeName(inputDomain);
  const clientIp = normalizeClientIp(opts?.clientIp ?? '0.0.0.0');

  if (!domain) return { domain, decision: 'NONE', reason: null, blocklist: null };

  const [clients, blocklistsById, categoryBlocklistsByCategory, appBlocklistsByApp, globalBlockedAppsRes] =
    await Promise.all([
      loadClients(db),
      loadBlocklists(db),
      loadCategoryBlocklists(db),
      loadAppBlocklists(db),
      db.pool.query('SELECT value FROM settings WHERE key = $1', ['global_blocked_apps'])
    ]);

  const exactClient = findExactClient(clients, clientIp);
  const subnetClient = exactClient ? null : findBestCidrClient(clients, clientIp);
  const effectiveClient = exactClient ?? subnetClient;

  const policyPrefix = (scope: 'client' | 'subnet' | 'global'): string =>
    scope === 'client' ? 'ClientPolicy' : scope === 'subnet' ? 'SubnetPolicy' : 'GlobalPolicy';

  if (exactClient?.isInternetPaused || subnetClient?.isInternetPaused) {
    return {
      domain,
      decision: 'BLOCKED',
      reason: exactClient?.isInternetPaused ? 'ClientPolicy:InternetPaused' : 'SubnetPolicy:InternetPaused',
      blocklist: null
    };
  }

  const globalAppsValue = globalBlockedAppsRes.rows?.[0]?.value;
  const globalActiveApps = parseGlobalBlockedAppsSetting(globalAppsValue);
  const globalShadowApps = parseGlobalShadowAppsSetting(globalAppsValue).filter((a) => !globalActiveApps.includes(a));

  // Precompute category/app id sets so we can exclude them from normal blocklist selection.
  const categoryIds = new Set<string>();
  for (const ids of categoryBlocklistsByCategory.values()) for (const id of ids) categoryIds.add(String(id));
  const appIds = new Set<string>();
  for (const ids of appBlocklistsByApp.values()) for (const id of ids) appIds.add(String(id));

  // Compute effective policy (base + schedules) for this client/subnet/global.
  const now = new Date();
  const effectiveBlockedCategories = new Set<ContentCategory>();

  const shouldUseGlobalCategories =
    exactClient?.useGlobalCategories === false ? false : subnetClient?.useGlobalCategories === false ? false : true;
  const shouldUseGlobalApps =
    exactClient?.useGlobalApps === false ? false : subnetClient?.useGlobalApps === false ? false : true;

  if (!shouldUseGlobalCategories) {
    const base = exactClient?.useGlobalCategories === false ? exactClient : subnetClient;
    for (const c of base?.blockedCategories ?? []) effectiveBlockedCategories.add(c);
  }

  const effectiveActiveApps = new Set<AppService>(shouldUseGlobalApps ? globalActiveApps : []);
  const effectiveShadowApps = new Set<AppService>(shouldUseGlobalApps ? globalShadowApps : []);

  if (!shouldUseGlobalApps) {
    const base = exactClient?.useGlobalApps === false ? exactClient : subnetClient;
    for (const a of base?.blockedApps ?? []) effectiveActiveApps.add(a);
  }

  for (const a of effectiveActiveApps) effectiveShadowApps.delete(a);

  let blockAll = false;
  const activeSubnetSchedules = (subnetClient?.schedules ?? []).filter((s) => isScheduleActiveNow(s, now));
  const activeClientSchedules = (exactClient?.schedules ?? []).filter((s) => isScheduleActiveNow(s, now));

  for (const s of [...activeSubnetSchedules, ...activeClientSchedules]) {
    if (s.blockAll) blockAll = true;
    for (const c of s.blockedCategories ?? []) effectiveBlockedCategories.add(c);
    for (const a of s.blockedApps ?? []) effectiveActiveApps.add(a);
  }

  for (const a of effectiveActiveApps) effectiveShadowApps.delete(a);

  // Manual rules (Allow/Block) + per-client/subnet rules.
  // We load only the rules for the actually-selected blocklists below.

  if (blockAll) {
    const scope: 'client' | 'subnet' | 'global' = activeClientSchedules.some((s) => s.blockAll)
      ? 'client'
      : activeSubnetSchedules.some((s) => s.blockAll)
        ? 'subnet'
        : 'global';
    return { domain, decision: 'BLOCKED', reason: `${policyPrefix(scope)}:BlockAll`, blocklist: null };
  }

  // Fast app suffix blocking has highest priority inside the policy phase.
  const clientScheduleApps = activeClientSchedules.flatMap((s) => s.blockedApps ?? []);
  const subnetScheduleApps = activeSubnetSchedules.flatMap((s) => s.blockedApps ?? []);
  const clientBaseApps = exactClient?.useGlobalApps === false ? (exactClient?.blockedApps ?? []) : [];
  const subnetBaseApps = subnetClient?.useGlobalApps === false ? (subnetClient?.blockedApps ?? []) : [];
  const globalBaseApps = shouldUseGlobalApps ? globalActiveApps : [];

  const findBlockedAppWithScope = (): { app: AppService; scope: 'client' | 'subnet' | 'global' } | null => {
    const clientScheduleHit = isAppBlockedByPolicy(domain, clientScheduleApps);
    if (clientScheduleHit) return { app: clientScheduleHit, scope: 'client' };

    const clientBaseHit = isAppBlockedByPolicy(domain, clientBaseApps);
    if (clientBaseHit) return { app: clientBaseHit, scope: 'client' };

    const subnetScheduleHit = isAppBlockedByPolicy(domain, subnetScheduleApps);
    if (subnetScheduleHit) return { app: subnetScheduleHit, scope: 'subnet' };

    const subnetBaseHit = isAppBlockedByPolicy(domain, subnetBaseApps);
    if (subnetBaseHit) return { app: subnetBaseHit, scope: 'subnet' };

    const globalHit = isAppBlockedByPolicy(domain, globalBaseApps);
    if (globalHit) return { app: globalHit, scope: 'global' };

    return null;
  };

  const blockedAppHit = findBlockedAppWithScope();
  if (blockedAppHit) {
    return {
      domain,
      decision: 'BLOCKED',
      reason: `${policyPrefix(blockedAppHit.scope)}:App:${blockedAppHit.app}`,
      blocklist: null
    };
  }

  // Determine selected blocklists for this client.
  const selectedBlocklists = new Set<string>();
  const shouldUseGlobalBlocklists =
    exactClient?.useGlobalSettings === false ? false : subnetClient?.useGlobalSettings === false ? false : true;

  if (!shouldUseGlobalBlocklists) {
    const base = exactClient?.useGlobalSettings === false ? exactClient : subnetClient;
    for (const id of base?.assignedBlocklists ?? []) {
      const sid = String(id).trim();
      if (!sid) continue;
      if (categoryIds.has(sid) || appIds.has(sid)) continue;
      selectedBlocklists.add(sid);
    }
  } else {
    for (const [id, st] of blocklistsById.entries()) {
      if (categoryIds.has(id) || appIds.has(id)) continue;
      if (st.enabled) selectedBlocklists.add(id);
    }
  }

  if (shouldUseGlobalCategories) {
    for (const id of categoryIds) {
      const st = blocklistsById.get(id);
      if (st?.enabled) selectedBlocklists.add(id);
    }
  }

  for (const cat of effectiveBlockedCategories) {
    const ids = categoryBlocklistsByCategory.get(cat) ?? [];
    for (const id of ids) selectedBlocklists.add(String(id));
  }

  // App blocklists are evaluated independently.
  const selectedActiveAppBlocklists = new Set<string>();
  const selectedShadowAppBlocklists = new Set<string>();
  const blocklistIdToApp = new Map<string, AppService>();

  for (const app of effectiveActiveApps) {
    const ids = appBlocklistsByApp.get(app) ?? [];
    for (const id of ids) {
      const sid = String(id);
      selectedActiveAppBlocklists.add(sid);
      if (!blocklistIdToApp.has(sid)) blocklistIdToApp.set(sid, app);
    }
  }

  for (const app of effectiveShadowApps) {
    const ids = appBlocklistsByApp.get(app) ?? [];
    for (const id of ids) {
      const sid = String(id);
      selectedShadowAppBlocklists.add(sid);
      if (!blocklistIdToApp.has(sid)) blocklistIdToApp.set(sid, app);
    }
  }

  // Load only the rule index required for this check.
  const neededIds: number[] = [];
  for (const id of new Set<string>([...selectedBlocklists, ...selectedActiveAppBlocklists, ...selectedShadowAppBlocklists])) {
    const n = Number(id);
    if (Number.isFinite(n)) neededIds.push(n);
  }

  const index = await loadRulesIndex(db, neededIds);
  const candidates = buildCandidateDomains(domain);

  // Per-client / subnet manual allow/block rules.
  if (exactClient) {
    const clientManual = decideManualRule(
      candidates,
      index.manualAllowedByClientId.get(exactClient.id),
      index.manualBlockedByClientId.get(exactClient.id)
    );
    if (clientManual === 'BLOCKED') return { domain, decision: 'BLOCKED', reason: `ClientRule:${exactClient.id}`, blocklist: null };
    if (clientManual === 'ALLOWED') return { domain, decision: 'ALLOWED', reason: `ClientRule:${exactClient.id}`, blocklist: null };
  }

  if (subnetClient) {
    const subnetManual = decideManualRule(
      candidates,
      index.manualAllowedBySubnetId.get(subnetClient.id),
      index.manualBlockedBySubnetId.get(subnetClient.id)
    );
    if (subnetManual === 'BLOCKED') return { domain, decision: 'BLOCKED', reason: `SubnetRule:${subnetClient.id}`, blocklist: null };
    if (subnetManual === 'ALLOWED') return { domain, decision: 'ALLOWED', reason: `SubnetRule:${subnetClient.id}`, blocklist: null };
  }

  const globalManual = decideManualRule(candidates, index.globalManualAllowed, index.globalManualBlocked);
  if (globalManual === 'BLOCKED') return { domain, decision: 'BLOCKED', reason: 'Manual', blocklist: null };
  if (globalManual === 'ALLOWED') return { domain, decision: 'ALLOWED', reason: 'Manual', blocklist: null };

  let shadowHit: string | null = null;

  // Evaluate app blocklists (active, then shadow).
  const globalShadowAppsList = shouldUseGlobalApps ? globalShadowApps : [];
  let appShadowHit: string | undefined;
  const shadowApp = isAppBlockedByPolicy(domain, globalShadowAppsList);
  if (shadowApp) appShadowHit = `${policyPrefix('global')}:AppShadow:${shadowApp}`;

  const appScopeByApp = new Map<AppService, 'client' | 'subnet' | 'global'>();
  for (const a of globalBaseApps) appScopeByApp.set(a, 'global');
  for (const a of globalShadowAppsList) appScopeByApp.set(a, 'global');
  for (const a of subnetBaseApps) appScopeByApp.set(a, 'subnet');
  for (const a of subnetScheduleApps) appScopeByApp.set(a, 'subnet');
  for (const a of clientBaseApps) appScopeByApp.set(a, 'client');
  for (const a of clientScheduleApps) appScopeByApp.set(a, 'client');

  if (selectedActiveAppBlocklists.size) {
    const appDecision = decideRuleIndexed(index, domain, blocklistsById, selectedActiveAppBlocklists);
    if (appDecision.decision === 'BLOCKED') {
      const id = appDecision.blocklistId ?? '';
      const app = id ? blocklistIdToApp.get(id) : undefined;
      const scope = app ? (appScopeByApp.get(app) ?? 'global') : 'global';
      return {
        domain,
        decision: 'BLOCKED',
        reason: app ? `${policyPrefix(scope)}:AppList:${app}` : id ? formatBlocklistCategory(id, blocklistsById.get(id)?.name) : null,
        blocklist: id ? { id, name: blocklistsById.get(id)?.name ?? 'Blocklist', mode: blocklistsById.get(id)?.mode ?? 'ACTIVE' } : null
      };
    }
    if (appDecision.decision === 'SHADOW_BLOCKED' && !appShadowHit) {
      const id = appDecision.blocklistId ?? '';
      const app = id ? blocklistIdToApp.get(id) : undefined;
      const scope = app ? (appScopeByApp.get(app) ?? 'global') : 'global';
      appShadowHit = app
        ? `${policyPrefix(scope)}:AppListShadow:${app}`
        : id
          ? formatBlocklistCategory(id, blocklistsById.get(id)?.name)
          : undefined;
    }
  }

  if (selectedShadowAppBlocklists.size) {
    const shadowDecision = decideRuleIndexed(index, domain, blocklistsById, selectedShadowAppBlocklists);
    if ((shadowDecision.decision === 'BLOCKED' || shadowDecision.decision === 'SHADOW_BLOCKED') && !appShadowHit) {
      const id = shadowDecision.blocklistId ?? '';
      const app = id ? blocklistIdToApp.get(id) : undefined;
      const scope = app ? (appScopeByApp.get(app) ?? 'global') : 'global';
      appShadowHit = app
        ? `${policyPrefix(scope)}:AppListShadow:${app}`
        : id
          ? formatBlocklistCategory(id, blocklistsById.get(id)?.name)
          : undefined;
    }
  }

  // Evaluate normal blocklists.
  const { decision, blocklistId } = decideRuleIndexed(index, domain, blocklistsById, selectedBlocklists);
  if (decision === 'BLOCKED') {
    const id = blocklistId ?? '';
    const st = id ? blocklistsById.get(id) : undefined;
    return {
      domain,
      decision: 'BLOCKED',
      reason: id ? formatBlocklistCategory(id, st?.name) : null,
      blocklist: id ? { id, name: st?.name ?? 'Blocklist', mode: st?.mode ?? 'ACTIVE' } : null
    };
  }

  if (decision === 'SHADOW_BLOCKED' && blocklistId) {
    const st = blocklistsById.get(blocklistId);
    shadowHit = formatBlocklistCategory(blocklistId, st?.name);
  }

  if (appShadowHit) shadowHit = appShadowHit;

  if (shadowHit) {
    const id = extractBlocklistId(shadowHit) ?? null;
    const st = id ? blocklistsById.get(id) : undefined;
    return {
      domain,
      decision: 'SHADOW_BLOCKED',
      reason: shadowHit,
      blocklist: id && st ? { id, name: st.name, mode: 'SHADOW' } : null
    };
  }

  void effectiveClient;
  return { domain, decision: 'NONE', reason: null, blocklist: null };
}

async function loadCategoryBlocklists(db: Db): Promise<Map<ContentCategory, string[]>> {
  const urls: Array<{ category: ContentCategory; url: string }> = [];
  for (const [category, categoryUrls] of Object.entries(CATEGORY_BLOCKLIST_URLS) as Array<
    [ContentCategory, string[]]
  >) {
    for (const url of categoryUrls) {
      if (url) urls.push({ category, url });
    }
  }

  if (!urls.length) return new Map();

  const res = await db.pool.query('SELECT id, url, enabled FROM blocklists WHERE url = ANY($1::text[])', [
    urls.map((x) => x.url)
  ]);

  const idByUrl = new Map<string, { id: string; enabled: boolean }>();
  for (const row of res.rows) {
    const url = String(row?.url ?? '');
    const id = String(row?.id ?? '').trim();
    if (!url || !id) continue;
    idByUrl.set(url, { id, enabled: row?.enabled !== false });
  }

  const out = new Map<ContentCategory, string[]>();
  for (const { category, url } of urls) {
    const hit = idByUrl.get(url);
    if (!hit) continue;
    const cur = out.get(category) ?? [];
    if (!cur.includes(hit.id)) cur.push(hit.id);
    out.set(category, cur);
  }
  return out;
}

async function loadAppBlocklists(db: Db): Promise<Map<AppService, string[]>> {
  const urls: Array<{ app: AppService; url: string }> = [];
  for (const [app, appUrls] of Object.entries(APP_BLOCKLIST_URLS) as Array<[AppService, string[]]>) {
    for (const url of appUrls) {
      if (url) urls.push({ app, url });
    }
  }

  if (!urls.length) return new Map();

  const res = await db.pool.query('SELECT id, url, enabled FROM blocklists WHERE url = ANY($1::text[])', [
    urls.map((x) => x.url)
  ]);

  const idByUrl = new Map<string, { id: string; enabled: boolean }>();
  for (const row of res.rows) {
    const url = String(row?.url ?? '');
    const id = String(row?.id ?? '').trim();
    if (!url || !id) continue;
    idByUrl.set(url, { id, enabled: row?.enabled !== false });
  }

  const out = new Map<AppService, string[]>();
  for (const { app, url } of urls) {
    const hit = idByUrl.get(url);
    if (!hit) continue;
    const cur = out.get(app) ?? [];
    if (!cur.includes(hit.id)) cur.push(hit.id);
    out.set(app, cur);
  }
  return out;
}

async function loadBlocklists(db: Db): Promise<Map<string, BlocklistStatus>> {
  const res = await db.pool.query('SELECT id, enabled, mode, name FROM blocklists');
  const map = new Map<string, BlocklistStatus>();
  for (const row of res.rows) {
    const id = String(row?.id ?? '').trim();
    if (!id) continue;
    const enabled = row?.enabled !== false;
    const mode = row?.mode === 'SHADOW' ? 'SHADOW' : 'ACTIVE';
    const name = String(row?.name ?? '').trim();
    map.set(id, { enabled, mode, name });
  }
  return map;
}

function parseRewriteDomain(input: string): { domain: string; wildcard: boolean } | null {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  if (raw.startsWith('*.')) {
    const base = normalizeName(raw.slice(2));
    if (!base) return null;
    return { domain: base, wildcard: true };
  }
  const domain = normalizeName(raw);
  if (!domain) return null;
  return { domain, wildcard: false };
}

function loadRewritesFromSettings(value: any): RewriteEntry[] {
  const raw = Array.isArray(value?.items) ? value.items : Array.isArray(value) ? value : [];
  const out: RewriteEntry[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const id = String(r.id ?? '').trim();
    const parsed = parseRewriteDomain(String(r.domain ?? ''));
    const target = String(r.target ?? '').trim();
    if (!id || !parsed || !target) continue;
    out.push({ id, domain: parsed.domain, target, wildcard: parsed.wildcard });
  }
  return out;
}

function buildLocalAnswerResponse(query: any, answerName: string, qtype: string, target: string): Buffer | null {
  const ttl = 60;
  const answers: any[] = [];

  const isIpv4 = (() => {
    try {
      const a = ipaddr.parse(target);
      return a.kind() === 'ipv4';
    } catch {
      return false;
    }
  })();

  const isIpv6 = (() => {
    try {
      const a = ipaddr.parse(target);
      return a.kind() === 'ipv6';
    } catch {
      return false;
    }
  })();

  if (qtype === 'A') {
    if (isIpv4) answers.push({ type: 'A', name: answerName, ttl, data: target });
    else answers.push({ type: 'CNAME', name: answerName, ttl, data: normalizeName(target) });
  } else if (qtype === 'AAAA') {
    if (isIpv6) answers.push({ type: 'AAAA', name: answerName, ttl, data: target });
    else answers.push({ type: 'CNAME', name: answerName, ttl, data: normalizeName(target) });
  } else if (qtype === 'CNAME') {
    answers.push({ type: 'CNAME', name: answerName, ttl, data: normalizeName(target) });
  } else if (qtype === 'ANY') {
    if (isIpv4) answers.push({ type: 'A', name: answerName, ttl, data: target });
    else if (isIpv6) answers.push({ type: 'AAAA', name: answerName, ttl, data: target });
    else answers.push({ type: 'CNAME', name: answerName, ttl, data: normalizeName(target) });
  } else {
    return null;
  }

  const response = {
    type: 'response',
    id: query.id,
    flags: query.flags,
    questions: query.questions,
    answers,
    authorities: [],
    additionals: [],
    rcode: 'NOERROR'
  };
  return dnsPacket.encode(response as any);
}

async function insertQueryLog(
  db: Db,
  entry: {
    id: string;
    timestamp: string;
    domain: string;
    client: string;
    clientIp: string;
    status: string;
    type: string;
    durationMs: number;
    blocklistId?: string;
    answerIps?: string[];
    protectionPaused?: boolean;
  }
): Promise<void> {
  // Fire-and-forget; DNS latency must be minimal.
  void db.pool.query('INSERT INTO query_logs(entry) VALUES ($1)', [entry]).catch(() => {});
}

function extractAnswerIpsFromDnsResponse(resp: Buffer): string[] {
  try {
    const decoded: any = dnsPacket.decode(resp);
    const answers: any[] = Array.isArray(decoded?.answers) ? decoded.answers : [];
    const ips: string[] = [];
    for (const a of answers) {
      const t = typeof a?.type === 'string' ? a.type : '';
      if (t !== 'A' && t !== 'AAAA') continue;
      const d = a?.data;
      if (typeof d === 'string' && d.length > 0) ips.push(d);
    }
    // de-dupe and cap to keep logs small
    return Array.from(new Set(ips)).slice(0, 8);
  } catch {
    return [];
  }
}

async function forwardUdp(upstream: { host: string; port: number }, msg: Buffer, timeoutMs: number): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const timer = setTimeout(() => {
      try {
        socket.close();
      } catch {
        // ignore
      }
      reject(new Error('UPSTREAM_TIMEOUT'));
    }, timeoutMs);

    socket.once('message', (data) => {
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // ignore
      }
      resolve(data);
    });

    socket.send(msg, upstream.port, upstream.host, (err) => {
      if (err) {
        clearTimeout(timer);
        try {
          socket.close();
        } catch {
          // ignore
        }
        reject(err);
      }
    });
  });
}

async function forwardTcp(
  upstream: { host: string; port: number },
  msg: Buffer | Uint8Array | string,
  timeoutMs: number
): Promise<Buffer> {
  const msgBuf = Buffer.isBuffer(msg) ? msg : Buffer.from(msg);
  return await new Promise<Buffer>((resolve, reject) => {
    const socket = net.createConnection({ host: upstream.host, port: upstream.port });
    const timer = setTimeout(() => {
      socket.destroy(new Error('UPSTREAM_TIMEOUT'));
    }, timeoutMs);

    let chunks: Buffer[] = [];
    let expected: number | null = null;

    socket.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });

    socket.on('data', (data) => {
      chunks.push(data);
      const all = Buffer.concat(chunks);
      if (expected == null) {
        if (all.length < 2) return;
        expected = all.readUInt16BE(0);
      }
      if (expected != null && all.length >= expected + 2) {
        clearTimeout(timer);
        socket.end();
        resolve(all.subarray(2, 2 + expected));
      }
    });

    socket.on('connect', () => {
      const len = Buffer.alloc(2);
      len.writeUInt16BE(msgBuf.length, 0);
      socket.write(Buffer.concat([len, msgBuf]));
    });
  });
}

async function forwardDot(
  upstream: { host: string; port: number },
  msg: Buffer | Uint8Array | string,
  timeoutMs: number,
  lookup?: any
): Promise<Buffer> {
  const msgBuf = Buffer.isBuffer(msg) ? msg : Buffer.from(msg);
  return await new Promise<Buffer>((resolve, reject) => {
    const socket = tls.connect({
      host: upstream.host,
      port: upstream.port,
      servername: upstream.host,
      timeout: timeoutMs,
      ...(lookup ? { lookup } : {})
    });

    const timer = setTimeout(() => {
      socket.destroy(new Error('UPSTREAM_TIMEOUT'));
    }, timeoutMs);

    let chunks: Buffer[] = [];
    let expected: number | null = null;

    socket.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });

    socket.on('data', (data) => {
      chunks.push(data);
      const all = Buffer.concat(chunks);
      if (expected == null) {
        if (all.length < 2) return;
        expected = all.readUInt16BE(0);
      }
      if (expected != null && all.length >= expected + 2) {
        clearTimeout(timer);
        socket.end();
        resolve(all.subarray(2, 2 + expected));
      }
    });

    socket.on('secureConnect', () => {
      const len = Buffer.alloc(2);
      len.writeUInt16BE(msgBuf.length, 0);
      socket.write(Buffer.concat([len, msgBuf]));
    });
  });
}

async function forwardDohHttp1(dohUrl: string, msg: Buffer, timeoutMs: number): Promise<Buffer> {
  return await forwardDohHttp1WithOptions(dohUrl, msg, timeoutMs, { preferIpv4: false });
}

type DohHttp1Options = {
  preferIpv4: boolean;
  bootstrapServers?: string[];
};

type LookupAddress = { address: string; family: 4 | 6 };

function parseBootstrapServers(raw: string): string[] {
  const list = String(raw || '')
    .split(/[,\s]+/g)
    .map((s) => s.trim())
    .filter(Boolean);
  // Keep only IP literals to avoid recursive lookups.
  return list.filter((s) => net.isIP(s) === 4 || net.isIP(s) === 6);
}

function createBootstrapLookup(opts: { bootstrapServers: string[]; preferIpv4: boolean }) {
  const servers = Array.isArray(opts.bootstrapServers) ? opts.bootstrapServers : [];
  if (servers.length === 0) return null;

  const resolver = new dns.Resolver();
  try {
    resolver.setServers(servers);
  } catch {
    return null;
  }

  const resolveAll = async (hostname: string): Promise<LookupAddress[]> => {
    let v4: string[] = [];
    let v6: string[] = [];

    try {
      v4 = await new Promise<string[]>((resolve, reject) => {
        resolver.resolve4(hostname, (err, addresses) => {
          if (err) reject(err);
          else resolve(Array.isArray(addresses) ? (addresses as string[]) : []);
        });
      });
    } catch {
      v4 = [];
    }

    try {
      v6 = await new Promise<string[]>((resolve, reject) => {
        resolver.resolve6(hostname, (err, addresses) => {
          if (err) reject(err);
          else resolve(Array.isArray(addresses) ? (addresses as string[]) : []);
        });
      });
    } catch {
      v6 = [];
    }

    const as4 = (Array.isArray(v4) ? v4 : []).map((address) => ({ address, family: 4 as const }));
    const as6 = (Array.isArray(v6) ? v6 : []).map((address) => ({ address, family: 6 as const }));
    return opts.preferIpv4 ? [...as4, ...as6] : [...as6, ...as4];
  };

  // Callback-style lookup function compatible with net/tls/http2.
  return (hostname: string, options: any, callback: any) => {
    const requestedFamily = typeof options?.family === 'number' ? options.family : 0;
    const wantsAll = Boolean(options?.all);

    // If hostname is already an IP literal, skip DNS.
    const ipFamily = net.isIP(hostname);
    if (ipFamily === 4 || ipFamily === 6) {
      if (wantsAll) {
        callback(null, [{ address: hostname, family: ipFamily }]);
        return;
      }
      callback(null, hostname, ipFamily);
      return;
    }

    (async () => {
      const all = await resolveAll(hostname);
      const filtered =
        requestedFamily === 4 ? all.filter((a) => a.family === 4) : requestedFamily === 6 ? all.filter((a) => a.family === 6) : all;

      if (filtered.length === 0) throw new Error('DNS_LOOKUP_FAILED');
      if (wantsAll) return filtered;
      return filtered[0];
    })()
      .then((result: any) => {
        if (Array.isArray(result)) {
          callback(null, result);
          return;
        }
        callback(null, result.address, result.family);
      })
      .catch((err) => callback(err));
  };
}

const dohAgentCache = new Map<string, Agent>();
const bootstrapLookupCache = new Map<string, any>();

function getBootstrapLookupCached(opts: { bootstrapServers: string[]; preferIpv4: boolean }) {
  const servers = Array.isArray(opts.bootstrapServers) ? opts.bootstrapServers : [];
  const key = JSON.stringify({ servers, preferIpv4: opts.preferIpv4 });
  if (bootstrapLookupCache.has(key)) return bootstrapLookupCache.get(key);
  const created = createBootstrapLookup({ bootstrapServers: servers, preferIpv4: opts.preferIpv4 });
  bootstrapLookupCache.set(key, created);
  return created;
}

function getDohAgent(opts: { preferIpv4: boolean; bootstrapServers: string[] }): Agent {
  const servers = Array.isArray(opts.bootstrapServers) ? opts.bootstrapServers : [];
  const key = JSON.stringify({ servers, preferIpv4: opts.preferIpv4 });
  const existing = dohAgentCache.get(key);
  if (existing) return existing;

  const lookup = getBootstrapLookupCached({ bootstrapServers: servers, preferIpv4: opts.preferIpv4 });
  const agent = new Agent({
    connections: 32,
    pipelining: 1,
    keepAliveTimeout: 30_000,
    keepAliveMaxTimeout: 60_000,
    ...(lookup
      ? {
          connect: {
            lookup
          }
        }
      : {})
  });

  dohAgentCache.set(key, agent);
  return agent;
}

async function forwardDohHttp1WithOptions(
  dohUrl: string,
  msg: Buffer,
  timeoutMs: number,
  options: DohHttp1Options
): Promise<Buffer> {
  const started = Date.now();
  const bootstrapServers = parseBootstrapServers(String(options.bootstrapServers?.join(',') || ''));
  const attempt = async (dispatcher: Agent, budgetMs: number): Promise<Buffer> => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), budgetMs);
    try {
      try {
        const res = await request(dohUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/dns-message',
            accept: 'application/dns-message',
            'user-agent': 'sentinel-dns/0.1'
          },
          body: msg,
          dispatcher,
          signal: ac.signal
        });

        if (res.statusCode !== 200) {
          try {
            await res.body.text();
          } catch {
            // ignore
          }
          throw new Error(`HTTP_${res.statusCode}`);
        }

        return Buffer.from(await res.body.arrayBuffer());
      } catch (e: any) {
        if (ac.signal.aborted) throw new Error('UPSTREAM_TIMEOUT');
        throw e;
      }
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    const primary = getDohAgent({ preferIpv4: options.preferIpv4, bootstrapServers });
    return await attempt(primary, timeoutMs);
  } catch (e: any) {
    // If IPv4 is preferred but fails (e.g. v4 route blackhole) allow a single retry
    // with the default agent to let IPv6 succeed within the remaining time budget.
    const msgText = e instanceof Error ? e.message : String(e);
    if (!options.preferIpv4) throw e;
    if (msgText.startsWith('HTTP_')) throw e;
    if (msgText === 'UPSTREAM_TIMEOUT') throw e;

    const remaining = Math.max(250, timeoutMs - (Date.now() - started));
    const fallback = getDohAgent({ preferIpv4: false, bootstrapServers });
    return await attempt(fallback, remaining);
  }
}

async function forwardDohHttp2(
  dohUrl: string,
  msg: Buffer,
  timeoutMs: number,
  opts?: { bootstrapServers?: string[]; preferIpv4?: boolean }
): Promise<Buffer> {
  const url = new URL(dohUrl);
  const origin = `${url.protocol}//${url.host}`;
  const path = `${url.pathname}${url.search}` || '/';

  const servers = parseBootstrapServers(String(opts?.bootstrapServers?.join(',') || ''));
  const preferIpv4 = Boolean(opts?.preferIpv4);
  const lookup = servers.length ? getBootstrapLookupCached({ bootstrapServers: servers, preferIpv4 }) : null;

  return await new Promise<Buffer>((resolve, reject) => {
    const client = http2.connect(origin, {
      servername: url.hostname,
      ...(lookup ? { lookup } : {})
    });
    const timer = setTimeout(() => {
      client.destroy(new Error('UPSTREAM_TIMEOUT'));
    }, timeoutMs);

    client.on('error', (err) => {
      clearTimeout(timer);
      client.close();
      reject(err);
    });

    const req = client.request({
      ':method': 'POST',
      ':scheme': 'https',
      ':authority': url.host,
      ':path': path,
      'content-type': 'application/dns-message',
      accept: 'application/dns-message',
      'user-agent': 'sentinel-dns/0.1'
    });

    let status = 0;
    const chunks: Buffer[] = [];

    req.on('response', (headers) => {
      status = Number(headers[':status'] ?? 0);
    });

    req.on('data', (chunk: Buffer) => chunks.push(chunk));

    req.on('end', () => {
      clearTimeout(timer);
      client.close();
      if (status && status !== 200) {
        reject(new Error(`HTTP_${status}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });

    req.on('error', (err) => {
      clearTimeout(timer);
      client.close();
      reject(err);
    });

    req.end(msg);
  });
}

async function forwardDoh(
  dohUrl: string,
  msg: Buffer,
  timeoutMs: number,
  preferIpv4: boolean,
  bootstrapServers: string[]
): Promise<Buffer> {
  if (dohUrl.startsWith('https://')) {
    // Prefer HTTP/1.1: it's generally more compatible on constrained networks.
    // (HTTP/2 can stall due to middleboxes, IPv6 routing issues, or ALPN handling.)
    return await forwardDohHttp1WithOptions(dohUrl, msg, timeoutMs, { preferIpv4, bootstrapServers });
  }

  return await forwardDohHttp1WithOptions(dohUrl, msg, timeoutMs, { preferIpv4, bootstrapServers });
}

function buildNxDomainResponse(query: any): Buffer {
  const baseFlags = typeof query?.flags === 'number' ? query.flags : 0;
  const response = {
    type: 'response',
    id: query.id,
    // dns-packet encodes the header RCODE in the low 4 bits of `flags`.
    // Preserve all existing flag bits/opcode from the query, but overwrite the RCODE.
    flags: (baseFlags & ~0xf) | 3,
    questions: query.questions,
    answers: [],
    authorities: [],
    additionals: [],
    rcode: 'NXDOMAIN'
  };
  return dnsPacket.encode(response as any);
}

function buildServFailResponse(query: any): Buffer {
  const baseFlags = typeof query?.flags === 'number' ? query.flags : 0;
  const response = {
    type: 'response',
    id: query.id,
    // Preserve existing flag bits/opcode from the query, but overwrite the RCODE.
    flags: (baseFlags & ~0xf) | 2,
    questions: query.questions,
    answers: [],
    authorities: [],
    additionals: [],
    rcode: 'SERVFAIL'
  };
  return dnsPacket.encode(response as any);
}

export async function startDnsServer(config: AppConfig, db: Db): Promise<{ close: () => Promise<void> }> {
  if (!config.ENABLE_DNS) {
    return { close: async () => {} };
  }

  dnsRuntimeStats.startedAt = new Date().toISOString();
  dnsRuntimeStats.lastQueryAt = null;
  dnsRuntimeStats.lastClientIp = null;
  dnsRuntimeStats.lastTransport = null;
  dnsRuntimeStats.totalQueries = 0;
  dnsRuntimeStats.tailscaleQueries = 0;
  dnsRuntimeStats.tailscaleV4Queries = 0;
  dnsRuntimeStats.tailscaleV6Queries = 0;

  function logRulesIndexReload(stats: {
    selectedBlocklistCount: number;
    maxId: number;
    durationMs: number;
    index: RulesIndex;
  }): void {
    try {
      const loadedAtIso = new Date().toISOString();
      console.info(
        `[dns] rules-index reloaded at=${loadedAtIso} maxId=${stats.maxId} ` +
          `selectedBlocklists=${stats.selectedBlocklistCount} ` +
          `domains=${stats.index.blockedByDomain.size} ` +
          `globalManualAllowed=${stats.index.globalManualAllowed.size} globalManualBlocked=${stats.index.globalManualBlocked.size} ` +
          `clientScoped=${stats.index.manualBlockedByClientId.size + stats.index.manualAllowedByClientId.size} ` +
          `subnetScoped=${stats.index.manualBlockedBySubnetId.size + stats.index.manualAllowedBySubnetId.size} ` +
          `durationMs=${stats.durationMs}`
      );
    } catch {
      // best-effort logging only
    }
  }

  const upstreamCache: UpstreamCache = {
    loadedAt: 0,
    upstream: { ...parseHostPort(config.UPSTREAM_DNS), transport: 'udp' }
  };

  const bootstrapServers = parseBootstrapServers(String((config as any).DNS_FORWARD_BOOTSTRAP_DNS || ''));

  const rulesCache: RulesCache = {
    loadedAt: 0,
    maxId: 0,
    includedIdsKey: '',
    index: {
      globalManualAllowed: new Set(),
      globalManualBlocked: new Set(),
      manualAllowedByClientId: new Map(),
      manualBlockedByClientId: new Map(),
      manualAllowedBySubnetId: new Map(),
      manualBlockedBySubnetId: new Map(),
      blockedByDomain: new Map()
    }
  };
  const clientsCache: ClientsCache = { loadedAt: 0, clients: [] };
  const rewritesCache: RewritesCache = { loadedAt: 0, byDomain: new Map(), wildcards: [] };
  const blocklistsCache: BlocklistsCache = { loadedAt: 0, byId: new Map() };
  const categoryBlocklistsCache: CategoryBlocklistsCache = { loadedAt: 0, byCategory: new Map() };
  const appBlocklistsCache: AppBlocklistsCache = { loadedAt: 0, byApp: new Map() };
  const categoryBlocklistIdsCache: { loadedAt: number; ids: Set<string> } = { loadedAt: 0, ids: new Set() };
  const appBlocklistIdsCache: { loadedAt: number; ids: Set<string> } = { loadedAt: 0, ids: new Set() };
  const globalAppsCache: { loadedAt: number; activeApps: AppService[]; shadowApps: AppService[] } = {
    loadedAt: 0,
    activeApps: [],
    shadowApps: []
  };

  const appBlocklistWarmup = {
    inFlight: new Set<string>(),
    lastAttemptMsById: new Map<string, number>()
  };

  const APP_BLOCKLIST_WARMUP_COOLDOWN_MS = 5 * 60_000;

  let protectionPause: ProtectionPauseState = { mode: 'OFF' };

  async function refreshProtectionPause(): Promise<void> {
    try {
      const res = await db.pool.query('SELECT value FROM settings WHERE key = $1', ['protection_pause']);
      protectionPause = parseProtectionPauseSetting(res.rows?.[0]?.value);
    } catch {
      // keep last known
    }
  }

  function collectReferencedAppsForWarmup(): Set<AppService> {
    const out = new Set<AppService>();

    for (const a of globalAppsCache.activeApps) out.add(a);
    for (const a of globalAppsCache.shadowApps) out.add(a);

    for (const client of clientsCache.clients) {
      if (client.useGlobalApps === false) {
        for (const a of client.blockedApps ?? []) out.add(a);
      }

      for (const s of client.schedules ?? []) {
        for (const a of s.blockedApps ?? []) out.add(a);
      }
    }

    return out;
  }

  async function warmAppBlocklistsIfNeeded(): Promise<void> {
    const apps = collectReferencedAppsForWarmup();
    if (!apps.size) return;

    const wantedIds = new Set<string>();
    for (const app of apps) {
      const ids = appBlocklistsCache.byApp.get(app) ?? [];
      for (const id of ids) {
        const sid = String(id).trim();
        if (sid) wantedIds.add(sid);
      }
    }

    const numericIds = Array.from(wantedIds)
      .map((x) => Number(x))
      .filter((n) => Number.isFinite(n));

    if (!numericIds.length) return;

    const res = await db.pool.query(
      'SELECT id, name, url, last_updated_at, last_rule_count FROM blocklists WHERE id = ANY($1::int[])',
      [numericIds]
    );

    const now = Date.now();
    for (const row of res.rows) {
      const idNum = Number(row?.id);
      if (!Number.isFinite(idNum)) continue;
      const id = String(idNum);

      const lastUpdatedAt = row?.last_updated_at as string | null | undefined;
      const lastRuleCount = Number(row?.last_rule_count ?? 0);
      const shouldRefresh = !lastUpdatedAt || !Number.isFinite(lastRuleCount) || lastRuleCount <= 0;
      if (!shouldRefresh) continue;

      if (appBlocklistWarmup.inFlight.has(id)) continue;
      const lastAttempt = appBlocklistWarmup.lastAttemptMsById.get(id) ?? 0;
      if (now - lastAttempt < APP_BLOCKLIST_WARMUP_COOLDOWN_MS) continue;
      appBlocklistWarmup.lastAttemptMsById.set(id, now);

      const name = String(row?.name ?? '').trim();
      const url = String(row?.url ?? '').trim();
      if (!name || !url) continue;

      appBlocklistWarmup.inFlight.add(id);
      void refreshBlocklist(db, { id: idNum, name, url })
        .catch(() => undefined)
        .finally(() => {
          appBlocklistWarmup.inFlight.delete(id);
        });
    }
  }

  async function refreshCaches(): Promise<void> {
    try {
      const [clients, blocklists, categoryBlocklists, appBlocklists, globalBlockedApps, dnsSettings, dnsRewrites, maxRulesId] =
        await Promise.all([
          loadClients(db),
          loadBlocklists(db),
          loadCategoryBlocklists(db),
          loadAppBlocklists(db),
          db.pool.query('SELECT value FROM settings WHERE key = $1', ['global_blocked_apps']),
          db.pool.query('SELECT value FROM settings WHERE key = $1', ['dns_settings']),
          db.pool.query('SELECT value FROM settings WHERE key = $1', ['dns_rewrites']),
          getRulesMaxId(db)
        ]);

      clientsCache.clients = clients;
      clientsCache.loadedAt = Date.now();
      blocklistsCache.byId = blocklists;
      blocklistsCache.loadedAt = Date.now();
      categoryBlocklistsCache.byCategory = categoryBlocklists;
      categoryBlocklistsCache.loadedAt = Date.now();

      // Precompute union sets so query-time filtering is cheap.
      const catIds = new Set<string>();
      for (const ids of categoryBlocklists.values()) {
        for (const id of ids) catIds.add(String(id));
      }
      categoryBlocklistIdsCache.ids = catIds;
      categoryBlocklistIdsCache.loadedAt = Date.now();

      appBlocklistsCache.byApp = appBlocklists;
      appBlocklistsCache.loadedAt = Date.now();

      const appIds = new Set<string>();
      for (const ids of appBlocklists.values()) {
        for (const id of ids) appIds.add(String(id));
      }
      appBlocklistIdsCache.ids = appIds;
      appBlocklistIdsCache.loadedAt = Date.now();

      const globalAppsValue = globalBlockedApps.rows?.[0]?.value;
      globalAppsCache.activeApps = parseGlobalBlockedAppsSetting(globalAppsValue);
      globalAppsCache.shadowApps = parseGlobalShadowAppsSetting(globalAppsValue).filter(
        (a) => !globalAppsCache.activeApps.includes(a)
      );
      globalAppsCache.loadedAt = Date.now();

      // Make app blocking reliable: app-specific blocklists are seeded as disabled and may not have
      // any rules until refreshed at least once. Warm up referenced app blocklists automatically.
      void warmAppBlocklistsIfNeeded().catch(() => undefined);

      // Rules can be large (millions of rows). Avoid reloading them every 5 seconds.
      // Instead: track MAX(id) and rebuild the in-memory index only when it changes,
      // with a cooldown to avoid thrashing during refresh imports.
      const nowMs = Date.now();
      const RULES_RELOAD_COOLDOWN_MS = 30_000;
      const RULES_SELECTION_RELOAD_COOLDOWN_MS = 2_000;

      const shouldReloadByRules = maxRulesId !== rulesCache.maxId;

      // Build the full "needed ids" set first so we can also detect selection changes.
      const neededIds = new Set<number>();

      // Include all globally enabled lists (includes enabled category/app lists).
      for (const [id, st] of blocklists.entries()) {
        if (!st.enabled) continue;
        const n = Number(id);
        if (Number.isFinite(n)) neededIds.add(n);
      }

      // Include per-client override blocklists even when globally disabled.
      for (const c of clients) {
        if (c.useGlobalSettings !== false) continue;
        for (const id of c.assignedBlocklists ?? []) {
          const sid = String(id).trim();
          if (!sid) continue;
          // Category/App lists are managed separately.
          if (categoryBlocklistIdsCache.ids.has(sid) || appBlocklistIdsCache.ids.has(sid)) continue;
          const n = Number(sid);
          if (Number.isFinite(n)) neededIds.add(n);
        }
      }

      // Include Category/App lists referenced by per-client policies and schedules,
      // even when those blocklists are globally disabled.
      const referencedCategories = new Set<ContentCategory>();
      const referencedApps = new Set<AppService>();

      for (const c of clients) {
        if (c.useGlobalCategories === false) {
          for (const cat of c.blockedCategories ?? []) referencedCategories.add(cat);
        }

        if (c.useGlobalApps === false) {
          for (const app of c.blockedApps ?? []) referencedApps.add(app);
        }

        for (const s of c.schedules ?? []) {
          for (const cat of s.blockedCategories ?? []) referencedCategories.add(cat);
          for (const app of s.blockedApps ?? []) referencedApps.add(app);
        }
      }

      // Global app lists can apply to clients using global apps.
      for (const app of globalAppsCache.activeApps) referencedApps.add(app);
      for (const app of globalAppsCache.shadowApps) referencedApps.add(app);

      for (const cat of referencedCategories) {
        const ids = categoryBlocklists.get(cat) ?? [];
        for (const id of ids) {
          const n = Number(id);
          if (Number.isFinite(n)) neededIds.add(n);
        }
      }

      for (const app of referencedApps) {
        const ids = appBlocklists.get(app) ?? [];
        for (const id of ids) {
          const n = Number(id);
          if (Number.isFinite(n)) neededIds.add(n);
        }
      }

      const neededIdsKey = Array.from(neededIds).sort((a, b) => a - b).join(',');
      const shouldReloadBySelection = neededIdsKey !== rulesCache.includedIdsKey;

      const selectionCooldownOk = nowMs - rulesCache.loadedAt >= RULES_SELECTION_RELOAD_COOLDOWN_MS;
      const rulesCooldownOk = nowMs - rulesCache.loadedAt >= RULES_RELOAD_COOLDOWN_MS;

      if ((shouldReloadByRules && rulesCooldownOk) || (!shouldReloadByRules && shouldReloadBySelection && selectionCooldownOk)) {
        const t0 = Date.now();
        const nextIndex = await loadRulesIndex(db, Array.from(neededIds));
        const durationMs = Date.now() - t0;

        rulesCache.index = nextIndex;
        rulesCache.maxId = maxRulesId;
        rulesCache.loadedAt = nowMs;
        rulesCache.includedIdsKey = neededIdsKey;

        logRulesIndexReload({
          selectedBlocklistCount: neededIds.size,
          maxId: maxRulesId,
          durationMs,
          index: nextIndex
        });
      }

      const rewrites = loadRewritesFromSettings(dnsRewrites.rows?.[0]?.value);
      const byDomain = new Map<string, RewriteEntry>();
      const wildcards: RewriteEntry[] = [];
      for (const r of rewrites) {
        if (r.wildcard) wildcards.push(r);
        else byDomain.set(normalizeName(r.domain), r);
      }
      // Prefer most specific wildcard first (longest domain).
      wildcards.sort((a, b) => b.domain.length - a.domain.length);
      rewritesCache.byDomain = byDomain;
      rewritesCache.wildcards = wildcards;
      rewritesCache.loadedAt = Date.now();

      const value = dnsSettings.rows?.[0]?.value;
      const mode = value?.upstreamMode === 'forward' ? 'forward' : 'unbound';

      let configured: DnsUpstreamConfigured = mode === 'forward' ? { upstreamMode: 'forward', forward: { transport: 'udp' } } : { upstreamMode: 'unbound' };
      if (mode === 'forward') {
        const transport =
          value?.forward?.transport === 'tcp'
            ? 'tcp'
            : value?.forward?.transport === 'dot'
              ? 'dot'
              : value?.forward?.transport === 'doh'
                ? 'doh'
                : 'udp';

        configured = { upstreamMode: 'forward', forward: { transport } };

        if (transport === 'doh') {
          const dohUrl = typeof value?.forward?.dohUrl === 'string' ? String(value.forward.dohUrl) : '';
          if (dohUrl) {
            configured.forward.dohUrl = dohUrl;
            upstreamCache.upstream = { transport: 'doh', dohUrl };
          }
        } else {
          const host = typeof value?.forward?.host === 'string' ? String(value.forward.host) : '';
          const port = Number(value?.forward?.port);
          if (host && Number.isFinite(port) && port > 0) {
            configured.forward.host = host;
            configured.forward.port = Math.min(65535, Math.floor(port));
            upstreamCache.upstream = { host, port: Math.min(65535, Math.floor(port)), transport };
          }
        }
      } else {
        const parsed = parseHostPort(config.UPSTREAM_DNS);
        upstreamCache.upstream = { host: parsed.host, port: parsed.port, transport: 'udp' };
      }

      upstreamCache.loadedAt = Date.now();

      dnsUpstreamDebug.refreshedAtMs = upstreamCache.loadedAt;
      dnsUpstreamDebug.refreshedAt = new Date(upstreamCache.loadedAt).toISOString();
      dnsUpstreamDebug.configured = configured;
      dnsUpstreamDebug.effective = upstreamCache.upstream;
    } catch {
      // keep last good caches
    }
  }

  await refreshCaches();
  await refreshProtectionPause();
  const refreshTimer = setInterval(refreshCaches, DNS_CACHE_REFRESH_INTERVAL_MS);
  const pauseTimer = setInterval(refreshProtectionPause, 1000);

  const resolveDnsBindHosts = (
    hostRaw: string
  ):
    | { mode: 'v4'; udpHosts: string[]; tcpHosts: string[] }
    | { mode: 'v6'; udpHosts: string[]; tcpHosts: string[] }
    | { mode: 'dual'; udpHosts: { v4: string; v6: string }; tcpHosts: { v4: string; v6: string } } => {
    const host = String(hostRaw ?? '').trim();

    // Explicit IPv6 bind.
    if (host && host.includes(':') && host !== '0.0.0.0') {
      return { mode: 'v6', udpHosts: [host], tcpHosts: [host] };
    }

    // Explicit IPv4 bind.
    if (host && host !== '0.0.0.0') {
      return { mode: 'v4', udpHosts: [host], tcpHosts: [host] };
    }

    // Default: bind both stacks. (Important for Tailscale clients that use IPv6 tailnet IPs.)
    return { mode: 'dual', udpHosts: { v4: '0.0.0.0', v6: '::' }, tcpHosts: { v4: '0.0.0.0', v6: '::' } };
  };

  const bindCfg = resolveDnsBindHosts(config.DNS_HOST);

  const udpSockets: dgram.Socket[] = [];
  if (bindCfg.mode === 'dual') {
    udpSockets.push(dgram.createSocket('udp4'));
    udpSockets.push(dgram.createSocket({ type: 'udp6', ipv6Only: true }));
  } else if (bindCfg.mode === 'v6') {
    udpSockets.push(dgram.createSocket({ type: 'udp6', ipv6Only: true }));
  } else {
    udpSockets.push(dgram.createSocket('udp4'));
  }

  async function handleQuery(msg: Buffer, clientIp: string): Promise<Buffer> {
    const start = Date.now();
    let query: any;
    try {
      query = dnsPacket.decode(msg);
      const q = query.questions?.[0];
      const name = q?.name ? String(q.name) : '';
      const qtype = q?.type ? String(q.type) : 'A';

      const forwardUpstream = async (upstream: UpstreamCache['upstream']): Promise<Buffer> => {
        const getTimeoutMs = (): number => {
          const defaults = {
            udp: 2000,
            tcp: 4000,
            dot: 4000,
            doh: 15000
          } as const;

          const raw =
            upstream.transport === 'udp'
              ? (config as any).DNS_FORWARD_UDP_TIMEOUT_MS
              : upstream.transport === 'tcp'
                ? (config as any).DNS_FORWARD_TCP_TIMEOUT_MS
                : upstream.transport === 'dot'
                  ? (config as any).DNS_FORWARD_DOT_TIMEOUT_MS
                  : (config as any).DNS_FORWARD_DOH_TIMEOUT_MS;

          const fallback = defaults[upstream.transport];
          const n = Number(raw);
          if (!Number.isFinite(n)) return fallback;
          return Math.max(250, Math.floor(n));
        };

        const timeoutMs = getTimeoutMs();

        const preferIpv4 = Boolean((config as any).DNS_FORWARD_DOH_PREFER_IPV4);

        const lookup =
          bootstrapServers.length > 0
            ? getBootstrapLookupCached({ bootstrapServers, preferIpv4: Boolean((config as any).DNS_FORWARD_DOH_PREFER_IPV4) })
            : null;

        return upstream.transport === 'tcp'
          ? await forwardTcp({ host: upstream.host, port: upstream.port }, msg, timeoutMs)
          : upstream.transport === 'dot'
            ? await forwardDot({ host: upstream.host, port: upstream.port }, msg, timeoutMs, lookup)
            : upstream.transport === 'doh'
              ? await forwardDoh(upstream.dohUrl, msg, timeoutMs, preferIpv4, bootstrapServers)
              : await forwardUdp({ host: upstream.host, port: upstream.port }, msg, timeoutMs);
      };

      const forwardActiveUpstreamWithTelemetry = async (): Promise<Buffer> => {
        const upstream = upstreamCache.upstream;
        try {
          const resp = await forwardUpstream(upstream);
          const now = Date.now();
          dnsUpstreamDebug.lastForwardOkAtMs = now;
          dnsUpstreamDebug.lastForwardOkAt = new Date(now).toISOString();
          dnsUpstreamDebug.lastForwardError = null;
          return resp;
        } catch (e: any) {
          const now = Date.now();
          const err = e instanceof Error ? e : new Error(typeof e === 'string' ? e : 'UPSTREAM_ERROR');
          const code = typeof e?.code === 'string' ? String(e.code) : undefined;
          const target =
            upstream.transport === 'doh' ? upstream.dohUrl : `${upstream.host}:${String(upstream.port ?? '')}`;
          dnsUpstreamDebug.lastForwardError = {
            at: new Date(now).toISOString(),
            atMs: now,
            transport: upstream.transport,
            target,
            name: err.name || undefined,
            code,
            message: err.message || String(err)
          };
          throw e;
        }
      };

      const forwardActiveUpstreamNoTelemetry = async (): Promise<Buffer> => {
        return await forwardUpstream(upstreamCache.upstream);
      };

      // Local rewrites (exact + wildcard) handled before block/allow evaluation.
      const normalizedName = normalizeName(name);
      let rewrite = rewritesCache.byDomain.get(normalizedName);

      if (!rewrite && rewritesCache.wildcards.length) {
        for (const candidate of rewritesCache.wildcards) {
          if (normalizedName !== candidate.domain && normalizedName.endsWith(`.${candidate.domain}`)) {
            rewrite = candidate;
            break;
          }
        }
      }

      if (rewrite) {
        const localResp = buildLocalAnswerResponse(query, name, qtype, rewrite.target);
        if (localResp) {
          const exactClient = findExactClient(clientsCache.clients, clientIp);
          const subnetClient = findBestCidrClient(clientsCache.clients, clientIp);
          const effectiveClient = exactClient ?? subnetClient;
          const clientName = effectiveClient?.name ?? 'Unknown';
          const answerIps = extractAnswerIpsFromDnsResponse(localResp);
          await insertQueryLog(db, {
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            domain: name,
            client: clientName,
            clientIp,
            status: 'PERMITTED',
            type: qtype,
            durationMs: Date.now() - start,
            answerIps
          });
          return localResp;
        }
      }

      const exactClient = findExactClient(clientsCache.clients, clientIp);
      const subnetClient = findBestCidrClient(clientsCache.clients, clientIp);
      const client = exactClient ?? subnetClient;
      const clientName = client?.name ?? 'Unknown';

      // Client kill-switch: blocks *all* DNS for this client/subnet.
      if (exactClient?.isInternetPaused || subnetClient?.isInternetPaused) {
        const resp = buildNxDomainResponse(query);
        await insertQueryLog(db, {
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          domain: name,
          client: clientName,
          clientIp,
          status: 'BLOCKED',
          type: qtype,
          durationMs: Date.now() - start,
          blocklistId: exactClient?.isInternetPaused ? 'ClientPolicy:InternetPaused' : 'SubnetPolicy:InternetPaused'
        });
        return resp;
      }

      // Global protection pause: bypass all filtering and allow queries through.
      // (Rewrites are still handled above; internet-paused remains a hard kill-switch.)
      if (isProtectionPaused(protectionPause)) {
        const upstreamResp = await forwardActiveUpstreamWithTelemetry();

        const answerIps = extractAnswerIpsFromDnsResponse(upstreamResp);
        await insertQueryLog(db, {
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          domain: name,
          client: clientName,
          clientIp,
          status: 'PERMITTED',
          type: qtype,
          durationMs: Date.now() - start,
          answerIps,
          protectionPaused: true
        });

        return upstreamResp;
      }

      // Manual allow/block rules with precedence: Client > Subnet > Global.
      // (These are applied after protection pause, but before app/blocklist evaluation.)
      const candidates = buildCandidateDomains(name);
      const idx = rulesCache.index;

      const clientManual = exactClient
        ? decideManualRule(
            candidates,
            idx.manualAllowedByClientId.get(exactClient.id),
            idx.manualBlockedByClientId.get(exactClient.id)
          )
        : 'NONE';

      if (clientManual === 'BLOCKED') {
        const resp = buildNxDomainResponse(query);
        await insertQueryLog(db, {
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          domain: name,
          client: clientName,
          clientIp,
          status: 'BLOCKED',
          type: qtype,
          durationMs: Date.now() - start,
          blocklistId: `ClientRule:${exactClient?.id ?? ''}`
        });
        return resp;
      }

      if (clientManual === 'ALLOWED') {
        const upstreamResp = await forwardActiveUpstreamWithTelemetry();

        await insertQueryLog(db, {
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          domain: name,
          client: clientName,
          clientIp,
          status: 'PERMITTED',
          type: qtype,
          durationMs: Date.now() - start,
          answerIps: extractAnswerIpsFromDnsResponse(upstreamResp)
        });
        return upstreamResp;
      }

      const subnetManual = subnetClient
        ? decideManualRule(
            candidates,
            idx.manualAllowedBySubnetId.get(subnetClient.id),
            idx.manualBlockedBySubnetId.get(subnetClient.id)
          )
        : 'NONE';

      if (subnetManual === 'BLOCKED') {
        const resp = buildNxDomainResponse(query);
        await insertQueryLog(db, {
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          domain: name,
          client: clientName,
          clientIp,
          status: 'BLOCKED',
          type: qtype,
          durationMs: Date.now() - start,
          blocklistId: `SubnetRule:${subnetClient?.id ?? ''}`
        });
        return resp;
      }

      if (subnetManual === 'ALLOWED') {
        const upstreamResp = await forwardActiveUpstreamWithTelemetry();

        await insertQueryLog(db, {
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          domain: name,
          client: clientName,
          clientIp,
          status: 'PERMITTED',
          type: qtype,
          durationMs: Date.now() - start,
          answerIps: extractAnswerIpsFromDnsResponse(upstreamResp)
        });
        return upstreamResp;
      }

      const globalManual = decideManualRule(candidates, idx.globalManualAllowed, idx.globalManualBlocked);

      if (globalManual === 'BLOCKED') {
        const resp = buildNxDomainResponse(query);
        await insertQueryLog(db, {
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          domain: name,
          client: clientName,
          clientIp,
          status: 'BLOCKED',
          type: qtype,
          durationMs: Date.now() - start,
          blocklistId: 'Manual'
        });
        return resp;
      }

      if (globalManual === 'ALLOWED') {
        const upstreamResp = await forwardActiveUpstreamWithTelemetry();

        await insertQueryLog(db, {
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          domain: name,
          client: clientName,
          clientIp,
          status: 'PERMITTED',
          type: qtype,
          durationMs: Date.now() - start,
          answerIps: extractAnswerIpsFromDnsResponse(upstreamResp)
        });
        return upstreamResp;
      }

      // Compute effective policy (base + schedules).
      const now = new Date();
      const policyPrefix = (scope: 'client' | 'subnet' | 'global'): string =>
        scope === 'client' ? 'ClientPolicy' : scope === 'subnet' ? 'SubnetPolicy' : 'GlobalPolicy';

      const effectiveBlockedCategories = new Set<ContentCategory>();
      const shouldUseGlobalCategories = exactClient?.useGlobalCategories === false ? false : subnetClient?.useGlobalCategories === false ? false : true;
      const shouldUseGlobalApps = exactClient?.useGlobalApps === false ? false : subnetClient?.useGlobalApps === false ? false : true;

      if (!shouldUseGlobalCategories) {
        const base = exactClient?.useGlobalCategories === false ? exactClient : subnetClient;
        for (const c of base?.blockedCategories ?? []) effectiveBlockedCategories.add(c);
      }

      const effectiveActiveApps = new Set<AppService>(shouldUseGlobalApps ? globalAppsCache.activeApps : []);
      const effectiveShadowApps = new Set<AppService>(shouldUseGlobalApps ? globalAppsCache.shadowApps : []);

      if (!shouldUseGlobalApps) {
        const base = exactClient?.useGlobalApps === false ? exactClient : subnetClient;
        for (const a of base?.blockedApps ?? []) effectiveActiveApps.add(a);
      }

      // Ensure active always wins if both are present.
      for (const a of effectiveActiveApps) effectiveShadowApps.delete(a);
      let blockAll = false;

      const activeSubnetSchedules = (subnetClient?.schedules ?? []).filter((s) => isScheduleActiveNow(s, now));
      const activeClientSchedules = (exactClient?.schedules ?? []).filter((s) => isScheduleActiveNow(s, now));

      for (const s of [...activeSubnetSchedules, ...activeClientSchedules]) {
        if (s.blockAll) blockAll = true;
        for (const c of s.blockedCategories ?? []) effectiveBlockedCategories.add(c);
        for (const a of s.blockedApps ?? []) effectiveActiveApps.add(a);
      }

      for (const a of effectiveActiveApps) effectiveShadowApps.delete(a);

      if (blockAll) {
        const blockAllScope: 'client' | 'subnet' = activeClientSchedules.some((s) => s.blockAll) ? 'client' : 'subnet';
        const resp = buildNxDomainResponse(query);
        await insertQueryLog(db, {
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          domain: name,
          client: clientName,
          clientIp,
          status: 'BLOCKED',
          type: qtype,
          durationMs: Date.now() - start,
          blocklistId: `${policyPrefix(blockAllScope)}:BlockAll`
        });
        return resp;
      }

      const clientScheduleApps = activeClientSchedules.flatMap((s) => s.blockedApps ?? []);
      const subnetScheduleApps = activeSubnetSchedules.flatMap((s) => s.blockedApps ?? []);
      const clientBaseApps = exactClient?.useGlobalApps === false ? (exactClient?.blockedApps ?? []) : [];
      const subnetBaseApps = subnetClient?.useGlobalApps === false ? (subnetClient?.blockedApps ?? []) : [];
      const globalBaseApps = shouldUseGlobalApps ? globalAppsCache.activeApps : [];
      const globalShadowApps = shouldUseGlobalApps ? globalAppsCache.shadowApps : [];

      const findBlockedAppWithScope = (): { app: AppService; scope: 'client' | 'subnet' | 'global' } | null => {
        const clientScheduleHit = isAppBlockedByPolicy(name, clientScheduleApps);
        if (clientScheduleHit) return { app: clientScheduleHit, scope: 'client' };

        const clientBaseHit = isAppBlockedByPolicy(name, clientBaseApps);
        if (clientBaseHit) return { app: clientBaseHit, scope: 'client' };

        const subnetScheduleHit = isAppBlockedByPolicy(name, subnetScheduleApps);
        if (subnetScheduleHit) return { app: subnetScheduleHit, scope: 'subnet' };

        const subnetBaseHit = isAppBlockedByPolicy(name, subnetBaseApps);
        if (subnetBaseHit) return { app: subnetBaseHit, scope: 'subnet' };

        const globalHit = isAppBlockedByPolicy(name, globalBaseApps);
        if (globalHit) return { app: globalHit, scope: 'global' };

        return null;
      };

      const blockedAppHit = findBlockedAppWithScope();
      if (blockedAppHit) {
        const resp = buildNxDomainResponse(query);
        await insertQueryLog(db, {
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          domain: name,
          client: clientName,
          clientIp,
          status: 'BLOCKED',
          type: qtype,
          durationMs: Date.now() - start,
          blocklistId: `${policyPrefix(blockedAppHit.scope)}:App:${blockedAppHit.app}`
        });
        return resp;
      }

      let appShadowHit: string | undefined;
      const shadowApp = isAppBlockedByPolicy(name, globalShadowApps);
      if (shadowApp) appShadowHit = `${policyPrefix('global')}:AppShadow:${shadowApp}`;

      // Determine which blocklists are active for this client.
      const selectedBlocklists = new Set<string>();

      const categoryIds = categoryBlocklistIdsCache.ids;
      const appIds = appBlocklistIdsCache.ids;

      const shouldUseGlobalBlocklists = exactClient?.useGlobalSettings === false ? false : subnetClient?.useGlobalSettings === false ? false : true;

      if (!shouldUseGlobalBlocklists) {
        const base = exactClient?.useGlobalSettings === false ? exactClient : subnetClient;
        for (const id of base?.assignedBlocklists ?? []) {
          // Per-client/subnet overrides should work even when globally disabled.
          const sid = String(id);
          // Category/App lists are managed separately.
          if (categoryIds.has(sid) || appIds.has(sid)) continue;
          selectedBlocklists.add(sid);
        }
      } else {
        for (const [id, st] of blocklistsCache.byId.entries()) {
          // Category/App lists are managed separately.
          if (categoryIds.has(id) || appIds.has(id)) continue;
          if (st.enabled) selectedBlocklists.add(id);
        }
      }

      // Global categories: include enabled category lists only when allowed for this client.
      if (shouldUseGlobalCategories) {
        for (const id of categoryIds) {
          const st = blocklistsCache.byId.get(id);
          if (st?.enabled) selectedBlocklists.add(id);
        }
      }

      for (const cat of effectiveBlockedCategories) {
        const ids = categoryBlocklistsCache.byCategory.get(cat) ?? [];
        for (const id of ids) {
          selectedBlocklists.add(String(id));
        }
      }

      // App-blocklists are evaluated independently from normal blocklists.
      if (effectiveActiveApps.size || effectiveShadowApps.size) {
        const appScopeByApp = new Map<AppService, 'client' | 'subnet' | 'global'>();
        for (const a of globalBaseApps) appScopeByApp.set(a, 'global');
        for (const a of globalShadowApps) appScopeByApp.set(a, 'global');
        for (const a of subnetBaseApps) appScopeByApp.set(a, 'subnet');
        for (const a of subnetScheduleApps) appScopeByApp.set(a, 'subnet');
        for (const a of clientBaseApps) appScopeByApp.set(a, 'client');
        for (const a of clientScheduleApps) appScopeByApp.set(a, 'client');

        const selectedActiveAppBlocklists = new Set<string>();
        const selectedShadowAppBlocklists = new Set<string>();
        const blocklistIdToApp = new Map<string, AppService>();

        for (const app of effectiveActiveApps) {
          const ids = appBlocklistsCache.byApp.get(app) ?? [];
          for (const id of ids) {
            const sid = String(id);
            selectedActiveAppBlocklists.add(sid);
            if (!blocklistIdToApp.has(sid)) blocklistIdToApp.set(sid, app);
          }
        }

        for (const app of effectiveShadowApps) {
          const ids = appBlocklistsCache.byApp.get(app) ?? [];
          for (const id of ids) {
            const sid = String(id);
            selectedShadowAppBlocklists.add(sid);
            if (!blocklistIdToApp.has(sid)) blocklistIdToApp.set(sid, app);
          }
        }

        if (selectedActiveAppBlocklists.size) {
          const appDecision = decideRuleIndexed(rulesCache.index, name, blocklistsCache.byId, selectedActiveAppBlocklists);
          if (appDecision.decision === 'BLOCKED') {
            const resp = buildNxDomainResponse(query);
            const id = appDecision.blocklistId ?? '';
            const app = id ? blocklistIdToApp.get(id) : undefined;
            const scope = app ? (appScopeByApp.get(app) ?? 'global') : 'global';
            await insertQueryLog(db, {
              id: crypto.randomUUID(),
              timestamp: new Date().toISOString(),
              domain: name,
              client: clientName,
              clientIp,
              status: 'BLOCKED',
              type: qtype,
              durationMs: Date.now() - start,
              blocklistId: app
                ? `${policyPrefix(scope)}:AppList:${app}`
                : id
                  ? formatBlocklistCategory(id, blocklistsCache.byId.get(id)?.name)
                  : undefined
            });
            return resp;
          }

          if (appDecision.decision === 'SHADOW_BLOCKED' && !appShadowHit) {
            const id = appDecision.blocklistId ?? '';
            const app = id ? blocklistIdToApp.get(id) : undefined;
            const scope = app ? (appScopeByApp.get(app) ?? 'global') : 'global';
            appShadowHit = app
              ? `${policyPrefix(scope)}:AppListShadow:${app}`
              : id
                ? formatBlocklistCategory(id, blocklistsCache.byId.get(id)?.name)
                : undefined;
          }
        }

        if (selectedShadowAppBlocklists.size) {
          const shadowDecision = decideRuleIndexed(rulesCache.index, name, blocklistsCache.byId, selectedShadowAppBlocklists);
          if ((shadowDecision.decision === 'BLOCKED' || shadowDecision.decision === 'SHADOW_BLOCKED') && !appShadowHit) {
            const id = shadowDecision.blocklistId ?? '';
            const app = id ? blocklistIdToApp.get(id) : undefined;
            const scope = app ? (appScopeByApp.get(app) ?? 'global') : 'global';
            appShadowHit = app
              ? `${policyPrefix(scope)}:AppListShadow:${app}`
              : id
                ? formatBlocklistCategory(id, blocklistsCache.byId.get(id)?.name)
                : undefined;
          }
        }
      }

      const { decision, blocklistId } = decideRuleIndexed(rulesCache.index, name, blocklistsCache.byId, selectedBlocklists);

      if (decision === 'BLOCKED') {
        const resp = buildNxDomainResponse(query);

        let answerIps: string[] | undefined;
        if (config.SHADOW_RESOLVE_BLOCKED) {
          try {
            const upstreamResp = await forwardActiveUpstreamNoTelemetry();
            answerIps = extractAnswerIpsFromDnsResponse(upstreamResp);
          } catch {
            // ignore: blocked response should still be fast/reliable
          }
        }

        await insertQueryLog(db, {
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          domain: name,
          client: clientName,
          clientIp,
          status: 'BLOCKED',
          type: qtype,
          durationMs: Date.now() - start,
          blocklistId: blocklistId ? formatBlocklistCategory(blocklistId, blocklistsCache.byId.get(blocklistId)?.name) : undefined,
          answerIps
        });
        return resp;
      }

      const upstreamResp = await forwardActiveUpstreamWithTelemetry();

      const finalStatus: 'SHADOW_BLOCKED' | 'PERMITTED' =
        decision === 'SHADOW_BLOCKED' || !!appShadowHit ? 'SHADOW_BLOCKED' : 'PERMITTED';
      const finalBlocklistId =
        finalStatus === 'SHADOW_BLOCKED'
          ? appShadowHit ??
            (decision === 'SHADOW_BLOCKED' && blocklistId
              ? formatBlocklistCategory(blocklistId, blocklistsCache.byId.get(blocklistId)?.name)
              : undefined)
          : undefined;

      await insertQueryLog(db, {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        domain: name,
        client: clientName,
        clientIp,
        status: finalStatus,
        type: qtype,
        durationMs: Date.now() - start,
        blocklistId: finalBlocklistId,
        answerIps: extractAnswerIpsFromDnsResponse(upstreamResp)
      });
      return upstreamResp;
    } catch {
      if (query) return buildServFailResponse(query);
      // Best effort: create SERVFAIL without ID/flags is not possible
      throw new Error('DECODE_FAILED');
    }
  }

  for (const udp of udpSockets) {
    udp.on('message', async (msg, rinfo) => {
      try {
        const clientIp = normalizeClientIp(rinfo.address);
        recordDnsQuerySeen(clientIp, 'udp');
        const msgBuf = Buffer.isBuffer(msg) ? msg : Buffer.from(msg);
        const resp = await handleQuery(msgBuf, clientIp);
        udp.send(resp, rinfo.port, rinfo.address);
      } catch {
        // ignore
      }
    });
  }

  const createTcpServer = (): net.Server =>
    net.createServer((socket) => {
      socket.setTimeout(5000);
      socket.setNoDelay(true);

      let buf = Buffer.alloc(0);

      socket.on('data', async (data) => {
        const dataBuf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        buf = Buffer.concat([buf, dataBuf]);
        while (buf.length >= 2) {
          const len = buf.readUInt16BE(0);
          if (buf.length < 2 + len) return;
          const msg = buf.subarray(2, 2 + len);
          buf = buf.subarray(2 + len);

          try {
            const ipRaw = socket.remoteAddress ?? '0.0.0.0';
            const ip = normalizeClientIp(ipRaw);
            recordDnsQuerySeen(ip, 'tcp');
            const resp = await handleQuery(msg, ip);
            const outLen = Buffer.alloc(2);
            outLen.writeUInt16BE(resp.length, 0);
            socket.write(Buffer.concat([outLen, resp]));
          } catch {
            // ignore
          }
        }
      });

      socket.on('timeout', () => {
        try {
          socket.end();
        } catch {
          // ignore
        }
      });
    });

  const tcpServers: net.Server[] = [];
  if (bindCfg.mode === 'dual') {
    tcpServers.push(createTcpServer());
    tcpServers.push(createTcpServer());
  } else {
    tcpServers.push(createTcpServer());
  }

  const bindUdp = (udp: dgram.Socket, host: string): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      udp.once('error', reject);
      udp.bind(config.DNS_PORT, host, () => {
        udp.off('error', reject);
        resolve();
      });
    });

  const listenTcp = (tcp: net.Server, host: string, opts?: { ipv6Only?: boolean }): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      tcp.once('error', reject);
      tcp.listen({ port: config.DNS_PORT, host, ipv6Only: opts?.ipv6Only }, () => {
        tcp.off('error', reject);
        resolve();
      });
    });

  if (bindCfg.mode === 'dual') {
    // UDP
    await bindUdp(udpSockets[0], bindCfg.udpHosts.v4);
    await bindUdp(udpSockets[1], bindCfg.udpHosts.v6);

    // TCP (separate v4/v6 servers to avoid dual-stack quirks)
    await listenTcp(tcpServers[0], bindCfg.tcpHosts.v4);
    await listenTcp(tcpServers[1], bindCfg.tcpHosts.v6, { ipv6Only: true });
  } else {
    const host = bindCfg.udpHosts[0] ?? config.DNS_HOST;
    await bindUdp(udpSockets[0], host);

    const tcpHost = bindCfg.tcpHosts[0] ?? config.DNS_HOST;
    await listenTcp(tcpServers[0], tcpHost, { ipv6Only: bindCfg.mode === 'v6' ? true : undefined });
  }

  async function close(): Promise<void> {
    clearInterval(refreshTimer);
    clearInterval(pauseTimer);

    for (const udp of udpSockets) {
      await new Promise<void>((resolve) => {
        try {
          udp.close(() => resolve());
        } catch {
          resolve();
        }
      });
    }

    for (const tcp of tcpServers) {
      await new Promise<void>((resolve) => {
        try {
          tcp.close(() => resolve());
        } catch {
          resolve();
        }
      });
    }
  }

  return { close };
}

export const __testing = {
  normalizeScheduleMode,
  parseProtectionPauseSetting,
  isProtectionPaused,
  parseGlobalBlockedAppsSetting,
  parseGlobalShadowAppsSetting,
  parseHostPort,
  normalizeName,
  matchesDomain,
  extractBlocklistId,
  formatBlocklistCategory,
  buildCandidateDomains,
  decideRuleIndexed,
  parseTimeToMinutes,
  isScheduleActiveNow,
  isAppBlockedByPolicy,
  findClient,
  loadRewritesFromSettings,
  buildLocalAnswerResponse,
  extractAnswerIpsFromDnsResponse,
  buildNxDomainResponse,
  buildServFailResponse
};
