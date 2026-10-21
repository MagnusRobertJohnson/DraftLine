'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import type { Draft, DraftTeam, DraftPick } from '@shared/types';

export default function DraftBoardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: draftId } = use(params);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [teams, setTeams] = useState<DraftTeam[]>([]);
  const [picks, setPicks] = useState<DraftPick[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastDraftedPlayer, setLastDraftedPlayer] = useState<DraftPick | null>(null);

  const loadData = async () => {
    try {
      const { data: d } = await supabase.from('drafts').select('*').eq('id', draftId).single();
      if (!d) return;
      setDraft(d as Draft);

      const { data: t } = await supabase
        .from('draft_teams')
        .select('*')
        .eq('draft_id', draftId)
        .order('draft_order', { ascending: true });
      if (t) setTeams(t as DraftTeam[]);

      const { data: p } = await supabase
        .from('draft_picks')
        .select('*')
        .eq('draft_id', draftId)
        .order('pick_number', { ascending: true });
      if (p) {
        setPicks(p as DraftPick[]);
        if (p.length > 0) {
          setLastDraftedPlayer(p[p.length - 1] as DraftPick);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();

    // Subscribe to live picks
    const channel = supabase
      .channel(`draft-${draftId}-live`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'draft_picks', filter: `draft_id=eq.${draftId}` },
        (payload) => {
          const newPick = payload.new as DraftPick;
          setPicks((prev) => [...prev, newPick]);
          setLastDraftedPlayer(newPick);
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'draft_picks', filter: `draft_id=eq.${draftId}` },
        () => {
          loadData();
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'drafts', filter: `id=eq.${draftId}` },
        (payload) => {
          setDraft(payload.new as Draft);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [draftId]);

  if (loading || !draft) {
    return <div className="p-8 text-center text-slate-400">Connecting to draft board...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-rink-card border border-rink-border p-6 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-lg">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black text-slate-100">{draft.name}</h1>
            <span
              className={`text-xs px-2.5 py-0.5 rounded font-bold uppercase tracking-wider ${
                draft.status === 'confirmed'
                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                  : 'bg-ice-950 text-ice-300 border border-ice-800 animate-pulse'
              }`}
            >
              {draft.status === 'confirmed' ? 'Draft Finalized' : 'Draft Live'}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            {teams.length} Teams • Total Picks: {picks.length}
            {draft.salary_cap_enabled && ` • Cap Limit: $${draft.salary_cap_amount}M`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href={`/drafts/${draftId}/roster`}
            className="bg-rink-accent hover:bg-rink-highlight text-rink-dark px-4 py-2 rounded-lg text-xs font-bold transition shadow"
          >
            🏒 My Team & IR
          </Link>
          <Link
            href={`/drafts/${draftId}/standings`}
            className="bg-ice-600 hover:bg-ice-500 text-white px-4 py-2 rounded-lg text-xs font-bold transition shadow"
          >
            🏆 Standings
          </Link>
        </div>
      </div>

      {/* Latest Pick Alert */}
      {lastDraftedPlayer && draft.status !== 'confirmed' && (
        <div className="bg-gradient-to-r from-ice-950 to-rink-card border border-ice-500/50 p-4 rounded-xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl animate-bounce">🚨</span>
            <div>
              <span className="text-xs uppercase font-semibold text-ice-300">Just Drafted</span>
              <div className="text-base font-black text-slate-100">
                #{lastDraftedPlayer.pick_number} {lastDraftedPlayer.player_name}{' '}
                <span className="text-xs text-slate-400">
                  ({lastDraftedPlayer.player_position} - {lastDraftedPlayer.player_team})
                </span>
              </div>
            </div>
          </div>
          <div className="text-right">
            <span className="text-xs text-slate-400">Team</span>
            <div className="font-bold text-ice-300">
              {teams.find((t) => t.id === lastDraftedPlayer.draft_team_id)?.team_name}
            </div>
          </div>
        </div>
      )}

      {/* Draft Grid / Team Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {teams.map((team, idx) => {
          const teamPicks = picks.filter((p) => p.draft_team_id === team.id);
          const totalCap = teamPicks.reduce((acc, p) => acc + Number(p.cap_hit || 0), 0);

          return (
            <div
              key={team.id}
              className="bg-rink-card border border-rink-border rounded-xl overflow-hidden flex flex-col justify-between shadow"
            >
              <div className="bg-rink-dark/80 p-3.5 border-b border-rink-border flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-slate-400 font-mono">#{idx + 1}</span>
                  <h3 className="font-bold text-slate-100 text-sm truncate max-w-[170px]">
                    {team.team_name}
                  </h3>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-slate-400 block">{teamPicks.length} players</span>
                  {draft.salary_cap_enabled && (
                    <span className="text-xs font-mono font-bold text-emerald-400">
                      ${totalCap.toFixed(2)}M
                    </span>
                  )}
                </div>
              </div>

              {/* Picks list */}
              <div className="p-3 space-y-1.5 flex-1 min-h-[160px] max-h-80 overflow-y-auto">
                {teamPicks.length === 0 ? (
                  <div className="text-[11px] text-slate-500 py-6 text-center">No picks yet</div>
                ) : (
                  teamPicks.map((pick) => (
                    <div
                      key={pick.id}
                      className="p-1.5 rounded bg-rink-dark/50 border border-rink-border/50 flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="text-[10px] font-mono text-slate-500">
                          #{pick.pick_number}
                        </span>
                        <span className="font-medium text-slate-200 truncate">{pick.player_name}</span>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <span className="text-[9px] px-1 py-0.2 rounded bg-slate-800 text-ice-300">
                          {pick.player_position}
                        </span>
                        {draft.salary_cap_enabled && (
                          <span className="text-[10px] font-mono text-slate-400">
                            ${Number(pick.cap_hit).toFixed(1)}M
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
