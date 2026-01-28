import React, { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Plus, Trash2, List, Globe, Hash, Shield, Search, Sparkles, AlertTriangle, CheckCircle, X, XCircle, ArrowRight, Play, BarChart3, FlaskConical, Eye, Database, Layers, Stethoscope, Smartphone, Server } from 'lucide-react';
import { analyzeDomain } from '../services/geminiService';
import { useRules } from '../contexts/RulesContext';
import { BlocklistMode, QueryStatus, Blocklist, AppService } from '../types';
import Modal from '../components/Modal';
import { getAuthHeaders } from '../services/apiClient';
import { AppLogo } from '../components/AppLogo';
import { ReadOnlyFollowerBanner } from '../components/ReadOnlyFollowerBanner';
import { isReadOnlyFollower, useClusterStatus } from '../hooks/useClusterStatus';

const Blocking: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'gravity' | 'categories' | 'apps' | 'domains' | 'audit' | 'regex'>('gravity');

    const { status: clusterStatus } = useClusterStatus();
    const readOnlyFollower = isReadOnlyFollower(clusterStatus);
  
  // Gravity List State Management
    const [blocklists, setBlocklists] = useState<Blocklist[]>([]);
    const [isSyncing, setIsSyncing] = useState(false);
    const [blocklistsError, setBlocklistsError] = useState<string | null>(null);
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [newListName, setNewListName] = useState('');
    const [newListUrl, setNewListUrl] = useState('');

  // Domain Management State
  const [domainInput, setDomainInput] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<{category: string, purpose: string, impact: string} | null>(null);
  
  // Audit/Tester State
  const [auditDomain, setAuditDomain] = useState('');
  const [isAuditing, setIsAuditing] = useState(false);
  const [auditResult, setAuditResult] = useState<{
      total: number, 
      affectedClients: string[], 
      frequency: string,
      gravityMatches: Blocklist[]
  } | null>(null);

  const APPS: Array<{ id: AppService; label: string }> = [
      { id: 'tiktok', label: 'TikTok' },
      { id: 'tinder', label: 'Tinder' },
      { id: 'instagram', label: 'Instagram' },
      { id: 'snapchat', label: 'Snapchat' },
      { id: 'facebook', label: 'Facebook' },
      { id: 'twitter', label: 'Twitter/X' },
      { id: 'roblox', label: 'Roblox' },
      { id: 'vk', label: 'VK' },
      { id: 'reddit', label: 'Reddit' },
      { id: 'youtube', label: 'YouTube' },
      { id: 'tumblr', label: 'Tumblr' },
      { id: '9gag', label: '9GAG' },
      { id: 'twitch', label: 'Twitch' },
      { id: 'telegram', label: 'Telegram' },
      { id: 'fortnite', label: 'Fortnite' },
      { id: 'leagueoflegends', label: 'League of Legends' },
      { id: 'messenger', label: 'Messenger' },
      { id: 'discord', label: 'Discord' },
      { id: 'dailymotion', label: 'Dailymotion' },
      { id: 'bereal', label: 'BeReal' },
      { id: 'pinterest', label: 'Pinterest' },
      { id: 'minecraft', label: 'Minecraft' },
      { id: 'blizzard', label: 'Blizzard/Battle.net' },
      { id: 'imgur', label: 'Imgur' },
      { id: 'hulu', label: 'Hulu' },
      { id: 'xboxlive', label: 'Xbox Live' },
      { id: 'vimeo', label: 'Vimeo' },
      { id: 'steam', label: 'Steam' },
      { id: 'netflix', label: 'Netflix' },
      { id: 'skype', label: 'Skype' },
      { id: 'mastodon', label: 'Mastodon' },
      { id: 'playstation-network', label: 'PlayStation Network' },
      { id: 'disneyplus', label: 'Disney+' },
      { id: 'whatsapp', label: 'WhatsApp' },
      { id: 'primevideo', label: 'Prime Video' },
      { id: 'hbomax', label: 'HBO Max / Max' },
      { id: 'ebay', label: 'eBay' },
      { id: 'signal', label: 'Signal' },
      { id: 'google-chat', label: 'Google Chat' },
      { id: 'spotify', label: 'Spotify' },
      { id: 'zoom', label: 'Zoom' },
      { id: 'amazon', label: 'Amazon' },
      { id: 'chatgpt', label: 'ChatGPT' }
  ];

    const APPS_SORTED = useMemo(
            () => [...APPS].sort((a, b) => a.label.localeCompare(b.label, 'de', { sensitivity: 'base' })),
            []
    );

  const APP_LIST_URLS: Partial<Record<AppService, string[]>> = {
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

    const [globalBlockedApps, setGlobalBlockedApps] = useState<AppService[]>([]);
    const [globalShadowApps, setGlobalShadowApps] = useState<AppService[]>([]);
  const [appsMsg, setAppsMsg] = useState<string>('');
    const [globalBlocklistsMsg, setGlobalBlocklistsMsg] = useState<string>('');
    const [globalCategoriesMsg, setGlobalCategoriesMsg] = useState<string>('');
    const [appsMsgFading, setAppsMsgFading] = useState(false);
    const [globalBlocklistsMsgFading, setGlobalBlocklistsMsgFading] = useState(false);
    const [globalCategoriesMsgFading, setGlobalCategoriesMsgFading] = useState(false);
  const [appsBusy, setAppsBusy] = useState(false);


  const CATEGORY_DEFINITIONS = [
      { id: 'adult', name: 'Adult Content', source: 'StevenBlack/hosts/porn', rules: 45000 },
      { id: 'gambling', name: 'Gambling', source: 'StevenBlack/hosts/gambling', rules: 12400 },
      { id: 'social', name: 'Social Media', source: 'StevenBlack/hosts/social', rules: 8200 },
  ];

  // Use Global Rules Context
  const { rules, addRule, removeRule } = useRules();

    const stripTrailingParenSuffix = (value: string) => String(value || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
    const stripLeadingPrefix = (value: string, prefix: string) => {
            const v = String(value || '').trim();
            const p = String(prefix || '').trim();
            if (!p) return v;
            return v.toLowerCase().startsWith(p.toLowerCase()) ? v.slice(p.length).trimStart() : v;
    };
    const displayCategoryName = (value: string) => stripTrailingParenSuffix(stripLeadingPrefix(value, 'Category:'));

    const isCategoryBlocklist = (b: Blocklist) => String(b?.name ?? '').trim().toLowerCase().startsWith('category:');
    const isAppBlocklist = (b: Blocklist) => String(b?.name ?? '').trim().toLowerCase().startsWith('app:');

    const blocklistsOnly = useMemo(
        () => blocklists.filter((b) => !isCategoryBlocklist(b) && !isAppBlocklist(b)),
        [blocklists]
    );

    const categoryLists = useMemo(
        () => blocklists.filter((b) => isCategoryBlocklist(b)),
        [blocklists]
    );

    const categoryGroups = useMemo(() => {
        const map = new Map<string, Blocklist[]>();
        for (const list of categoryLists) {
            const key = displayCategoryName(list.name);
            const cur = map.get(key) ?? [];
            cur.push(list);
            map.set(key, cur);
        }
        return Array.from(map.entries())
            .map(([name, lists]) => ({ name, lists }))
            .sort((a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }));
    }, [categoryLists]);

    const appLists = useMemo(
        () => blocklists.filter((b) => isAppBlocklist(b)),
        [blocklists]
    );

    const totalRulesFor = (lists: Blocklist[]) =>
        lists.reduce((sum, b) => sum + (Number.isFinite(b.ruleCount) ? b.ruleCount : 0), 0);

    const totalBlocklistRules = useMemo(() => totalRulesFor(blocklistsOnly), [blocklistsOnly]);
    const totalCategoryRules = useMemo(() => totalRulesFor(categoryLists), [categoryLists]);
    const totalAppListRules = useMemo(() => totalRulesFor(appLists), [appLists]);

    const canUpdateLists = useMemo(() => {
        const hasEnabledGlobalLists = blocklistsOnly.some((b) => b.mode !== 'DISABLED');
        const hasEnabledCategories = categoryLists.some((b) => b.mode !== 'DISABLED');
        const hasSelectedApps = (globalBlockedApps.length + globalShadowApps.length) > 0;
        return hasEnabledGlobalLists || hasEnabledCategories || hasSelectedApps;
    }, [blocklistsOnly, categoryLists, globalBlockedApps, globalShadowApps]);

    const groupModeFor = (lists: Blocklist[]): BlocklistMode => {
        const modes = new Set(lists.map((l) => l.mode));
        if (modes.size === 1) return lists[0].mode;
        if (modes.has('ACTIVE')) return 'ACTIVE';
        if (modes.has('SHADOW')) return 'SHADOW';
        return 'DISABLED';
    };

    const handleCategoryGroupModeChange = (ids: string[], mode: BlocklistMode) => {
        setBlocklists((prev) => prev.map((list) => (ids.includes(list.id) ? { ...list, mode } : list)));

        void (async () => {
            try {
                await Promise.all(ids.map((id) => updateBlocklistMode(id, mode)));
                setGlobalCategoriesMsg('Saved');
            } catch (e: any) {
                setBlocklistsError(String(e?.message || 'Failed to update blocklist.'));
                setGlobalCategoriesMsg(String(e?.message || 'Failed to save.'));
                loadBlocklists();
            }
        })();
    };

    const updateListsTitle = useMemo(() => {
        return !canUpdateLists
            ? 'Nothing to update (all lists and apps are OFF).'
            : 'Downloads/refreshes the contents of enabled lists (rules), including selected App lists, so upstream changes take effect.';
    }, [canUpdateLists]);

    useEffect(() => {
        if (!appsMsg) return;
        setAppsMsgFading(false);
        const tFade = window.setTimeout(() => setAppsMsgFading(true), 4500);
        const tClear = window.setTimeout(() => {
            setAppsMsg('');
            setAppsMsgFading(false);
        }, 5000);
        return () => {
            window.clearTimeout(tFade);
            window.clearTimeout(tClear);
        };
    }, [appsMsg]);

    useEffect(() => {
        if (!globalBlocklistsMsg) return;
        setGlobalBlocklistsMsgFading(false);
        const tFade = window.setTimeout(() => setGlobalBlocklistsMsgFading(true), 4500);
        const tClear = window.setTimeout(() => {
            setGlobalBlocklistsMsg('');
            setGlobalBlocklistsMsgFading(false);
        }, 5000);
        return () => {
            window.clearTimeout(tFade);
            window.clearTimeout(tClear);
        };
    }, [globalBlocklistsMsg]);

    useEffect(() => {
        if (!globalCategoriesMsg) return;
        setGlobalCategoriesMsgFading(false);
        const tFade = window.setTimeout(() => setGlobalCategoriesMsgFading(true), 4500);
        const tClear = window.setTimeout(() => {
            setGlobalCategoriesMsg('');
            setGlobalCategoriesMsgFading(false);
        }, 5000);
        return () => {
            window.clearTimeout(tFade);
            window.clearTimeout(tClear);
        };
    }, [globalCategoriesMsg]);

    const normalizeName = (name: string): string => {
        const n = String(name || '').trim().toLowerCase();
        return n.endsWith('.') ? n.slice(0, -1) : n;
    };

    const matchesDomain = (ruleDomain: string, queryName: string): boolean => {
        const r = normalizeName(ruleDomain);
        const q = normalizeName(queryName);
        return q === r || q.endsWith(`.${r}`);
    };

    const canonicalizeDomainInput = (value: string): string => {
        let v = String(value || '').trim();
        if (!v) return '';

        // If the user pasted a URL, extract the hostname.
        if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) {
            try {
                v = new URL(v).hostname;
            } catch {
                // ignore
            }
        }

        // Strip path/query fragments if present.
        v = v.split('/')[0].trim();

        // Strip a single trailing dot and normalize case.
        v = normalizeName(v);

        // Convert "*.example.com" into "example.com" for suffix matching.
        v = v.replace(/^\*\./, '');

        // Strip "host:port" (only when it's clearly a port).
        const hostPort = /^([^\s:]+):(\d{1,5})$/.exec(v);
        if (hostPort) v = hostPort[1];

        return v;
    };

    const mapServerBlocklist = (row: any): Blocklist => {
        const id = String(row?.id ?? '');
        const enabled = row?.enabled !== false;
        const serverMode: BlocklistMode = row?.mode === 'SHADOW' ? 'SHADOW' : 'ACTIVE';
        const lastUpdatedRaw = typeof row?.last_updated_at === 'string' ? row.last_updated_at : null;
        return {
            id,
            name: String(row?.name ?? `List ${id}`),
            url: String(row?.url ?? ''),
            ruleCount: typeof row?.last_rule_count === 'number' ? row.last_rule_count : 0,
            mode: enabled ? serverMode : 'DISABLED',
            lastUpdated: lastUpdatedRaw ? new Date(lastUpdatedRaw).toLocaleString() : '—',
            lastUpdatedAt: lastUpdatedRaw
        };
    };

    const loadBlocklists = () => {
        setBlocklistsError(null);
        fetch('/api/blocklists')
            .then(async (r) => {
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                return r.json();
            })
            .then((data) => {
                const items = Array.isArray(data?.items) ? data.items : [];
                setBlocklists(items.map(mapServerBlocklist).filter((b: Blocklist) => b.id));
            })
            .catch(() => {
                setBlocklists([]);
                setBlocklistsError('Could not load blocklists.');
            });
    };

    useEffect(() => {
        loadBlocklists();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch('/api/settings', { headers: { ...getAuthHeaders() }, credentials: 'include' });
                const data = await res.json().catch(() => null);
                const items = Array.isArray((data as any)?.items) ? (data as any).items : [];
                const item = items.find((i: any) => i?.key === 'global_blocked_apps');
                const raw = item?.value;
                const blocked = Array.isArray(raw?.blockedApps) ? raw.blockedApps : Array.isArray(raw) ? raw : [];
                const shadow = Array.isArray(raw?.shadowApps) ? raw.shadowApps : [];

                const nextBlocked = blocked.map((x: any) => String(x)).filter(Boolean);
                const nextShadow = shadow.map((x: any) => String(x)).filter(Boolean);

                if (!cancelled) {
                    setGlobalBlockedApps(nextBlocked as any);
                    setGlobalShadowApps(nextShadow as any);
                }
            } catch {
                // ignore
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const appBlocklistIds = useMemo(() => {
        const map = new Map<AppService, string[]>();
        for (const [app, urls] of Object.entries(APP_LIST_URLS) as Array<[AppService, string[]]>) {
            const ids = new Set<string>();
            for (const url of urls) {
                for (const id of blocklists.filter((b) => b.url === url).map((b) => b.id)) {
                    ids.add(id);
                }
            }
            if (ids.size) map.set(app, Array.from(ids));
        }
        return map;
    }, [blocklists]);

    const refreshBlocklistsBestEffort = async (ids: string[]) => {
        const uniqueIds = Array.from(new Set(ids));
        let index = 0;
        const concurrency = Math.min(5, uniqueIds.length);

        const worker = async () => {
            while (true) {
                const nextIndex = index;
                index += 1;
                if (nextIndex >= uniqueIds.length) return;
                const id = uniqueIds[nextIndex];
                try {
                    await fetch(`/api/blocklists/${encodeURIComponent(id)}/refresh`, {
                        method: 'POST',
                        headers: { ...getAuthHeaders() },
                        credentials: 'include'
                    });
                } catch {
                    // best-effort
                }
            }
        };

        await Promise.all(Array.from({ length: concurrency }, () => worker()));
    };

    const setBlocklistsEnabledBestEffort = async (ids: string[], enabled: boolean) => {
        const uniqueIds = Array.from(new Set(ids));
        let index = 0;
        const concurrency = Math.min(5, uniqueIds.length);

        const worker = async () => {
            while (true) {
                const nextIndex = index;
                index += 1;
                if (nextIndex >= uniqueIds.length) return;
                const id = uniqueIds[nextIndex];
                try {
                    await fetch(`/api/blocklists/${encodeURIComponent(id)}`,
                        {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                            credentials: 'include',
                            body: JSON.stringify({ enabled })
                        }
                    );
                } catch {
                    // best-effort
                }
            }
        };

        await Promise.all(Array.from({ length: concurrency }, () => worker()));
    };

    const setGlobalAppMode = async (id: AppService, mode: 'ACTIVE' | 'SHADOW' | 'OFF') => {
        setAppsMsg('');

        const nextBlocked = (() => {
            if (mode !== 'ACTIVE') return globalBlockedApps.filter((a) => a !== id);
            return globalBlockedApps.includes(id) ? globalBlockedApps : [...globalBlockedApps, id];
        })();

        const nextShadow = (() => {
            if (mode !== 'SHADOW') return globalShadowApps.filter((a) => a !== id);
            return globalShadowApps.includes(id) ? globalShadowApps : [...globalShadowApps, id];
        })();

        // Ensure the app cannot be both active and shadow.
        const cleanedBlocked = nextBlocked.filter((a) => !nextShadow.includes(a));
        const cleanedShadow = nextShadow.filter((a) => !cleanedBlocked.includes(a));

        setGlobalBlockedApps(cleanedBlocked);
        setGlobalShadowApps(cleanedShadow);

        setAppsBusy(true);
        try {
            const res = await fetch('/api/settings/global_blocked_apps', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                credentials: 'include',
                body: JSON.stringify({ blockedApps: cleanedBlocked, shadowApps: cleanedShadow })
            });

            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(String((body as any)?.message || `HTTP ${res.status}`));
            }

            // Warm up referenced app blocklists so the effect is immediate (ACTIVE or SHADOW).
            if (mode !== 'OFF') {
                const idsForApp = appBlocklistIds.get(id) ?? [];
                if (idsForApp.length) {
                    // Make sure app lists become part of the normal refresh cycle (startup + daily) and are included in UPDATE LISTS.
                    await setBlocklistsEnabledBestEffort(idsForApp, true);
                    await refreshBlocklistsBestEffort(idsForApp);
                }
            }

            setAppsMsg('Saved');
        } catch (e: any) {
            setAppsMsg(String(e?.message || 'Failed to save.'));
            loadBlocklists();
        } finally {
            setAppsBusy(false);
        }
    };

    const deleteBlocklist = (id: string) => {
        setBlocklists(prev => prev.filter(b => b.id !== id));
        fetch(`/api/blocklists/${encodeURIComponent(id)}`,
            {
                method: 'DELETE',
                headers: { ...getAuthHeaders() },
                credentials: 'include'
            }
        ).catch(() => {
            setBlocklistsError('Failed to delete blocklist.');
            loadBlocklists();
        });
    };

    const refreshBlocklist = async (id: string) => {
        const r = await fetch(`/api/blocklists/${encodeURIComponent(id)}/refresh`, {
            method: 'POST',
            headers: { ...getAuthHeaders() },
            credentials: 'include'
        });
        if (!r.ok) {
            const body = await r.json().catch(() => ({}));
            throw new Error(String(body?.message || `Refresh failed (HTTP ${r.status})`));
        }
    };

    const syncAllBlocklists = async () => {
        setIsSyncing(true);
        setBlocklistsError(null);
        try {
            const ids = new Set<string>();

            // Refresh everything that is globally enabled (includes categories).
            for (const b of blocklists.filter((b) => b.mode !== 'DISABLED')) {
                ids.add(b.id);
            }

            // Also refresh app lists for currently selected global apps (even if they were still disabled in the DB).
            const selectedApps = Array.from(new Set([...(globalBlockedApps ?? []), ...(globalShadowApps ?? [])])) as AppService[];
            for (const app of selectedApps) {
                const idsForApp = appBlocklistIds.get(app) ?? [];
                for (const id of idsForApp) ids.add(id);
            }

            for (const id of ids) {
                await refreshBlocklist(id);
            }
        } catch {
            setBlocklistsError('One or more blocklists failed to refresh.');
        } finally {
            setIsSyncing(false);
            loadBlocklists();
        }
    };


    const updateBlocklistMode = async (id: string, mode: BlocklistMode, feedback?: 'blocklists' | 'categories') => {
        if (feedback === 'blocklists') setGlobalBlocklistsMsg('');
        if (feedback === 'categories') setGlobalCategoriesMsg('');

        const enabled = mode !== 'DISABLED';
        const r = await fetch(`/api/blocklists/${encodeURIComponent(id)}`,
            {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                credentials: 'include',
                body: JSON.stringify({ enabled, mode })
            }
        );

        if (!r.ok) {
            const body = await r.json().catch(() => ({}));
            throw new Error(String((body as any)?.message || `HTTP ${r.status}`));
        }
        const row = await r.json().catch(() => null);
        if (!row) throw new Error('INVALID_RESPONSE');
        const mapped = mapServerBlocklist(row);
        setBlocklists(prev => prev.map(b => b.id === id ? { ...b, ...mapped } : b));

        if (feedback === 'blocklists') setGlobalBlocklistsMsg('Saved');
        if (feedback === 'categories') setGlobalCategoriesMsg('Saved');

        // If the list is being enabled for the first time, populate rules immediately.
        if (mapped.mode !== 'DISABLED' && !mapped.lastUpdatedAt) {
            try {
                await refreshBlocklist(id);
                loadBlocklists();
            } catch {
                // ignore; errors are reflected in server state and user can retry
            }
        }
    };

    const submitNewBlocklist = async () => {
        const name = newListName.trim();
        const url = newListUrl.trim();
        if (!name || !url) return;

        setBlocklistsError(null);
        try {
            const res = await fetch('/api/blocklists', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                credentials: 'include',
                body: JSON.stringify({ name, url, enabled: true })
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(String(body?.message || `HTTP ${res.status}`));
            }
            setIsAddOpen(false);
            setNewListName('');
            setNewListUrl('');
            loadBlocklists();
        } catch (e: any) {
            setBlocklistsError(String(e?.message || 'Failed to add blocklist.'));
        }
    };

    const handleBlocklistModeChange = (id: string, mode: BlocklistMode, feedback?: 'blocklists' | 'categories') => {
        setBlocklists(prev => prev.map(list => list.id === id ? { ...list, mode } : list));

        void updateBlocklistMode(id, mode, feedback).catch((e: any) => {
            setBlocklistsError(String(e?.message || 'Failed to update blocklist.'));
            if (feedback === 'blocklists') setGlobalBlocklistsMsg(String(e?.message || 'Failed to save.'));
            if (feedback === 'categories') setGlobalCategoriesMsg(String(e?.message || 'Failed to save.'));
            loadBlocklists();
        });
    };



  const handleAnalyze = async () => {
        const domain = canonicalizeDomainInput(domainInput);
        if (!domain) return;
    setIsAnalyzing(true);
    setAnalysis(null);
    
    try {
            const rawText = await analyzeDomain(domain);
      
      const parseSection = (header: string, nextHeader?: string) => {
        const parts = rawText.split(header);
        if (parts.length < 2) return 'Unknown';
        const content = parts[1];
        if (nextHeader) {
          return content.split(nextHeader)[0].trim();
        }
        return content.trim();
      };

      const category = parseSection('[CATEGORY]', '[PURPOSE]');
      const purpose = parseSection('[PURPOSE]', '[BLOCKING IMPACT]');
      const impact = parseSection('[BLOCKING IMPACT]');

      setAnalysis({ category, purpose, impact });
    } catch (error) {
      console.error(error);
    } finally {
      setIsAnalyzing(false);
    }
  };

    const handleAddRuleClick = (type: 'BLOCKED' | 'ALLOWED', categoryOverride?: string) => {
        const domain = canonicalizeDomainInput(domainInput);
        if (!domain) return;
        addRule(domain, type, categoryOverride || analysis?.category || 'Manual');
        setDomainInput('');
        setAnalysis(null);
    };
  
  const handleAudit = () => {
      if(!auditDomain) return;
      setIsAuditing(true);
      setAuditResult(null);
  };

  useEffect(() => {
      if (!isAuditing) return;
      if (!auditDomain) return;
      let cancelled = false;

      (async () => {
          try {
              const canon = canonicalizeDomainInput(auditDomain);
              if (!canon) {
                  if (!cancelled) setAuditResult({ total: 0, affectedClients: [], frequency: 'Unknown', gravityMatches: [] });
                  return;
              }

              const res = await fetch('/api/query-logs?limit=1000');
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const data = await res.json();
              const items = Array.isArray(data?.items) ? data.items : [];

              const matches = items.filter((q: any) => typeof q?.domain === 'string' && matchesDomain(canon, q.domain));
              const clients = Array.from(new Set(matches.map((q: any) => String(q?.client ?? 'Unknown'))));

              let gravityMatches: Blocklist[] = [];

              // Server-side policy evaluation (includes categories, apps, allow/block).
              const checkRes = await fetch('/api/policy/domaincheck', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                  credentials: 'include',
                  body: JSON.stringify({ domain: canon })
              });

              if (checkRes.ok) {
                  const check = await checkRes.json();
                  const decision = String(check?.decision ?? 'NONE');
                  const reason = typeof check?.reason === 'string' ? check.reason : '';
                  const blocklist = check?.blocklist;

                  if (decision === 'BLOCKED' || decision === 'SHADOW_BLOCKED') {
                      if (blocklist && typeof blocklist?.id === 'string') {
                          const existing = blocklists.find((b) => b.id === String(blocklist.id));
                          if (existing) {
                              gravityMatches = [{ ...existing, mode: decision === 'SHADOW_BLOCKED' ? 'SHADOW' : existing.mode }];
                          } else {
                              gravityMatches = [
                                  {
                                      id: String(blocklist.id),
                                      name: String(blocklist.name ?? 'Blocklist'),
                                      url: '',
                                      ruleCount: 0,
                                      mode: decision === 'SHADOW_BLOCKED' ? 'SHADOW' : 'ACTIVE',
                                      lastUpdated: '—',
                                      lastUpdatedAt: null
                                  }
                              ];
                          }
                      } else {
                          gravityMatches = [
                              {
                                  id: `policy:${reason || decision}`,
                                  name: reason || (decision === 'SHADOW_BLOCKED' ? 'Shadow policy match' : 'Policy match'),
                                  url: '',
                                  ruleCount: 0,
                                  mode: decision === 'SHADOW_BLOCKED' ? 'SHADOW' : 'ACTIVE',
                                  lastUpdated: '—',
                                  lastUpdatedAt: null
                              }
                          ];
                      }
                  }
              }

              if (cancelled) return;
              setAuditResult({
                  total: matches.length,
                  affectedClients: clients,
                  frequency: matches.length > 5 ? 'High Frequency' : matches.length > 0 ? 'Occasional' : 'Never seen',
                  gravityMatches
              });
          } catch {
              if (cancelled) return;
              setAuditResult({ total: 0, affectedClients: [], frequency: 'Unknown', gravityMatches: [] });
          } finally {
              if (!cancelled) setIsAuditing(false);
          }
      })();

      return () => {
          cancelled = true;
      };
  }, [isAuditing, auditDomain, rules, blocklists]);

  const getCategoryColor = (cat: string) => {
    const lower = cat.toLowerCase();
    if (lower.includes('malware') || lower.includes('ad')) return 'text-rose-400';
    if (lower.includes('telemetry')) return 'text-orange-400';
    if (lower.includes('os') || lower.includes('cdn') || lower.includes('text-emerald-400')) return 'text-emerald-400';
    return 'text-zinc-400';
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex justify-between items-end">
        <div>
           <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
              <Shield className="w-5 h-5 text-emerald-500" /> Gravity
           </h2>
           <p className="text-zinc-500 text-sm mt-1">Blocklist aggregation and rule management.</p>
        </div>
                <button
                    onClick={syncAllBlocklists}
                    disabled={isSyncing || !canUpdateLists}
                    className="btn-primary flex items-center gap-2 px-4 py-2 rounded text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                    title={updateListsTitle}
                >
                     <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                     {isSyncing ? 'UPDATING…' : 'UPDATE LISTS'}
                </button>
      </div>

    <ReadOnlyFollowerBanner show={readOnlyFollower} />

            {blocklistsError && (
                <div className="p-3 rounded border border-rose-900/40 bg-rose-950/20 text-xs text-rose-300">
                    {blocklistsError}
                </div>
            )}

      {/* Tabs */}
      <div className="border-b border-[#27272a] flex gap-1">
        {[
          { id: 'gravity', label: 'Blocklists', icon: List },
                    { id: 'categories', label: 'Categories', icon: Layers },
                    { id: 'apps', label: 'Apps', icon: Smartphone },
          { id: 'domains', label: 'Allow/Block', icon: Globe },
          { id: 'audit', label: 'Policy Tester', icon: Stethoscope },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-medium border-b-2 transition-all ${
              activeTab === tab.id 
                ? 'border-emerald-500 text-white bg-[#18181b]' 
                : 'border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-[#18181b]/50'
            }`}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="dashboard-card rounded-lg overflow-hidden min-h-[400px]">
        
        {/* TAB 1: BLOCKLISTS */}
        {activeTab === 'gravity' && (
          <div>
             <div className="px-4 py-3 min-h-[56px] border-b border-[#27272a] flex justify-between items-center gap-4 bg-[#121214]">
                                <div className="text-xs text-zinc-500 font-mono whitespace-nowrap">Total Rules: <span className="text-white font-bold ml-1">{totalBlocklistRules.toLocaleString()}</span></div>
                                <div className="flex items-center gap-4 whitespace-nowrap">
                                    <div className="text-xs text-zinc-500">
                                        Enabled lists: <span className="text-zinc-200 font-mono">{blocklistsOnly.filter((b) => b.mode !== 'DISABLED').length}</span>
                                        {globalBlocklistsMsg ? (
                                            <span
                                                className={`ml-2 inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-bold tracking-tight transition-opacity duration-500 ${
                                                    globalBlocklistsMsgFading ? 'opacity-0' : 'opacity-100'
                                                } ${
                                                    globalBlocklistsMsg.startsWith('Saved')
                                                        ? 'bg-emerald-950/20 text-emerald-300 border-emerald-700/40'
                                                        : 'bg-rose-950/20 text-rose-300 border-rose-700/40'
                                                }`}
                                            >
                                                {globalBlocklistsMsg}
                                            </span>
                                        ) : null}
                                    </div>
                                    <button
                                        onClick={() => setIsAddOpen(true)}
                                        className="flex items-center gap-1.5 text-[10px] font-bold bg-zinc-800 text-zinc-300 border border-zinc-700 px-3 py-1.5 rounded hover:bg-white hover:text-black transition-colors"
                                    >
                                        <Plus className="w-3 h-3" /> ADD LIST
                                    </button>
                                </div>
             </div>

             <div className="px-4 py-3 min-h-[72px] flex flex-col justify-center bg-indigo-900/10 border-b border-indigo-500/20">
                 <div className="text-xs text-zinc-200 font-bold mb-1">Global Blocklists</div>
                 <div className="text-xs text-zinc-400 leading-relaxed">
                     Settings here apply globally. If a device or network has per-client settings, those take precedence.
                     Category and App lists are managed separately.
                 </div>
             </div>

             <table className="w-full text-left">
                <thead className="bg-[#09090b] text-[10px] text-zinc-500 uppercase font-bold tracking-wider">
                   <tr>
                      <th className="p-4 border-b border-[#27272a]">Source</th>
                             <th className="p-4 border-b border-[#27272a]">Mode (Impact)</th>
                             <th className="p-4 border-b border-[#27272a]">Rules</th>
                             <th className="p-4 border-b border-[#27272a]">Updated</th>
                             <th className="p-4 border-b border-[#27272a] text-right">Action</th>
                         </tr>
                     </thead>
                     <tbody className="divide-y divide-[#27272a]">
                         {blocklistsOnly.map(list => (
                             <tr key={list.id} className="hover:bg-[#18181b] transition-colors">
                                 <td className="p-4">
                            <div className="font-bold text-zinc-200 text-sm">{list.name}</div>
                            <div className="text-[10px] text-zinc-600 font-mono truncate max-w-[300px] mt-0.5">{list.url}</div>
                         </td>
                         <td className="p-4">
                            <div className="flex bg-[#09090b] rounded p-1 border border-[#27272a] w-fit relative z-10 pointer-events-auto">
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleBlocklistModeChange(list.id, 'ACTIVE', 'blocklists');
                                    }}
                                    className={`relative z-10 pointer-events-auto px-3 py-1 rounded text-[9px] font-bold transition-all ${list.mode === 'ACTIVE' ? 'bg-emerald-600 text-white shadow' : 'text-zinc-500 hover:text-zinc-300'}`}
                                >
                                    ACTIVE
                                </button>
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleBlocklistModeChange(list.id, 'SHADOW', 'blocklists');
                                    }}
                                    className={`relative z-10 pointer-events-auto px-3 py-1 rounded text-[9px] font-bold transition-all ${list.mode === 'SHADOW' ? 'bg-amber-600 text-white shadow' : 'text-zinc-500 hover:text-zinc-300'}`}
                                    title="Log only, do not block. Useful for testing new lists."
                                >
                                    SHADOW
                                </button>
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleBlocklistModeChange(list.id, 'DISABLED', 'blocklists');
                                    }}
                                    className={`relative z-10 pointer-events-auto px-3 py-1 rounded text-[9px] font-bold transition-all ${list.mode === 'DISABLED' ? 'bg-zinc-700 text-white shadow' : 'text-zinc-500 hover:text-zinc-300'}`}
                                >
                                    OFF
                                </button>
                            </div>
                            {list.mode === 'SHADOW' && (
                                <div className="mt-1 text-[9px] text-amber-500 flex items-center gap-1">
                                    <Eye className="w-3 h-3" /> Silent Monitoring
                                </div>
                            )}
                         </td>
                         <td className="p-4 text-xs text-zinc-300 font-mono">{list.ruleCount.toLocaleString()}</td>
                         <td className="p-4 text-xs text-zinc-500">{list.lastUpdated}</td>
                         <td className="p-4 text-right">
                                     <button
                                        onClick={() => deleteBlocklist(list.id)}
                                        className="text-zinc-600 hover:text-rose-500 p-2 transition-colors"
                                     >
                               <Trash2 className="w-4 h-4" />
                            </button>
                         </td>
                      </tr>
                   ))}
                </tbody>
             </table>

                         {isAddOpen && (
                             <Modal open={true} onClose={() => setIsAddOpen(false)} zIndex={1100}>
                                 <div className="dashboard-card w-full max-w-lg rounded-lg overflow-hidden border border-[#27272a] bg-[#09090b] animate-fade-in">
                                     <div className="p-5 border-b border-[#27272a] flex justify-between items-center bg-[#121214]">
                                         <h3 className="text-sm font-bold text-white uppercase tracking-wider">Add Blocklist</h3>
                                         <button onClick={() => setIsAddOpen(false)} className="text-zinc-500 hover:text-white">
                                             <X className="w-5 h-5" />
                                         </button>
                                     </div>
                                     <div className="p-6 space-y-4">
                                         <div>
                                             <label className="block text-[10px] font-bold text-zinc-500 uppercase mb-2">Name</label>
                                             <input
                                                 value={newListName}
                                                 onChange={(e) => setNewListName(e.target.value)}
                                                 className="w-full bg-[#18181b] border border-[#27272a] rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
                                                 placeholder="StevenBlack Hosts"
                                             />
                                         </div>
                                         <div>
                                             <label className="block text-[10px] font-bold text-zinc-500 uppercase mb-2">URL</label>
                                             <input
                                                 value={newListUrl}
                                                 onChange={(e) => setNewListUrl(e.target.value)}
                                                 className="w-full bg-[#18181b] border border-[#27272a] rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
                                                 placeholder="https://example.com/hosts.txt"
                                             />
                                             <div className="mt-2 text-[11px] text-zinc-500">
                                                 Tip: Use a plain domain list or hosts-style list.
                                             </div>
                                         </div>
                                     </div>
                                     <div className="p-4 border-t border-[#27272a] bg-[#121214] flex justify-end gap-2">
                                         <button
                                             onClick={() => setIsAddOpen(false)}
                                             className="px-4 py-2 rounded text-xs font-bold text-zinc-500 hover:text-white transition-colors"
                                         >
                                             CANCEL
                                         </button>
                                         <button
                                             onClick={submitNewBlocklist}
                                             className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white transition-all text-xs font-bold"
                                         >
                                             ADD
                                         </button>
                                     </div>
                                 </div>
                             </Modal>
                         )}
          </div>
        )}

                {/* TAB 2: CATEGORIES */}
                {activeTab === 'categories' && (
                    <div>
                        <div className="px-4 py-3 min-h-[56px] border-b border-[#27272a] flex justify-between items-center gap-4 bg-[#121214]">
                            <div className="text-xs text-zinc-500 font-mono whitespace-nowrap">Total Rules: <span className="text-white font-bold ml-1">{totalCategoryRules.toLocaleString()}</span></div>
                            <div className="flex items-center gap-4 whitespace-nowrap">
                                <div className="text-xs text-zinc-500">
                                    Enabled categories: <span className="text-zinc-200 font-mono">{categoryGroups.filter((g) => g.lists.some((b) => b.mode !== 'DISABLED')).length}</span>
                                    {globalCategoriesMsg ? (
                                        <span
                                            className={`ml-2 inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-bold tracking-tight transition-opacity duration-500 ${
                                                globalCategoriesMsgFading ? 'opacity-0' : 'opacity-100'
                                            } ${
                                                globalCategoriesMsg.startsWith('Saved')
                                                    ? 'bg-emerald-950/20 text-emerald-300 border-emerald-700/40'
                                                    : 'bg-rose-950/20 text-rose-300 border-rose-700/40'
                                            }`}
                                        >
                                            {globalCategoriesMsg}
                                        </span>
                                    ) : null}
                                </div>
                            </div>
                        </div>

                        <div className="px-4 py-3 min-h-[72px] flex flex-col justify-center bg-indigo-900/10 border-b border-indigo-500/20">
                            <div className="text-xs text-zinc-200 font-bold mb-1">Global Category Blocking</div>
                            <div className="text-xs text-zinc-400 leading-relaxed">
                                Settings here apply globally. If a device or network has per-client category settings, those take precedence.
                            </div>
                        </div>

                        <table className="w-full text-left">
                            <thead className="bg-[#09090b] text-[10px] text-zinc-500 uppercase font-bold tracking-wider">
                                <tr>
                                    <th className="p-4 border-b border-[#27272a]">Category</th>
                                    <th className="p-4 border-b border-[#27272a]">Mode (Impact)</th>
                                    <th className="p-4 border-b border-[#27272a]">Rules</th>
                                    <th className="p-4 border-b border-[#27272a]">Updated</th>
                                    <th className="p-4 border-b border-[#27272a] text-right">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#27272a]">
                                {categoryGroups.map((group) => {
                                    const ids = group.lists.map((l) => l.id);
                                    const groupMode = groupModeFor(group.lists);
                                    const updatedTimestamps = group.lists
                                        .map((l) => (typeof l.lastUpdatedAt === 'string' ? Date.parse(l.lastUpdatedAt) : NaN))
                                        .filter((t) => Number.isFinite(t));
                                    const updated = updatedTimestamps.length
                                        ? new Date(Math.max(...updatedTimestamps)).toLocaleString()
                                        : '—';
                                    const hasRules = group.lists.some((l) => !!l.lastUpdatedAt);
                                    const ruleCount = hasRules
                                        ? group.lists.reduce((sum, l) => sum + (Number.isFinite(l.ruleCount) ? l.ruleCount : 0), 0)
                                        : null;

                                    return (
                                    <tr key={group.name} className="hover:bg-[#18181b] transition-colors">
                                        <td className="p-4">
                                            <div className="font-bold text-zinc-200 text-sm">{group.name}</div>
                                        </td>
                                        <td className="p-4">
                                            <div className="flex bg-[#09090b] rounded p-1 border border-[#27272a] w-fit relative z-10 pointer-events-auto">
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleCategoryGroupModeChange(ids, 'ACTIVE');
                                                    }}
                                                    className={`relative z-10 pointer-events-auto px-3 py-1 rounded text-[9px] font-bold transition-all ${groupMode === 'ACTIVE' ? 'bg-emerald-600 text-white shadow' : 'text-zinc-500 hover:text-zinc-300'}`}
                                                >
                                                    ACTIVE
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleCategoryGroupModeChange(ids, 'SHADOW');
                                                    }}
                                                    className={`relative z-10 pointer-events-auto px-3 py-1 rounded text-[9px] font-bold transition-all ${groupMode === 'SHADOW' ? 'bg-amber-600 text-white shadow' : 'text-zinc-500 hover:text-zinc-300'}`}
                                                    title="Log only, do not block. Useful for testing new lists."
                                                >
                                                    SHADOW
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleCategoryGroupModeChange(ids, 'DISABLED');
                                                    }}
                                                    className={`relative z-10 pointer-events-auto px-3 py-1 rounded text-[9px] font-bold transition-all ${groupMode === 'DISABLED' ? 'bg-zinc-700 text-white shadow' : 'text-zinc-500 hover:text-zinc-300'}`}
                                                >
                                                    OFF
                                                </button>
                                            </div>
                                            {groupMode === 'SHADOW' && (
                                                <div className="mt-1 text-[9px] text-amber-500 flex items-center gap-1">
                                                    <Eye className="w-3 h-3" /> Silent Monitoring
                                                </div>
                                            )}
                                        </td>
                                        <td className="p-4 text-xs text-zinc-300 font-mono">{ruleCount != null ? ruleCount.toLocaleString() : '—'}</td>
                                        <td className="p-4 text-xs text-zinc-500">{updated}</td>
                                        <td className="p-4 text-right">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    void (async () => {
                                                        try {
                                                            await Promise.all(ids.map((id) => refreshBlocklist(id)));
                                                            loadBlocklists();
                                                        } catch {
                                                            setBlocklistsError('Failed to refresh category list.');
                                                            loadBlocklists();
                                                        }
                                                    })();
                                                }}
                                                className="text-zinc-600 hover:text-emerald-400 p-2 transition-colors"
                                                title="Refresh this category list"
                                            >
                                                <RefreshCw className="w-4 h-4" />
                                            </button>
                                        </td>
                                    </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* TAB 3: APPS (GLOBAL) */}
                {activeTab === 'apps' && (
                    <div>
                        <div className="px-4 py-3 min-h-[56px] border-b border-[#27272a] flex justify-between items-center gap-4 bg-[#121214]">
                            <div className="text-xs text-zinc-500 font-mono whitespace-nowrap">Total Rules: <span className="text-white font-bold ml-1">{totalAppListRules.toLocaleString()}</span></div>
                            <div className="flex items-center gap-4 whitespace-nowrap">
                                <div className="text-xs text-zinc-500">
                                    Selected apps: <span className="text-zinc-200 font-mono">{globalBlockedApps.length + globalShadowApps.length}</span>
                                    {appsMsg ? (
                                        <span
                                            className={`ml-2 inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-bold tracking-tight transition-opacity duration-500 ${
                                                appsMsgFading ? 'opacity-0' : 'opacity-100'
                                            } ${
                                                appsMsg.startsWith('Saved')
                                                    ? 'bg-emerald-950/20 text-emerald-300 border-emerald-700/40'
                                                    : 'bg-rose-950/20 text-rose-300 border-rose-700/40'
                                            }`}
                                        >
                                            {appsMsg}
                                        </span>
                                    ) : null}
                                </div>
                            </div>
                        </div>

                        <div className="px-4 py-3 min-h-[72px] flex flex-col justify-center bg-indigo-900/10 border-b border-indigo-500/20">
                            <div className="text-xs text-zinc-200 font-bold mb-1">Global App Blocking</div>
                            <div className="text-xs text-zinc-400 leading-relaxed">
                                Settings here apply globally. If a client has per-client settings, those take precedence.
                                App blocks are evaluated independently from normal Blocklists. Lists are sourced from NextDNS Services and coverage may vary.
                            </div>
                        </div>

                        <table className="w-full text-left">
                            <thead className="bg-[#09090b] text-[10px] text-zinc-500 uppercase font-bold tracking-wider">
                                <tr>
                                    <th className="p-4 border-b border-[#27272a]">App</th>
                                    <th className="p-4 border-b border-[#27272a]">Mode (Impact)</th>
                                    <th className="p-4 border-b border-[#27272a]">Rules</th>
                                    <th className="p-4 border-b border-[#27272a]">Updated</th>
                                    <th className="p-4 border-b border-[#27272a] text-right">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#27272a]">
                                {APPS_SORTED.map((a) => {
                                    const isActive = globalBlockedApps.includes(a.id);
                                    const isShadow = globalShadowApps.includes(a.id);
                                    const selected = isActive || isShadow;
                                    const ids = appBlocklistIds.get(a.id) ?? [];
                                    const lists = ids.length ? blocklists.filter((b) => ids.includes(b.id)) : [];
                                    const allRefreshed = lists.length > 0 && lists.every((l) => !!l.lastUpdatedAt);
                                    const ruleCount = allRefreshed
                                        ? lists.reduce((sum, l) => sum + (Number.isFinite(l.ruleCount) ? l.ruleCount : 0), 0)
                                        : null;
                                    const timestamps = lists
                                        .map((l) => (typeof l.lastUpdatedAt === 'string' ? Date.parse(l.lastUpdatedAt) : NaN))
                                        .filter((t) => Number.isFinite(t));
                                    const updated = timestamps.length ? new Date(Math.max(...timestamps)).toLocaleString() : '—';
                                    const primaryUrl = (APP_LIST_URLS as any)?.[a.id]?.[0] ?? '';

                                    return (
                                        <tr key={a.id} className="hover:bg-[#18181b] transition-colors">
                                            <td className="p-4">
                                                <div className="flex items-center gap-2">
                                                    <AppLogo app={a.id} label={a.label} size={18} />
                                                    <div className="min-w-0">
                                                        <div className="font-bold text-zinc-200 text-sm">{a.label}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="p-4">
                                                <div className="flex bg-[#09090b] rounded p-1 border border-[#27272a] w-fit">
                                                    <button
                                                        type="button"
                                                        onClick={() => void setGlobalAppMode(a.id, 'ACTIVE')}
                                                        disabled={appsBusy}
                                                        className={`px-3 py-1 rounded text-[9px] font-bold transition-all disabled:opacity-50 ${isActive ? 'bg-emerald-600 text-white shadow' : 'text-zinc-500 hover:text-zinc-300'}`}
                                                    >
                                                        ACTIVE
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => void setGlobalAppMode(a.id, 'SHADOW')}
                                                        disabled={appsBusy}
                                                        className={`px-3 py-1 rounded text-[9px] font-bold transition-all disabled:opacity-50 ${isShadow ? 'bg-amber-600 text-white shadow' : 'text-zinc-500 hover:text-zinc-300'}`}
                                                        title="Log only, do not block. Useful for testing app blocks."
                                                    >
                                                        SHADOW
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => void setGlobalAppMode(a.id, 'OFF')}
                                                        disabled={appsBusy}
                                                        className={`px-3 py-1 rounded text-[9px] font-bold transition-all disabled:opacity-50 ${!selected ? 'bg-zinc-700 text-white shadow' : 'text-zinc-500 hover:text-zinc-300'}`}
                                                    >
                                                        OFF
                                                    </button>
                                                </div>
                                            </td>
                                            <td className="p-4 text-xs text-zinc-300 font-mono">{ruleCount == null ? '—' : ruleCount.toLocaleString()}</td>
                                            <td className="p-4 text-xs text-zinc-500">{updated}</td>
                                            <td className="p-4 text-right">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        void (async () => {
                                                            try {
                                                                if (ids.length) await refreshBlocklistsBestEffort(ids);
                                                                loadBlocklists();
                                                            } catch {
                                                                setBlocklistsError('Failed to refresh app lists.');
                                                                loadBlocklists();
                                                            }
                                                        })();
                                                    }}
                                                    className="text-zinc-600 hover:text-emerald-400 p-2 transition-colors"
                                                    title="Refresh this app list"
                                                >
                                                    <RefreshCw className="w-4 h-4" />
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}

        {/* TAB 3: DOMAINS (ALLOW/BLOCK) */}
        {activeTab === 'domains' && (
           <div className="p-6">
              {/* Add New Rule Section */}
              <div className="mb-8 bg-[#121214] border border-[#27272a] rounded-lg overflow-hidden">
                 <div className="p-4 border-b border-[#27272a] bg-[#18181b]/50">
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                       <Plus className="w-4 h-4 text-emerald-500" /> Add Custom Rule
                    </h3>
                 </div>
                 <div className="p-4">
                    <div className="flex gap-2 mb-4">
                       <div className="relative flex-1">
                          <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                          <input 
                             type="text" 
                             placeholder="Enter domain (e.g. ads.example.com)"
                             className="w-full bg-[#09090b] border border-[#27272a] text-white pl-10 pr-4 py-2 rounded text-sm font-mono focus:outline-none focus:border-emerald-500 transition-colors"
                             value={domainInput}
                             onChange={(e) => setDomainInput(e.target.value)}
                             onKeyDown={(e) => e.key === 'Enter' && handleAnalyze()}
                          />
                       </div>
                              <div className="flex gap-2">
                                  <button
                                      onClick={() => handleAddRuleClick('ALLOWED', 'Manual')}
                                      disabled={!domainInput.trim()}
                                      className="px-4 py-2 rounded border border-[#27272a] text-zinc-400 hover:text-emerald-400 hover:border-emerald-500/50 hover:bg-emerald-950/10 transition-all text-xs font-bold flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                      title="Create an allow rule without AI"
                                  >
                                      <CheckCircle className="w-4 h-4" />
                                      ALLOW
                                  </button>

                                  <button
                                      onClick={() => handleAddRuleClick('BLOCKED', 'Manual')}
                                      disabled={!domainInput.trim()}
                                      className="px-4 py-2 rounded bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-900/20 transition-all text-xs font-bold flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                      title="Create a block rule without AI"
                                  >
                                      <XCircle className="w-4 h-4" />
                                      BLOCK
                                  </button>

                                  <button 
                                      onClick={handleAnalyze}
                                      disabled={isAnalyzing || !domainInput.trim()}
                                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                      title="Optional: get an AI assessment before choosing"
                                  >
                                      {isAnalyzing ? (
                                          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                      ) : (
                                          <Sparkles className="w-4 h-4" />
                                      )}
                                      ANALYZE
                                  </button>
                              </div>
                    </div>

                    {/* Analysis Result */}
                    {analysis && (
                       <div className="animate-fade-in bg-[#09090b] border border-[#27272a] rounded p-4 mb-4">
                          <div className="flex items-start gap-4 mb-4">
                             <div className="p-2 bg-indigo-950/30 border border-indigo-900/50 rounded text-indigo-400">
                                <Sparkles className="w-5 h-5" />
                             </div>
                             <div className="flex-1">
                                <div className="flex items-center justify-between mb-1">
                                   <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider">AI Assessment</span>
                                   <span className={`text-[10px] font-bold px-2 py-0.5 rounded border border-[#27272a] uppercase ${getCategoryColor(analysis.category)}`}>
                                      {analysis.category}
                                   </span>
                                </div>
                                <p className="text-sm text-zinc-200 font-medium mb-1">{analysis.purpose}</p>
                                <div className="flex items-center gap-2 text-xs text-zinc-500 mt-2">
                                   <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                                   Impact: <span className="text-zinc-300">{analysis.impact}</span>
                                </div>
                             </div>
                          </div>
                          
                          <div className="flex gap-2 justify-end">
                             <button 
                                onClick={() => handleAddRuleClick('ALLOWED')}
                                className="px-4 py-2 rounded border border-[#27272a] text-zinc-400 hover:text-emerald-400 hover:border-emerald-500/50 hover:bg-emerald-950/10 transition-all text-xs font-bold flex items-center gap-2"
                             >
                                <CheckCircle className="w-3.5 h-3.5" />
                                WHITELIST
                             </button>
                             <button 
                                onClick={() => handleAddRuleClick('BLOCKED')}
                                className="px-4 py-2 rounded bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-900/20 transition-all text-xs font-bold flex items-center gap-2"
                             >
                                <XCircle className="w-3.5 h-3.5" />
                                BLOCK DOMAIN
                             </button>
                          </div>
                       </div>
                    )}
                 </div>
              </div>

              {/* Rules List */}
              <div className="space-y-2">
                 {rules.map(rule => (
                    <div key={rule.id} className="flex items-center justify-between p-3 bg-[#18181b] border border-[#27272a] rounded hover:border-zinc-500 transition-colors group">
                       <div className="flex items-center gap-4">
                          <div className={`w-8 h-8 rounded flex items-center justify-center border ${
                             rule.type === 'BLOCKED' 
                             ? 'bg-rose-950/20 border-rose-900/50 text-rose-500' 
                             : 'bg-emerald-950/20 border-emerald-900/50 text-emerald-500'
                          }`}>
                             {rule.type === 'BLOCKED' ? <XCircle className="w-4 h-4" /> : <CheckCircle className="w-4 h-4" />}
                          </div>
                          <div>
                             <div className="text-sm font-mono text-zinc-200 font-medium">{rule.domain}</div>
                             <div className="flex items-center gap-2 mt-0.5">
                                <span className={`text-[10px] uppercase font-bold ${getCategoryColor(rule.category)}`}>{rule.category}</span>
                                <span className="text-[10px] text-zinc-600">• Added {rule.addedAt}</span>
                             </div>
                          </div>
                       </div>
                       <button 
                                  aria-label={`Delete rule ${rule.domain}`}
                          onClick={() => removeRule(rule.id)}
                          className="p-2 text-zinc-600 hover:text-rose-500 transition-colors opacity-0 group-hover:opacity-100"
                       >
                          <Trash2 className="w-4 h-4" />
                       </button>
                    </div>
                 ))}
                 
                 {rules.length === 0 && (
                    <div className="text-center py-12 text-zinc-600">
                       <Globe className="w-8 h-8 mx-auto mb-2 opacity-20" />
                       <p className="text-xs">No custom rules defined.</p>
                    </div>
                 )}
              </div>
           </div>
        )}

        {/* TAB 4: AUDIT/TESTER */}
        {activeTab === 'audit' && (
            <div className="p-6">
                <div className="bg-[#121214] border border-[#27272a] rounded-lg p-6 flex flex-col items-center justify-center text-center">
                    <div className="w-16 h-16 bg-[#18181b] border border-[#27272a] rounded-full flex items-center justify-center mb-4">
                        <Stethoscope className="w-8 h-8 text-indigo-500 opacity-80" />
                    </div>
                    <h3 className="text-lg font-bold text-white mb-2">Policy Auditor (Dry Run)</h3>
                    <p className="text-sm text-zinc-400 max-w-md mb-8">
                        Execute a real query against the active Gravity Database and check historical traffic logs to predict impact.
                    </p>

                    <div className="w-full max-w-md space-y-4">
                        <div className="relative">
                            <input 
                                type="text"
                                value={auditDomain}
                                onChange={(e) => setAuditDomain(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleAudit()}
                                placeholder="Enter domain (e.g. google-analytics.com)" 
                                className="w-full bg-[#09090b] border border-[#27272a] text-white px-4 py-3 rounded text-sm font-mono outline-none focus:border-indigo-500 shadow-inner"
                            />
                            <div className="absolute right-2 top-2">
                                <button 
                                    onClick={handleAudit}
                                    disabled={isAuditing}
                                    className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded flex items-center gap-2 transition-colors disabled:opacity-50"
                                >
                                    {isAuditing ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3 fill-current" />}
                                    AUDIT
                                </button>
                            </div>
                        </div>
                    </div>

                    {isAuditing && (
                         <div className="mt-4 text-xs text-zinc-500 flex items-center gap-2 animate-pulse">
                             <Database className="w-3 h-3" /> Querying Gravity Database (2.4M records)...
                         </div>
                    )}

                    {auditResult && !isAuditing && (
                        <div className="mt-8 w-full max-w-2xl animate-fade-in text-left bg-[#09090b] border border-[#27272a] rounded-lg overflow-hidden grid grid-cols-1 md:grid-cols-2 shadow-2xl">
                            {/* Left Column: Log Analysis */}
                            <div className="border-r border-[#27272a]">
                                <div className="p-3 border-b border-[#27272a] bg-[#18181b] flex items-center gap-2">
                                    <Database className="w-3.5 h-3.5 text-zinc-500" />
                                    <span className="text-xs font-bold text-zinc-300 uppercase">Traffic History (24h)</span>
                                </div>
                                <div className="p-4 space-y-4">
                                     <div className="flex items-center justify-between">
                                        <div className="text-[10px] text-zinc-500 uppercase font-bold">Query Volume</div>
                                        <div className="text-xl font-mono text-white">{auditResult.total}</div>
                                     </div>
                                     
                                     {auditResult.total > 0 && (
                                         <div>
                                            <div className="text-[10px] text-zinc-500 uppercase font-bold mb-2">Past Clients</div>
                                            <div className="flex flex-wrap gap-2">
                                                {auditResult.affectedClients.map(client => (
                                                    <div key={client} className="text-[10px] bg-[#18181b] border border-[#27272a] rounded px-1.5 py-0.5 text-zinc-300">
                                                        {client}
                                                    </div>
                                                ))}
                                            </div>
                                         </div>
                                     )}
                                     {auditResult.total === 0 && (
                                         <p className="text-xs text-zinc-500 italic">No traffic seen for this domain in logs.</p>
                                     )}
                                </div>
                            </div>

                            {/* Right Column: Gravity Check */}
                            <div>
                                <div className="p-3 border-b border-[#27272a] bg-[#18181b] flex items-center gap-2">
                                    <Layers className="w-3.5 h-3.5 text-zinc-500" />
                                    <span className="text-xs font-bold text-zinc-300 uppercase">Gravity Analysis</span>
                                </div>
                                <div className="p-4 space-y-4">
                                     <div>
                                        {auditResult.gravityMatches.length > 0 ? (
                                            <div className="space-y-2">
                                                <div className="flex items-center gap-2 mb-3 bg-rose-950/20 p-2 rounded border border-rose-900/30">
                                                     <AlertTriangle className="w-4 h-4 text-rose-500" />
                                                     <span className="text-xs font-bold text-rose-500">Domain is Blocked</span>
                                                </div>
                                                {auditResult.gravityMatches.map(list => (
                                                    <div key={list.id} className="flex items-start gap-2 p-2 bg-[#121214] rounded border border-[#27272a]">
                                                        {list.mode === 'ACTIVE' ? (
                                                            <div className="mt-0.5 w-3 h-3 rounded-full bg-rose-500 flex items-center justify-center">
                                                                <XCircle className="w-2.5 h-2.5 text-black" />
                                                            </div>
                                                        ) : list.mode === 'SHADOW' ? (
                                                            <div className="mt-0.5 w-3 h-3 rounded-full bg-amber-500 flex items-center justify-center">
                                                                <Eye className="w-2.5 h-2.5 text-black" />
                                                            </div>
                                                        ) : (
                                                            <div className="mt-0.5 w-3 h-3 rounded-full bg-zinc-600"></div>
                                                        )}
                                                        
                                                        <div>
                                                            <div className="text-xs font-bold text-zinc-200">{list.name}</div>
                                                            <div className="text-[9px] font-mono text-zinc-500">
                                                                {list.mode === 'ACTIVE' ? 'BLOCKING ENABLED' : list.mode === 'SHADOW' ? 'DETECTED (SHADOW MODE)' : 'LIST DISABLED'}
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="flex flex-col items-center justify-center py-2 text-center">
                                                <CheckCircle className="w-8 h-8 text-emerald-500 opacity-50 mb-2" />
                                                <span className="text-xs font-bold text-emerald-500">Safe / Allowed</span>
                                                <span className="text-[10px] text-zinc-500 mt-1">Not found in any active Gravity list.</span>
                                            </div>
                                        )}
                                     </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        )}
      </div>
    </div>
  );
};

export default Blocking;