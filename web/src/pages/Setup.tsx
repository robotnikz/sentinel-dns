import React, { useEffect, useMemo, useState } from 'react';

type AuthStatus = { configured: boolean };
type AuthMe = { loggedIn: boolean; username?: string };

export default function Setup(props: { onDone: () => void }): React.ReactElement {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [me, setMe] = useState<AuthMe | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    Promise.all([
      fetch('/api/auth/status', { credentials: 'include' }).then((r) => r.json()),
      fetch('/api/auth/me', { credentials: 'include' }).then((r) => r.json()).catch(() => ({ loggedIn: false }))
    ])
      .then(([statusRes, meRes]) => {
        setStatus({ configured: !!statusRes?.configured });
        setMe({ loggedIn: !!meRes?.loggedIn, username: meRes?.username ? String(meRes.username) : undefined });
      })
      .catch(() => {
        setStatus({ configured: false });
        setMe({ loggedIn: false });
        setError('Backend not reachable.');
      });
  }, []);

  const canSubmit = useMemo(() => {
    if (busy) return false;
    if (!status) return false;
    const u = username.trim();
    if (status.configured) return u.length > 0 && password.length > 0;
    return u.length > 0 && password.length >= 8 && password === password2;
  }, [busy, status, username, password, password2]);

  const submit = async () => {
    setError('');
    setBusy(true);
    try {
      if (status?.configured) {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: username.trim(), password })
        });
        const data = await res.json().catch(() => ({} as any));
        if (!res.ok) {
          setError(data?.message || 'Login failed.');
          return;
        }
        props.onDone();
        return;
      }

      const res = await fetch('/api/auth/setup', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password })
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        setError(data?.message || 'Setup failed.');
        return;
      }
      props.onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#09090b] flex items-center justify-center p-6">
      <div className="w-full max-w-xl bg-[#121214] border border-[#27272a] rounded-xl p-6">
        <div className="text-xs text-zinc-500 font-mono">Sentinel-DNS</div>
        <h1 className="text-xl font-bold text-white mt-1">
          {status?.configured ? 'Login' : 'First-run setup'}
        </h1>
        <p className="text-sm text-zinc-400 mt-2">
          {status?.configured
            ? 'Sign in to manage rules, DNS settings, and API keys.'
            : 'Create an admin user (username + password) to secure this instance.'}
        </p>

        <div className="mt-6 space-y-3">
          <div className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">Username</div>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder={me?.username ? me.username : 'Enter username'}
            className="w-full bg-[#09090b] border border-[#27272a] text-zinc-200 px-3 py-2 rounded text-xs font-mono focus:outline-none focus:border-zinc-500"
          />
        </div>

        {status?.configured ? (
          <div className="mt-6 space-y-3">
            <div className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">Admin Password</div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter admin password"
              className="w-full bg-[#09090b] border border-[#27272a] text-zinc-200 px-3 py-2 rounded text-xs font-mono focus:outline-none focus:border-zinc-500"
            />
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            <div className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">Create Admin Password</div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              className="w-full bg-[#09090b] border border-[#27272a] text-zinc-200 px-3 py-2 rounded text-xs font-mono focus:outline-none focus:border-zinc-500"
            />
            <input
              type="password"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              placeholder="Confirm password"
              className="w-full bg-[#09090b] border border-[#27272a] text-zinc-200 px-3 py-2 rounded text-xs font-mono focus:outline-none focus:border-zinc-500"
            />
          </div>
        )}

        {error ? <div className="mt-4 text-xs text-rose-400">{error}</div> : null}

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            disabled={!canSubmit}
            onClick={submit}
            className={`px-4 py-2 rounded text-xs font-bold border transition-colors ${
              canSubmit
                ? 'bg-white text-black border-white hover:bg-zinc-200'
                : 'bg-[#18181b] text-zinc-500 border-[#27272a] cursor-not-allowed'
            }`}
          >
            {busy ? 'Working…' : status?.configured ? 'Login' : 'Create user'}
          </button>
        </div>
      </div>
    </div>
  );
}
