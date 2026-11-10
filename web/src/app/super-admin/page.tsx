'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { authHeaders } from '@/lib/clientAuth';

interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  subscription_tier: string;
  is_super_admin: boolean;
}
interface DraftRow {
  id: string;
  name: string;
  status: string;
  season_id: string;
  teamCount: number;
  adminEmail: string;
  adminName: string | null;
}

export default function SuperAdminPage() {
  const [tab, setTab] = useState<'users' | 'drafts'>('users');
  const [users, setUsers] = useState<UserRow[]>([]);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [denied, setDenied] = useState(false);

  const loadUsers = async (search = q) => {
    const res = await fetch(`/api/super-admin/users?q=${encodeURIComponent(search)}`, {
      headers: await authHeaders(),
    });
    if (res.status === 404 || res.status === 401) return setDenied(true);
    const json = await res.json();
    if (!res.ok) return setError(json.error);
    setUsers(json.users);
  };

  const loadDrafts = async () => {
    const res = await fetch('/api/super-admin/drafts', { headers: await authHeaders() });
    const json = await res.json();
    if (res.ok) setDrafts(json.drafts);
    else setError(json.error);
  };

  useEffect(() => {
    loadUsers('');
    loadDrafts();
  }, []);

  const setTier = async (userId: string, tier: string) => {
    setError('');
    const res = await fetch('/api/super-admin/users', {
      method: 'PATCH',
      headers: await authHeaders(),
      body: JSON.stringify({ userId, tier }),
    });
    const json = await res.json();
    if (!res.ok) setError(json.error);
    loadUsers();
  };

  if (denied) return <div className="p-8 text-center text-slate-400">Page not found.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black text-slate-100">🛡️ Meta-Admin</h1>
        <Link href="/dashboard" className="text-sm text-ice-300 hover:underline">← Dashboard</Link>
      </div>

      <div className="flex gap-2">
        {(['users', 'drafts'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold border ${
              tab === t ? 'bg-ice-600 border-ice-500 text-white' : 'border-rink-border text-slate-300'
            }`}
          >
            {t === 'users' ? 'Users' : 'All Drafts'}
          </button>
        ))}
      </div>

      {error && <div className="text-rose-400 text-sm">{error}</div>}

      {tab === 'users' && (
        <div className="space-y-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              loadUsers();
            }}
            className="flex gap-2"
          >
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by email or name"
              className="flex-1 bg-rink-dark border border-rink-border rounded-lg px-3 py-2 text-sm text-slate-100"
            />
            <button className="bg-ice-600 text-white px-4 py-2 rounded-lg text-sm font-semibold">Search</button>
          </form>
          <div className="bg-rink-card border border-rink-border rounded-xl divide-y divide-rink-border">
            {users.map((u) => (
              <div key={u.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                <div>
                  <div className="text-slate-100 font-semibold">
                    {u.display_name || u.email} {u.is_super_admin && '🛡️'}
                  </div>
                  <div className="text-slate-400">{u.email}</div>
                </div>
                {u.is_super_admin ? (
                  <span className="text-amber-300">Meta-Admin</span>
                ) : (
                  <select
                    value={u.subscription_tier}
                    onChange={(e) => setTier(u.id, e.target.value)}
                    className="bg-rink-dark border border-rink-border rounded-lg px-2 py-1 text-slate-100"
                  >
                    <option value="free">Free member</option>
                    <option value="admin_basic">Admin (3 drafts per season)</option>
                    <option value="admin_top">Admin Pro (15 drafts per season)</option>
                  </select>
                )}
              </div>
            ))}
            {users.length === 0 && <div className="p-4 text-slate-400 text-sm">No users found.</div>}
          </div>
        </div>
      )}

      {tab === 'drafts' && (
        <div className="bg-rink-card border border-rink-border rounded-xl divide-y divide-rink-border">
          {drafts.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-3 p-3 text-sm">
              <div>
                <div className="text-slate-100 font-semibold">{d.name}</div>
                <div className="text-slate-400">
                  Admin: {d.adminName || d.adminEmail} · {d.teamCount} teams · {d.status} · {d.season_id}
                </div>
              </div>
              <div className="flex gap-3">
                <Link href={`/drafts/${d.id}`} className="text-ice-300 hover:underline">Standings</Link>
                <Link href={`/drafts/${d.id}/admin`} className="text-amber-300 hover:underline">Manage</Link>
              </div>
            </div>
          ))}
          {drafts.length === 0 && <div className="p-4 text-slate-400 text-sm">No drafts yet.</div>}
        </div>
      )}
    </div>
  );
}
