'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import { authHeaders } from '@/lib/clientAuth';
import TeamStylePicker from '@/components/TeamStylePicker';
import { normalizePositionGroup } from '@shared/roster-validation';
import type { Draft, DraftTeam, DraftPick, RosterTransaction } from '@shared/types';

export default function TeamRosterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: draftId } = use(params);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [team, setTeam] = useState<DraftTeam | null>(null);
  const [roster, setRoster] = useState<DraftPick[]>([]);
  const [pendingTx, setPendingTx] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  // Selected for swap
  const [selectedActiveIds, setSelectedActiveIds] = useState<string[]>([]);
  const [selectedIrIds, setSelectedIrIds] = useState<string[]>([]);
  const [submittingSwap, setSubmittingSwap] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<{ text: string; isError: boolean } | null>(null);

  const loadData = async () => {
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uId = auth?.user?.id || null;
      setUserId(uId);

      // 1. Fetch draft
      const { data: d } = await supabase.from('drafts').select('*').eq('id', draftId).single();
      if (!d) return;
      setDraft(d as Draft);

      // 2. Fetch user team (or first team if testing/admin)
      let tQuery = supabase.from('draft_teams').select('*').eq('draft_id', draftId);
      if (uId) {
        tQuery = tQuery.eq('user_id', uId);
      }
      const { data: userTeams } = await tQuery;
      const currentTeam = userTeams && userTeams.length > 0 ? userTeams[0] : null;

      if (currentTeam) {
        setTeam(currentTeam as DraftTeam);

        // 3. Fetch team picks
        const { data: p } = await supabase
          .from('draft_picks')
          .select('*')
          .eq('draft_team_id', currentTeam.id)
          .order('pick_number');
        if (p) setRoster(p as DraftPick[]);

        // 4. Fetch pending transactions
        const { data: tx } = await supabase
          .from('roster_transactions')
          .select('*, roster_transaction_players(draft_pick_id, to_status, draft_picks(*))')
          .eq('draft_team_id', currentTeam.id)
          .eq('status', 'pending');
        if (tx) setPendingTx(tx);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [draftId]);

  const activePicks = roster.filter((p) => p.roster_status === 'active');
  const irPicks = roster.filter((p) => p.roster_status === 'ir');

  // Multi-player selection toggles
  const toggleActiveSelect = (id: string) => {
    setSelectedActiveIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleIrSelect = (id: string) => {
    setSelectedIrIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  // Parity checks
  const outgoingCounts = { F: 0, D: 0, G: 0 };
  const incomingCounts = { F: 0, D: 0, G: 0 };

  for (const id of selectedActiveIds) {
    const p = roster.find((x) => x.id === id);
    if (p) outgoingCounts[normalizePositionGroup(p.player_position)]++;
  }
  for (const id of selectedIrIds) {
    const p = roster.find((x) => x.id === id);
    if (p) incomingCounts[normalizePositionGroup(p.player_position)]++;
  }

  const isCountEqual =
    selectedActiveIds.length > 0 && selectedActiveIds.length === selectedIrIds.length;
  const isParityMatching =
    isCountEqual &&
    outgoingCounts.F === incomingCounts.F &&
    outgoingCounts.D === incomingCounts.D &&
    outgoingCounts.G === incomingCounts.G;

  // Projected Cap Hit
  const currentActiveCap = activePicks.reduce((sum, p) => sum + Number(p.cap_hit || 0), 0);
  const outgoingCap = selectedActiveIds.reduce((sum, id) => {
    const p = roster.find((x) => x.id === id);
    return sum + Number(p?.cap_hit || 0);
  }, 0);
  const incomingCap = selectedIrIds.reduce((sum, id) => {
    const p = roster.find((x) => x.id === id);
    return sum + Number(p?.cap_hit || 0);
  }, 0);

  const projectedCap = currentActiveCap - outgoingCap + incomingCap;
  const isCapCompliant =
    !draft?.salary_cap_enabled ||
    projectedCap <= Number(draft.salary_cap_amount || 88.0) + 0.0001;

  const canSubmit = isParityMatching && isCapCompliant;

  const handleScheduleSwap = async () => {
    if (!canSubmit || !team) return;
    setSubmittingSwap(true);
    setFeedbackMsg(null);

    try {
      const res = await fetch(`/api/drafts/${draftId}/roster/swap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({
          teamId: team.id,
          outgoingActivePickIds: selectedActiveIds,
          incomingIrPickIds: selectedIrIds,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to schedule swap');

      setFeedbackMsg({
        text: `Swap scheduled successfully! It will take effect at midnight Eastern Time.`,
        isError: false,
      });
      setSelectedActiveIds([]);
      setSelectedIrIds([]);
      loadData();
    } catch (err: any) {
      setFeedbackMsg({ text: err.message, isError: true });
    } finally {
      setSubmittingSwap(false);
    }
  };

  const handleCancelPending = async (txId: string) => {
    try {
      const res = await fetch(
        `/api/drafts/${draftId}/roster/swap?transactionId=${encodeURIComponent(txId)}`,
        { method: 'DELETE', headers: await authHeaders() }
      );
      if (!res.ok) throw new Error('Failed to cancel');
      loadData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  if (loading || !draft) {
    return <div className="p-8 text-center text-slate-400">Loading your team roster...</div>;
  }

  if (!team) {
    return (
      <div className="bg-rink-card border border-rink-border p-8 rounded-xl text-center space-y-4">
        <h2 className="text-xl font-bold">No Team Found</h2>
        <p className="text-sm text-slate-400">
          You don't have a team in this draft pool yet. Use the invite code{' '}
          <span className="font-mono text-ice-300 font-bold">{draft.invite_code}</span> to join.
        </p>
        <Link
          href={`/dashboard?join=${draft.invite_code}`}
          className="inline-block bg-ice-600 hover:bg-ice-500 text-white font-semibold px-4 py-2 rounded text-sm"
        >
          Join Draft Pool
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-rink-card border border-rink-border p-6 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4 shadow">
        <div>
          <span className="text-xs uppercase font-semibold text-ice-400 tracking-wider">
            {draft.name}
          </span>
          <h1 className="text-2xl font-black text-slate-100">{team.team_name}</h1>
          <div className="flex items-center gap-4 mt-2 text-xs text-slate-400">
            <span>
              Active: {activePicks.length} / {draft.forwards_count + draft.defense_count + draft.goalies_count}
            </span>
            <span>
              IR: {irPicks.length} / {draft.injured_reserve_count}
            </span>
            {draft.salary_cap_enabled && (
              <span className="font-mono text-emerald-400 font-semibold">
                Cap: ${currentActiveCap.toFixed(2)}M / ${draft.salary_cap_amount}M
              </span>
            )}
          </div>
          {userId === team.user_id && (
            <TeamStylePicker
              draftId={draftId}
              initialColor={(team as any).team_color ?? null}
              initialIcon={(team as any).team_icon ?? null}
            />
          )}
        </div>

        <div className="flex items-center gap-2">
          <Link
            href={`/drafts/${draftId}`}
            className="bg-rink-dark hover:bg-rink-border border border-rink-border text-slate-200 px-4 py-2 rounded-lg text-xs font-semibold transition"
          >
            Draft Board
          </Link>
          <Link
            href={`/drafts/${draftId}/standings`}
            className="bg-ice-600 hover:bg-ice-500 text-white px-4 py-2 rounded-lg text-xs font-semibold transition"
          >
            🏆 Standings
          </Link>
        </div>
      </div>

      {feedbackMsg && (
        <div
          className={`p-4 rounded-xl text-sm border ${
            feedbackMsg.isError
              ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
              : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
          }`}
        >
          {feedbackMsg.text}
        </div>
      )}

      {/* Pending Swaps Banner */}
      {pendingTx.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 p-4 rounded-xl space-y-2">
          <div className="flex items-center gap-2 text-amber-300 font-bold text-sm">
            <span>⏳</span> Scheduled Swaps Pending Next Eastern Midnight
          </div>
          {pendingTx.map((tx) => (
            <div
              key={tx.id}
              className="bg-rink-dark/80 p-3 rounded border border-amber-500/20 flex items-center justify-between text-xs"
            >
              <div>
                <span className="text-slate-300">
                  Takes effect at: {new Date(tx.effective_at).toLocaleString()}
                </span>
              </div>
              <button
                onClick={() => handleCancelPending(tx.id)}
                className="text-xs text-rose-400 hover:text-rose-300 underline font-semibold"
              >
                Cancel Swap
              </button>
            </div>
          ))}
        </div>
      )}

      {/* IR Swap Staging Bar (Always visible when players selected) */}
      {(selectedActiveIds.length > 0 || selectedIrIds.length > 0) && (
        <div className="bg-gradient-to-r from-ice-950 via-rink-card to-rink-card border border-rink-accent p-5 rounded-xl space-y-4 shadow-xl">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h3 className="font-bold text-slate-100 text-sm">
                Multi-Player IR Swap Staging
              </h3>
              <p className="text-xs text-slate-400">
                Swapping: {selectedActiveIds.length} Active ⇄ {selectedIrIds.length} IR
              </p>
            </div>

            <div className="flex items-center gap-4 text-xs font-mono">
              <div
                className={`px-3 py-1.5 rounded border ${
                  isParityMatching
                    ? 'bg-emerald-950/60 border-emerald-600 text-emerald-300'
                    : 'bg-amber-950/60 border-amber-600 text-amber-300'
                }`}
              >
                Positions: Out ({outgoingCounts.F}F, {outgoingCounts.D}D, {outgoingCounts.G}G) ⇄ In (
                {incomingCounts.F}F, {incomingCounts.D}D, {incomingCounts.G}G){' '}
                {isParityMatching ? '✓' : '✗'}
              </div>

              {draft.salary_cap_enabled && (
                <div
                  className={`px-3 py-1.5 rounded border ${
                    isCapCompliant
                      ? 'bg-emerald-950/60 border-emerald-600 text-emerald-300'
                      : 'bg-rose-950/60 border-rose-600 text-rose-300'
                  }`}
                >
                  Projected Cap: ${projectedCap.toFixed(2)}M / ${draft.salary_cap_amount}M{' '}
                  {isCapCompliant ? '✓' : '✗'}
                </div>
              )}
            </div>

            <button
              disabled={!canSubmit || submittingSwap}
              onClick={handleScheduleSwap}
              className={`font-bold text-xs px-5 py-2.5 rounded-lg transition shadow ${
                canSubmit
                  ? 'bg-gradient-to-r from-ice-600 to-ice-500 hover:from-ice-500 hover:to-ice-400 text-white'
                  : 'bg-slate-800 text-slate-500 cursor-not-allowed'
              }`}
            >
              {submittingSwap ? 'Scheduling...' : 'Confirm Swap for Midnight'}
            </button>
          </div>
        </div>
      )}

      {/* Main Roster Grid: Active vs IR */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Active Roster */}
        <div className="bg-rink-card border border-rink-border p-5 rounded-xl space-y-4">
          <div className="flex items-center justify-between border-b border-rink-border pb-3">
            <h2 className="font-bold text-slate-100 flex items-center gap-2">
              <span>⚡</span> Active Roster ({activePicks.length})
            </h2>
            <span className="text-[11px] text-slate-400">Select players to move to IR</span>
          </div>

          <div className="space-y-2">
            {activePicks.map((pick) => {
              const isSelected = selectedActiveIds.includes(pick.id);
              return (
                <div
                  key={pick.id}
                  onClick={() => toggleActiveSelect(pick.id)}
                  className={`p-3 rounded-lg border text-xs flex items-center justify-between cursor-pointer transition select-none ${
                    isSelected
                      ? 'bg-ice-950 border-rink-accent shadow-sm'
                      : 'bg-rink-dark/60 border-rink-border hover:border-slate-600'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => {}}
                      className="rounded bg-rink-dark border-rink-border text-ice-500 pointer-events-none"
                    />
                    <div>
                      <div className="font-bold text-slate-100 flex items-center gap-2">
                        <span>{pick.player_name}</span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-ice-300 font-mono">
                          {pick.player_position}
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-400">{pick.player_team}</span>
                    </div>
                  </div>

                  <div className="text-right">
                    {draft.salary_cap_enabled && (
                      <span className="font-mono text-emerald-400 block font-semibold">
                        ${Number(pick.cap_hit).toFixed(2)}M
                      </span>
                    )}
                    <span className="text-[10px] text-slate-500">Pick #{pick.pick_number}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Injured Reserve (IR) */}
        <div className="bg-rink-card border border-rink-border p-5 rounded-xl space-y-4">
          <div className="flex items-center justify-between border-b border-rink-border pb-3">
            <h2 className="font-bold text-slate-100 flex items-center gap-2">
              <span>🩹</span> Injured Reserve ({irPicks.length} / {draft.injured_reserve_count})
            </h2>
            <span className="text-[11px] text-slate-400">Select players to activate</span>
          </div>

          <div className="space-y-2">
            {irPicks.length === 0 ? (
              <div className="text-xs text-slate-500 py-12 text-center border border-dashed border-rink-border/50 rounded-lg">
                No players on IR.
              </div>
            ) : (
              irPicks.map((pick) => {
                const isSelected = selectedIrIds.includes(pick.id);
                return (
                  <div
                    key={pick.id}
                    onClick={() => toggleIrSelect(pick.id)}
                    className={`p-3 rounded-lg border text-xs flex items-center justify-between cursor-pointer transition select-none ${
                      isSelected
                        ? 'bg-emerald-950/60 border-emerald-500 shadow-sm'
                        : 'bg-rink-dark/60 border-rink-border hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {}}
                        className="rounded bg-rink-dark border-rink-border text-emerald-500 pointer-events-none"
                      />
                      <div>
                        <div className="font-bold text-slate-100 flex items-center gap-2">
                          <span>{pick.player_name}</span>
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-ice-300 font-mono">
                            {pick.player_position}
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-400">{pick.player_team}</span>
                      </div>
                    </div>

                    <div className="text-right">
                      {draft.salary_cap_enabled && (
                        <span className="font-mono text-emerald-400 block font-semibold">
                          ${Number(pick.cap_hit).toFixed(2)}M
                        </span>
                      )}
                      <span className="text-[10px] text-amber-400 font-semibold">On IR</span>
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
