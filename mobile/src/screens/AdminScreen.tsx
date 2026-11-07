import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Alert, Modal } from 'react-native';
import { supabase } from '../lib/supabase';
import { api, friendlyNetworkError } from '../lib/api';
import { ui } from '../lib/theme';
import type { Draft, DraftTeam, DraftPick } from '../../../shared/types';
import { teamIndexForPick, roundForPick } from '../../../shared/draftOrder';

const confirmAsync = (title: string, message: string, okLabel = 'OK') =>
  new Promise<boolean>((resolve) =>
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: okLabel, onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) })
  );

export default function AdminScreen({ draftId, onOpenBoard }: { draftId: string; onOpenBoard: () => void }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [teams, setTeams] = useState<DraftTeam[]>([]);
  const [picks, setPicks] = useState<DraftPick[]>([]);
  const [salaries, setSalaries] = useState<Map<number, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [salaryWarning, setSalaryWarning] = useState('');

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [newTeamName, setNewTeamName] = useState('');

  const [salaryFor, setSalaryFor] = useState<any | null>(null);
  const [salaryInput, setSalaryInput] = useState('');
  const [salaryError, setSalaryError] = useState('');

  const load = async () => {
    try {
      const { data: d, error: dErr } = await supabase.from('drafts').select('*').eq('id', draftId).single();
      if (dErr || !d) {
        setLoadError(dErr?.message || 'This draft could not be loaded. It may not exist, or you may not have access.');
        return;
      }
      setLoadError('');
      setDraft(d as Draft);

      const { data: t } = await supabase.from('draft_teams').select('*').eq('draft_id', draftId).order('draft_order', { ascending: true });
      if (t) setTeams(t as DraftTeam[]);
      const { data: p } = await supabase.from('draft_picks').select('*').eq('draft_id', draftId).order('pick_number', { ascending: true });
      if (p) setPicks(p as DraftPick[]);

      const sal = await api(`/api/drafts/${draftId}/salaries`);
      if (sal.ok) {
        setSalaryWarning('');
        const map = new Map<number, number>();
        for (const [pid, cap] of Object.entries(sal.data.salaries as Record<string, number>)) map.set(Number(pid), Number(cap));
        setSalaries(map);
      } else {
        setSalaryWarning('Salaries could not be loaded, so cap hits below may show as $0.00M. Pull to retry by reopening this tab.');
      }
    } catch (e: any) {
      setLoadError(`Could not reach the server (${friendlyNetworkError(e.message)}). Check your connection and try again.`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    load();
    const channel = supabase
      .channel(`mobile-admin-${draftId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'draft_picks', filter: `draft_id=eq.${draftId}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'draft_teams', filter: `draft_id=eq.${draftId}` }, () => load())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'drafts', filter: `id=eq.${draftId}` }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [draftId]);

  if (loading) return <ActivityIndicator color="#48CAE4" style={{ marginTop: 32 }} />;

  if (!draft) {
    return (
      <View style={[ui.body, { alignItems: 'center' }]}>
        <Text style={[ui.errorText, { marginBottom: 12 }]}>{loadError || 'This draft could not be loaded.'}</Text>
        <TouchableOpacity style={ui.button} onPress={() => { setLoading(true); load(); }}>
          <Text style={ui.buttonText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const numTeams = teams.length;
  const orderType = draft.pick_order_type ?? 'snake';
  const orderLocked = draft.status !== 'setup' || picks.length > 0;
  const currentPickNumber = picks.length + 1;
  const currentRound = roundForPick(numTeams, currentPickNumber);
  const currentTeam = teams[teamIndexForPick(numTeams, currentPickNumber, orderType)] || null;
  const draftedIds = new Set(picks.map((p) => p.nhl_player_id));

  const checklist = [
    { done: numTeams >= 2, label: 'Add at least 2 teams', hint: 'Use "+ Add" in the Draft Teams card.' },
    { done: salaries.size > 0, label: 'Salaries loaded', hint: 'Open NHL Players on the dashboard and run "Sync Salaries".' },
    { done: draft.status !== 'setup' || picks.length > 0, label: 'Draft started', hint: 'Make the first pick.' },
  ];
  const showChecklist = draft.status === 'setup' && checklist.some((c) => !c.done);

  const updateOrder = async (payload: Record<string, unknown>) => {
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const res = await api(`/api/drafts/${draftId}/order`, { method: 'POST', body: payload });
      if (!res.ok) throw new Error(res.data.error || 'Failed to update the pick order');
      await load();
    } catch (e: any) {
      setErrorMsg(e.message);
    }
  };

  const moveTeam = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= teams.length) return;
    const ids = teams.map((t) => t.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    updateOrder({ action: 'set_order', teamIds: ids });
  };

  const randomize = async () => {
    if (teams.length < 2) return;
    if (await confirmAsync('Randomize order?', 'This replaces the current pick order.', 'Randomize')) {
      updateOrder({ action: 'randomize' });
    }
  };

  const search = async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setErrorMsg('');
    setHasSearched(false);

    let found: any[] = [];
    let nhlFailed = false;
    try {
      const res = await fetch(`https://search.d3.nhle.com/api/v1/search/player?culture=en-us&limit=20&q=${encodeURIComponent(q)}&active=true`);
      if (!res.ok) throw new Error('Search failed');
      found = (await res.json()) || [];
    } catch {
      nhlFailed = true;
    }

    // Fall back to our own player list, which also includes rostered players with no games played yet
    if (found.length === 0) {
      try {
        const res = await api('/api/players');
        if (res.ok) {
          const needle = q.toLowerCase();
          found = [
            ...(res.data.skaters || []).map((s: any) => ({ playerId: s.playerId, name: s.skaterFullName, positionCode: s.positionCode, teamAbbrev: s.teamAbbrevs })),
            ...(res.data.goalies || []).map((g: any) => ({ playerId: g.playerId, name: g.goalieFullName, positionCode: 'G', teamAbbrev: g.teamAbbrevs })),
          ].filter((p) => p.name.toLowerCase().includes(needle)).slice(0, 20);
          nhlFailed = false;
        }
      } catch {
        // keep the original failure state
      }
    }

    if (nhlFailed && found.length === 0) {
      setErrorMsg("Player search isn't responding right now (the NHL search service may be down). Try again in a moment.");
    }
    setResults(found);
    setHasSearched(!nhlFailed || found.length > 0);
    setSearching(false);
  };

  const draftPlayer = async (player: any, confirmNoSalary = false): Promise<void> => {
    if (!currentTeam) return;
    setSubmitting(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const res = await api(`/api/drafts/${draftId}/picks`, {
        method: 'POST',
        body: {
          action: 'make_pick',
          teamId: currentTeam.id,
          pickNumber: currentPickNumber,
          nhlPlayerId: Number(player.playerId),
          playerName: player.name,
          position: player.positionCode || 'F',
          team: player.teamAbbrev || 'NHL',
          confirmNoSalary,
        },
      });
      if (res.status === 409 && res.data.code === 'NO_SALARY') {
        setSubmitting(false);
        if (await confirmAsync('No salary on file', `${res.data.error}\n\nDraft at $0.00M, or cancel and use "Set salary" first.`, 'Draft at $0')) {
          return draftPlayer(player, true);
        }
        return;
      }
      if (!res.ok) throw new Error(res.data.error || 'Failed to make pick');
      setSuccessMsg(`Picked ${player.name} for ${currentTeam.team_name}!`);
      setQuery('');
      setResults([]);
      setHasSearched(false);
      load();
    } catch (e: any) {
      setErrorMsg(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const saveSalary = async () => {
    if (!salaryFor) return;
    const capHit = parseFloat(salaryInput);
    if (!Number.isFinite(capHit) || capHit < 0 || capHit >= 10000) {
      setSalaryError('Enter a valid cap hit in millions, e.g. 0.95');
      return;
    }
    try {
      const res = await api(`/api/drafts/${draftId}/salaries`, {
        method: 'PUT',
        body: { playerId: Number(salaryFor.playerId), playerName: salaryFor.name, capHit },
      });
      if (!res.ok) throw new Error(res.data.error || 'Failed to save salary');
      setSuccessMsg(`Set ${salaryFor.name}'s cap hit to $${capHit.toFixed(2)}M.`);
      setSalaryFor(null);
      load();
    } catch (e: any) {
      setSalaryError(e.message);
    }
  };

  const undoPick = async () => {
    if (picks.length === 0) return;
    if (!(await confirmAsync('Undo last pick?', 'Are you sure you want to undo the last pick?', 'Undo'))) return;
    setErrorMsg('');
    try {
      const res = await api(`/api/drafts/${draftId}/picks`, { method: 'POST', body: { action: 'undo_pick' } });
      if (!res.ok) throw new Error(res.data.error || 'Failed to undo pick');
      load();
    } catch (e: any) {
      setErrorMsg(e.message);
    }
  };

  const finalize = async () => {
    if (!(await confirmAsync('Finalize draft?', 'This locks the rosters and activates scoring.', 'Finalize'))) return;
    try {
      const res = await api(`/api/drafts/${draftId}/picks`, { method: 'POST', body: { action: 'finalize_draft' } });
      if (!res.ok) throw new Error(res.data.error || 'Failed to finalize');
      load();
      Alert.alert('Draft finalized', 'Standings and active scoring are now live.');
    } catch (e: any) {
      setErrorMsg(e.message);
    }
  };

  const addTeam = async () => {
    const name = newTeamName.trim();
    if (!name) return;
    try {
      const { error } = await supabase.from('draft_teams').insert({ draft_id: draftId, team_name: name, draft_order: teams.length + 1 });
      if (error) throw error;
      setNewTeamName('');
      load();
    } catch (e: any) {
      setErrorMsg(e.message);
    }
  };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={ui.body} keyboardShouldPersistTaps="handled">
      <View style={ui.rowBetween}>
        <View style={{ flex: 1 }}>
          <Text style={ui.title}>{draft.name}</Text>
          <Text style={ui.sub}>
            Invite code {draft.invite_code} • {draft.season_type === 'regular' ? 'Regular Season' : 'Playoffs'}
            {draft.salary_cap_enabled ? ` • Cap $${draft.salary_cap_amount}M` : ''} • {draft.status}
          </Text>
        </View>
      </View>
      <View style={[ui.row, ui.gap, { marginVertical: 12 }]}>
        <TouchableOpacity style={ui.buttonGhost} onPress={onOpenBoard}><Text style={ui.buttonText}>📺 Live Board</Text></TouchableOpacity>
        {draft.status !== 'confirmed' && (
          <TouchableOpacity style={ui.buttonGreen} onPress={finalize}><Text style={ui.buttonText}>🏁 Finalize</Text></TouchableOpacity>
        )}
      </View>

      {errorMsg ? <View style={[ui.banner, ui.bannerError]}><Text style={ui.errorText}>{errorMsg}</Text></View> : null}
      {successMsg ? <View style={[ui.banner, ui.bannerOk]}><Text style={ui.okText}>{successMsg}</Text></View> : null}
      {salaryWarning ? <View style={[ui.banner, ui.bannerWarn]}><Text style={ui.warnText}>{salaryWarning}</Text></View> : null}

      {showChecklist && (
        <View style={ui.card}>
          <Text style={ui.cardTitle}>Before you start drafting</Text>
          {checklist.map((c) => (
            <Text key={c.label} style={[ui.text, { marginBottom: 2 }, c.done && { color: '#34d399' }]}>
              {c.done ? '✓' : '○'} {c.label}{!c.done ? ` — ${c.hint}` : ''}
            </Text>
          ))}
        </View>
      )}

      {draft.status !== 'confirmed' && (
        <View style={ui.card}>
          <Text style={ui.sub}>Round {currentRound} • Pick #{currentPickNumber}</Text>
          <Text style={[ui.title, { marginTop: 2 }]}>On The Clock: {currentTeam ? currentTeam.team_name : 'No Teams'}</Text>
          {picks.length > 0 && (
            <TouchableOpacity style={[ui.buttonDanger, { alignSelf: 'flex-start', marginVertical: 8 }]} onPress={undoPick}>
              <Text style={ui.buttonText}>↩ Undo Last Pick</Text>
            </TouchableOpacity>
          )}

          {numTeams < 2 ? (
            <View style={[ui.banner, ui.bannerWarn, { marginTop: 8, marginBottom: 0 }]}>
              <Text style={ui.warnText}>Add at least 2 teams below before making picks!</Text>
            </View>
          ) : (
            <View style={{ marginTop: 8 }}>
              <TextInput
                style={ui.input}
                placeholder="Search player (e.g. McDavid, Makar)..."
                placeholderTextColor="#64748b"
                value={query}
                onChangeText={setQuery}
                onSubmitEditing={search}
                returnKeyType="search"
                autoCapitalize="none"
              />
              <TouchableOpacity style={[ui.button, searching && ui.disabled]} disabled={searching} onPress={search}>
                <Text style={ui.buttonText}>{searching ? 'Searching...' : 'Search'}</Text>
              </TouchableOpacity>

              {hasSearched && !searching && results.length === 0 && (
                <Text style={[ui.sub, { marginTop: 10 }]}>
                  No active players found for "{query}". Try just the last name, or check the spelling. Players who haven't been added to NHL
                  rosters yet won't appear.
                </Text>
              )}

              {results.map((player) => {
                const pid = Number(player.playerId);
                const isDrafted = draftedIds.has(pid);
                const cap = salaries.get(pid) || 0;
                return (
                  <View key={pid} style={[ui.rowBetween, { paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#3A506B', opacity: isDrafted ? 0.4 : 1 }]}>
                    <View style={{ flex: 1, paddingRight: 8 }}>
                      <Text style={ui.strong}>{player.name}</Text>
                      <Text style={ui.sub}>{player.positionCode} • {player.teamAbbrev}</Text>
                      {draft.salary_cap_enabled && (
                        cap > 0 ? (
                          <Text style={{ color: '#34d399', fontSize: 12 }}>Cap: ${cap.toFixed(2)}M</Text>
                        ) : (
                          <TouchableOpacity onPress={() => { setSalaryFor(player); setSalaryInput(''); setSalaryError(''); }}>
                            <Text style={{ color: '#fbbf24', fontSize: 12 }}>Salary unknown — <Text style={{ textDecorationLine: 'underline' }}>Set salary</Text></Text>
                          </TouchableOpacity>
                        )
                      )}
                    </View>
                    <TouchableOpacity
                      style={[ui.button, (isDrafted || submitting) && ui.disabled]}
                      disabled={isDrafted || submitting}
                      onPress={() => draftPlayer(player)}
                    >
                      <Text style={ui.buttonText}>{isDrafted ? 'Drafted' : 'Draft'}</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      )}

      <View style={ui.card}>
        <Text style={ui.cardTitle}>Draft Teams ({numTeams})</Text>
        {teams.map((t, idx) => (
          <View
            key={t.id}
            style={[ui.rowBetween, {
              padding: 10, borderRadius: 8, borderWidth: 1, marginBottom: 6,
              borderColor: currentTeam?.id === t.id && draft.status !== 'confirmed' ? '#38BDF8' : '#3A506B',
            }]}
          >
            <Text style={[ui.text, currentTeam?.id === t.id && { fontWeight: '800' }]}>#{idx + 1}. {t.team_name}</Text>
            <View style={ui.row}>
              <Text style={[ui.sub, { marginRight: 8 }]}>{picks.filter((p) => p.draft_team_id === t.id).length} picks</Text>
              {!orderLocked && numTeams > 1 && (
                <>
                  <TouchableOpacity style={[ui.chip, { marginRight: 4 }, idx === 0 && ui.disabled]} disabled={idx === 0} onPress={() => moveTeam(idx, -1)}>
                    <Text style={ui.chipText}>▲</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[ui.chip, { marginRight: 0 }, idx === numTeams - 1 && ui.disabled]} disabled={idx === numTeams - 1} onPress={() => moveTeam(idx, 1)}>
                    <Text style={ui.chipText}>▼</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        ))}

        <Text style={[ui.sub, { marginTop: 8, marginBottom: 6, fontWeight: '700' }]}>PICK ORDER</Text>
        <View style={ui.row}>
          {(['snake', 'linear'] as const).map((type) => (
            <TouchableOpacity
              key={type}
              disabled={orderLocked}
              style={[ui.chip, orderType === type && ui.chipActive, orderLocked && ui.disabled]}
              onPress={() => orderType !== type && updateOrder({ action: 'set_type', type })}
            >
              <Text style={[ui.chipText, orderType === type && ui.chipTextActive]}>{type === 'snake' ? 'Snake' : 'Standard'}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={[ui.sub, { marginVertical: 6 }]}>
          {orderType === 'snake'
            ? 'Snake: 1st→last in odd rounds, last→1st in even rounds.'
            : 'Standard: 1st→last in every round.'}
        </Text>
        {!orderLocked ? (
          <TouchableOpacity style={[ui.button, { alignSelf: 'flex-start' }, numTeams < 2 && ui.disabled]} disabled={numTeams < 2} onPress={randomize}>
            <Text style={ui.buttonText}>🎲 Randomize order</Text>
          </TouchableOpacity>
        ) : (
          <Text style={ui.warnText}>Order is locked once picks start. Undo all picks to change it.</Text>
        )}

        {draft.status === 'setup' && (
          <View style={[ui.row, { marginTop: 14 }]}>
            <TextInput
              style={[ui.input, { flex: 1, marginBottom: 0, marginRight: 8 }]}
              placeholder="Team name..."
              placeholderTextColor="#64748b"
              value={newTeamName}
              onChangeText={setNewTeamName}
              onSubmitEditing={addTeam}
            />
            <TouchableOpacity style={ui.button} onPress={addTeam}><Text style={ui.buttonText}>+ Add</Text></TouchableOpacity>
          </View>
        )}
      </View>

      <View style={ui.card}>
        <Text style={ui.cardTitle}>Draft Picks Log ({picks.length})</Text>
        {picks.length === 0 && <Text style={ui.empty}>No picks drafted yet.</Text>}
        {[...picks].reverse().map((pick) => {
          const team = teams.find((t) => t.id === pick.draft_team_id);
          return (
            <View key={pick.id} style={[ui.rowBetween, { paddingVertical: 6, borderTopWidth: 1, borderTopColor: '#3A506B' }]}>
              <Text style={[ui.text, { flex: 1 }]}>
                <Text style={ui.mono}>#{pick.pick_number} </Text>
                {pick.player_name} ({pick.player_position}) — {team?.team_name}
              </Text>
              {draft.salary_cap_enabled && <Text style={ui.sub}>${Number(pick.cap_hit).toFixed(1)}M</Text>}
            </View>
          );
        })}
      </View>

      <Modal visible={!!salaryFor} transparent animationType="fade" onRequestClose={() => setSalaryFor(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 }}>
          <View style={ui.card}>
            <Text style={ui.cardTitle}>Cap hit for {salaryFor?.name}</Text>
            <TextInput
              style={ui.input}
              value={salaryInput}
              onChangeText={setSalaryInput}
              keyboardType="decimal-pad"
              placeholder="In $M, e.g. 0.95"
              placeholderTextColor="#64748b"
            />
            {salaryError ? <Text style={[ui.errorText, { marginBottom: 8 }]}>{salaryError}</Text> : null}
            <View style={[ui.row, ui.gap]}>
              <TouchableOpacity style={ui.button} onPress={saveSalary}><Text style={ui.buttonText}>Save</Text></TouchableOpacity>
              <TouchableOpacity style={ui.buttonGhost} onPress={() => setSalaryFor(null)}><Text style={ui.buttonText}>Cancel</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}
