import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  SafeAreaView,
  TextInput,
  TouchableOpacity,
  FlatList,
  ScrollView,
  StatusBar,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { supabase } from './src/lib/supabase';
import type { Draft, DraftTeam, DraftPick, Profile } from '../shared/types';
import { validateRosterSwap, normalizePositionGroup, getNextEasternMidnight } from '../shared/roster-validation';

export default function App() {
  const [sessionUser, setSessionUser] = useState<any>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  // Auth fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isRegister, setIsRegister] = useState(false);
  const [authError, setAuthError] = useState('');

  // Dashboard / Navigation
  const [currentScreen, setCurrentScreen] = useState<'dashboard' | 'draft_board' | 'roster_ir' | 'admin_console'>('dashboard');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [selectedDraft, setSelectedDraft] = useState<Draft | null>(null);

  // Active Draft Data
  const [teams, setTeams] = useState<DraftTeam[]>([]);
  const [picks, setPicks] = useState<DraftPick[]>([]);
  const [userTeam, setUserTeam] = useState<DraftTeam | null>(null);

  // Join Code modal/input
  const [joinCode, setJoinCode] = useState('');
  const [joinTeamName, setJoinTeamName] = useState('');

  // IR Swap state
  const [selectedActiveIds, setSelectedActiveIds] = useState<string[]>([]);
  const [selectedIrIds, setSelectedIrIds] = useState<string[]>([]);

  // Check auth
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSessionUser(session?.user ?? null);
      if (session?.user) loadUserProfile(session.user.id);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSessionUser(session?.user ?? null);
      if (session?.user) loadUserProfile(session.user.id);
    });

    return () => subscription.unsubscribe();
  }, []);

  const loadUserProfile = async (userId: string) => {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).single();
    if (data) setProfile(data as Profile);
    loadDrafts(userId);
  };

  const loadDrafts = async (userId: string) => {
    const { data: managed } = await supabase.from('drafts').select('*').eq('admin_id', userId);
    const { data: joined } = await supabase
      .from('draft_teams')
      .select('drafts(*)')
      .eq('user_id', userId);

    const allDrafts: Draft[] = [
      ...(managed || []),
      ...((joined || []).map((j: any) => j.drafts).filter(Boolean)),
    ];
    setDrafts(allDrafts);
  };

  // Auth Submit
  const handleAuth = async () => {
    setAuthError('');
    if (!email || !password) {
      setAuthError('Please fill in email and password');
      return;
    }

    if (isRegister) {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) setAuthError(error.message);
      else Alert.alert('Success', 'Account created! Please sign in.');
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setAuthError(error.message);
    }
  };

  // Open Draft
  const openDraft = async (draft: Draft) => {
    setSelectedDraft(draft);
    setLoading(true);

    const { data: t } = await supabase.from('draft_teams').select('*').eq('draft_id', draft.id);
    const { data: p } = await supabase.from('draft_picks').select('*').eq('draft_id', draft.id).order('pick_number');

    if (t) {
      setTeams(t as DraftTeam[]);
      if (sessionUser) {
        const myTeam = t.find((team: any) => team.user_id === sessionUser.id);
        setUserTeam(myTeam || null);
      }
    }
    if (p) setPicks(p as DraftPick[]);

    setLoading(false);
    setCurrentScreen('draft_board');
  };

  // Real-time Pick Updates for Mobile
  useEffect(() => {
    if (!selectedDraft) return;

    const channel = supabase
      .channel(`mobile-draft-${selectedDraft.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'draft_picks', filter: `draft_id=eq.${selectedDraft.id}` },
        (payload) => {
          setPicks((prev) => [...prev, payload.new as DraftPick]);
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'draft_picks', filter: `draft_id=eq.${selectedDraft.id}` },
        () => {
          if (selectedDraft) openDraft(selectedDraft);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedDraft?.id]);

  // Handle Join Pool
  const handleJoinPool = async () => {
    if (!joinCode || !joinTeamName || !sessionUser) {
      Alert.alert('Error', 'Please enter invite code and team name');
      return;
    }

    const { data: d, error: dErr } = await supabase
      .from('drafts')
      .select('id, name')
      .eq('invite_code', joinCode.trim().toUpperCase())
      .single();

    if (dErr || !d) {
      Alert.alert('Error', 'Invalid invite code.');
      return;
    }

    const { count } = await supabase
      .from('draft_teams')
      .select('*', { count: 'exact', head: true })
      .eq('draft_id', d.id);

    const { error: teamErr } = await supabase.from('draft_teams').insert({
      draft_id: d.id,
      user_id: sessionUser.id,
      team_name: joinTeamName.trim(),
      draft_order: (count || 0) + 1,
    });

    if (teamErr) {
      Alert.alert('Error', teamErr.message);
    } else {
      Alert.alert('Success', `Joined ${d.name}!`);
      setJoinCode('');
      setJoinTeamName('');
      loadDrafts(sessionUser.id);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color="#48CAE4" />
      </SafeAreaView>
    );
  }

  // SCREEN 1: LOGIN / REGISTER
  if (!sessionUser) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" />
        <View style={styles.authBox}>
          <Text style={styles.logoText}>🏒 HockeyPool</Text>
          <Text style={styles.tagline}>Mobile Live Draft & Fantasy Hockey</Text>

          {authError ? <Text style={styles.errorText}>{authError}</Text> : null}

          <TextInput
            style={styles.input}
            placeholder="Email Address"
            placeholderTextColor="#64748b"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />

          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor="#64748b"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          <TouchableOpacity style={styles.primaryButton} onPress={handleAuth}>
            <Text style={styles.primaryButtonText}>{isRegister ? 'Register' : 'Sign In'}</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => setIsRegister(!isRegister)} style={styles.switchAuth}>
            <Text style={styles.switchAuthText}>
              {isRegister ? 'Already have an account? Sign In' : "Don't have an account? Register"}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // SCREEN 2: DASHBOARD
  if (currentScreen === 'dashboard') {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" />
        <View style={styles.header}>
          <View>
            <Text style={styles.headerTitle}>🏒 HockeyPool</Text>
            <Text style={styles.headerSubtitle}>{profile?.email}</Text>
          </View>
          <TouchableOpacity onPress={() => supabase.auth.signOut()}>
            <Text style={styles.signOutText}>Sign Out</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.body}>
          {/* Join Draft Box */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>🎟️ Join Draft Pool</Text>
            <TextInput
              style={styles.input}
              placeholder="8-Character Invite Code"
              placeholderTextColor="#64748b"
              value={joinCode}
              onChangeText={setJoinCode}
              autoCapitalize="characters"
            />
            <TextInput
              style={styles.input}
              placeholder="Your Team Name"
              placeholderTextColor="#64748b"
              value={joinTeamName}
              onChangeText={setJoinTeamName}
            />
            <TouchableOpacity style={styles.secondaryButton} onPress={handleJoinPool}>
              <Text style={styles.secondaryButtonText}>Join with Code</Text>
            </TouchableOpacity>
          </View>

          {/* Drafts List */}
          <Text style={styles.sectionHeader}>Your Draft Pools ({drafts.length})</Text>
          {drafts.length === 0 ? (
            <Text style={styles.emptyText}>You haven't joined any draft pools yet.</Text>
          ) : (
            drafts.map((d) => (
              <TouchableOpacity key={d.id} style={styles.draftCard} onPress={() => openDraft(d)}>
                <View>
                  <Text style={styles.draftName}>{d.name}</Text>
                  <Text style={styles.draftSub}>
                    {d.season_type === 'regular' ? 'Regular Season' : 'Playoffs'} • Status: {d.status}
                  </Text>
                </View>
                <Text style={styles.arrowText}>➔</Text>
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // SCREEN 3: LIVE DRAFT BOARD & ADMIN/ROSTER TABS
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      {/* Top Navigation */}
      <View style={styles.draftHeader}>
        <TouchableOpacity onPress={() => setCurrentScreen('dashboard')}>
          <Text style={styles.backButtonText}>← Dashboard</Text>
        </TouchableOpacity>
        <Text style={styles.draftHeaderTitle} numberOfLines={1}>
          {selectedDraft?.name}
        </Text>
      </View>

      {/* Tabs */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tabItem, currentScreen === 'draft_board' && styles.tabActive]}
          onPress={() => setCurrentScreen('draft_board')}
        >
          <Text style={[styles.tabText, currentScreen === 'draft_board' && styles.tabTextActive]}>
            Live Board ({picks.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabItem, currentScreen === 'roster_ir' && styles.tabActive]}
          onPress={() => setCurrentScreen('roster_ir')}
        >
          <Text style={[styles.tabText, currentScreen === 'roster_ir' && styles.tabTextActive]}>
            My Team & IR
          </Text>
        </TouchableOpacity>
      </View>

      {/* DRAFT BOARD TAB */}
      {currentScreen === 'draft_board' && (
        <View style={styles.flexOne}>
          <FlatList
            data={picks.slice().reverse()}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => {
              const team = teams.find((t) => t.id === item.draft_team_id);
              return (
                <View style={styles.pickRow}>
                  <View style={styles.pickInfo}>
                    <Text style={styles.pickNum}>#{item.pick_number}</Text>
                    <View>
                      <Text style={styles.pickPlayer}>{item.player_name}</Text>
                      <Text style={styles.pickDetails}>
                        {item.player_position} • {item.player_team} • {team?.team_name}
                      </Text>
                    </View>
                  </View>
                  {selectedDraft?.salary_cap_enabled && (
                    <Text style={styles.pickCap}>${Number(item.cap_hit).toFixed(1)}M</Text>
                  )}
                </View>
              );
            }}
            ListEmptyComponent={
              <Text style={styles.emptyText}>No draft picks recorded yet.</Text>
            }
          />
        </View>
      )}

      {/* ROSTER & IR TAB */}
      {currentScreen === 'roster_ir' && (
        <ScrollView style={styles.flexOne}>
          {!userTeam ? (
            <Text style={styles.emptyText}>You do not have a team in this draft.</Text>
          ) : (
            <View style={styles.body}>
              <Text style={styles.sectionHeader}>{userTeam.team_name}</Text>
              <Text style={styles.draftSub}>Manage Active & IR Roster Swaps</Text>

              {/* Active Players */}
              <Text style={[styles.cardTitle, { marginTop: 15 }]}>Active Roster</Text>
              {picks
                .filter((p) => p.draft_team_id === userTeam.id && p.roster_status === 'active')
                .map((p) => (
                  <View key={p.id} style={styles.rosterRow}>
                    <Text style={styles.pickPlayer}>{p.player_name} ({p.player_position})</Text>
                    <Text style={styles.pickDetails}>{p.player_team}</Text>
                  </View>
                ))}

              {/* IR Players */}
              <Text style={[styles.cardTitle, { marginTop: 15 }]}>Injured Reserve (IR)</Text>
              {picks
                .filter((p) => p.draft_team_id === userTeam.id && p.roster_status === 'ir')
                .map((p) => (
                  <View key={p.id} style={styles.rosterRow}>
                    <Text style={styles.pickPlayer}>{p.player_name} ({p.player_position})</Text>
                    <Text style={[styles.pickDetails, { color: '#fbbf24' }]}>IR</Text>
                  </View>
                ))}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B132B',
  },
  flexOne: {
    flex: 1,
  },
  authBox: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  logoText: {
    fontSize: 32,
    fontWeight: '900',
    color: '#38BDF8',
    textAlign: 'center',
  },
  tagline: {
    fontSize: 14,
    color: '#94a3b8',
    textAlign: 'center',
    marginBottom: 32,
    marginTop: 4,
  },
  input: {
    backgroundColor: '#1C2541',
    borderWidth: 1,
    borderColor: '#3A506B',
    borderRadius: 8,
    color: '#f8fafc',
    padding: 12,
    marginBottom: 12,
  },
  primaryButton: {
    backgroundColor: '#0284C7',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  switchAuth: {
    marginTop: 16,
    alignItems: 'center',
  },
  switchAuthText: {
    color: '#38BDF8',
    fontSize: 13,
  },
  errorText: {
    color: '#f43f5e',
    fontSize: 13,
    marginBottom: 12,
    textAlign: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#3A506B',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#38BDF8',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#94a3b8',
  },
  signOutText: {
    color: '#f43f5e',
    fontSize: 13,
  },
  body: {
    padding: 16,
  },
  card: {
    backgroundColor: '#1C2541',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#3A506B',
    marginBottom: 20,
  },
  cardTitle: {
    color: '#f8fafc',
    fontWeight: 'bold',
    fontSize: 16,
    marginBottom: 12,
  },
  secondaryButton: {
    backgroundColor: '#3A506B',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#f8fafc',
    fontWeight: '600',
    fontSize: 14,
  },
  sectionHeader: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  draftCard: {
    backgroundColor: '#1C2541',
    borderWidth: 1,
    borderColor: '#3A506B',
    padding: 16,
    borderRadius: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  draftName: {
    color: '#f8fafc',
    fontWeight: 'bold',
    fontSize: 15,
  },
  draftSub: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 2,
  },
  arrowText: {
    color: '#38BDF8',
    fontSize: 18,
  },
  emptyText: {
    color: '#64748b',
    textAlign: 'center',
    padding: 24,
    fontSize: 14,
  },
  draftHeader: {
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#3A506B',
  },
  backButtonText: {
    color: '#38BDF8',
    fontSize: 14,
    fontWeight: '600',
    marginRight: 16,
  },
  draftHeaderTitle: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: 'bold',
    flex: 1,
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#3A506B',
    backgroundColor: '#1C2541',
  },
  tabItem: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: '#38BDF8',
  },
  tabText: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#38BDF8',
  },
  pickRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1C2541',
  },
  pickInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  pickNum: {
    color: '#64748b',
    fontFamily: 'monospace',
    marginRight: 12,
    fontSize: 13,
  },
  pickPlayer: {
    color: '#f8fafc',
    fontWeight: 'bold',
    fontSize: 14,
  },
  pickDetails: {
    color: '#94a3b8',
    fontSize: 12,
  },
  pickCap: {
    color: '#34d399',
    fontFamily: 'monospace',
    fontWeight: 'bold',
    fontSize: 13,
  },
  rosterRow: {
    backgroundColor: '#1C2541',
    padding: 12,
    borderRadius: 8,
    marginBottom: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
