'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import type { Profile } from '@shared/types';

interface DraftSummary {
  id: string;
  name: string;
  status: string;
  season_id: string;
  role: 'Admin' | 'Member';
  teamName: string | null;
  playerCount: number;
}

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return router.push('/');
      const uid = auth.user.id;

      const { data: prof } = await supabase.from('profiles').select('*').eq('id', uid).single();
      setProfile(prof as Profile);

      const { data: teams } = await supabase
        .from('draft_teams')
        .select('id, team_name, draft_id, drafts(id, name, status, season_id, admin_id), draft_picks(id)')
        .eq('user_id', uid);
      const { data: managed } = await supabase
        .from('drafts')
        .select('id, name, status, season_id')
        .eq('admin_id', uid);

      const list = new Map<string, DraftSummary>();
      (managed ?? []).forEach((d: any) =>
        list.set(d.id, { ...d, role: 'Admin', teamName: null, playerCount: 0 })
      );
      (teams ?? []).forEach((t: any) => {
        if (!t.drafts) return;
        const existing = list.get(t.drafts.id);
        const entry: DraftSummary = {
          id: t.drafts.id,
          name: t.drafts.name,
          status: t.drafts.status,
          season_id: t.drafts.season_id,
          role: t.drafts.admin_id === uid ? 'Admin' : 'Member',
          teamName: t.team_name,
          playerCount: t.draft_picks?.length ?? 0,
        };
        list.set(entry.id, existing ? { ...existing, ...entry } : entry);
      });
      setDrafts([...list.values()]);
      setLoading(false);
    })();
  }, [router]);

  if (loading || !profile) return <div className="p-8 text-center text-slate-400">Loading...</div>;

  const joined = drafts.filter((d) => d.teamName);
  const stats = [
    { label: 'Drafts joined', value: joined.length },
    { label: 'Drafts managed', value: drafts.filter((d) => d.role === 'Admin').length },
    { label: 'Completed drafts', value: joined.filter((d) => d.status === 'completed').length },
    { label: 'Players drafted', value: joined.reduce((n, d) => n + d.playerCount, 0) },
  ];

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-100">{profile.display_name || profile.email}</h1>
          <div className="text-sm text-slate-400">{profile.email}</div>
        </div>
        <div className="flex gap-4 text-sm">
          <Link href="/settings" className="text-ice-300 hover:underline">⚙️ Settings</Link>
          <Link href="/dashboard" className="text-ice-300 hover:underline">← Dashboard</Link>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="bg-rink-card border border-rink-border rounded-xl p-4 text-center">
            <div className="text-2xl font-black text-ice-300">{s.value}</div>
            <div className="text-xs text-slate-400">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="bg-rink-card border border-rink-border rounded-xl divide-y divide-rink-border">
        <div className="p-4 font-bold text-slate-100">My drafts</div>
        {drafts.map((d) => (
          <Link
            key={d.id}
            href={`/drafts/${d.id}/standings`}
            className="flex items-center justify-between gap-3 p-4 hover:bg-rink-dark/50 text-sm"
          >
            <div>
              <div className="text-slate-100 font-semibold">{d.name}</div>
              <div className="text-slate-400">
                {d.role} · {d.teamName ? `Team: ${d.teamName} · ` : ''}Season {d.season_id}
              </div>
            </div>
            <span className="text-xs px-2 py-0.5 rounded-full bg-ice-900 border border-ice-700 text-ice-300">
              {d.status}
            </span>
          </Link>
        ))}
        {drafts.length === 0 && (
          <div className="p-4 text-slate-400 text-sm">You haven't joined any drafts yet.</div>
        )}
      </div>
    </div>
  );
}
