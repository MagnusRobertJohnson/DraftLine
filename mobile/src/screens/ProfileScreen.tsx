import React, { useEffect, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { ui } from '../lib/theme';
import type { Draft, Profile } from '../../../shared/types';

type Summary = { id: string; name: string; status: string; season_id: string; role: string; teamName: string | null; playerCount: number };
type Membership = { team_name: string; drafts: Pick<Draft, 'id' | 'name' | 'status' | 'season_id' | 'admin_id'> | null; draft_picks: { id: string }[] };

export default function ProfileScreen({ userId, onBack, onSettings }: { userId: string; onBack: () => void; onSettings: () => void }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [drafts, setDrafts] = useState<Summary[]>([]);
  const [error, setError] = useState('');
  const load = async () => {
    const [profileRes, managedRes, teamsRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).single(),
      supabase.from('drafts').select('id, name, status, season_id').eq('admin_id', userId),
      supabase.from('draft_teams').select('team_name, drafts(id, name, status, season_id, admin_id), draft_picks(id)')
        .eq('user_id', userId).overrideTypes<Membership[], { merge: false }>(),
    ]);
    const failure = profileRes.error || managedRes.error || teamsRes.error;
    if (failure) { setError(failure.message); return; }
    setProfile(profileRes.data as Profile);
    const summaries = new Map<string, Summary>();
    for (const draft of managedRes.data || []) {
      summaries.set(draft.id, { ...draft, role: 'Admin', teamName: null, playerCount: 0 });
    }
    for (const membership of teamsRes.data || []) {
      const draft = membership.drafts;
      if (!draft) continue;
      summaries.set(draft.id, {
        id: draft.id, name: draft.name, status: draft.status, season_id: draft.season_id,
        role: draft.admin_id === userId ? 'Admin' : 'Member', teamName: membership.team_name,
        playerCount: membership.draft_picks?.length ?? 0,
      });
    }
    setDrafts([...summaries.values()]);
    setError('');
  };
  useEffect(() => { load(); }, [userId]);
  const joined = drafts.filter((draft) => draft.teamName);
  return <ScrollView contentContainerStyle={ui.body}>
    <View style={ui.rowBetween}>
      <TouchableOpacity onPress={onBack}><Text style={ui.link}>← Dashboard</Text></TouchableOpacity>
      <TouchableOpacity onPress={onSettings}><Text style={ui.link}>Settings</Text></TouchableOpacity>
    </View>
    {error ? <View style={ui.banner}><Text style={ui.errorText}>{error}</Text>
      <TouchableOpacity onPress={load}><Text style={ui.link}>Try again</Text></TouchableOpacity></View> : null}
    {profile && <>
      <Text style={[ui.title, { marginTop: 12 }]}>{profile.display_name || profile.email}</Text>
      <Text style={ui.sub}>{profile.email}</Text>
      <View style={[ui.card, { marginTop: 12 }]}>
        <Text style={ui.text}>Drafts joined: {joined.length}</Text>
        <Text style={ui.text}>Drafts managed: {drafts.filter((draft) => draft.role === 'Admin').length}</Text>
        <Text style={ui.text}>Completed drafts: {joined.filter((draft) => draft.status === 'completed').length}</Text>
        <Text style={ui.text}>Players drafted: {joined.reduce((sum, draft) => sum + draft.playerCount, 0)}</Text>
      </View>
      <Text style={ui.cardTitle}>My drafts</Text>
      {drafts.length === 0 && <Text style={ui.sub}>You haven't joined any drafts yet.</Text>}
      {drafts.map((draft) => <View style={ui.card} key={draft.id}>
        <Text style={ui.strong}>{draft.name}</Text>
        <Text style={ui.sub}>{draft.role} {draft.teamName ? `· ${draft.teamName}` : ''} · Season {draft.season_id} · {draft.status}</Text>
      </View>)}
    </>}
  </ScrollView>;
}
