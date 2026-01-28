import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Smartphone, Laptop, Tv, Gamepad2, Tablet, Search, Shield, GlobeLock, X, Filter, Lock, Skull, Heart, MessageCircle, Play, ShoppingCart, Ban, Grid, HelpCircle, Info, Moon, Clock, Calendar, Check, Pause, ChevronDown, ChevronUp, WifiOff, Power, Youtube, Network, Router, Sliders, Plus, Save, Fingerprint, RefreshCw, Pencil, Trash2 } from 'lucide-react';
import { ClientProfile, ContentCategory, AppService, ScheduleModeType, BlocklistMode, Schedule } from '../types';
import { AppLogo } from '../components/AppLogo';
import { useClients } from '../contexts/ClientsContext';
import Modal from '../components/Modal';
import { getAuthHeaders } from '../services/apiClient';

const Clients: React.FC = () => {
  // Use global client context
    const { clients, addClient, updateClient, removeClient } = useClients();
  
  const [activeView, setActiveView] = useState<'devices' | 'networks'>('devices');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedClient, setSelectedClient] = useState<ClientProfile | null>(null);

    const [clientSaveMsg, setClientSaveMsg] = useState<string>('');
    const [clientSaveFading, setClientSaveFading] = useState(false);
    const clientSaveFadeTimerRef = useRef<number | null>(null);
    const clientSaveClearTimerRef = useRef<number | null>(null);
    const saveSeqRef = useRef(0);
  
  // Modal States
    const [modalSection, setModalSection] = useState<'overview' | 'rules' | 'schedules'>('overview');
  const [showAddModal, setShowAddModal] = useState(false);
  const [addMode, setAddMode] = useState<'manual' | 'scan'>('manual'); // New: Switch between manual and scan
    const [editingClient, setEditingClient] = useState<ClientProfile | null>(null);
        const [clientToDelete, setClientToDelete] = useState<ClientProfile | null>(null);
                const [scheduleToDelete, setScheduleToDelete] = useState<Schedule | null>(null);
        const [addNodeError, setAddNodeError] = useState<string | null>(null);

    // Discovered clients (best-effort from DNS logs + optional reverse DNS)
    const [discovered, setDiscovered] = useState<Array<{ ip: string; hostname: string | null; lastSeen?: string | null }>>([]);
    const [discoveredLoading, setDiscoveredLoading] = useState(false);
    const [discoveredError, setDiscoveredError] = useState<string | null>(null);

  // Add Node Form State
  const [newNodeData, setNewNodeData] = useState({
      name: '',
      mac: '',
      ip: '',
      cidr: '',
      deviceIcon: 'smartphone'
  });

    // Temporary state for editing schedules
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);

    // Blocklists (for per-client override UI)
    const [availableBlocklists, setAvailableBlocklists] = useState<Array<{ id: string; name: string; url: string; mode: BlocklistMode }>>([]);
    const [blocklistsError, setBlocklistsError] = useState<string | null>(null);
    const [blocklistSearch, setBlocklistSearch] = useState('');

    // Global filtering state (for per-client "use global" toggles)
    const [globalBlockedApps, setGlobalBlockedApps] = useState<AppService[]>([]);

    const mapServerBlocklist = (row: any): { id: string; name: string; url: string; mode: BlocklistMode } | null => {
        const id = String(row?.id ?? '').trim();
        if (!id) return null;
        const enabled = row?.enabled !== false;
        const serverMode: BlocklistMode = row?.mode === 'SHADOW' ? 'SHADOW' : 'ACTIVE';
        const mode: BlocklistMode = enabled ? serverMode : 'DISABLED';
        return { id, name: String(row?.name ?? `List ${id}`), url: String(row?.url ?? ''), mode };
    };

    const isCategoryBlocklist = (b: { name: string } | null | undefined) => String(b?.name ?? '').trim().toLowerCase().startsWith('category:');
    const isAppBlocklist = (b: { name: string } | null | undefined) => String(b?.name ?? '').trim().toLowerCase().startsWith('app:');

    const blocklistsOnly = useMemo(
        () => availableBlocklists.filter((b) => !isCategoryBlocklist(b) && !isAppBlocklist(b)),
        [availableBlocklists]
    );

    const globalEnabledBlocklistIds = useMemo(() => {
        // Global blocklists should not include category/app lists (those are handled separately).
        return blocklistsOnly.filter((b) => b.mode !== 'DISABLED').map((b) => b.id);
    }, [blocklistsOnly]);

    useEffect(() => {
        // Load global blocked apps when opening client modal (best-effort)
        if (!selectedClient) return;
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch('/api/settings', { headers: { ...getAuthHeaders() } });
                const data = await res.json().catch(() => null);
                const items = Array.isArray((data as any)?.items) ? (data as any).items : [];
                const item = items.find((i: any) => i?.key === 'global_blocked_apps');
                const raw = item?.value;
                const list = Array.isArray(raw?.blockedApps) ? raw.blockedApps : Array.isArray(raw) ? raw : [];
                const next = list.map((x: any) => String(x)).filter(Boolean);
                if (!cancelled) setGlobalBlockedApps(next as any);
            } catch {
                if (!cancelled) setGlobalBlockedApps([]);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [selectedClient]);

    useEffect(() => {
        // Load blocklists when opening client modal (best-effort)
        if (!selectedClient) return;
        let cancelled = false;
        setBlocklistsError(null);
        fetch('/api/blocklists')
            .then(async (r) => {
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                return r.json();
            })
            .then((data) => {
                if (cancelled) return;
                const items = Array.isArray(data?.items) ? data.items : [];
                const mapped = items.map(mapServerBlocklist).filter(Boolean) as Array<{ id: string; name: string; url: string; mode: BlocklistMode }>;
                setAvailableBlocklists(mapped);
            })
            .catch(() => {
                if (cancelled) return;
                setAvailableBlocklists([]);
                setBlocklistsError('Could not load blocklists.');
            });
        return () => {
            cancelled = true;
        };
    }, [selectedClient]);

  const getIcon = (type: string) => {
    switch(type) {
      case 'laptop': return <Laptop className="w-5 h-5" />;
      case 'tv': return <Tv className="w-5 h-5" />;
      case 'game': return <Gamepad2 className="w-5 h-5" />;
      case 'tablet': return <Tablet className="w-5 h-5" />;
      case 'subnet': return <Network className="w-5 h-5" />;
      case 'iot': return <Router className="w-5 h-5" />;
      default: return <Smartphone className="w-5 h-5" />;
    }
  };

    const normalizeToken = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '');

    // Filter Logic: Split Devices vs Subnets (and make search work reliably in both tabs)
    const filteredClients = clients.filter((c) => {
        const isSubnet = !!(c.isSubnet || c.type === 'subnet' || (typeof c.cidr === 'string' && c.cidr.includes('/')));
        const matchesType = activeView === 'networks' ? isSubnet : !isSubnet;

        const raw = searchTerm.trim();
        if (!raw) return matchesType;

        const tokens = raw.toLowerCase().split(/\s+/).filter(Boolean);

        const hay = activeView === 'networks'
            ? [
                    String(c.name ?? '').toLowerCase(),
                    String(c.cidr ?? '').toLowerCase()
                ]
            : [
                    String(c.name ?? '').toLowerCase(),
                    String(c.ip ?? '').toLowerCase(),
                    String(c.mac ?? '').toLowerCase(),
                    String(c.type ?? '').toLowerCase()
                ];

        const hayNorm = hay.map(normalizeToken);

        const matchesSearch = tokens.every((t) => {
            const tn = normalizeToken(t);
            return hay.some((h) => h.includes(t)) || (tn ? hayNorm.some((h) => h.includes(tn)) : true);
        });

        return matchesType && matchesSearch;
    });

  const CATEGORY_LIST_URLS: Partial<Record<ContentCategory, string[]>> = {
      adult: ['https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/nsfw.txt'],
      gambling: ['https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/gambling.txt'],
      social: ['https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/social.txt'],
      piracy: ['https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/anti.piracy.txt'],
      dating: ['https://raw.githubusercontent.com/nextdns/services/main/services/tinder']
  };

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

  const categoryBlocklistIds = useMemo(() => {
      const map = new Map<ContentCategory, string[]>();
      for (const [cat, urls] of Object.entries(CATEGORY_LIST_URLS) as Array<[ContentCategory, string[]]>) {
          const ids = new Set<string>();
          for (const url of urls) {
              for (const id of availableBlocklists.filter((b) => b.url === url).map((b) => b.id)) {
                  ids.add(id);
              }
          }
          if (ids.size) map.set(cat, Array.from(ids));
      }
      return map;
  }, [availableBlocklists]);

  const appBlocklistIds = useMemo(() => {
      const map = new Map<AppService, string[]>();
      for (const [app, urls] of Object.entries(APP_LIST_URLS) as Array<[AppService, string[]]>) {
          const ids = new Set<string>();
          for (const url of urls) {
              for (const id of availableBlocklists.filter((b) => b.url === url).map((b) => b.id)) {
                  ids.add(id);
              }
          }
          if (ids.size) map.set(app, Array.from(ids));
      }
      return map;
  }, [availableBlocklists]);

  const ensureBlocklistsEnabledAndRefreshed = async (ids: string[]) => {
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
                  await fetch(`/api/blocklists/${encodeURIComponent(id)}/refresh`,
                      {
                          method: 'POST',
                          headers: {
                              ...getAuthHeaders()
                          }
                      }
                  );
              } catch {
                  // best-effort
              }
          }
      };

      await Promise.all(Array.from({ length: concurrency }, () => worker()));
  };

  // Configuration Constants
  const CATEGORIES: {id: ContentCategory, label: string, icon: React.ElementType}[] = [
    { id: 'adult', label: 'Pornography', icon: Lock },
    { id: 'gambling', label: 'Gambling', icon: Grid },
    { id: 'piracy', label: 'Piracy', icon: Skull },
    { id: 'dating', label: 'Dating', icon: Heart },
    { id: 'social', label: 'Social Media', icon: MessageCircle },
    { id: 'crypto', label: 'Crypto', icon: Ban },
    { id: 'shopping', label: 'Shopping', icon: ShoppingCart },
    { id: 'game', label: 'Online Games', icon: Gamepad2 },
    { id: 'video', label: 'Video Stream', icon: Play },
  ];

    const CATEGORIES_SORTED = useMemo(
            () => [...CATEGORIES].sort((a, b) => a.label.localeCompare(b.label, 'de', { sensitivity: 'base' })),
            []
    );

    const APPS: {id: AppService, label: string}[] = [
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
        { id: 'chatgpt', label: 'ChatGPT' },
    ];

    const APPS_SORTED = useMemo(
        () => [...APPS].sort((a, b) => a.label.localeCompare(b.label, 'de', { sensitivity: 'base' })),
        []
    );

    const globalBlockedCategories = useMemo(() => {
        // Derive from globally enabled Category blocklists (any source enabled counts as globally selected).
        const enabledIds = new Set(
            availableBlocklists.filter((b) => b.mode !== 'DISABLED').map((b) => b.id)
        );
        const out: ContentCategory[] = [];
        for (const cat of CATEGORIES_SORTED) {
            const ids = categoryBlocklistIds.get(cat.id) ?? [];
            if (ids.some((id) => enabledIds.has(id))) out.push(cat.id);
        }
        return out;
    }, [availableBlocklists, categoryBlocklistIds, CATEGORIES_SORTED]);

  // --- ACTIONS ---

  const handleSelectDiscovered = (lease: any) => {
      setNewNodeData({
          name: lease.hostname || lease.ip,
          mac: lease.mac,
          ip: lease.ip,
          cidr: '',
          deviceIcon: lease.type || 'smartphone'
      });
      setAddMode('manual'); // Switch to manual to review/edit before saving
  };

  const loadDiscovered = async () => {
      setDiscoveredLoading(true);
      setDiscoveredError(null);
      try {
          const res = await fetch('/api/discovery/clients?limit=200', {
              headers: { ...getAuthHeaders() },
              credentials: 'include'
          });
          if (!res.ok) {
              const data = await res.json().catch(() => ({} as any));
              setDiscoveredError(data?.error || data?.message || 'Failed to load discovered clients.');
              setDiscovered([]);
              return;
          }
          const data = await res.json().catch(() => ({} as any));
          const items = Array.isArray(data?.items) ? data.items : [];
          setDiscovered(
              items
                  .map((x: any) => ({
                      ip: typeof x?.ip === 'string' ? x.ip : '',
                      hostname: typeof x?.hostname === 'string' && x.hostname.trim() ? x.hostname.trim() : null,
                      lastSeen: typeof x?.lastSeen === 'string' ? x.lastSeen : null
                  }))
                  .filter((x: any) => !!x.ip)
          );
      } catch {
          setDiscoveredError('Backend not reachable.');
          setDiscovered([]);
      } finally {
          setDiscoveredLoading(false);
      }
  };

  useEffect(() => {
      if (!showAddModal) return;
      if (activeView !== 'devices') return;
      if (addMode !== 'scan') return;
      void loadDiscovered();
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAddModal, activeView, addMode]);

  const resetNewNodeData = () => {
      setNewNodeData({ name: '', mac: '', ip: '', cidr: '', deviceIcon: 'smartphone' });
  };

  const openCreateModal = () => {
      setEditingClient(null);
      setAddMode('manual');
      setAddNodeError(null);
      resetNewNodeData();
      setShowAddModal(true);
  };

  const openEditClient = (client: ClientProfile) => {
      const isSubnet = client.isSubnet || client.type === 'subnet';
      setEditingClient(client);
      setAddMode('manual');
      setAddNodeError(null);
      setActiveView(isSubnet ? 'networks' : 'devices');
      setNewNodeData({
          name: client.name || '',
          mac: client.mac || '',
          ip: client.ip || '',
          cidr: client.cidr || '',
          deviceIcon: isSubnet ? 'smartphone' : client.type || 'smartphone'
      });
      setShowAddModal(true);
  };

  const closeAddModal = () => {
      setShowAddModal(false);
      setEditingClient(null);
      setAddMode('manual');
      setAddNodeError(null);
      resetNewNodeData();
  };

    const handleAddNode = async () => {
      if(!newNodeData.name) return;
      setAddNodeError(null);

      const isNetworkCreation = editingClient
          ? editingClient.isSubnet || editingClient.type === 'subnet'
          : activeView === 'networks';

      const cidr = String(newNodeData.cidr ?? '').trim();
      if (isNetworkCreation) {
          if (!cidr) {
              setAddNodeError('CIDR is required for network segments.');
              return;
          }
          if (!cidr.includes('/')) {
              setAddNodeError('CIDR must include a prefix length (e.g. 192.168.20.0/24).');
              return;
          }
      }

      if (editingClient) {
          const updatedProfile: ClientProfile = {
              ...editingClient,
              name: newNodeData.name,
              type: isNetworkCreation ? 'subnet' : (newNodeData.deviceIcon as any),
              isSubnet: isNetworkCreation,
              cidr: isNetworkCreation ? cidr : undefined,
              mac: !isNetworkCreation ? newNodeData.mac : undefined,
              ip: !isNetworkCreation ? newNodeData.ip : undefined
          };

          const ok = await updateClient(updatedProfile);
          if (!ok) {
              setAddNodeError('Save failed. Please check your inputs (CIDR format) and permissions.');
              return;
          }

          closeAddModal();
          return;
      }

      const idPrefix = isNetworkCreation ? 's-' : 'c-';
      const id = `${idPrefix}${Date.now()}`;

      const newProfile: ClientProfile = {
          id,
          name: newNodeData.name,
          type: isNetworkCreation ? 'subnet' : newNodeData.deviceIcon as any,
          isSubnet: isNetworkCreation,
          // Network Fields
          cidr: isNetworkCreation ? cidr : undefined,
          // Device Fields
          mac: !isNetworkCreation ? newNodeData.mac : undefined,
          ip: !isNetworkCreation ? newNodeData.ip : undefined,
          
          status: 'online',
          policy: 'Custom',
          safeSearch: false,
          assignedBlocklists: [],
          useGlobalSettings: true,
          useGlobalCategories: true,
          useGlobalApps: true,
          isInternetPaused: false,
          blockedCategories: [],
          blockedApps: [],
          schedules: []
      };

      // Best-effort persist; show feedback in the modal when editing, not on creation.
      const ok = await addClient(newProfile);
      if (!ok) {
          setAddNodeError('Create failed. Please check your inputs (CIDR format) and permissions.');
          return;
      }

      closeAddModal();
  };

  const handleDeleteClient = (client: ClientProfile) => {
      setClientToDelete(client);
  };

  const confirmDeleteClient = () => {
      if (!clientToDelete) return;

      const id = clientToDelete.id;
      const wasSelected = selectedClient?.id === id;

      const seq = ++saveSeqRef.current;
      setClientSaveMsg('Deleting…');
      void removeClient(id).then((ok) => {
          if (seq !== saveSeqRef.current) return;
          setClientSaveMsg(ok ? 'Deleted' : 'Delete failed');
          if (ok && wasSelected) setSelectedClient(null);
      });

      setClientToDelete(null);
  };

  const confirmDeleteSchedule = () => {
      if (!selectedClient || !scheduleToDelete) return;

      const scheduleId = scheduleToDelete.id;
      const updatedSchedules = selectedClient.schedules.filter((s) => s.id !== scheduleId);
      if (editingScheduleId === scheduleId) setEditingScheduleId(null);

      handleUpdateClient({ ...selectedClient, schedules: updatedSchedules });
      setScheduleToDelete(null);
  };

  // Wrapper for updating client that updates both local view state and global state
  const handleUpdateClient = (updated: ClientProfile) => {
      setSelectedClient(updated);

      const seq = ++saveSeqRef.current;
      setClientSaveMsg('Saving…');
      void updateClient(updated).then((ok) => {
          if (seq !== saveSeqRef.current) return;
          setClientSaveMsg(ok ? 'Saved' : 'Save failed');
      });
  };

  useEffect(() => {
      // Reset save status when switching clients / closing modal.
      setClientSaveMsg('');
      setClientSaveFading(false);
      saveSeqRef.current += 1;
  }, [selectedClient?.id]);

  useEffect(() => {
      if (clientSaveFadeTimerRef.current) window.clearTimeout(clientSaveFadeTimerRef.current);
      if (clientSaveClearTimerRef.current) window.clearTimeout(clientSaveClearTimerRef.current);
      clientSaveFadeTimerRef.current = null;
      clientSaveClearTimerRef.current = null;
      setClientSaveFading(false);

      // Only auto-dismiss terminal states.
      if (!clientSaveMsg || clientSaveMsg.startsWith('Saving')) return;

      clientSaveFadeTimerRef.current = window.setTimeout(() => setClientSaveFading(true), 4500);
      clientSaveClearTimerRef.current = window.setTimeout(() => {
          setClientSaveMsg('');
          setClientSaveFading(false);
      }, 5000);

      return () => {
          if (clientSaveFadeTimerRef.current) window.clearTimeout(clientSaveFadeTimerRef.current);
          if (clientSaveClearTimerRef.current) window.clearTimeout(clientSaveClearTimerRef.current);
      };
  }, [clientSaveMsg]);

  const setClientBlocklistsMode = (useGlobal: boolean) => {
      if (!selectedClient) return;

      if (useGlobal) {
          handleUpdateClient({
              ...selectedClient,
              useGlobalSettings: true
          });
          return;
      }

      // Switching to custom: if nothing selected yet, start from global enabled.
      const existing = Array.isArray(selectedClient.assignedBlocklists) ? selectedClient.assignedBlocklists : [];
      const nextAssigned = existing.length > 0 ? existing : globalEnabledBlocklistIds;
      handleUpdateClient({
          ...selectedClient,
          useGlobalSettings: false,
          assignedBlocklists: nextAssigned
      });
  };

  const toggleClientBlocklist = (id: string) => {
      if (!selectedClient) return;
      const cur = new Set(Array.isArray(selectedClient.assignedBlocklists) ? selectedClient.assignedBlocklists : []);
      if (cur.has(id)) cur.delete(id);
      else cur.add(id);
      handleUpdateClient({
          ...selectedClient,
          useGlobalSettings: false,
          assignedBlocklists: Array.from(cur)
      });
  };

  const toggleSafeSearch = () => {
      if(!selectedClient) return;
      handleUpdateClient({ ...selectedClient, safeSearch: !selectedClient.safeSearch });
  };

  const toggleInternetPause = () => {
      if(!selectedClient) return;
      handleUpdateClient({ ...selectedClient, isInternetPaused: !selectedClient.isInternetPaused });
  };

  const toggleScheduleActive = (scheduleId: string) => {
      if(!selectedClient) return;
      const updatedSchedules = selectedClient.schedules.map(s => 
          s.id === scheduleId ? { ...s, active: !s.active } : s
      );
      handleUpdateClient({ ...selectedClient, schedules: updatedSchedules });
  };

    const updateScheduleMode = (scheduleId: string, mode: ScheduleModeType) => {
      if(!selectedClient) return;
      const current = selectedClient.schedules.find((s) => s.id === scheduleId);
      if (!current) return;

      let newCats: ContentCategory[] = Array.isArray(current.blockedCategories) ? current.blockedCategories : [];
      let newApps: AppService[] = Array.isArray(current.blockedApps) ? current.blockedApps : [];
      let blockAll = current.blockAll === true;

      if (mode === 'sleep') {
          newCats = CATEGORIES.map(c => c.id);
          newApps = APPS.map(a => a.id);
          blockAll = false;
      }
      else if (mode === 'homework') {
          newCats = ['social', 'game', 'video'];
          newApps = ['tiktok', 'instagram', 'roblox'];
          blockAll = false;
      }
      else if (mode === 'total_block') {
          newCats = [];
          newApps = [];
          blockAll = true;
      }
      else if (mode === 'custom') {
          // Keep current selections, just ensure we are not in full-block mode.
          blockAll = false;
      }

      const updatedSchedules = selectedClient.schedules.map(s => 
          s.id === scheduleId ? { ...s, mode: mode, blockedCategories: newCats, blockedApps: newApps, blockAll } : s
      );
      handleUpdateClient({ ...selectedClient, schedules: updatedSchedules });
  }

    const SCHEDULE_MODES: Array<{ id: ScheduleModeType; label: string }> = [
      { id: 'sleep', label: 'Sleep' },
      { id: 'homework', label: 'Homework' },
      { id: 'total_block', label: 'Total Block' },
      { id: 'custom', label: 'Custom' }
  ];

  const addNewSchedule = () => {
      if (!selectedClient) return;
      const id = `sched-${Date.now()}-${selectedClient.schedules.length + 1}`;
      const newSchedule = {
          id,
          name: 'New Schedule',
          days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as any,
          startTime: '21:00',
          endTime: '07:00',
          active: true,
          mode: 'sleep' as ScheduleModeType,
          blockedCategories: CATEGORIES.map((c) => c.id),
          blockedApps: APPS.map((a) => a.id),
          blockAll: false
      };
      handleUpdateClient({ ...selectedClient, schedules: [...selectedClient.schedules, newSchedule] });
      setEditingScheduleId(id);
  };

  const updateScheduleFields = (scheduleId: string, patch: Partial<any>) => {
      if (!selectedClient) return;
      const updatedSchedules = selectedClient.schedules.map((s) => (s.id === scheduleId ? { ...s, ...patch } : s));
      handleUpdateClient({ ...selectedClient, schedules: updatedSchedules });
  };

  const updateSchedulePolicy = (scheduleId: string, cats: ContentCategory[], apps: AppService[]) => {
      if(!selectedClient) return;
      const updatedSchedules = selectedClient.schedules.map(s => 
          s.id === scheduleId ? { ...s, blockedCategories: cats, blockedApps: apps } : s
      );
      handleUpdateClient({ ...selectedClient, schedules: updatedSchedules });
  };

  // --- HELPER COMPONENTS ---

  const renderPolicySelector = (
      currentCats: ContentCategory[], 
      currentApps: AppService[], 
      onCatToggle: (id: ContentCategory) => void,
      onAppToggle: (id: AppService) => void,
      isBlockedAll: boolean = false,
      bgColor: string = 'bg-[#18181b]',
      borderColor: string = 'border-[#27272a]',
      categoryGlobalToggle?: { value: boolean; onToggle: () => void },
      appGlobalToggle?: { value: boolean; onToggle: () => void }
  ) => (
      <div className={`p-4 rounded border ${bgColor} ${borderColor} space-y-4 relative`}>
          {isBlockedAll && (
              <div className="absolute inset-0 z-10 bg-[#09090b]/80 flex items-center justify-center backdrop-blur-sm rounded">
                  <div className="flex flex-col items-center gap-2">
                      <WifiOff className="w-8 h-8 text-rose-500" />
                      <span className="text-sm font-bold text-white uppercase tracking-wider">Total Internet Block</span>
                      <span className="text-xs text-zinc-400">All traffic is blocked in this mode.</span>
                  </div>
              </div>
          )}

          <div>
              <div className="flex items-center justify-between gap-4 mb-2">
                  <div>
                      <div className="text-[10px] font-bold text-zinc-500 uppercase">Blocked Categories</div>
                      {categoryGlobalToggle?.value && (
                          <div className="text-[10px] text-zinc-600 mt-1">Using global categories (edit in Filtering → Categories)</div>
                      )}
                  </div>
                  {categoryGlobalToggle && (
                      <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold text-zinc-500">Use global blocked categories</span>
                          <div
                              onClick={categoryGlobalToggle.onToggle}
                              className={`w-10 h-5 rounded-full relative cursor-pointer transition-colors ${categoryGlobalToggle.value ? 'bg-emerald-600' : 'bg-zinc-700'}`}
                              title={categoryGlobalToggle.value ? 'Global' : 'Custom'}
                          >
                              <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${categoryGlobalToggle.value ? 'right-0.5' : 'left-0.5'}`}></div>
                          </div>
                      </div>
                  )}
              </div>

              <div className={`grid grid-cols-2 sm:grid-cols-3 gap-2 ${categoryGlobalToggle?.value ? 'opacity-40 pointer-events-none' : ''}`}>
                  {CATEGORIES_SORTED.map(cat => {
                      const isSelected = currentCats.includes(cat.id);
                      const Icon = cat.icon;
                      return (
                          <div
                              key={cat.id}
                              onClick={() => !isBlockedAll && onCatToggle(cat.id)}
                              className={`flex items-center gap-2 p-2 rounded cursor-pointer border transition-all ${
                                  isSelected
                                  ? 'bg-rose-950/20 border-rose-500/50 text-rose-400'
                                  : 'bg-[#09090b] border-[#27272a] text-zinc-400 hover:border-zinc-500'
                              }`}
                          >
                              <Icon className="w-3.5 h-3.5" />
                              <span className="text-[10px] font-bold">{cat.label}</span>
                          </div>
                      );
                  })}
              </div>
          </div>
          <div>
              <div className="pt-4 border-t border-[#27272a]">
                  <div className="flex items-center justify-between gap-4 mb-2">
                      <div>
                          <div className="text-[10px] font-bold text-zinc-500 uppercase">Blocked Applications</div>
                          {appGlobalToggle?.value && (
                              <div className="text-[10px] text-zinc-600 mt-1">Using global apps (edit in Filtering → Apps)</div>
                          )}
                      </div>
                      {appGlobalToggle && (
                          <div className="flex items-center gap-2">
                              <span className="text-[10px] font-bold text-zinc-500">Use global blocked apps</span>
                              <div
                                  onClick={appGlobalToggle.onToggle}
                                  className={`w-10 h-5 rounded-full relative cursor-pointer transition-colors ${appGlobalToggle.value ? 'bg-emerald-600' : 'bg-zinc-700'}`}
                                  title={appGlobalToggle.value ? 'Global' : 'Custom'}
                              >
                                  <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${appGlobalToggle.value ? 'right-0.5' : 'left-0.5'}`}></div>
                              </div>
                          </div>
                      )}
                  </div>

                  <div className={`max-h-56 overflow-y-auto pr-1 ${appGlobalToggle?.value ? 'opacity-40 pointer-events-none' : ''}`}>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          {APPS_SORTED.map(app => {
                              const isSelected = currentApps.includes(app.id);
                              return (
                                  <div
                                      key={app.id}
                                      onClick={() => !isBlockedAll && onAppToggle(app.id)}
                                      className={`flex items-center gap-2 p-2 rounded cursor-pointer border transition-all ${
                                          isSelected
                                          ? 'bg-orange-950/20 border-orange-500/50 text-orange-400'
                                          : 'bg-[#09090b] border-[#27272a] text-zinc-400 hover:border-zinc-500'
                                      }`}
                                  >
                                      <AppLogo app={app.id} label={app.label} size={14} />
                                      <span className="text-[10px] font-bold">{app.label}</span>
                                  </div>
                              );
                          })}
                      </div>
                  </div>
              </div>
          </div>
      </div>
  );

  const getStatusBadge = (client: ClientProfile) => {
      if (client.isInternetPaused) {
          return (
             <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/30 text-rose-400 text-[10px] font-bold uppercase animate-pulse">
                <WifiOff className="w-3 h-3" />
                <span>INTERNET PAUSED</span>
             </div>
          );
      }
      const hasSleepSchedule = client.schedules.find(s => s.active && (s.mode === 'sleep' || s.mode === 'total_block'));
      if (hasSleepSchedule) {
          return (
             <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 text-[10px] font-bold uppercase">
                <Moon className="w-3 h-3" />
                <span>Sleep Schedule</span>
             </div>
          );
      }
      return null;
  };

  return (
        <div className={`space-y-6 animate-fade-in ${selectedClient ? 'xl:pr-[520px]' : ''}`}>
      {/* Header & Controls */}
      <div className="flex flex-col gap-6">
        <div className="flex justify-between items-end">
           <div>
              <h2 className="text-xl font-bold text-white tracking-tight">Access Control</h2>
              <p className="text-zinc-500 text-sm mt-1">Manage policies for devices and network segments.</p>
           </div>
           {/* Context-Aware Add Button */}
           <button 
                         onClick={openCreateModal}
             className="btn-primary flex items-center gap-2 px-4 py-2 rounded text-xs shadow-lg transition-transform hover:scale-105"
           >
               <Plus className="w-3.5 h-3.5" /> 
               {activeView === 'devices' ? 'ADD DEVICE' : 'ADD NETWORK'}
           </button>
        </div>
        
        <div className="flex flex-col sm:flex-row justify-between gap-4 border-b border-[#27272a]">
            {/* View Tabs (match Filtering-style tab bar) */}
            <div className="flex gap-1">
                <button
                    onClick={() => setActiveView('devices')}
                    className={`flex items-center gap-2 px-4 py-2.5 text-xs font-medium border-b-2 transition-all ${
                        activeView === 'devices'
                            ? 'border-emerald-500 text-white bg-[#18181b]'
                            : 'border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-[#18181b]/50'
                    }`}
                >
                    <Smartphone className="w-3.5 h-3.5" />
                    Individual Devices
                </button>
                <button
                    onClick={() => setActiveView('networks')}
                    className={`flex items-center gap-2 px-4 py-2.5 text-xs font-medium border-b-2 transition-all ${
                        activeView === 'networks'
                            ? 'border-emerald-500 text-white bg-[#18181b]'
                            : 'border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-[#18181b]/50'
                    }`}
                >
                    <Network className="w-3.5 h-3.5" />
                    Networks & Subnets
                </button>
            </div>

            {/* Search */}
            <div className="relative mb-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
              <input 
                type="text" 
                placeholder={activeView === 'devices' ? "Search MAC / IP / Name" : "Search CIDR / VLAN Name"}
                className="bg-[#18181b] border border-[#27272a] text-zinc-300 pl-9 pr-4 py-1.5 rounded text-xs font-mono focus:outline-none focus:border-zinc-500 w-64 placeholder:text-zinc-600"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {filteredClients.map(client => {
            const isOffline = client.isInternetPaused;
            const isSubnet = client.isSubnet || client.type === 'subnet';
            
            return (
          <div 
            key={client.id} 
                        onClick={() => { setSelectedClient(client); setModalSection('overview'); setEditingScheduleId(null); }}
            className={`dashboard-card p-0 rounded-lg group overflow-hidden cursor-pointer transition-all ${
                isOffline ? 'border-rose-900/50 bg-rose-950/5' : 
                'hover:border-zinc-500'
            }`}
          >
            <div className="p-5 flex justify-between items-start">
              <div className="flex items-start gap-4">
                <div className={`p-2.5 rounded border ${client.status === 'online' ? 'bg-[#18181b] border-[#27272a] text-zinc-200' : 'bg-[#18181b] border-[#27272a] text-zinc-600'}`}>
                  {getIcon(client.type)}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white mb-1 flex items-center gap-2">
                    {client.name}
                    {client.status === 'online' && !isOffline && <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></div>}
                    {isOffline && <WifiOff className="w-3.5 h-3.5 text-rose-500" />}
                  </h3>
                  <div className="flex flex-col gap-0.5">
                     {isSubnet ? (
                        <span className="text-[11px] font-mono text-zinc-500 flex items-center gap-1.5">
                           <span className="text-zinc-700">CIDR</span> {client.cidr}
                        </span>
                     ) : (
                        <>
                           {client.ip && <span className="text-[11px] font-mono text-zinc-500 flex items-center gap-1.5">
                             <span className="text-zinc-700">IP</span> {client.ip}
                           </span>}
                           {client.mac && <span className="text-[11px] font-mono text-zinc-500 flex items-center gap-1.5">
                             <span className="text-zinc-700">MAC</span> {client.mac}
                           </span>}
                        </>
                     )}
                  </div>
                </div>
              </div>
              
                            <div className="flex flex-col items-end gap-2">
                                    <div className="flex items-center gap-1">
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                openEditClient(client);
                                            }}
                                            className="p-1.5 rounded text-zinc-500 hover:text-white hover:bg-[#18181b]"
                                            title="Edit policy"
                                        >
                                            <Pencil className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleDeleteClient(client);
                                            }}
                                            className="p-1.5 rounded text-zinc-500 hover:text-rose-300 hover:bg-[#18181b]"
                                            title="Delete policy"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                    {getStatusBadge(client)}
                            </div>
            </div>

            <div className="bg-[#121214] border-t border-[#27272a] p-3 grid grid-cols-2 gap-px">
               {/* Safe Search */}
               <div className="flex items-center justify-between pr-4 border-r border-[#27272a]/0">
                  <div className="flex items-center gap-2">
                    <GlobeLock className={`w-3.5 h-3.5 ${client.safeSearch ? 'text-emerald-500' : 'text-zinc-600'}`} />
                    <span className="text-xs font-medium text-zinc-400">Safe Search</span>
                  </div>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${client.safeSearch ? 'bg-emerald-950/30 text-emerald-500' : 'text-zinc-600'}`}>
                    {client.safeSearch ? 'ON' : 'OFF'}
                  </span>
               </div>

               {/* Blocklist */}
               <div className="flex items-center justify-between pl-4">
                  <div className="flex items-center gap-2">
                    <Shield className="w-3.5 h-3.5 text-zinc-400" />
                    <span className="text-xs font-medium text-zinc-400">Rules</span>
                  </div>
                  <div className="flex items-center gap-1">
                    {client.useGlobalSettings ? (
                        <span className="text-[10px] font-mono text-zinc-500">GLOBAL</span>
                    ) : (
                      <span className="flex items-center gap-1">
                        <span className="text-[10px] font-bold text-white">{client.assignedBlocklists.length}</span>
                        <span className="text-zinc-600 text-[10px]">lists</span>
                      </span>
                    )}
                  </div>
               </div>
            </div>
          </div>
        )})}
      </div>

      {/* ADD NODE MODAL */}
            <Modal open={showAddModal} onClose={closeAddModal} zIndex={1000}>
              <div className="w-full max-w-md bg-[#09090b] border border-[#27272a] rounded-lg overflow-hidden shadow-2xl animate-fade-in">
                  <div className="p-5 border-b border-[#27272a] flex justify-between items-center bg-[#121214]">
                      <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                          <Plus className="w-4 h-4 text-emerald-500" /> 
                                                    {editingClient
                                                        ? activeView === 'devices'
                                                            ? 'Edit Device'
                                                            : 'Edit Network Segment'
                                                        : activeView === 'devices'
                                                            ? 'Add New Device'
                                                            : 'Add Network Segment'}
                      </h3>
                                            <button onClick={closeAddModal} className="text-zinc-500 hover:text-white"><X className="w-5 h-5" /></button>
                  </div>
                  <div className="p-6 space-y-4">

                      {addNodeError && (
                          <div className="text-xs text-rose-300 bg-rose-950/20 border border-rose-800/30 rounded px-3 py-2">
                              {addNodeError}
                          </div>
                      )}
                      
                      {/* Name Field (Common) */}
                      <div>
                          <label className="block text-[10px] font-bold text-zinc-500 uppercase mb-1.5">Name / Label</label>
                          <input 
                            type="text" 
                            placeholder={activeView === 'devices' ? "e.g. Living Room Xbox" : "e.g. Guest VLAN"}
                            className="w-full bg-[#121214] border border-[#27272a] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
                            value={newNodeData.name}
                            onChange={(e) => setNewNodeData({...newNodeData, name: e.target.value})}
                          />
                      </div>

                      {/* Fields specific to View Type */}
                      {activeView === 'devices' ? (
                          <>
                             {/* Tabs for Add Method */}
                             {!editingClient ? (
                               <div className="flex gap-1 border-b border-[#27272a] mb-4">
                                  <button
                                      onClick={() => setAddMode('manual')}
                                      className={`flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium border-b-2 transition-all ${
                                          addMode === 'manual'
                                              ? 'border-emerald-500 text-white bg-[#18181b]'
                                              : 'border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-[#18181b]/50'
                                      }`}
                                  >
                                      MANUAL ENTRY
                                  </button>
                                  <button
                                      onClick={() => setAddMode('scan')}
                                      className={`flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium border-b-2 transition-all ${
                                          addMode === 'scan'
                                              ? 'border-emerald-500 text-white bg-[#18181b]'
                                              : 'border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-[#18181b]/50'
                                      }`}
                                  >
                                      DISCOVERED
                                  </button>
                               </div>
                             ) : (
                               <div className="text-[10px] font-bold text-zinc-500 uppercase mb-4">
                                 Manual Entry
                               </div>
                             )}

                             {addMode === 'manual' && (
                                 <div className="bg-[#18181b] border border-[#27272a] rounded p-4 space-y-4 animate-fade-in">
                                    <div className="text-[10px] font-bold text-zinc-500 uppercase flex items-center gap-2">
                                        <Fingerprint className="w-3.5 h-3.5" /> Identification Method
                                    </div>
                                    <p className="text-[10px] text-zinc-500 leading-relaxed">
                                        Sentinel detects devices by matching identifying information in the request. 
                                        Provide the MAC (Layer 2) or IP (Layer 3) assigned by your router.
                                    </p>
                                    
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1.5">MAC Address</label>
                                            <input 
                                                type="text" 
                                                placeholder="AA:BB:CC:11:22:33"
                                                className="w-full bg-[#09090b] border border-[#27272a] rounded px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-emerald-500 placeholder:text-zinc-700"
                                                value={newNodeData.mac}
                                                onChange={(e) => setNewNodeData({...newNodeData, mac: e.target.value})}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-[10px] font-bold text-zinc-400 uppercase mb-1.5">IP Address (Identifier)</label>
                                            <input 
                                                type="text" 
                                                placeholder="192.168.1.50"
                                                className="w-full bg-[#09090b] border border-[#27272a] rounded px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-emerald-500 placeholder:text-zinc-700"
                                                value={newNodeData.ip}
                                                onChange={(e) => setNewNodeData({...newNodeData, ip: e.target.value})}
                                            />
                                        </div>
                                    </div>
                                </div>
                             )}

                             {addMode === 'scan' && (
                                 <div className="space-y-2 animate-fade-in max-h-[200px] overflow-y-auto pr-1">
                                     <div className="flex justify-between items-center text-xs text-zinc-500 mb-2">
                                         <span>Discovered from recent DNS activity</span>
                                         <button
                                             onClick={loadDiscovered}
                                             className="inline-flex items-center gap-2 text-[10px] font-bold text-zinc-400 hover:text-white"
                                             disabled={discoveredLoading}
                                             title="Refresh"
                                         >
                                             <RefreshCw className={`w-3 h-3 ${discoveredLoading ? 'animate-spin' : ''}`} />
                                             Refresh
                                         </button>
                                     </div>

                                     {discoveredError && (
                                         <div className="text-[10px] text-rose-400 border border-rose-900/50 bg-rose-950/20 rounded p-2">
                                             {discoveredError}
                                         </div>
                                     )}

                                     {discoveredLoading && discovered.length === 0 ? (
                                         <div className="text-center py-8 text-zinc-600 border border-dashed border-[#27272a] rounded">
                                             <Search className="w-6 h-6 mx-auto mb-2 opacity-20" />
                                             <div className="text-xs">Discovering…</div>
                                         </div>
                                     ) : discovered.length === 0 ? (
                                         <div className="text-center py-8 text-zinc-600 border border-dashed border-[#27272a] rounded">
                                             <Search className="w-6 h-6 mx-auto mb-2 opacity-20" />
                                             <div className="text-xs">No clients discovered yet.</div>
                                             <div className="text-[10px] text-zinc-700 mt-1">Generate some DNS traffic, or configure reverse DNS in Local DNS → Client Discovery.</div>
                                         </div>
                                     ) : (
                                         <div className="space-y-2">
                                             {discovered.map((d) => (
                                                 <button
                                                     key={d.ip}
                                                     onClick={() => handleSelectDiscovered({ ip: d.ip, hostname: d.hostname || d.ip, mac: '', type: 'smartphone' })}
                                                     className="w-full text-left px-3 py-2 rounded border border-[#27272a] bg-[#121214] hover:bg-[#18181b] hover:border-zinc-500 transition-colors"
                                                 >
                                                     <div className="flex items-center justify-between gap-3">
                                                         <div className="flex flex-col">
                                                             <span className="text-xs text-zinc-200 font-mono">{d.hostname || d.ip}</span>
                                                             <span className="text-[10px] text-zinc-600 font-mono">{d.ip}</span>
                                                         </div>
                                                         <span className="text-[10px] text-zinc-500">ADD</span>
                                                     </div>
                                                 </button>
                                             ))}
                                         </div>
                                     )}
                                 </div>
                             )}
                            
                            <div className="mt-4">
                                <label className="block text-[10px] font-bold text-zinc-500 uppercase mb-1.5">Device Type</label>
                                <div className="grid grid-cols-4 gap-2">
                                    {['smartphone', 'laptop', 'game', 'tv'].map(icon => (
                                        <div 
                                            key={icon} 
                                            onClick={() => setNewNodeData({...newNodeData, deviceIcon: icon})}
                                            className={`p-2 rounded border cursor-pointer flex justify-center items-center ${newNodeData.deviceIcon === icon ? 'bg-emerald-950/30 border-emerald-500 text-emerald-500' : 'bg-[#121214] border-[#27272a] text-zinc-500 hover:border-zinc-500'}`}
                                        >
                                            {getIcon(icon)}
                                        </div>
                                    ))}
                                </div>
                            </div>
                          </>
                      ) : (
                          <div>
                              <label className="block text-[10px] font-bold text-zinc-500 uppercase mb-1.5">CIDR Range</label>
                              <input 
                                type="text" 
                                placeholder="192.168.20.0/24"
                                className="w-full bg-[#121214] border border-[#27272a] rounded px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
                                value={newNodeData.cidr}
                                onChange={(e) => setNewNodeData({...newNodeData, cidr: e.target.value})}
                              />
                              <p className="text-[10px] text-zinc-600 mt-1">All IPs within this range will inherit this policy.</p>
                          </div>
                      )}
                  </div>
                  <div className="p-5 border-t border-[#27272a] bg-[#121214] flex justify-end gap-3">
                      <button onClick={closeAddModal} className="px-4 py-2 rounded text-xs font-bold text-zinc-400 hover:text-white">CANCEL</button>
                      <button 
                        onClick={() => void handleAddNode()}
                                                disabled={!newNodeData.name || (activeView === 'networks' && !newNodeData.cidr.trim())}
                        className="btn-primary px-6 py-2 rounded text-xs flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                          <Save className="w-3.5 h-3.5" /> {editingClient ? 'SAVE CHANGES' : 'SAVE'}
                      </button>
                  </div>
              </div>
      </Modal>

            {/* CLIENT/NETWORK DETAILS POPUP (center modal) */}
            <Modal
                open={!!selectedClient}
                onClose={() => setSelectedClient(null)}
                zIndex={1100}
            >
                {selectedClient ? (
                    <div
                        className={`w-full max-w-5xl max-h-[90vh] rounded-xl overflow-hidden shadow-2xl bg-[#09090b] border ${
                            selectedClient.isInternetPaused ? 'border-rose-900' : 'border-[#27272a]'
                        }`}
                    >
                    <div className="h-full max-h-[90vh] flex flex-col overflow-hidden">
                    {/* Header */}
                    <div className="p-5 border-b border-[#27272a] bg-[#121214] flex items-start justify-between gap-6">
                        <div className="flex items-start gap-4 min-w-0">
                            <div className={`w-11 h-11 rounded border flex items-center justify-center flex-shrink-0 ${selectedClient.isInternetPaused ? 'bg-rose-950/30 border-rose-900/60' : 'bg-[#18181b] border-[#27272a]'}`}>
                                {getIcon(selectedClient.type)}
                            </div>
                            <div className="min-w-0">
                                <div className="flex items-center gap-3 min-w-0">
                                    <h2 className="text-base font-bold text-white truncate">{selectedClient.name}</h2>
                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded border border-[#27272a] bg-[#09090b] text-zinc-400 uppercase flex-shrink-0">
                                        {selectedClient.type === 'subnet' ? 'Network' : 'Device'}
                                    </span>
                                </div>
                                <div className="mt-1 flex items-center gap-3 flex-wrap">
                                    <div className="text-[11px] text-zinc-500 font-mono bg-[#09090b] border border-[#27272a] rounded px-2 py-0.5">
                                        {selectedClient.cidr || selectedClient.ip || 'DHCP'}
                                    </div>
                                    {clientSaveMsg ? (
                                        <span
                                            className={`inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-bold tracking-tight transition-opacity duration-500 ${
                                                clientSaveFading ? 'opacity-0' : 'opacity-100'
                                            } ${
                                                clientSaveMsg.startsWith('Saving')
                                                    ? 'bg-amber-950/20 text-amber-300 border-amber-700/40'
                                                    : clientSaveMsg.startsWith('Saved')
                                                        ? 'bg-emerald-950/20 text-emerald-300 border-emerald-700/40'
                                                        : 'bg-rose-950/20 text-rose-300 border-rose-700/40'
                                            }`}
                                        >
                                            {clientSaveMsg}
                                        </span>
                                    ) : null}
                                </div>
                                <div className="mt-2 text-xs text-zinc-500">
                                    Per-client settings override global settings for this device/network.
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0">
                            <button
                                onClick={toggleInternetPause}
                                className={`flex items-center gap-2 px-4 py-1.5 rounded text-xs font-bold border transition-all ${
                                    selectedClient.isInternetPaused
                                        ? 'bg-rose-600 text-white border-rose-500 shadow-[0_0_15px_rgba(225,29,72,0.4)]'
                                        : 'bg-[#18181b] border-[#27272a] text-zinc-400 hover:text-rose-500 hover:border-rose-900'
                                }`}
                            >
                                {selectedClient.isInternetPaused ? (
                                    <Play className="w-3.5 h-3.5 fill-current" />
                                ) : (
                                    <Pause className="w-3.5 h-3.5 fill-current" />
                                )}
                                {selectedClient.isInternetPaused ? 'RESUME INTERNET' : 'PAUSE INTERNET'}
                            </button>
                            <button
                                onClick={() => setSelectedClient(null)}
                                className="p-2 rounded border border-[#27272a] bg-[#18181b] text-zinc-400 hover:text-white hover:bg-[#27272a] transition-colors"
                                title="Close"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    {/* Tabs (match Global Filtering pages) */}
                    <div className="border-b border-[#27272a] flex gap-1">
                        {[
                            { id: 'overview', label: 'Overview', icon: Sliders },
                            { id: 'rules', label: 'Policy & Rules', icon: Filter },
                            { id: 'schedules', label: 'Schedules', icon: Calendar }
                        ].map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setModalSection(tab.id as any)}
                                className={`flex items-center gap-2 px-4 py-2.5 text-xs font-medium border-b-2 transition-all ${
                                    modalSection === tab.id
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
                    <div className="flex-1 overflow-y-auto p-6 bg-[#09090b]">
                        {modalSection === 'overview' && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-fade-in">
                                <div className="p-6 rounded-lg bg-[#121214] border border-[#27272a]">
                                    <div className="flex items-center gap-3 mb-4">
                                        <div className="relative">
                                            <div className={`w-3 h-3 rounded-full ${selectedClient.status === 'online' ? 'bg-emerald-500' : 'bg-zinc-600'}`}></div>
                                            {selectedClient.status === 'online' && <div className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-75"></div>}
                                        </div>
                                        <span className="text-sm font-bold text-zinc-200">Connection Status</span>
                                    </div>
                                    <div className="space-y-3">
                                        <div className="flex justify-between text-xs border-b border-[#27272a] pb-2">
                                            <span className="text-zinc-500">Last Seen</span>
                                            <span className="text-zinc-300">Just now</span>
                                        </div>
                                        <div className="flex justify-between text-xs border-b border-[#27272a] pb-2">
                                            <span className="text-zinc-500">Queries (24h)</span>
                                            <span className="text-zinc-300 font-mono">1,240</span>
                                        </div>
                                        <div className="flex justify-between text-xs">
                                            <span className="text-zinc-500">Block Rate</span>
                                            <span className="text-rose-500 font-mono">12%</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="p-6 rounded-lg bg-[#121214] border border-[#27272a] flex flex-col justify-center items-center text-center">
                                    <h3 className="text-xs font-bold text-zinc-500 uppercase mb-2">Current Policy</h3>
                                    <div className="text-xl font-bold text-white mb-1">{selectedClient.policy}</div>
                                    <button 
                                        onClick={() => setModalSection('rules')}
                                        className="text-[10px] text-indigo-400 hover:text-indigo-300 font-bold mt-2 flex items-center gap-1"
                                    >
                                        EDIT RULES <ChevronDown className="w-3 h-3 -rotate-90" />
                                    </button>
                                </div>
                            </div>
                        )}
                        {/* Reuse existing sections 'rules' and 'schedules' with handleUpdateClient wrapper */}
                        {modalSection === 'rules' && (
                            <div className={`space-y-8 animate-fade-in ${selectedClient.isInternetPaused ? 'opacity-50 pointer-events-none grayscale' : ''}`}>
                                <div>
                                    <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-4">Global Protections</h3>
                                    <div className="p-4 bg-[#18181b] border border-[#27272a] rounded flex items-center justify-between">
                                        <div className="flex items-center gap-4">
                                            <div className={`p-2 rounded-lg ${selectedClient.safeSearch ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-800 text-zinc-500'}`}>
                                                <Youtube className="w-5 h-5" />
                                            </div>
                                            <div>
                                                <div className="text-sm font-bold text-zinc-200">Force SafeSearch</div>
                                                <div className="text-[10px] text-zinc-500 mt-1 max-w-[400px]">
                                                    Enforces Google SafeSearch, Bing Strict Mode, and YouTube Restricted Mode via DNS CNAME rewrites.
                                                </div>
                                            </div>
                                        </div>
                                        <div 
                                            onClick={toggleSafeSearch}
                                            className={`w-10 h-5 rounded-full relative cursor-pointer transition-colors ${selectedClient.safeSearch ? 'bg-emerald-600' : 'bg-zinc-700'}`}
                                        >
                                            <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${selectedClient.safeSearch ? 'right-0.5' : 'left-0.5'}`}></div>
                                        </div>
                                    </div>
                                </div>

                                <div>
                                    <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-4">Blocklists</h3>
                                    <div className="p-4 bg-[#18181b] border border-[#27272a] rounded space-y-4">
                                        <div className="flex items-center justify-between gap-4">
                                            <div>
                                                <div className="text-sm font-bold text-zinc-200">Use Global Blocklists</div>
                                                <div className="text-[10px] text-zinc-500 mt-1">
                                                    If disabled, this client uses exactly the selected lists (can include lists that are globally disabled).
                                                </div>
                                            </div>
                                            <div
                                                onClick={() => setClientBlocklistsMode(!selectedClient.useGlobalSettings)}
                                                className={`w-10 h-5 rounded-full relative cursor-pointer transition-colors ${selectedClient.useGlobalSettings ? 'bg-emerald-600' : 'bg-zinc-700'}`}
                                                title={selectedClient.useGlobalSettings ? 'Global' : 'Custom'}
                                            >
                                                <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${selectedClient.useGlobalSettings ? 'right-0.5' : 'left-0.5'}`}></div>
                                            </div>
                                        </div>

                                        {blocklistsError && (
                                            <div className="text-[10px] text-rose-400">{blocklistsError}</div>
                                        )}

                                        {selectedClient.useGlobalSettings ? (
                                            <div className="flex items-center justify-between text-xs">
                                                <div className="text-zinc-500">Currently active (global)</div>
                                                <div className="text-zinc-200 font-mono">{globalEnabledBlocklistIds.length} lists</div>
                                            </div>
                                        ) : (
                                            <>
                                                <div className="flex items-center gap-2">
                                                    <div className="relative flex-1">
                                                        <Search className="w-4 h-4 text-zinc-600 absolute left-3 top-1/2 -translate-y-1/2" />
                                                        <input
                                                            value={blocklistSearch}
                                                            onChange={(e) => setBlocklistSearch(e.target.value)}
                                                            placeholder="Search blocklists…"
                                                            className="w-full bg-[#09090b] border border-[#27272a] rounded px-9 py-2 text-xs text-white focus:outline-none focus:border-zinc-500"
                                                        />
                                                    </div>
                                                    <button
                                                        onClick={() => handleUpdateClient({ ...selectedClient, assignedBlocklists: globalEnabledBlocklistIds, useGlobalSettings: false })}
                                                        className="text-[10px] font-bold px-3 py-2 rounded bg-[#09090b] border border-[#27272a] text-zinc-300 hover:text-white"
                                                        title="Start from global enabled lists"
                                                    >
                                                        USE GLOBAL
                                                    </button>
                                                </div>

                                                <div className="max-h-[240px] overflow-y-auto pr-1 space-y-2">
                                                    {blocklistsOnly
                                                        .filter((b) => {
                                                            const q = blocklistSearch.trim().toLowerCase();
                                                            if (!q) return true;
                                                            return b.name.toLowerCase().includes(q) || b.id.includes(q);
                                                        })
                                                        .map((b) => {
                                                            const selected = (selectedClient.assignedBlocklists || []).includes(b.id);
                                                            const isGlobalDisabled = b.mode === 'DISABLED';
                                                            const isShadow = b.mode === 'SHADOW';
                                                            return (
                                                                <button
                                                                    key={b.id}
                                                                    onClick={() => toggleClientBlocklist(b.id)}
                                                                    className={`w-full flex items-center justify-between px-3 py-2 rounded border text-left transition-colors ${
                                                                        selected ? 'bg-emerald-950/20 border-emerald-700/40' : 'bg-[#09090b] border-[#27272a] hover:bg-[#111113]'
                                                                    }`}
                                                                >
                                                                    <div className="flex items-center gap-3 min-w-0">
                                                                        <div className={`w-4 h-4 rounded border flex items-center justify-center ${selected ? 'bg-emerald-600 border-emerald-500' : 'border-zinc-600'}`}>
                                                                            {selected && <Check className="w-3 h-3 text-white" />}
                                                                        </div>
                                                                        <div className="min-w-0">
                                                                            <div className="text-xs font-bold text-zinc-200 truncate">{b.name}</div>
                                                                            <div className="text-[10px] text-zinc-600 font-mono truncate">{b.id}</div>
                                                                        </div>
                                                                    </div>
                                                                    <div className="flex items-center gap-2 flex-shrink-0">
                                                                        {isShadow && <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-950/30 text-indigo-300 border border-indigo-800/40">SHADOW</span>}
                                                                        {isGlobalDisabled && <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-zinc-900 text-zinc-500 border border-[#27272a]">GLOBAL OFF</span>}
                                                                    </div>
                                                                </button>
                                                            );
                                                        })}

                                                    {blocklistsOnly.length === 0 && (
                                                        <div className="text-[10px] text-zinc-600">
                                                            No blocklists configured yet. Add one in Filtering → Blocklists.
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="flex items-center justify-between text-xs pt-1">
                                                    <div className="text-zinc-500">Selected for this client</div>
                                                    <div className="text-zinc-200 font-mono">{(selectedClient.assignedBlocklists || []).length} lists</div>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>

                                {renderPolicySelector(
                                    (selectedClient.useGlobalCategories === false ? selectedClient.blockedCategories : globalBlockedCategories),
                                    (selectedClient.useGlobalApps === false ? selectedClient.blockedApps : globalBlockedApps),
                                    (id) => {
                                        if (selectedClient.useGlobalCategories !== false) return;
                                        const exists = selectedClient.blockedCategories.includes(id);
                                        const nextCategories = exists
                                            ? selectedClient.blockedCategories.filter((c) => c !== id)
                                            : [...selectedClient.blockedCategories, id];
                                        handleUpdateClient({
                                            ...selectedClient,
                                            blockedCategories: nextCategories
                                        });

                                        const idsForCategory = categoryBlocklistIds.get(id) ?? [];
                                        if (!exists && idsForCategory.length) void ensureBlocklistsEnabledAndRefreshed(idsForCategory);
                                    }, 
                                    (id) => {
                                        if (selectedClient.useGlobalApps !== false) return;
                                        const exists = selectedClient.blockedApps.includes(id);
                                        const idsForApp = appBlocklistIds.get(id) ?? [];
                                        handleUpdateClient({
                                            ...selectedClient,
                                            blockedApps: exists ? selectedClient.blockedApps.filter(a => a !== id) : [...selectedClient.blockedApps, id]
                                        });

                                        if (!exists && idsForApp.length) {
                                            void ensureBlocklistsEnabledAndRefreshed(idsForApp);
                                        }
                                    },
                                    false,
                                    'bg-[#18181b]',
                                    'border-[#27272a]',
                                    {
                                        value: selectedClient.useGlobalCategories !== false,
                                        onToggle: () => handleUpdateClient({ ...selectedClient, useGlobalCategories: selectedClient.useGlobalCategories === false ? true : false })
                                    },
                                    {
                                        value: selectedClient.useGlobalApps !== false,
                                        onToggle: () => handleUpdateClient({ ...selectedClient, useGlobalApps: selectedClient.useGlobalApps === false ? true : false })
                                    }
                                )}
                            </div>
                        )}
                        {/* Schedules */}
                         {modalSection === 'schedules' && (
                             <div className="space-y-6 animate-fade-in">
                                  <div className="flex justify-between items-center mb-4">
                                     <p className="text-xs text-zinc-500">Automatically apply policies based on time of day.</p>
                                     <button onClick={addNewSchedule} className="text-[10px] font-bold bg-indigo-600 text-white px-3 py-1.5 rounded hover:bg-indigo-500 transition-colors">
                                         + NEW SCHEDULE
                                     </button>
                                 </div>
                                 {selectedClient.schedules.map(schedule => (
                                     <div key={schedule.id} className="bg-[#121214] border border-[#27272a] rounded p-4 mb-2 space-y-3">
                                          <div className="flex justify-between items-center gap-3">
                                              <input
                                                  value={schedule.name}
                                                  onChange={(e) => updateScheduleFields(schedule.id, { name: e.target.value })}
                                                  className="bg-transparent border border-transparent focus:border-[#27272a] rounded px-2 py-1 text-sm font-bold text-zinc-200 w-full"
                                              />
                                              <div className="flex items-center gap-1 flex-shrink-0">
                                                  <button
                                                      onClick={() => setEditingScheduleId((prev) => (prev === schedule.id ? null : schedule.id))}
                                                      className="p-1.5 rounded text-zinc-500 hover:text-white hover:bg-[#18181b]"
                                                      title="Edit schedule"
                                                      aria-label={`Edit schedule ${schedule.name}`}
                                                  >
                                                      <Pencil className="w-3.5 h-3.5" />
                                                  </button>
                                                  <button
                                                      onClick={() => setScheduleToDelete(schedule)}
                                                      className="p-1.5 rounded text-zinc-500 hover:text-rose-300 hover:bg-[#18181b]"
                                                      title="Delete schedule"
                                                      aria-label={`Delete schedule ${schedule.name}`}
                                                  >
                                                      <Trash2 className="w-3.5 h-3.5" />
                                                  </button>
                                                  <div
                                                      onClick={() => toggleScheduleActive(schedule.id)}
                                                      className={`w-10 h-5 rounded-full relative cursor-pointer transition-colors flex-shrink-0 ${schedule.active ? 'bg-emerald-600' : 'bg-zinc-700'}`}
                                                  >
                                                      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${schedule.active ? 'right-0.5' : 'left-0.5'}`}></div>
                                                  </div>
                                              </div>
                                          </div>

                                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                              <div className="space-y-1">
                                                  <div className="text-[10px] font-bold text-zinc-500 uppercase">Days</div>
                                                  <div className="flex flex-wrap gap-1">
                                                      {(['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] as const).map((d) => {
                                                          const on = schedule.days.includes(d as any);
                                                          return (
                                                              <button
                                                                  key={d}
                                                                  onClick={() => {
                                                                      const next = on ? schedule.days.filter((x: any) => x !== d) : [...schedule.days, d];
                                                                      updateScheduleFields(schedule.id, { days: next });
                                                                  }}
                                                                  className={`px-2 py-1 rounded text-[10px] font-bold border transition-colors ${on ? 'bg-indigo-950/30 border-indigo-500/40 text-indigo-300' : 'bg-[#09090b] border-[#27272a] text-zinc-500 hover:text-zinc-300'}`}
                                                              >
                                                                  {d}
                                                              </button>
                                                          );
                                                      })}
                                                  </div>
                                              </div>

                                              <div className="space-y-1">
                                                  <div className="text-[10px] font-bold text-zinc-500 uppercase">Time Window</div>
                                                  <div className="flex items-center gap-2">
                                                      <input
                                                          value={schedule.startTime}
                                                          onChange={(e) => updateScheduleFields(schedule.id, { startTime: e.target.value })}
                                                          className="w-24 bg-[#09090b] border border-[#27272a] rounded px-2 py-1 text-xs font-mono text-zinc-200"
                                                      />
                                                      <span className="text-xs text-zinc-600">→</span>
                                                      <input
                                                          value={schedule.endTime}
                                                          onChange={(e) => updateScheduleFields(schedule.id, { endTime: e.target.value })}
                                                          className="w-24 bg-[#09090b] border border-[#27272a] rounded px-2 py-1 text-xs font-mono text-zinc-200"
                                                      />
                                                  </div>
                                                  <div className="text-[10px] text-zinc-600">Use 24h time (e.g. 21:00 → 07:00).</div>
                                              </div>

                                              <div className="space-y-1">
                                                  <div className="text-[10px] font-bold text-zinc-500 uppercase">Mode</div>
                                                  <select
                                                      value={schedule.mode}
                                                      onChange={(e) => updateScheduleMode(schedule.id, e.target.value as any)}
                                                      className="w-full bg-[#09090b] border border-[#27272a] rounded px-2 py-1 text-xs text-zinc-200"
                                                  >
                                                      {SCHEDULE_MODES.map((m) => (
                                                          <option key={m.id} value={m.id}>{m.label}</option>
                                                      ))}
                                                  </select>
                                              </div>
                                          </div>

                                          {(schedule.mode === 'custom' || editingScheduleId === schedule.id) && (
                                              <div className="pt-2">
                                                  {renderPolicySelector(
                                                      schedule.blockedCategories,
                                                      schedule.blockedApps,
                                                      (catId) => {
                                                          const exists = schedule.blockedCategories.includes(catId);
                                                          const next = exists ? schedule.blockedCategories.filter((c: any) => c !== catId) : [...schedule.blockedCategories, catId];
                                                          updateSchedulePolicy(schedule.id, next as any, schedule.blockedApps as any);

                                                          const idsForCategory = categoryBlocklistIds.get(catId as any) ?? [];
                                                          if (!exists && idsForCategory.length) {
                                                              void ensureBlocklistsEnabledAndRefreshed(idsForCategory);
                                                          }
                                                      },
                                                      (appId) => {
                                                          const exists = schedule.blockedApps.includes(appId);
                                                          const next = exists ? schedule.blockedApps.filter((a: any) => a !== appId) : [...schedule.blockedApps, appId];
                                                          updateSchedulePolicy(schedule.id, schedule.blockedCategories as any, next as any);

                                                          const idsForApp = appBlocklistIds.get(appId as any) ?? [];
                                                          if (!exists && idsForApp.length) {
                                                              void ensureBlocklistsEnabledAndRefreshed(idsForApp);
                                                          }
                                                      },
                                                      schedule.blockAll === true,
                                                      'bg-[#121214]',
                                                      'border-[#27272a]'
                                                  )}
                                              </div>
                                          )}
                                     </div>
                                 ))}
                             </div>
                         )}
                    </div>
                    </div>
                </div>
                ) : null}
            </Modal>

      {/* DELETE CONFIRMATION MODAL */}
      {clientToDelete && (
          <Modal open={true} onClose={() => setClientToDelete(null)} zIndex={1200}>
              <div className="w-full max-w-md bg-[#09090b] border border-[#27272a] rounded-lg overflow-hidden shadow-2xl animate-fade-in">
                  <div className="p-5 border-b border-[#27272a] flex justify-between items-center bg-[#121214]">
                      <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                          <Trash2 className="w-4 h-4 text-rose-500" />
                          Delete Client
                      </h3>
                      <button onClick={() => setClientToDelete(null)} className="text-zinc-500 hover:text-white" aria-label="Close">
                          <X className="w-5 h-5" />
                      </button>
                  </div>
                  <div className="p-6 space-y-3">
                      <div className="text-sm text-zinc-200">
                          Delete <span className="font-bold">{clientToDelete.name}</span>?
                      </div>
                      <div className="text-xs text-zinc-500">
                          This removes the client profile and its policy overrides. DNS logs remain unchanged.
                      </div>
                  </div>
                  <div className="p-5 border-t border-[#27272a] bg-[#121214] flex flex-col sm:flex-row justify-end gap-3">
                      <button
                          onClick={() => setClientToDelete(null)}
                          className="px-4 py-2 rounded text-xs font-bold text-zinc-400 hover:text-white"
                      >
                          CANCEL
                      </button>
                      <button
                          onClick={confirmDeleteClient}
                          className="px-6 py-2 rounded text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white"
                      >
                          DELETE
                      </button>
                  </div>
              </div>
          </Modal>
      )}

      {/* DELETE SCHEDULE CONFIRMATION MODAL */}
      {scheduleToDelete && selectedClient && (
          <Modal open={true} onClose={() => setScheduleToDelete(null)} zIndex={1200}>
              <div className="w-full max-w-md bg-[#09090b] border border-[#27272a] rounded-lg overflow-hidden shadow-2xl animate-fade-in">
                  <div className="p-5 border-b border-[#27272a] flex justify-between items-center bg-[#121214]">
                      <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                          <Trash2 className="w-4 h-4 text-rose-500" />
                          Delete Schedule
                      </h3>
                      <button onClick={() => setScheduleToDelete(null)} className="text-zinc-500 hover:text-white" aria-label="Close">
                          <X className="w-5 h-5" />
                      </button>
                  </div>
                  <div className="p-6 space-y-3">
                      <div className="text-sm text-zinc-200">
                          Delete <span className="font-bold">{scheduleToDelete.name}</span>?
                      </div>
                      <div className="text-xs text-zinc-500">
                          This removes the schedule from <span className="font-bold">{selectedClient.name}</span>. You can recreate it anytime.
                      </div>
                  </div>
                  <div className="p-5 border-t border-[#27272a] bg-[#121214] flex flex-col sm:flex-row justify-end gap-3">
                      <button
                          onClick={() => setScheduleToDelete(null)}
                          className="px-4 py-2 rounded text-xs font-bold text-zinc-400 hover:text-white"
                      >
                          CANCEL
                      </button>
                      <button
                          onClick={confirmDeleteSchedule}
                          className="px-6 py-2 rounded text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white"
                      >
                          DELETE
                      </button>
                  </div>
              </div>
          </Modal>
      )}
    </div>
  );
};

export default Clients;