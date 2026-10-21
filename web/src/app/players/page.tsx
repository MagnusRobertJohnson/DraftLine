'use client';

import { useState, useEffect, useMemo } from 'react';
import type { NHLSkater, NHLGoalie } from '@shared/types';
import { authHeaders, fetchIsAdmin } from '@/lib/clientAuth';

type PlayerTab = 'skaters' | 'goalies';
type SkaterSortKey = keyof NHLSkater | 'capHit';
type GoalieSortKey = keyof NHLGoalie | 'capHit';

export default function PlayersPage() {
  const [tab, setTab] = useState<PlayerTab>('skaters');
  const [skaters, setSkaters] = useState<NHLSkater[]>([]);
  const [goalies, setGoalies] = useState<NHLGoalie[]>([]);
  const [salariesCount, setSalariesCount] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [overrideIds, setOverrideIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    fetchIsAdmin().then(setIsAdmin);
  }, []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  // Sorting
  const [skaterSortKey, setSkaterSortKey] = useState<SkaterSortKey>('points');
  const [goalieSortKey, setGoalieSortKey] = useState<GoalieSortKey>('wins');
  const [skaterSortAsc, setSkaterSortAsc] = useState(false);
  const [goalieSortAsc, setGoalieSortAsc] = useState(false);

  // Sync state
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

  const fetchPlayers = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/players', { headers: await authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load players');
      setSkaters(data.skaters || []);
      setGoalies(data.goalies || []);
      setSalariesCount(data.salariesCount || 0);
      setOverrideIds(new Set<number>(data.overrideIds || []));
      setUpdatedAt(data.updatedAt || null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPlayers();
  }, []);

  // Trigger online salary sync from Spotrac
  const handleAutoSync = async () => {
    setSyncing(true);
    setSyncStatus('Fetching contracts from source and matching with NHL rosters...');
    try {
      const res = await fetch('/api/players', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to sync salaries');
      setSyncStatus(
        `✓ Sync complete! Matched ${data.matchedCount} salaries. ${
          data.missingPlayers?.length
            ? `${data.missingPlayers.length} players still have no salary (click "—" to enter one): ${data.missingPlayers.slice(0, 15).join(', ')}${data.missingPlayers.length > 15 ? '…' : ''}`
            : 'No players missing.'
        }`
      );
      fetchPlayers();
    } catch (err: any) {
      setSyncStatus(`Sync error: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const setManualCap = async (playerId: number, name: string) => {
    const isOverridden = overrideIds.has(playerId);
    const input = window.prompt(
      `Your cap hit for ${name} in $M (e.g. 0.95). This applies to all your drafts that haven't started.` +
        (isOverridden ? ' Leave blank to reset to the shared value.' : '')
    );
    if (input === null) return;

    if (input.trim() === '' && isOverridden) {
      const res = await fetch('/api/players', {
        method: 'DELETE',
        headers: await authHeaders(),
        body: JSON.stringify({ playerId }),
      });
      if (res.ok) fetchPlayers();
      else alert((await res.json().catch(() => ({}))).error || 'Failed to reset salary');
      return;
    }

    const capHit = parseFloat(input);
    if (!Number.isFinite(capHit) || capHit < 0 || capHit >= 10000) {
      alert('Enter a valid number in millions, e.g. 0.95');
      return;
    }
    const res = await fetch('/api/players', {
      method: 'PUT',
      headers: await authHeaders(),
      body: JSON.stringify({ playerId, playerName: name, capHit }),
    });
    if (res.ok) fetchPlayers();
    else alert((await res.json().catch(() => ({}))).error || 'Failed to save salary');
  };

  const capCell = (playerId: number, name: string, capHit?: number) => {
    const label = capHit && capHit > 0 ? `$${capHit.toFixed(2)}M` : '—';
    if (!isAdmin) return <span className="font-mono font-bold">{label}</span>;
    const overridden = overrideIds.has(playerId);
    return (
      <button
        type="button"
        onClick={() => setManualCap(playerId, name)}
        title={overridden ? 'Your custom cap hit (click to edit or reset)' : 'Click to set your own cap hit'}
        className={`font-mono font-bold hover:underline ${overridden ? 'text-amber-400' : ''}`}
      >
        {label}
        {overridden && ' ✎'}
      </button>
    );
  };

  const toggleSkaterSort = (key: SkaterSortKey) => {
    if (skaterSortKey === key) {
      setSkaterSortAsc((prev) => !prev);
    } else {
      setSkaterSortKey(key);
      // For string fields like name or pos, default ascending; for numeric stats default descending
      setSkaterSortAsc(key === 'skaterFullName' || key === 'positionCode' || key === 'teamAbbrevs');
    }
  };

  const toggleGoalieSort = (key: GoalieSortKey) => {
    if (goalieSortKey === key) {
      setGoalieSortAsc((prev) => !prev);
    } else {
      setGoalieSortKey(key);
      // For GAA lower is better, default ascending; for names ascending; for others descending
      setGoalieSortAsc(
        key === 'goalsAgainstAverage' ||
        key === 'goalieFullName' ||
        key === 'teamAbbrevs'
      );
    }
  };

  // Filtered and sorted skaters
  const filteredSkaters = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = skaters.filter((s) => {
      if (!q) return true;
      return (
        s.skaterFullName.toLowerCase().includes(q) ||
        s.teamAbbrevs.toLowerCase().includes(q) ||
        s.positionCode.toLowerCase().includes(q)
      );
    });

    return [...list].sort((a, b) => {
      const isString =
        skaterSortKey === 'skaterFullName' ||
        skaterSortKey === 'positionCode' ||
        skaterSortKey === 'teamAbbrevs';

      if (isString) {
        const strA = String(a[skaterSortKey] ?? '').toLowerCase();
        const strB = String(b[skaterSortKey] ?? '').toLowerCase();
        const cmp = strA.localeCompare(strB);
        return skaterSortAsc ? cmp : -cmp;
      }

      // Numeric comparison
      const numA = Number(a[skaterSortKey] ?? 0);
      const numB = Number(b[skaterSortKey] ?? 0);
      return skaterSortAsc ? numA - numB : numB - numA;
    });
  }, [skaters, search, skaterSortKey, skaterSortAsc]);

  // Filtered and sorted goalies
  const filteredGoalies = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = goalies.filter((g) => {
      if (!q) return true;
      return (
        g.goalieFullName.toLowerCase().includes(q) ||
        g.teamAbbrevs.toLowerCase().includes(q)
      );
    });

    return [...list].sort((a, b) => {
      const isString =
        goalieSortKey === 'goalieFullName' ||
        goalieSortKey === 'teamAbbrevs';

      if (isString) {
        const strA = String(a[goalieSortKey] ?? '').toLowerCase();
        const strB = String(b[goalieSortKey] ?? '').toLowerCase();
        const cmp = strA.localeCompare(strB);
        return goalieSortAsc ? cmp : -cmp;
      }

      // Numeric comparison
      const numA = Number(a[goalieSortKey] ?? 0);
      const numB = Number(b[goalieSortKey] ?? 0);
      return goalieSortAsc ? numA - numB : numB - numA;
    });
  }, [goalies, search, goalieSortKey, goalieSortAsc]);

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-rink-card border border-rink-border p-6 rounded-xl">
        <div>
          <h1 className="text-2xl font-black text-slate-100 flex items-center gap-2">
            <span>🏒</span> NHL Players & Statistics
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Current season NHL statistics with salary cap hits for skaters and goalies.
            {updatedAt && ` Last updated ${new Date(updatedAt).toLocaleString()}.`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {isAdmin && (
          <button
            onClick={handleAutoSync}
            disabled={syncing}
            className="bg-ice-600 hover:bg-ice-500 disabled:opacity-50 text-white font-semibold text-xs px-4 py-2.5 rounded-lg transition shadow flex items-center gap-2"
          >
            <span>🔄</span> {syncing ? 'Syncing...' : 'Fetch & Sync Salaries'}
          </button>
          )}
        </div>
      </div>

      {syncStatus && (
        <div className="p-3 bg-rink-card border border-ice-500/40 text-ice-300 text-xs rounded-lg font-mono flex items-center justify-between">
          <span>{syncStatus}</span>
          <button onClick={() => setSyncStatus(null)} className="text-slate-400 hover:text-white ml-2">
            ✕
          </button>
        </div>
      )}

      {error && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm rounded-lg">
          {error}
        </div>
      )}

      {/* Controls Bar: Skater/Goalie Toggle + Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {/* Toggle between Skaters and Goalies */}
        <div className="flex bg-rink-dark border border-rink-border rounded-lg p-1 w-fit">
          <button
            onClick={() => setTab('skaters')}
            className={`px-5 py-2 rounded-md text-xs font-bold transition ${
              tab === 'skaters'
                ? 'bg-ice-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Skaters ({skaters.length})
          </button>
          <button
            onClick={() => setTab('goalies')}
            className={`px-5 py-2 rounded-md text-xs font-bold transition ${
              tab === 'goalies'
                ? 'bg-ice-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Goalies ({goalies.length})
          </button>
        </div>

        {/* Search */}
        <div className="relative flex-1 sm:max-w-xs">
          <input
            type="text"
            placeholder="Filter by name, team, or pos..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-rink-card border border-rink-border rounded-lg pl-3 pr-8 py-2 text-xs text-slate-100 focus:outline-none focus:border-rink-accent"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-2.5 text-xs text-slate-400 hover:text-white"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* TABLE SECTION */}
      <div className="bg-rink-card border border-rink-border rounded-xl overflow-hidden shadow">
        <div className="overflow-x-auto">
          {tab === 'skaters' ? (
            /* SKATERS TABLE */
            <table className="w-full text-left text-xs text-slate-300 whitespace-nowrap">
              <thead className="bg-rink-dark text-[11px] uppercase tracking-wider text-slate-400 border-b border-rink-border select-none">
                <tr>
                  <th
                    className="py-3 px-4 cursor-pointer hover:text-white"
                    onClick={() => toggleSkaterSort('skaterFullName')}
                  >
                    Player {skaterSortKey === 'skaterFullName' && (skaterSortAsc ? '▲' : '▼')}
                  </th>
                  <th
                    className="py-3 px-2 text-center cursor-pointer hover:text-white"
                    onClick={() => toggleSkaterSort('positionCode')}
                  >
                    Pos {skaterSortKey === 'positionCode' && (skaterSortAsc ? '▲' : '▼')}
                  </th>
                  <th
                    className="py-3 px-2 text-center cursor-pointer hover:text-white"
                    onClick={() => toggleSkaterSort('teamAbbrevs')}
                  >
                    Team {skaterSortKey === 'teamAbbrevs' && (skaterSortAsc ? '▲' : '▼')}
                  </th>
                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:text-white font-mono"
                    onClick={() => toggleSkaterSort('capHit')}
                  >
                    Cap Hit {skaterSortKey === 'capHit' && (skaterSortAsc ? '▲' : '▼')}
                  </th>
                  <th
                    className="py-3 px-3 text-center cursor-pointer hover:text-white"
                    onClick={() => toggleSkaterSort('gamesPlayed')}
                  >
                    GP {skaterSortKey === 'gamesPlayed' && (skaterSortAsc ? '▲' : '▼')}
                  </th>
                  <th
                    className="py-3 px-3 text-center cursor-pointer hover:text-white font-bold"
                    onClick={() => toggleSkaterSort('goals')}
                  >
                    G {skaterSortKey === 'goals' && (skaterSortAsc ? '▲' : '▼')}
                  </th>
                  <th
                    className="py-3 px-3 text-center cursor-pointer hover:text-white font-bold"
                    onClick={() => toggleSkaterSort('assists')}
                  >
                    A {skaterSortKey === 'assists' && (skaterSortAsc ? '▲' : '▼')}
                  </th>
                  <th
                    className="py-3 px-3 text-center cursor-pointer hover:text-ice-300 font-black text-ice-300"
                    onClick={() => toggleSkaterSort('points')}
                  >
                    PTS {skaterSortKey === 'points' && (skaterSortAsc ? '▲' : '▼')}
                  </th>
                  <th
                    className="py-3 px-3 text-center cursor-pointer hover:text-white"
                    onClick={() => toggleSkaterSort('plusMinus')}
                  >
                    +/- {skaterSortKey === 'plusMinus' && (skaterSortAsc ? '▲' : '▼')}
                  </th>
                  <th
                    className="py-3 px-3 text-center cursor-pointer hover:text-white"
                    onClick={() => toggleSkaterSort('hits')}
                  >
                    Hits {skaterSortKey === 'hits' && (skaterSortAsc ? '▲' : '▼')}
                  </th>
                  <th
                    className="py-3 px-3 text-center cursor-pointer hover:text-white"
                    onClick={() => toggleSkaterSort('blockedShots')}
                  >
                    Blocks {skaterSortKey === 'blockedShots' && (skaterSortAsc ? '▲' : '▼')}
                  </th>
                  <th
                    className="py-3 px-3 text-center cursor-pointer hover:text-white"
                    onClick={() => toggleSkaterSort('penaltyMinutes')}
                  >
                    PIM {skaterSortKey === 'penaltyMinutes' && (skaterSortAsc ? '▲' : '▼')}
                  </th>
                  <th
                    className="py-3 px-3 text-center cursor-pointer hover:text-white"
                    onClick={() => toggleSkaterSort('shots')}
                  >
                    SOG {skaterSortKey === 'shots' && (skaterSortAsc ? '▲' : '▼')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rink-border/50">
                {loading ? (
                  <tr>
                    <td colSpan={13} className="py-12 text-center text-slate-500">
                      Loading skater stats...
                    </td>
                  </tr>
                ) : filteredSkaters.length === 0 ? (
                  <tr>
                    <td colSpan={13} className="py-12 text-center text-slate-500">
                      No skaters match your filter.
                    </td>
                  </tr>
                ) : (
                  filteredSkaters.map((s) => (
                    <tr key={s.playerId} className="hover:bg-slate-800/50">
                      <td className="py-2.5 px-4 font-semibold text-slate-100 flex items-center gap-2">
                        <span>{s.skaterFullName}</span>
                      </td>
                      <td className="py-2.5 px-2 text-center">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-ice-300 font-mono font-semibold">
                          {s.positionCode}
                        </span>
                      </td>
                      <td className="py-2.5 px-2 text-center text-slate-400 font-mono">
                        {s.teamAbbrevs || '—'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-400">
                        {capCell(s.playerId, s.skaterFullName, s.capHit)}
                      </td>
                      <td className="py-2.5 px-3 text-center font-mono">{s.gamesPlayed}</td>
                      <td className="py-2.5 px-3 text-center font-mono font-bold text-slate-200">
                        {s.goals}
                      </td>
                      <td className="py-2.5 px-3 text-center font-mono font-bold text-slate-200">
                        {s.assists}
                      </td>
                      <td className="py-2.5 px-3 text-center font-mono font-black text-ice-300 bg-ice-950/20">
                        {s.points}
                      </td>
                      <td className="py-2.5 px-3 text-center font-mono">
                        <span
                          className={
                            s.plusMinus > 0
                              ? 'text-emerald-400'
                              : s.plusMinus < 0
                              ? 'text-rose-400'
                              : 'text-slate-400'
                          }
                        >
                          {s.plusMinus > 0 ? `+${s.plusMinus}` : s.plusMinus}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-center font-mono">{s.hits}</td>
                      <td className="py-2.5 px-3 text-center font-mono">{s.blockedShots}</td>
                      <td className="py-2.5 px-3 text-center font-mono">{s.penaltyMinutes}</td>
                      <td className="py-2.5 px-3 text-center font-mono">{s.shots}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          ) : (
            /* GOALIES TABLE */
            <table className="w-full text-left text-xs text-slate-300 whitespace-nowrap">
              <thead className="bg-rink-dark text-[11px] uppercase tracking-wider text-slate-400 border-b border-rink-border select-none">
                <tr>
                  <th
                    className="py-3 px-4 cursor-pointer hover:text-white"
                    onClick={() => toggleGoalieSort('goalieFullName')}
                  >
                    Player {goalieSortKey === 'goalieFullName' && (goalieSortAsc ? '▲' : '▼')}
                  </th>
                  <th
                    className="py-3 px-2 text-center cursor-pointer hover:text-white"
                    onClick={() => toggleGoalieSort('teamAbbrevs')}
                  >
                    Team {goalieSortKey === 'teamAbbrevs' && (goalieSortAsc ? '▲' : '▼')}
                  </th>
                  <th
                    className="py-3 px-3 text-right cursor-pointer hover:text-white font-mono"
                    onClick={() => toggleGoalieSort('capHit')}
                  >
                    Cap Hit {goalieSortKey === 'capHit' && (goalieSortAsc ? '▲' : '▼')}
                  </th>
                  <th
                    className="py-3 px-3 text-center cursor-pointer hover:text-white"
                    onClick={() => toggleGoalieSort('gamesPlayed')}
                  >
                    GP {goalieSortKey === 'gamesPlayed' && (goalieSortAsc ? '▲' : '▼')}
                  </th>
                  <th
                    className="py-3 px-3 text-center cursor-pointer hover:text-ice-300 font-black text-ice-300"
                    onClick={() => toggleGoalieSort('wins')}
                  >
                    W {goalieSortKey === 'wins' && (goalieSortAsc ? '▲' : '▼')}
                  </th>
                  <th
                    className="py-3 px-3 text-center cursor-pointer hover:text-white font-bold"
                    onClick={() => toggleGoalieSort('losses')}
                  >
                    L {goalieSortKey === 'losses' && (goalieSortAsc ? '▲' : '▼')}
                  </th>
                  <th
                    className="py-3 px-3 text-center cursor-pointer hover:text-white font-bold"
                    onClick={() => toggleGoalieSort('otLosses')}
                  >
                    OTL {goalieSortKey === 'otLosses' && (goalieSortAsc ? '▲' : '▼')}
                  </th>
                  <th
                    className="py-3 px-3 text-center cursor-pointer hover:text-white font-bold"
                    onClick={() => toggleGoalieSort('shutouts')}
                  >
                    SO {goalieSortKey === 'shutouts' && (goalieSortAsc ? '▲' : '▼')}
                  </th>
                  <th
                    className="py-3 px-3 text-center cursor-pointer hover:text-white font-mono"
                    onClick={() => toggleGoalieSort('shotsAgainst')}
                  >
                    SA {goalieSortKey === 'shotsAgainst' && (goalieSortAsc ? '▲' : '▼')}
                  </th>
                  <th
                    className="py-3 px-3 text-center cursor-pointer hover:text-white font-mono"
                    onClick={() => toggleGoalieSort('goalsAgainst')}
                  >
                    GA {goalieSortKey === 'goalsAgainst' && (goalieSortAsc ? '▲' : '▼')}
                  </th>
                  <th
                    className="py-3 px-3 text-center cursor-pointer hover:text-emerald-400 font-mono font-bold text-emerald-400"
                    onClick={() => toggleGoalieSort('savePct')}
                  >
                    SV% {goalieSortKey === 'savePct' && (goalieSortAsc ? '▲' : '▼')}
                  </th>
                  <th
                    className="py-3 px-3 text-center cursor-pointer hover:text-white font-mono font-bold"
                    onClick={() => toggleGoalieSort('goalsAgainstAverage')}
                  >
                    GAA {goalieSortKey === 'goalsAgainstAverage' && (goalieSortAsc ? '▲' : '▼')}
                  </th>
                  <th
                    className="py-3 px-3 text-center cursor-pointer hover:text-white font-mono"
                    onClick={() => toggleGoalieSort('goals')}
                  >
                    G {goalieSortKey === 'goals' && (goalieSortAsc ? '▲' : '▼')}
                  </th>
                  <th
                    className="py-3 px-3 text-center cursor-pointer hover:text-white font-mono"
                    onClick={() => toggleGoalieSort('assists')}
                  >
                    A {goalieSortKey === 'assists' && (goalieSortAsc ? '▲' : '▼')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rink-border/50">
                {loading ? (
                  <tr>
                    <td colSpan={14} className="py-12 text-center text-slate-500">
                      Loading goalie stats...
                    </td>
                  </tr>
                ) : filteredGoalies.length === 0 ? (
                  <tr>
                    <td colSpan={14} className="py-12 text-center text-slate-500">
                      No goalies match your filter.
                    </td>
                  </tr>
                ) : (
                  filteredGoalies.map((g) => (
                    <tr key={g.playerId} className="hover:bg-slate-800/50">
                      <td className="py-2.5 px-4 font-semibold text-slate-100 flex items-center gap-2">
                        <span>{g.goalieFullName}</span>
                      </td>
                      <td className="py-2.5 px-2 text-center text-slate-400 font-mono">
                        {g.teamAbbrevs || '—'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-400">
                        {capCell(g.playerId, g.goalieFullName, g.capHit)}
                      </td>
                      <td className="py-2.5 px-3 text-center font-mono">{g.gamesPlayed}</td>
                      <td className="py-2.5 px-3 text-center font-mono font-black text-ice-300 bg-ice-950/20">
                        {g.wins}
                      </td>
                      <td className="py-2.5 px-3 text-center font-mono text-slate-300">{g.losses}</td>
                      <td className="py-2.5 px-3 text-center font-mono text-slate-400">{g.otLosses}</td>
                      <td className="py-2.5 px-3 text-center font-mono font-bold text-amber-300">
                        {g.shutouts}
                      </td>
                      <td className="py-2.5 px-3 text-center font-mono">{g.shotsAgainst}</td>
                      <td className="py-2.5 px-3 text-center font-mono">{g.goalsAgainst}</td>
                      <td className="py-2.5 px-3 text-center font-mono font-bold text-emerald-400">
                        {Number(g.savePct || 0).toFixed(3)}
                      </td>
                      <td className="py-2.5 px-3 text-center font-mono font-semibold">
                        {Number(g.goalsAgainstAverage || 0).toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-center font-mono">{g.goals}</td>
                      <td className="py-2.5 px-3 text-center font-mono">{g.assists}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
