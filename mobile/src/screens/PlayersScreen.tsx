import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, ScrollView, ActivityIndicator, Modal } from 'react-native';
import { api } from '../lib/api';
import { ui } from '../lib/theme';
import SalaryReviews from './SalaryReviews';

type Tab = 'skaters' | 'goalies';

const SKATER_SORTS = [
  { key: 'points', label: 'Pts' }, { key: 'goals', label: 'G' }, { key: 'assists', label: 'A' },
  { key: 'plusMinus', label: '+/-' }, { key: 'hits', label: 'Hits' }, { key: 'capHit', label: 'Cap' },
  { key: 'skaterFullName', label: 'Name' },
];
const GOALIE_SORTS = [
  { key: 'wins', label: 'W' }, { key: 'savePct', label: 'SV%' }, { key: 'goalsAgainstAverage', label: 'GAA' },
  { key: 'shutouts', label: 'SO' }, { key: 'capHit', label: 'Cap' }, { key: 'goalieFullName', label: 'Name' },
];
const ASC_KEYS = new Set(['skaterFullName', 'goalieFullName', 'goalsAgainstAverage']);

const hasCap = (p: any) => !!p.capHit && p.capHit > 0;

export default function PlayersScreen({ isAdmin, onBack }: { isAdmin: boolean; onBack: () => void }) {
  const [tab, setTab] = useState<Tab>('skaters');
  const [skaters, setSkaters] = useState<any[]>([]);
  const [goalies, setGoalies] = useState<any[]>([]);
  const [salariesCount, setSalariesCount] = useState(0);
  const [overrideIds, setOverrideIds] = useState<Set<number>>(new Set());
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [salariesUpdatedAt, setSalariesUpdatedAt] = useState<string | null>(null);
  const [statsWarning, setStatsWarning] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [sortKey, setSortKey] = useState('points');
  const [sortAsc, setSortAsc] = useState(false);

  const [syncing, setSyncing] = useState(false);
  const [reviewRefresh, setReviewRefresh] = useState(0);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [syncError, setSyncError] = useState(false);
  const [syncReport, setSyncReport] = useState<{ missing: string[]; unmatched: { name: string; capHit: number; suggestion?: string }[] } | null>(null);
  const [showReport, setShowReport] = useState(false);

  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);
  const [capInput, setCapInput] = useState('');
  const [capError, setCapError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api('/api/players');
      if (!res.ok) throw new Error(res.data.error || 'Failed to load players');
      setSkaters(res.data.skaters || []);
      setGoalies(res.data.goalies || []);
      setSalariesCount(res.data.salariesCount || 0);
      setOverrideIds(new Set<number>(res.data.overrideIds || []));
      setUpdatedAt(res.data.updatedAt || null);
      setSalariesUpdatedAt(res.data.salariesUpdatedAt || null);
      setStatsWarning(res.data.statsWarning || null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const switchTab = (t: Tab) => {
    setTab(t);
    setSortKey(t === 'skaters' ? 'points' : 'wins');
    setSortAsc(false);
  };

  const pickSort = (key: string) => {
    if (key === sortKey) setSortAsc((v) => !v);
    else {
      setSortKey(key);
      setSortAsc(ASC_KEYS.has(key));
    }
  };

  const nameOf = (p: any) => (tab === 'skaters' ? p.skaterFullName : p.goalieFullName);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = (tab === 'skaters' ? skaters : goalies).filter((p) => {
      if (onlyMissing && hasCap(p)) return false;
      if (!q) return true;
      return (
        nameOf(p).toLowerCase().includes(q) ||
        String(p.teamAbbrevs).toLowerCase().includes(q) ||
        (tab === 'skaters' && String(p.positionCode).toLowerCase().includes(q))
      );
    });
    const isString = sortKey === 'skaterFullName' || sortKey === 'goalieFullName';
    return [...list].sort((a, b) => {
      if (isString) {
        const cmp = String(a[sortKey] ?? '').localeCompare(String(b[sortKey] ?? ''));
        return sortAsc ? cmp : -cmp;
      }
      const d = Number(a[sortKey] ?? 0) - Number(b[sortKey] ?? 0);
      return sortAsc ? d : -d;
    });
  }, [skaters, goalies, tab, search, onlyMissing, sortKey, sortAsc]);

  const missingCount = skaters.filter((p) => !hasCap(p)).length + goalies.filter((p) => !hasCap(p)).length;
  const salaryAgeHours = salariesUpdatedAt ? (Date.now() - new Date(salariesUpdatedAt).getTime()) / 3_600_000 : null;

  const sync = async () => {
    setSyncing(true);
    setSyncError(false);
    setSyncReport(null);
    setSyncStatus('Fetching contracts from source and matching with NHL rosters...');
    try {
      const res = await api('/api/players', { method: 'POST', body: {} });
      if (!res.ok) throw new Error(res.data.error || 'Failed to sync salaries');
      const d = res.data;
      setSyncStatus(
        `✓ Sync complete! Matched ${d.matchedCount} salaries. ${d.pendingReviewCount ?? 0} ambiguous groups need review. ${d.missingPlayers?.length ?? 0} players have no shared salary and ${d.unmatchedCount ?? 0} contract names couldn't be matched.`
      );
      setReviewRefresh((n) => n + 1);
      setSyncReport({ missing: d.missingPlayers ?? [], unmatched: d.unmatched ?? [] });
      load();
    } catch (e: any) {
      setSyncError(true);
      setSyncStatus(`Sync error: ${e.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const openCapEditor = (p: any) => {
    if (!isAdmin) return;
    const id = Number(p.playerId);
    setEditing({ id, name: nameOf(p) });
    setCapInput(overrideIds.has(id) && hasCap(p) ? String(p.capHit) : '');
    setCapError('');
  };

  const saveCap = async () => {
    if (!editing) return;
    const capHit = parseFloat(capInput);
    if (!Number.isFinite(capHit) || capHit < 0 || capHit >= 10000) {
      setCapError('Enter a valid number in millions, e.g. 0.95');
      return;
    }
    try {
      const res = await api('/api/players', { method: 'PUT', body: { playerId: editing.id, playerName: editing.name, capHit } });
      if (!res.ok) throw new Error(res.data.error || 'Failed to save salary');
      setEditing(null);
      load();
    } catch (e: any) {
      setCapError(e.message);
    }
  };

  const resetCap = async () => {
    if (!editing) return;
    try {
      const res = await api('/api/players', { method: 'DELETE', body: { playerId: editing.id } });
      if (!res.ok) throw new Error(res.data.error || 'Failed to reset salary');
      setEditing(null);
      load();
    } catch (e: any) {
      setCapError(e.message);
    }
  };

  const sorts = tab === 'skaters' ? SKATER_SORTS : GOALIE_SORTS;

  const header = (
    <View style={ui.body}>
      <View style={ui.rowBetween}>
        <TouchableOpacity onPress={onBack}><Text style={ui.link}>← Dashboard</Text></TouchableOpacity>
        {isAdmin && (
          <TouchableOpacity style={[ui.button, syncing && ui.disabled]} disabled={syncing} onPress={sync}>
            <Text style={ui.buttonText}>{syncing ? 'Syncing...' : '🔄 Sync Salaries'}</Text>
          </TouchableOpacity>
        )}
      </View>
      <Text style={[ui.title, { marginTop: 12 }]}>🏒 NHL Players & Statistics</Text>
      <Text style={ui.sub}>
        Current season stats with salary cap hits. Players who haven't played a game yet are listed with zero stats.
        {updatedAt ? ` Stats updated ${new Date(updatedAt).toLocaleString()}.` : ''}
        {salariesUpdatedAt ? ` Salaries synced ${new Date(salariesUpdatedAt).toLocaleString()}.` : ''}
      </Text>

      {syncStatus && (
        <View style={[ui.banner, syncError ? ui.bannerError : ui.bannerOk, { marginTop: 12 }]}>
          <Text style={syncError ? ui.errorText : ui.okText}>{syncStatus}</Text>
          {syncReport && (syncReport.missing.length > 0 || syncReport.unmatched.length > 0) && (
            <TouchableOpacity onPress={() => setShowReport((v) => !v)}>
              <Text style={[ui.link, { marginTop: 6 }]}>{showReport ? 'Hide details' : 'Show details'}</Text>
            </TouchableOpacity>
          )}
          {isAdmin && <SalaryReviews refresh={reviewRefresh} onSaved={load} />}
          {showReport && syncReport && (
            <View style={{ marginTop: 6 }}>
              {syncReport.missing.length > 0 && (
                <Text style={ui.sub}>No salary ({syncReport.missing.length}): {syncReport.missing.join(', ')}</Text>
              )}
              {syncReport.unmatched.length > 0 && (
                <Text style={[ui.sub, { marginTop: 6 }]}>
                  Unmatched contracts ({syncReport.unmatched.length}):{' '}
                  {syncReport.unmatched.map((u) => `${u.name} ($${u.capHit.toFixed(2)}M)${u.suggestion ? ` ~ ${u.suggestion}` : ''}`).join('; ')}
                </Text>
              )}
            </View>
          )}
        </View>
      )}

      {statsWarning && (
        <View style={[ui.banner, ui.bannerWarn, { marginTop: 12 }]}>
          <Text style={ui.warnText}>
            {statsWarning} Last successful update: {updatedAt ? new Date(updatedAt).toLocaleString() : 'unknown'}.
          </Text>
        </View>
      )}

      {!loading && !error && (salariesCount === 0 || missingCount > 0) && (
        <View style={[ui.banner, ui.bannerWarn, { marginTop: 12 }]}>
          <Text style={ui.warnText}>
            {salariesCount === 0 ? 'No salaries have been loaded yet.' : `${missingCount} players have no salary on file.`} Players with no
            salary count as $0.00M against a draft's cap.
            {isAdmin ? ' Sync salaries, or tap a player\'s cap hit to enter one.' : ' Your draft admin can set these.'}
          </Text>
          {missingCount > 0 && (
            <TouchableOpacity onPress={() => setOnlyMissing((v) => !v)}>
              <Text style={[ui.link, { marginTop: 6 }]}>{onlyMissing ? 'Show all players' : 'Show only players without a salary'}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {!loading && !error && salaryAgeHours !== null && salaryAgeHours > 48 && (
        <View style={[ui.banner, ui.bannerWarn]}>
          <Text style={ui.warnText}>
            Salaries were last synced {new Date(salariesUpdatedAt!).toLocaleString()}. The daily sync may be failing
            {isAdmin ? ' — try "Sync Salaries" to see the error.' : '.'}
          </Text>
        </View>
      )}

      {error ? (
        <View style={[ui.banner, ui.bannerError, { marginTop: 12 }]}>
          <Text style={ui.errorText}>{error}</Text>
          <TouchableOpacity onPress={load}><Text style={[ui.link, { marginTop: 6 }]}>Try again</Text></TouchableOpacity>
        </View>
      ) : null}

      <View style={[ui.row, { marginTop: 12, marginBottom: 10 }]}>
        {(['skaters', 'goalies'] as const).map((t) => (
          <TouchableOpacity key={t} style={[ui.chip, tab === t && ui.chipActive]} onPress={() => switchTab(t)}>
            <Text style={[ui.chipText, tab === t && ui.chipTextActive]}>
              {t === 'skaters' ? `Skaters (${skaters.length})` : `Goalies (${goalies.length})`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <TextInput
        style={ui.input}
        placeholder="Filter by name, team, or pos..."
        placeholderTextColor="#64748b"
        value={search}
        onChangeText={setSearch}
        autoCapitalize="none"
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {sorts.map((s) => (
          <TouchableOpacity key={s.key} style={[ui.chip, sortKey === s.key && ui.chipActive]} onPress={() => pickSort(s.key)}>
            <Text style={[ui.chipText, sortKey === s.key && ui.chipTextActive]}>
              {s.label}{sortKey === s.key ? (sortAsc ? ' ▲' : ' ▼') : ''}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );

  return (
    <View style={ui.container}>
      <FlatList
        data={loading ? [] : rows}
        keyExtractor={(p) => String(p.playerId)}
        ListHeaderComponent={header}
        ListEmptyComponent={
          loading ? <ActivityIndicator color="#48CAE4" style={{ marginTop: 24 }} /> : <Text style={ui.empty}>No players match.</Text>
        }
        initialNumToRender={20}
        renderItem={({ item: p }) => {
          const overridden = overrideIds.has(Number(p.playerId));
          return (
            <View style={[ui.rowBetween, { paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#1C2541' }]}>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={ui.strong}>{nameOf(p)}</Text>
                <Text style={ui.sub}>
                  {tab === 'skaters'
                    ? `${p.positionCode} • ${p.teamAbbrevs} • GP ${p.gamesPlayed} • ${p.goals}G ${p.assists}A ${p.points}P • ${p.plusMinus >= 0 ? '+' : ''}${p.plusMinus} • ${p.hits} hits`
                    : `${p.teamAbbrevs} • GP ${p.gamesPlayed} • ${p.wins}-${p.losses}-${p.otLosses} • ${Number(p.goalsAgainstAverage).toFixed(2)} GAA • ${Number(p.savePct).toFixed(3)} SV% • ${p.shutouts} SO`}
                </Text>
              </View>
              <TouchableOpacity disabled={!isAdmin} onPress={() => openCapEditor(p)}>
                <Text style={[ui.strong, overridden && { color: '#fbbf24' }, !hasCap(p) && { color: '#64748b' }]}>
                  {hasCap(p) ? `$${Number(p.capHit).toFixed(2)}M` : '—'}{overridden ? ' ✎' : ''}
                </Text>
              </TouchableOpacity>
            </View>
          );
        }}
      />

      <Modal visible={!!editing} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 }}>
          <View style={ui.card}>
            <Text style={ui.cardTitle}>Cap hit for {editing?.name}</Text>
            <Text style={[ui.sub, { marginBottom: 8 }]}>
              In $M (e.g. 0.95). Applies to all your drafts that haven't started.
            </Text>
            <TextInput
              style={ui.input}
              value={capInput}
              onChangeText={setCapInput}
              keyboardType="decimal-pad"
              placeholder="0.95"
              placeholderTextColor="#64748b"
            />
            {capError ? <Text style={[ui.errorText, { marginBottom: 8 }]}>{capError}</Text> : null}
            <View style={[ui.row, ui.gap]}>
              <TouchableOpacity style={ui.button} onPress={saveCap}><Text style={ui.buttonText}>Save</Text></TouchableOpacity>
              {editing && overrideIds.has(editing.id) && (
                <TouchableOpacity style={ui.buttonGhost} onPress={resetCap}><Text style={ui.buttonText}>Reset to shared</Text></TouchableOpacity>
              )}
              <TouchableOpacity style={ui.buttonGhost} onPress={() => setEditing(null)}><Text style={ui.buttonText}>Cancel</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
