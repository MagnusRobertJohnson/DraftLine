'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import type { TeamStanding, DraftPick, ScoringWeight, Draft } from '@shared/types';

export default function StandingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: draftId } = use(params);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [standings, setStandings] = useState<TeamStanding[]>([]);
  const [picks, setPicks] = useState<any[]>([]);
  const [weights, setWeights] = useState<ScoringWeight[]>([]);
  const [teamStyles, setTeamStyles] = useState<Record<string, { color: string | null; icon: string | null }>>({});
  const [h2hA, setH2hA] = useState('');
  const [h2hB, setH2hB] = useState('');
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [statsError, setStatsError] = useState(false);

  const loadStandings = async () => {
    try {
      const res = await fetch(`/api/drafts/${draftId}/standings`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load standings');
      if (data.standings) {
        setLoadError('');
        setStatsError(Boolean(data.statsError));
        setStandings(data.standings);
        setDraft(data.draft);
        setPicks(data.picks);
        setWeights(data.weights);
        setTeamStyles(data.teamStyles ?? {});
        if (data.standings.length > 0 && !expandedTeamId) {
          setExpandedTeamId(data.standings[0].teamId);
        }
      }
    } catch (err: any) {
      console.error(err);
      setLoadError(err.message || 'Could not load standings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStandings();
  }, [draftId]);

  const exportCsv = () => {
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const rows = [
      ['Rank', 'Team', 'Owner', 'Active', 'IR', 'Cap Hit', 'Total Points'],
      ...standings.map((s) => [s.rank, s.teamName, s.ownerName, s.activePlayersCount, s.irPlayersCount, s.totalCapHit, s.totalPoints]),
    ];
    const blob = new Blob([rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(draft?.name || 'standings').replace(/[^a-z0-9]+/gi, '-')}-standings.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return <div className="p-8 text-center text-slate-400">Calculating standings...</div>;
  }

  if (!draft) {
    return (
      <div className="p-8 text-center space-y-3">
        <p className="text-rose-300 text-sm">{loadError || 'Standings are not available for this draft.'}</p>
        <button
          onClick={() => { setLoading(true); loadStandings(); }}
          className="bg-ice-600 hover:bg-ice-500 text-white font-semibold text-xs px-4 py-2 rounded-lg"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Banner */}
      <div className="bg-rink-card border border-rink-border p-6 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4 shadow">
        <div>
          <span className="text-xs uppercase font-semibold text-ice-400 tracking-wider">
            {draft.season_type === 'regular' ? 'Regular Season' : 'Playoffs'} Pool
          </span>
          <h1 className="text-2xl font-black text-slate-100 flex items-center gap-2">
            <span>🏆</span> {draft.name} Standings
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Real-time standings based on official NHL statistics and date-stamped roster active time.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={exportCsv}
            className="bg-rink-dark hover:bg-rink-border border border-rink-border text-slate-200 px-4 py-2 rounded-lg text-xs font-semibold transition"
          >
            ⬇ Export CSV
          </button>
          <Link
            href={`/drafts/${draftId}`}
            className="bg-rink-dark hover:bg-rink-border border border-rink-border text-slate-200 px-4 py-2 rounded-lg text-xs font-semibold transition"
          >
            Draft Board
          </Link>
          <Link
            href={`/drafts/${draftId}/chat`}
            className="bg-rink-dark hover:bg-rink-border border border-rink-border text-slate-200 px-4 py-2 rounded-lg text-xs font-semibold transition"
          >
            💬 Chat
          </Link>
          <Link
            href={`/drafts/${draftId}/roster`}
            className="bg-rink-accent hover:bg-rink-highlight text-rink-dark px-4 py-2 rounded-lg text-xs font-bold transition shadow"
          >
            🏒 My Team & IR
          </Link>
        </div>
      </div>

      {(statsError || loadError) && (
        <div className="p-3 bg-amber-500/10 border border-amber-500/30 text-amber-300 text-sm rounded-lg">
          {statsError
            ? 'NHL stats are temporarily unavailable, so the points below may show as 0. Your picks are safe; check back in a few minutes.'
            : `Couldn't refresh standings (${loadError}). Showing the last loaded data.`}
        </div>
      )}

      {/* Standings Table */}
      <div className="bg-rink-card border border-rink-border rounded-xl overflow-hidden shadow">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-rink-dark text-xs uppercase tracking-wider text-slate-400 border-b border-rink-border">
              <tr>
                <th className="py-3 px-4 text-center w-12">Rank</th>
                <th className="py-3 px-4">Team</th>
                <th className="py-3 px-4">Owner</th>
                <th className="py-3 px-4 text-center">Active</th>
                <th className="py-3 px-4 text-center">IR</th>
                {draft.salary_cap_enabled && (
                  <th className="py-3 px-4 text-right">Cap Hit</th>
                )}
                <th className="py-3 px-4 text-right font-bold text-ice-300">Total Points</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rink-border/50">
              {standings.map((st) => {
                const isExpanded = expandedTeamId === st.teamId;
                const teamPicks = picks.filter((p) => p.draft_team_id === st.teamId);

                return (
                  <div key={st.teamId} className="contents">
                    <tr
                      onClick={() => setExpandedTeamId(isExpanded ? null : st.teamId)}
                      className={`hover:bg-slate-800/60 cursor-pointer transition select-none ${
                        isExpanded ? 'bg-slate-800/40' : ''
                      }`}
                    >
                      <td className="py-4 px-4 text-center font-bold font-mono">
                        {st.rank === 1 ? '🥇' : st.rank === 2 ? '🥈' : st.rank === 3 ? '🥉' : `#${st.rank}`}
                      </td>
                      <td className="py-4 px-4 font-bold text-slate-100 flex items-center gap-2">
                        <span
                          className="w-6 h-6 rounded-full flex items-center justify-center text-sm"
                          style={{ backgroundColor: teamStyles[st.teamId]?.color ?? 'transparent' }}
                        >
                          {teamStyles[st.teamId]?.icon ?? ''}
                        </span>
                        <span>{st.teamName}</span>
                        <span className="text-[10px] text-ice-400">
                          {isExpanded ? '▲' : '▼'}
                        </span>
                      </td>
                      <td className="py-4 px-4 text-slate-400">{st.ownerName}</td>
                      <td className="py-4 px-4 text-center font-mono">{st.activePlayersCount}</td>
                      <td className="py-4 px-4 text-center font-mono text-amber-400">{st.irPlayersCount}</td>
                      {draft.salary_cap_enabled && (
                        <td className="py-4 px-4 text-right font-mono text-emerald-400 font-semibold">
                          ${st.totalCapHit.toFixed(2)}M
                        </td>
                      )}
                      <td className="py-4 px-4 text-right font-mono font-black text-lg text-ice-300">
                        {st.totalPoints.toFixed(1)}
                      </td>
                    </tr>

                    {/* Expanded Team Roster Detail */}
                    {isExpanded && (
                      <tr>
                        <td
                          colSpan={draft.salary_cap_enabled ? 7 : 6}
                          className="bg-rink-dark/80 px-6 py-4 border-y border-rink-border/60"
                        >
                          <div className="space-y-3">
                            <h4 className="text-xs uppercase font-bold tracking-wider text-slate-400">
                              {st.teamName} Roster Breakdown
                            </h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                              {teamPicks.map((pick) => (
                                <div
                                  key={pick.id}
                                  className={`p-2.5 rounded border text-xs flex items-center justify-between ${
                                    pick.roster_status === 'ir'
                                      ? 'bg-amber-950/20 border-amber-500/30 text-amber-200'
                                      : 'bg-rink-card border-rink-border text-slate-200'
                                  }`}
                                >
                                  <div>
                                    <div className="font-bold flex items-center gap-1.5">
                                      <span>{pick.player_name}</span>
                                      <span className="text-[9px] px-1 py-0.2 rounded bg-slate-800 text-ice-300 font-mono">
                                        {pick.player_position}
                                      </span>
                                      {pick.roster_status === 'ir' && (
                                        <span className="text-[9px] px-1 py-0.2 rounded bg-amber-900 text-amber-200 font-bold uppercase">
                                          IR
                                        </span>
                                      )}
                                    </div>
                                    <span className="text-[10px] text-slate-400">
                                      {pick.player_team}
                                      {draft.salary_cap_enabled && ` • $${Number(pick.cap_hit).toFixed(1)}M`}
                                    </span>
                                  </div>

                                  <div className="text-right">
                                    <span className="font-mono font-black text-sm text-ice-300 block">
                                      {Number(pick.liveScore || 0).toFixed(1)} pts
                                    </span>
                                    {pick.roster_status === 'ir' && (
                                      <span className="text-[9px] text-slate-500">Points Frozen</span>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </div>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Head to head */}
      {standings.length >= 2 && (
        <div className="bg-rink-card border border-rink-border p-5 rounded-xl space-y-3">
          <h3 className="font-bold text-slate-100 text-sm">⚔️ Head-to-head</h3>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <select value={h2hA} onChange={(e) => setH2hA(e.target.value)} className="bg-rink-dark border border-rink-border rounded px-2 py-1 text-slate-100">
              <option value="">Team A</option>
              {standings.map((s) => <option key={s.teamId} value={s.teamId}>{s.teamName}</option>)}
            </select>
            <span className="text-slate-400">vs</span>
            <select value={h2hB} onChange={(e) => setH2hB(e.target.value)} className="bg-rink-dark border border-rink-border rounded px-2 py-1 text-slate-100">
              <option value="">Team B</option>
              {standings.map((s) => <option key={s.teamId} value={s.teamId}>{s.teamName}</option>)}
            </select>
          </div>
          {h2hA && h2hB && h2hA !== h2hB && (
            <div className="grid grid-cols-2 gap-4">
              {[h2hA, h2hB].map((tid) => {
                const st = standings.find((s) => s.teamId === tid)!;
                const tp = picks
                  .filter((p) => p.draft_team_id === tid)
                  .sort((a, b) => Number(b.liveScore || 0) - Number(a.liveScore || 0));
                return (
                  <div key={tid} className="space-y-1">
                    <div className="font-bold text-slate-100 text-sm">
                      {st.teamName} <span className="text-ice-300 font-mono">{st.totalPoints.toFixed(1)}</span>
                    </div>
                    {tp.slice(0, 8).map((p) => (
                      <div key={p.id} className="flex justify-between text-xs text-slate-300">
                        <span>{p.player_name}</span>
                        <span className="font-mono">{Number(p.liveScore || 0).toFixed(1)}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Scoring Weights Overview */}
      <div className="bg-rink-card border border-rink-border p-5 rounded-xl space-y-3">
        <h3 className="font-bold text-slate-100 text-sm flex items-center gap-2">
          <span>⚙️</span> Pool Scoring Rules
        </h3>
        <div className="flex flex-wrap gap-2 text-xs">
          {weights
            .filter((w) => w.enabled)
            .map((w) => (
              <span
                key={w.stat}
                className="px-2.5 py-1 rounded bg-rink-dark border border-rink-border text-slate-300 font-mono"
              >
                {w.label}: <strong className="text-ice-300">{Number(w.weight)} pts</strong>
              </span>
            ))}
        </div>
      </div>
    </div>
  );
}
