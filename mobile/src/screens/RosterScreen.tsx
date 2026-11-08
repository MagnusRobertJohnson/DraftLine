import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import type { Draft, DraftPick, DraftTeam } from '../../../shared/types';
import { validateRosterSwap } from '../../../shared/roster-validation';
import { api } from '../lib/api';
import { supabase } from '../lib/supabase';
import { ui } from '../lib/theme';

type Pending = { id: string; effective_at: string; roster_transaction_players: { draft_pick_id: string; to_status: string; draft_picks: { player_name: string } | null }[] };

export default function RosterScreen({ draft, team, picks, refresh }: {
  draft: Draft; team: DraftTeam | null; picks: DraftPick[]; refresh: () => void;
}) {
  const [active, setActive] = useState<string[]>([]);
  const [ir, setIr] = useState<string[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const roster = picks.filter((pick) => pick.draft_team_id === team?.id);
  const validation = validateRosterSwap(draft, roster, active, ir);

  const loadPending = async () => {
    if (!team) return;
    const { data, error: loadError } = await supabase.from('roster_transactions')
      .select('id, effective_at, roster_transaction_players(draft_pick_id, to_status, draft_picks(player_name))')
      .eq('draft_team_id', team.id).eq('status', 'pending').overrideTypes<Pending[], { merge: false }>();
    if (loadError) setError(loadError.message);
    else { setPending(data || []); setError(''); }
  };
  useEffect(() => { loadPending(); }, [team?.id]);

  const submit = async () => {
    if (!team || !validation.valid) return;
    setBusy(true);
    try {
      const result = await api(`/api/drafts/${draft.id}/roster/swap`, {
        method: 'POST', body: { teamId: team.id, outgoingActivePickIds: active, incomingIrPickIds: ir },
      });
      if (!result.ok) throw new Error(result.data.error || 'Could not schedule swap.');
      setActive([]); setIr([]);
      Alert.alert('Swap scheduled', 'The swap takes effect at midnight Eastern Time.');
      await loadPending(); refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not schedule swap.');
    } finally { setBusy(false); }
  };
  const cancel = async (id: string) => {
    try {
      const result = await api(`/api/drafts/${draft.id}/roster/swap?transactionId=${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!result.ok) throw new Error(result.data.error || 'Could not cancel swap.');
      await loadPending(); refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not cancel swap.'); }
  };
  if (!team) return <Text style={ui.empty}>You do not have a team in this draft.</Text>;
  return <ScrollView contentContainerStyle={ui.body}>
    <Text style={ui.title}>{team.team_name}</Text>
    <Text style={ui.sub}>Select active and IR players to swap. Matching positions are required.</Text>
    {error ? <Text style={[ui.errorText, { marginVertical: 8 }]}>{error}</Text> : null}
    {(['active', 'ir'] as const).map((status) => <View style={[ui.card, { marginTop: 12 }]} key={status}>
      <Text style={ui.cardTitle}>{status === 'active' ? 'Active roster' : 'Injured reserve'}</Text>
      {roster.filter((pick) => pick.roster_status === status).map((pick) => {
        const selected = status === 'active' ? active : ir;
        const update = status === 'active' ? setActive : setIr;
        return <TouchableOpacity key={pick.id} onPress={() => update((previous) =>
          previous.includes(pick.id) ? previous.filter((id) => id !== pick.id) : [...previous, pick.id])}>
          <Text style={[ui.text, { paddingVertical: 8 }]}>{selected.includes(pick.id) ? '☑' : '☐'} {pick.player_name} ({pick.player_position}) · ${Number(pick.cap_hit).toFixed(2)}M</Text>
        </TouchableOpacity>;
      })}
    </View>)}
    {(active.length > 0 || ir.length > 0) && !validation.valid && <Text style={ui.warnText}>{validation.error}</Text>}
    <TouchableOpacity style={[ui.button, (!validation.valid || busy) && ui.disabled]} disabled={!validation.valid || busy} onPress={submit}>
      <Text style={ui.buttonText}>{busy ? 'Scheduling...' : 'Schedule swap'}</Text>
    </TouchableOpacity>
    <Text style={[ui.cardTitle, { marginTop: 16 }]}>Pending swaps</Text>
    {pending.length === 0 && <Text style={ui.sub}>No pending swaps.</Text>}
    {pending.map((tx) => <View key={tx.id} style={ui.card}>
      <Text style={ui.text}>Effective {new Date(tx.effective_at).toLocaleString()}</Text>
      {tx.roster_transaction_players.map((player) => <Text style={ui.sub} key={player.draft_pick_id}>
        {player.draft_picks?.player_name || 'Player'} → {player.to_status.toUpperCase()}
      </Text>)}
      <TouchableOpacity onPress={() => cancel(tx.id)}><Text style={ui.link}>Cancel swap</Text></TouchableOpacity>
    </View>)}
  </ScrollView>;
}
