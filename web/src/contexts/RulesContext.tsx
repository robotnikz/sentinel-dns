import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { getAuthHeaders } from '../services/apiClient';

export interface CustomRule {
  id: string;
  domain: string;
  type: 'BLOCKED' | 'ALLOWED';
  category: string;
  addedAt: string;
}

interface RulesContextType {
  rules: CustomRule[];
  addRule: (domain: string, type: 'BLOCKED' | 'ALLOWED', category?: string) => Promise<void>;
  removeRule: (id: string) => Promise<void>;
}

const RulesContext = createContext<RulesContextType | undefined>(undefined);

export const RulesProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [rules, setRules] = useState<CustomRule[]>([]);

  const isImportedRuleCategory = (category: unknown): boolean => {
    const c = String(category ?? '').trim().toLowerCase();
    return c.startsWith('blocklist:') || c.startsWith('category:') || c.startsWith('app:');
  };

  useEffect(() => {
    let cancelled = false;

    fetch('/api/rules')
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        const items = Array.isArray(data?.items) ? data.items : [];
        const mapped: CustomRule[] = items
          .filter((row: any) => !isImportedRuleCategory(row?.category))
          .map((row: any) => ({
          id: String(row.id),
          domain: String(row.domain ?? ''),
          type: row.type === 'ALLOWED' ? 'ALLOWED' : 'BLOCKED',
          category: String(row.category ?? 'Manual'),
          addedAt: row.created_at ? new Date(row.created_at).toLocaleString() : 'Imported'
        }))
          .filter(r => r.domain);

        setRules(mapped);
      })
      .catch(() => {
        // Keep empty state if backend not reachable.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const addRule = async (domain: string, type: 'BLOCKED' | 'ALLOWED', category: string = 'Manual') => {
    // Prevent duplicates
    if (rules.some(r => r.domain === domain)) return;

    try {
      const res = await fetch('/api/rules', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify({ domain, type, category })
      });

      if (res.ok) {
        const row = await res.json();
        const newRule: CustomRule = {
          id: String(row.id),
          domain: String(row.domain ?? domain),
          type: row.type === 'ALLOWED' ? 'ALLOWED' : 'BLOCKED',
          category: String(row.category ?? category),
          addedAt: row.created_at ? new Date(row.created_at).toLocaleString() : 'Just now'
        };
        setRules(prev => [newRule, ...prev]);
        return;
      }
    } catch {
      // ignore and fall back to local
    }

    const newRule: CustomRule = {
      id: `local-${Date.now()}`,
      domain,
      type,
      category,
      addedAt: 'Just now'
    };
    setRules(prev => [newRule, ...prev]);
  };

  const removeRule = async (id: string) => {
    setRules(prev => prev.filter(r => r.id !== id));

    // Best-effort backend delete; if it fails, we keep UI responsive.
    if (!id.startsWith('local-')) {
      try {
        await fetch(`/api/rules/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: {
            ...getAuthHeaders()
          }
        });
      } catch {
        // ignore
      }
    }
  };

  return (
    <RulesContext.Provider value={{ rules, addRule, removeRule }}>
      {children}
    </RulesContext.Provider>
  );
};

export const useRules = () => {
  const context = useContext(RulesContext);
  if (context === undefined) {
    throw new Error('useRules must be used within a RulesProvider');
  }
  return context;
};