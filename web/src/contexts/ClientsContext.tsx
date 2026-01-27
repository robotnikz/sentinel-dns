import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { ClientProfile, Schedule, ScheduleModeType } from '../types';
import { getAuthHeaders } from '../services/apiClient';

interface ClientsContextType {
  clients: ClientProfile[];
  addClient: (client: ClientProfile) => Promise<boolean>;
  updateClient: (client: ClientProfile) => Promise<boolean>;
  removeClient: (id: string) => Promise<boolean>;
  getClientByIp: (ip: string) => ClientProfile | undefined;
}

const ClientsContext = createContext<ClientsContextType | undefined>(undefined);

const normalizeScheduleMode = (value: any): ScheduleModeType => {
  const mode = String(value ?? '').trim();
  if (mode === 'sleep') return 'sleep';
  if (mode === 'homework') return 'homework';
  if (mode === 'total_block') return 'total_block';
  return 'custom';
};

const normalizeSchedules = (value: any): Schedule[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((s) => s && typeof s === 'object')
    .map((s: any): Schedule => ({
      id: String(s.id ?? ''),
      name: String(s.name ?? 'Schedule'),
      days: Array.isArray(s.days) ? (s.days.map((d: any) => String(d)).filter(Boolean) as any) : [],
      startTime: String(s.startTime ?? ''),
      endTime: String(s.endTime ?? ''),
      active: s.active === true,
      mode: normalizeScheduleMode(s.mode),
      blockedCategories: Array.isArray(s.blockedCategories) ? (s.blockedCategories.map((x: any) => String(x)).filter(Boolean) as any) : [],
      blockedApps: Array.isArray(s.blockedApps) ? (s.blockedApps.map((x: any) => String(x)).filter(Boolean) as any) : [],
      blockAll: s.blockAll === true
    }))
    .filter((s) => !!s.id);
};

const mapClient = (row: any): ClientProfile | null => {
  if (!row || typeof row !== 'object') return null;

  const id = typeof row.id === 'string' ? row.id : String(row.id ?? '');
  const name = typeof row.name === 'string' ? row.name : String(row.name ?? '');
  const type = typeof row.type === 'string' ? row.type : '';
  if (!id || !name || !type) return null;

  return {
    id,
    name,
    isSubnet: row.isSubnet === true || type === 'subnet' || typeof row.cidr === 'string',
    cidr: typeof row.cidr === 'string' ? row.cidr : undefined,
    ip: typeof row.ip === 'string' ? row.ip : undefined,
    mac: typeof row.mac === 'string' ? row.mac : undefined,
    type: type as any,
    status: row.status === 'online' ? 'online' : 'offline',
    policy: typeof row.policy === 'string' ? row.policy : 'default',
    safeSearch: row.safeSearch === true,
    assignedBlocklists: Array.isArray(row.assignedBlocklists)
      ? row.assignedBlocklists.map((x: any) => String(x)).filter(Boolean)
      : [],
    useGlobalSettings: row.useGlobalSettings !== false,
    useGlobalCategories: row.useGlobalCategories !== false,
    useGlobalApps: row.useGlobalApps !== false,
    isInternetPaused: row.isInternetPaused === true,
    blockedCategories: Array.isArray(row.blockedCategories) ? (row.blockedCategories.map((x: any) => String(x)).filter(Boolean) as any) : [],
    blockedApps: Array.isArray(row.blockedApps) ? (row.blockedApps.map((x: any) => String(x)).filter(Boolean) as any) : [],
    schedules: normalizeSchedules(row.schedules)
  };
};

export const ClientsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [clients, setClients] = useState<ClientProfile[]>([]);

  const persistClient = async (input: RequestInfo, init: RequestInit): Promise<boolean> => {
    try {
      const res = await fetch(input, { ...init, credentials: 'include' });
      return res.ok;
    } catch {
      return false;
    }
  };

  useEffect(() => {
    let cancelled = false;

    fetch('/api/clients')
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => {
        if (cancelled) return;
        const items = Array.isArray(data?.items) ? data.items : [];
        const mapped: ClientProfile[] = items
          .map((row: any) => mapClient(row))
          .filter((c: ClientProfile | null): c is ClientProfile => !!c);

        setClients(mapped);
      })
      .catch(() => {
        // Keep empty state if backend not reachable.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const addClient = async (client: ClientProfile): Promise<boolean> => {
    const prev = clients;
    setClients((cur) => (cur.some((c) => c.id === client.id) ? cur : [...cur, client]));

    const ok = await persistClient(`/api/clients/${encodeURIComponent(client.id)}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify(client)
      }
    );

    if (!ok) setClients(prev);
    return ok;
  };

  const updateClient = async (updatedClient: ClientProfile): Promise<boolean> => {
    const prev = clients;
    setClients((cur) => cur.map((c) => (c.id === updatedClient.id ? updatedClient : c)));

    const ok = await persistClient(`/api/clients/${encodeURIComponent(updatedClient.id)}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify(updatedClient)
      }
    );

    if (!ok) setClients(prev);
    return ok;
  };

  const removeClient = async (id: string): Promise<boolean> => {
    const prev = clients;
    setClients((cur) => cur.filter((c) => c.id !== id));

    const ok = await persistClient(`/api/clients/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
        headers: {
          ...getAuthHeaders()
        }
      }
    );

    if (!ok) setClients(prev);
    return ok;
  };

  const getClientByIp = (ip: string) => {
      return clients.find(c => c.ip === ip);
  };

  return (
    <ClientsContext.Provider value={{ clients, addClient, updateClient, removeClient, getClientByIp }}>
      {children}
    </ClientsContext.Provider>
  );
};

export const useClients = () => {
  const context = useContext(ClientsContext);
  if (context === undefined) {
    throw new Error('useClients must be used within a ClientsProvider');
  }
  return context;
};