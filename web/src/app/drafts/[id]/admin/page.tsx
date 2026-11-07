'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import type { Draft, DraftTeam, DraftPick, PlayerSalary } from '@shared/types';
import { authHeaders } from '@/lib/clientAuth';
import InvitePanel from '@/components/InvitePanel';
import { teamIndexForPick, roundForPick } from '@shared/draftOrder';

export default function AdminDraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: draftId } = use(params);
  const router = useRouter();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [teams, setTeams] = useState<DraftTeam[]>([]);
  const [picks, setPicks] = useState<DraftPick[]>([]);
  const [salaries, setSalaries] = useState<Map<number, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [salaryWarning, setSalaryWarning] = useState('');
  const [hasSearched, setHasSearched] = useState(false);

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
      const { data: d, error: dErr } = await supabase.from('drafts').select('*').eq('id', draftId).single();
      if (dErr || !d) {
        setLoadError(dErr?.message || 'This draft could not be loaded. It may not exist, or you may not have access.');
        return;
      }
      setLoadError('');
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
        setSalaryWarning('');
        const sj = await salRes.json();
        const smap = new Map<number, number>();
        for (const [pid, cap] of Object.entries(sj.salaries as Record<string, number>)) {
          smap.set(Number(pid), Number(cap));
        }
        setSalaries(smap);
      } else {
        setSalaryWarning(
          'Salaries could not be loaded, so cap hits below may show as $0.00M. Reload the page; if it keeps happening, check the Players page.'
        );
      }
    } catch (err: any) {
      console.error(err);
      setLoadError(`Could not reach the server (${err.message}). Check your connection and try again.`);
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

  // Determine which team picks next (snake or linear, per the draft's setting)
  const totalRounds = draft
    ? draft.forwards_count + draft.defense_count + draft.goalies_count + draft.injured_reserve_count
    : 15;
  const currentPickNumber = picks.length + 1;
  const numTeams = teams.length;
  const orderType = draft?.pick_order_type ?? 'snake';
  const orderLocked = !draft || draft.status !== 'setup' || picks.length > 0;

  const currentRound = roundForPick(numTeams, currentPickNumber);
  const currentTeam: DraftTeam | null = teams[teamIndexForPick(numTeams, currentPickNumber, orderType)] || null;

  const updateOrder = async (payload: Record<string, unknown>) => {
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const res = await fetch(`/api/drafts/${draftId}/order`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Failed to update the pick order');
      await loadDraftData();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  const moveTeam = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= teams.length) return;
    const ids = teams.map((t) => t.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    updateOrder({ action: 'set_order', teamIds: ids });
  };

  const handleRandomize = () => {
    if (teams.length < 2) return;
    if (!confirm('Randomize the pick order? This replaces the current order.')) return;
    updateOrder({ action: 'randomize' });
  };

  // Handle player search
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;
    setSearching(true);
    setErrorMsg('');
    setHasSearched(false);

    let results: any[] = [];
    let nhlSearchFailed = false;
    try {
      // Search from NHL public search API
      const res = await fetch(
        `https://search.d3.nhle.com/api/v1/search/player?culture=en-us&limit=20&q=${encodeURIComponent(q)}&active=true`
      );
      if (!res.ok) throw new Error('Search failed');
      results = (await res.json()) || [];
    } catch {
      nhlSearchFailed = true;
    }

    // Fall back to our own player list, which also includes rostered players with no games played yet
    if (results.length === 0) {
      try {
        const res = await fetch('/api/players', { headers: await authHeaders() });
        if (res.ok) {
          const data = await res.json();
          const needle = q.toLowerCase();
          results = [
            ...(data.skaters || []).map((s: any) => ({
              playerId: s.playerId, name: s.skaterFullName, positionCode: s.positionCode, teamAbbrev: s.teamAbbrevs,
            })),
            ...(data.goalies || []).map((g: any) => ({
              playerId: g.playerId, name: g.goalieFullName, positionCode: 'G', teamAbbrev: g.teamAbbrevs,
            })),
          ]
            .filter((p) => p.name.toLowerCase().includes(needle))
            .slice(0, 20);
          nhlSearchFailed = false;
        }
      } catch {
        // keep the original failure state
      }
    }

    if (nhlSearchFailed && results.length === 0) {
      setErrorMsg(
        "Player search isn't responding right now (the NHL search service may be down or blocked on this network). Try again in a moment."
      );
    }
    setSearchResults(results);
    setHasSearched(!nhlSearchFailed || results.length > 0);
    setSearching(false);
  };

  // Set a missing salary for this draft
  const handleSetSalary = async (player: any) => {
    const input = window.prompt(`Cap hit for ${player.name} in $M (e.g. 0.95):`);
    if (input === null) return;
    const capHit = parseFloat(input);
    if (!Number.isFinite(capHit) || capHit < 0 || capHit >= 10000) {
      setErrorMsg('Enter a valid cap hit in millions, e.g. 0.95');
      return;
    }
    try {
      const res = await fetch(`/api/drafts/${draftId}/salaries`, {
        method: 'PUT',
        headers: await authHeaders(),
        body: JSON.stringify({ playerId: Number(player.playerId), playerName: player.name, capHit }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Failed to save salary');
      setErrorMsg('');
      setSuccessMsg(`Set ${player.name}'s cap hit to $${capHit.toFixed(2)}M.`);
      loadDraftData();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  // Submit pick
  const handleSelectPlayer = async (player: any, confirmNoSalary = false) => {
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
          confirmNoSalary,
        }),
      });

      const json = await res.json();
      if (res.status === 409 && json.code === 'NO_SALARY') {
        setSubmittingPick(false);
        if (window.confirm(`${json.error}\n\nOK = draft at $0.00M. Cancel = go back (use "Set salary" first).`)) {
          return await handleSelectPlayer(player, true);
        }
        return;
      }
      if (!res.ok) throw new Error(json.error || 'Failed to make pick');

      setSuccessMsg(`Picked ${player.name} for ${currentTeam.team_name}!`);
      setSearchQuery('');
      setSearchResults([]);
      setHasSearched(false);
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

  if (loading) {
    return <div className="p-8 text-center text-slate-400">Loading draft console...</div>;
  }

  if (!draft) {
    return (
      <div className="p-8 text-center space-y-3">
        <p className="text-rose-300 text-sm">{loadError || 'This draft could not be loaded.'}</p>
        <button
          onClick={() => { setLoading(true); loadDraftData(); }}
          className="bg-ice-600 hover:bg-ice-500 text-white font-semibold text-xs px-4 py-2 rounded-lg"
        >
          Try again
        </button>
      </div>
    );
  }

  const draftedPlayerIds = new Set(picks.map((p) => p.nhl_player_id));

  const checklist = [
    { done: teams.length >= 2, label: 'Add at least 2 teams', hint: 'Use "+ Add" in the Draft Teams panel.' },
    {
      done: salaries.size > 0,
      label: 'Salaries loaded',
      hint: 'Open the Players page and run "Fetch & Sync Salaries".',
    },
    { done: draft.status !== 'setup' || picks.length > 0, label: 'Draft started', hint: 'Make the first pick.' },
  ];
  const showChecklist = draft.status === 'setup' && checklist.some((c) => !c.done);

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

      {salaryWarning && (
        <div className="p-3 bg-amber-500/10 border border-amber-500/30 text-amber-300 text-sm rounded-lg">
          {salaryWarning}
        </div>
      )}

      {showChecklist && (
        <div className="bg-rink-card border border-rink-border p-4 rounded-xl">
          <h3 className="text-sm font-bold text-slate-100 mb-2">Before you start drafting</h3>
          <ul className="space-y-1 text-xs">
            {checklist.map((c) => (
              <li key={c.label} className={c.done ? 'text-emerald-400' : 'text-slate-300'}>
                {c.done ? '✓' : '○'} {c.label}
                {!c.done && <span className="text-slate-500"> — {c.hint}</span>}
              </li>
            ))}
          </ul>
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

              {hasSearched && !searching && searchResults.length === 0 && (
                <div className="text-xs text-slate-400 bg-rink-dark border border-rink-border rounded-lg p-3">
                  No active players found for &ldquo;{searchQuery}&rdquo;. Try just the last name, or check the
                  spelling. Players who haven&apos;t been added to NHL rosters yet won&apos;t appear.
                </div>
              )}

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
                            <div className="text-xs font-mono mt-0.5">
                              {capHit > 0 ? (
                                <span className="text-emerald-400">Cap: ${capHit.toFixed(2)}M</span>
                              ) : (
                                <span className="text-amber-400">
                                  Salary unknown{' '}
                                  <button
                                    type="button"
                                    onClick={() => handleSetSalary(player)}
                                    className="underline hover:text-amber-300"
                                  >
                                    Set salary
                                  </button>
                                </span>
                              )}
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
                <span className="flex items-center gap-1.5">
                  <span className="text-[10px] text-slate-400">
                    {picks.filter((p) => p.draft_team_id === t.id).length} picks
                  </span>
                  {!orderLocked && teams.length > 1 && (
                    <>
                      <button
                        type="button"
                        onClick={() => moveTeam(idx, -1)}
                        disabled={idx === 0}
                        aria-label={`Move ${t.team_name} up`}
                        className="px-1.5 rounded bg-rink-border hover:bg-slate-600 disabled:opacity-30"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        onClick={() => moveTeam(idx, 1)}
                        disabled={idx === teams.length - 1}
                        aria-label={`Move ${t.team_name} down`}
                        className="px-1.5 rounded bg-rink-border hover:bg-slate-600 disabled:opacity-30"
                      >
                        ▼
                      </button>
                    </>
                  )}
                </span>
              </div>
            ))}
          </div>

          <div className="pt-2 border-t border-rink-border space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Pick order</div>
            <div className="flex bg-rink-dark border border-rink-border rounded-lg p-1 w-fit">
              {(['snake', 'linear'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  disabled={orderLocked}
                  onClick={() => orderType !== type && updateOrder({ action: 'set_type', type })}
                  className={`px-3 py-1.5 rounded-md text-xs font-bold transition disabled:cursor-not-allowed ${
                    orderType === type ? 'bg-ice-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {type === 'snake' ? 'Snake' : 'Standard'}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-500">
              {orderType === 'snake'
                ? 'Snake: 1st→last in odd rounds, last→1st in even rounds.'
                : 'Standard: 1st→last in every round.'}
            </p>
            {!orderLocked ? (
              <button
                type="button"
                onClick={handleRandomize}
                disabled={teams.length < 2}
                className="bg-ice-600 hover:bg-ice-500 disabled:opacity-40 text-white font-semibold text-xs px-3 py-1.5 rounded"
              >
                🎲 Randomize order
              </button>
            ) : (
              <p className="text-[11px] text-amber-300">
                Order is locked once picks start. Undo all picks to change it.
              </p>
            )}
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
