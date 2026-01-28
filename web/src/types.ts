import React from 'react';

export enum QueryStatus {
  PERMITTED = 'PERMITTED',
  BLOCKED = 'BLOCKED',
  SHADOW_BLOCKED = 'SHADOW_BLOCKED', // New: Would have blocked, but allowed for testing
  CACHED = 'CACHED'
}

export interface DnsQuery {
  id: string;
  timestamp: string;
  domain: string;
  client: string;
  clientIp: string;
  status: QueryStatus;
  type: string; // A, AAAA, HTTPS, etc.
  durationMs: number;
  blocklistId?: string; // ID of the blocklist that triggered the block
}

export interface StatCardProps {
  title: string;
  value: string | number;
  change?: string;
  icon: React.ElementType;
  trend?: 'up' | 'down' | 'neutral';
  color?: string;
}

export interface ChartDataPoint {
  time: string;
  queries: number;
  ads: number;
}

export type BlocklistMode = 'ACTIVE' | 'SHADOW' | 'DISABLED';

export interface Blocklist {
  id: string;
  name: string;
  url: string;
  ruleCount: number;
  mode: BlocklistMode; // Changed from boolean enabled to enum
  lastUpdated: string;
  lastUpdatedAt?: string | null; // raw ISO timestamp (server last_updated_at)
  description?: string;
}

export interface DnsRewrite {
  id: string;
  domain: string;
  target: string;
}

export type ContentCategory = 'adult' | 'gambling' | 'social' | 'piracy' | 'crypto' | 'shopping' | 'news' | 'game' | 'video';
export type AppService =
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

export type ScheduleModeType = 'sleep' | 'homework' | 'total_block' | 'custom';

export interface Schedule {
    id: string;
    name: string;
    days: ('Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun')[];
    startTime: string; // "21:00"
    endTime: string;   // "07:00"
    active: boolean;
  mode: ScheduleModeType;
    
    // Specific rules (used if mode is 'custom', otherwise inherited from mode preset)
    blockedCategories: ContentCategory[];
    blockedApps: AppService[];
    blockAll?: boolean;
}

export interface ClientProfile {
  id: string;
  name: string;
  
  // Distinguish between single device and subnet
  isSubnet?: boolean;
  cidr?: string; // e.g. "192.168.20.0/24"
  ip?: string;   // e.g. "192.168.1.50" (Only for devices)
  mac?: string;  // Only for devices

  type: 'laptop' | 'smartphone' | 'tv' | 'game' | 'iot' | 'tablet' | 'subnet';
  status: 'online' | 'offline';
  policy: string; 
  safeSearch: boolean;
  assignedBlocklists: string[]; // IDs of blocklists
  useGlobalSettings: boolean;

  // If false, global categories/apps will NOT be applied to this client.
  // Client-specific categories/apps (and schedules) still apply.
  useGlobalCategories?: boolean;
  useGlobalApps?: boolean;
  
  // Total Internet Kill Switch
  isInternetPaused: boolean;

  // Base Filter Fields (Default)
  blockedCategories: ContentCategory[];
  blockedApps: AppService[];
  schedules: Schedule[];
}

export interface DhcpLease {
    ip: string;
    mac: string;
    hostname: string;
    expiresIn: string; // e.g. "23h 12m"
    type: 'laptop' | 'smartphone' | 'tv' | 'game' | 'iot' | 'tablet'; // inferred type
}

export interface Anomaly {
    id: number;
    device: string;
  clientIp?: string;
    issue: string;
    detail: string;
  /** Optional primary domain involved (if applicable). */
  domain?: string;
  /** Short, user-facing reasons for why this was flagged. */
  reasons?: string[];
  /** Optional list of related domains (e.g. top blocked domains for this device). */
  relatedDomains?: Array<{ domain: string; count: number }>;
  /** 0..1 heuristic confidence (not severity). */
  confidence?: number;
    risk: 'critical' | 'high' | 'medium' | 'low';
    timestamp: string;
}