'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import type { Draft, DraftTeam, DraftPick, PlayerSalary } from '@shared/types';
import { authHeaders } from '@/lib/clientAuth';
import InvitePanel from '@/components/InvitePanel';

export default function AdminDraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: draftId } = use(params);
  const router = useRouter();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [teams, setTeams] = useState<DraftTeam[]>([]);
  const [picks, setPicks] = useState<DraftPick[]>([]);
  const [salaries, setSalaries] = useState<Map<number, number>>(new Map());
  const [loading, setLoading] = useState(true);

  // Player search & selection state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [submittingPick, setSubmittingPick] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Team creation state
  const [newTeamName, setNewTeamName] = useState('');

  const loadDraftData = async () => {
    try {
      // 1. Fetch draft
      const { data: d } = await supabase.from('drafts').select('*').eq('id', draftId).single();
      if (!d) return;
      setDraft(d as Draft);

      // 2. Fetch teams
      const { data: t } = await supabase
        .from('draft_teams')
        .select('*')
        .eq('draft_id', draftId)
        .order('draft_order', { ascending: true });
      if (t) setTeams(t as DraftTeam[]);

      // 3. Fetch picks
      const { data: p } = await supabase
        .from('draft_picks')
        .select('*')
        .eq('draft_id', draftId)
        .order('pick_number', { ascending: true });
      if (p) setPicks(p as DraftPick[]);

      // 4. Fetch salaries (locked snapshot once the draft has started)
      const salRes = await fetch(`/api/drafts/${draftId}/salaries`, { headers: await authHeaders() });
      if (salRes.ok) {
        const sj = await salRes.json();
        const smap = new Map<number, number>();
        for (const [pid, cap] of Object.entries(sj.salaries as Record<string, number>)) {
          smap.set(Number(pid), Number(cap));
        }
        setSalaries(smap);
      }
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDraftData();

    // Subscribe to realtime pick changes
    const channel = supabase
      .channel(`draft-${draftId}-admin`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'draft_picks', filter: `draft_id=eq.${draftId}` },
        () => {
          loadDraftData();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'draft_teams', filter: `draft_id=eq.${draftId}` },
        () => {
          loadDraftData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [draftId]);

  // Determine which team picks next based on snake order
  const totalRounds = draft
    ? draft.forwards_count + draft.defense_count + draft.goalies_count + draft.injured_reserve_count
    : 15;
  const currentPickNumber = picks.length + 1;
  const numTeams = teams.length;

  let currentTeam: DraftTeam | null = null;
  let currentRound = 1;

  if (numTeams > 0) {
    currentRound = Math.floor((currentPickNumber - 1) / numTeams) + 1;
    const pickInRound = (currentPickNumber - 1) % numTeams;
    const isReverseRound = currentRound % 2 === 0;
    const teamIndex = isReverseRound ? numTeams - 1 - pickInRound : pickInRound;
    currentTeam = teams[teamIndex] || null;
  }

  // Handle player search
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setSearching(true);
    setErrorMsg('');

    try {
      const gameType = draft?.season_type === 'playoffs' ? '3' : '2';
      // Search from NHL public search API
      const res = await fetch(
        `https://search.d3.nhle.com/api/v1/search/player?culture=en-us&limit=20&q=${encodeURIComponent(
          searchQuery.trim()
        )}&active=true`
      );
      if (!res.ok) throw new Error('Search failed');
      const results = await res.json();
      setSearchResults(results || []);
    } catch (err: any) {
      setErrorMsg('Error searching NHL players: ' + err.message);
    } finally {
      setSearching(false);
    }
  };

  // Submit pick
  const handleSelectPlayer = async (player: any) => {
    if (!currentTeam || !draft) return;
    setSubmittingPick(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const playerId = Number(player.playerId);

      const res = await fetch(`/api/drafts/${draftId}/picks`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({
          action: 'make_pick',
          teamId: currentTeam.id,
          pickNumber: currentPickNumber,
          nhlPlayerId: playerId,
          playerName: player.name,
          position: player.positionCode || 'F',
          team: player.teamAbbrev || 'NHL',
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to make pick');

      setSuccessMsg(`Picked ${player.name} for ${currentTeam.team_name}!`);
      setSearchQuery('');
      setSearchResults([]);
      loadDraftData();
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setSubmittingPick(false);
    }
  };

  // Undo last pick
  const handleUndoPick = async () => {
    if (picks.length === 0) return;
    if (!confirm('Are you sure you want to undo the last pick?')) return;
    setErrorMsg('');

    try {
      const res = await fetch(`/api/drafts/${draftId}/picks`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ action: 'undo_pick' }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to undo pick');
      loadDraftData();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  // Finalize draft
  const handleFinalizeDraft = async () => {
    if (!confirm('Are you ready to finalize this draft? This will lock the rosters and activate scoring.')) {
      return;
    }

    try {
      const res = await fetch(`/api/drafts/${draftId}/picks`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ action: 'finalize_draft' }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to finalize');
      loadDraftData();
      alert('Draft finalized successfully! Standings and active scoring are now live.');
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  // Add manual team
  const handleAddTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTeamName.trim()) return;

    try {
      const nextOrder = teams.length + 1;
      const { error } = await supabase.from('draft_teams').insert({
        draft_id: draftId,
        team_name: newTeamName.trim(),
        draft_order: nextOrder,
      });

      if (error) throw error;
      setNewTeamName('');
      loadDraftData();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  if (loading || !draft) {
    return <div className="p-8 text-center text-slate-400">Loading draft console...</div>;
  }

  const draftedPlayerIds = new Set(picks.map((p) => p.nhl_player_id));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-rink-card border border-rink-border p-6 rounded-xl">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black text-slate-100">{draft.name}</h1>
            <span className="text-xs px-2.5 py-0.5 rounded font-bold uppercase tracking-wider bg-ice-900 border border-ice-700 text-ice-300">
              {draft.status}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Invite Code: <span className="font-mono font-bold text-ice-300">{draft.invite_code}</span> •{' '}
            {draft.season_type === 'regular' ? 'Regular Season' : 'Playoffs'}
            {draft.salary_cap_enabled && ` • Cap: $${draft.salary_cap_amount}M`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push(`/drafts/${draftId}`)}
            className="bg-rink-dark hover:bg-rink-border border border-rink-border text-slate-200 px-4 py-2 rounded-lg text-xs font-semibold transition"
          >
            📺 View Live Board
          </button>
          {draft.status !== 'confirmed' && (
            <button
              onClick={handleFinalizeDraft}
              className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-xs font-bold transition shadow"
            >
              🏁 Confirm & Finalize Draft
            </button>
          )}
        </div>
      </div>

      {errorMsg && (
        <div className="p-3 bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm rounded-lg">
          {errorMsg}
        </div>
      )}
      {successMsg && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm rounded-lg">
          {successMsg}
        </div>
      )}

      {/* Invites and templates */}
      <InvitePanel draft={draft} />

      {/* Draft Pick Input / On-the-clock Banner */}
      {draft.status !== 'confirmed' && (
        <div className="bg-gradient-to-r from-ice-950 via-rink-card to-rink-card border border-ice-600/40 p-6 rounded-xl space-y-4 shadow-xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-ice-400">
                Round {currentRound} • Pick #{currentPickNumber}
              </span>
              <h2 className="text-xl md:text-2xl font-black text-slate-100 mt-0.5">
                On The Clock: <span className="text-rink-accent">{currentTeam ? currentTeam.team_name : 'No Teams'}</span>
              </h2>
            </div>
            {picks.length > 0 && (
              <button
                onClick={handleUndoPick}
                className="bg-rose-950/60 hover:bg-rose-900/60 border border-rose-700/50 text-rose-300 px-3 py-1.5 rounded text-xs font-semibold transition self-start sm:self-auto"
              >
                ↩ Undo Last Pick
              </button>
            )}
          </div>

          {numTeams === 0 ? (
            <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 p-3 rounded">
              Add at least 2 teams below before making picks!
            </div>
          ) : (
            <div className="space-y-4">
              <form onSubmit={handleSearch} className="flex gap-2">
                <input
                  type="text"
                  placeholder="Search player to draft (e.g. McDavid, Makar, Shesterkin)..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="flex-1 bg-rink-dark border border-rink-border rounded-lg px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-rink-accent"
                />
                <button
                  type="submit"
                  disabled={searching}
                  className="bg-ice-600 hover:bg-ice-500 text-white font-semibold px-5 py-2.5 rounded-lg text-sm transition"
                >
                  {searching ? 'Searching...' : 'Search'}
                </button>
              </form>

              {/* Search Results Drawer */}
              {searchResults.length > 0 && (
                <div className="bg-rink-dark border border-rink-border rounded-lg max-h-72 overflow-y-auto divide-y divide-rink-border/50">
                  {searchResults.map((player: any) => {
                    const pId = Number(player.playerId);
                    const isDrafted = draftedPlayerIds.has(pId);
                    const capHit = salaries.get(pId) || 0;

                    return (
                      <div
                        key={pId}
                        className={`p-3 flex items-center justify-between transition ${
                          isDrafted ? 'opacity-40 bg-slate-900' : 'hover:bg-slate-800/60'
                        }`}
                      >
                        <div>
                          <div className="font-bold text-sm text-slate-100 flex items-center gap-2">
                            <span>{player.name}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-ice-300 font-mono">
                              {player.positionCode}
                            </span>
                            <span className="text-xs text-slate-400">{player.teamAbbrev}</span>
                          </div>
                          {draft.salary_cap_enabled && (
                            <div className="text-xs font-mono text-emerald-400 mt-0.5">
                              Cap: ${capHit.toFixed(2)}M
                            </div>
                          )}
                        </div>
                        <button
                          disabled={isDrafted || submittingPick}
                          onClick={() => handleSelectPlayer(player)}
                          className={`text-xs font-bold px-4 py-2 rounded transition ${
                            isDrafted
                              ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                              : 'bg-ice-600 hover:bg-ice-500 text-white shadow'
                          }`}
                        >
                          {isDrafted ? 'Drafted' : 'Draft Player'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Grid: Teams & Live Picks Log */}
      <div className="grid md:grid-cols-3 gap-6">
        {/* Teams List & Add Team */}
        <div className="bg-rink-card border border-rink-border p-5 rounded-xl space-y-4">
          <h3 className="font-bold text-slate-100 text-base flex items-center justify-between">
            <span>Draft Teams ({teams.length})</span>
          </h3>

          <div className="space-y-2 max-h-80 overflow-y-auto">
            {teams.map((t, idx) => (
              <div
                key={t.id}
                className={`p-2.5 rounded border text-xs flex items-center justify-between ${
                  currentTeam?.id === t.id
                    ? 'border-rink-accent bg-rink-accent/10 font-bold text-slate-100'
                    : 'border-rink-border bg-rink-dark/60 text-slate-300'
                }`}
              >
                <span>
                  #{idx + 1}. {t.team_name}
                </span>
                <span className="text-[10px] text-slate-400">
                  {picks.filter((p) => p.draft_team_id === t.id).length} picks
                </span>
              </div>
            ))}
          </div>

          {draft.status === 'setup' && (
            <form onSubmit={handleAddTeam} className="pt-2 border-t border-rink-border flex gap-2">
              <input
                type="text"
                placeholder="Team name..."
                value={newTeamName}
                onChange={(e) => setNewTeamName(e.target.value)}
                className="flex-1 bg-rink-dark border border-rink-border rounded px-3 py-1.5 text-xs text-slate-100"
              />
              <button
                type="submit"
                className="bg-ice-600 hover:bg-ice-500 text-white font-semibold text-xs px-3 py-1.5 rounded"
              >
                + Add
              </button>
            </form>
          )}
        </div>

        {/* Picks Feed */}
        <div className="md:col-span-2 bg-rink-card border border-rink-border p-5 rounded-xl space-y-4">
          <h3 className="font-bold text-slate-100 text-base">
            Draft Picks Log ({picks.length})
          </h3>

          <div className="space-y-2 max-h-96 overflow-y-auto">
            {picks.length === 0 ? (
              <div className="text-xs text-slate-500 py-8 text-center">No picks drafted yet.</div>
            ) : (
              [...picks].reverse().map((pick) => {
                const team = teams.find((t) => t.id === pick.draft_team_id);
                return (
                  <div
                    key={pick.id}
                    className="p-3 bg-rink-dark/70 border border-rink-border rounded flex items-center justify-between text-xs"
                  >
                    <div>
                      <span className="font-mono text-slate-400 mr-2">#{pick.pick_number}</span>
                      <span className="font-bold text-slate-100 mr-2">{pick.player_name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-ice-300 mr-2">
                        {pick.player_position}
                      </span>
                      <span className="text-slate-400">{pick.player_team}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-ice-300 font-semibold">{team?.team_name}</span>
                      {draft.salary_cap_enabled && (
                        <span className="ml-2 font-mono text-emerald-400">
                          ${Number(pick.cap_hit).toFixed(2)}M
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
