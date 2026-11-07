import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Share } from 'react-native';
import { api } from '../lib/api';
import { ui } from '../lib/theme';

export default function StandingsScreen({ draftId }: { draftId: string }) {
  const [draft, setDraft] = useState<any>(null);
  const [standings, setStandings] = useState<any[]>([]);
  const [picks, setPicks] = useState<any[]>([]);
  const [teamStyles, setTeamStyles] = useState<Record<string, { color: string | null; icon: string | null }>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [statsError, setStatsError] = useState(false);

  const load = async () => {
    try {
      const res = await api(`/api/drafts/${draftId}/standings`);
      if (!res.ok) throw new Error(res.data.error || 'Could not load standings');
      const d = res.data;
      setLoadError('');
      setStatsError(Boolean(d.statsError));
      setDraft(d.draft);
      setStandings(d.standings || []);
      setPicks(d.picks || []);
      setTeamStyles(d.teamStyles ?? {});
      setExpanded((cur) => cur ?? d.standings?.[0]?.teamId ?? null);
    } catch (e: any) {
      setLoadError(e.message || 'Could not load standings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    load();
  }, [draftId]);

  const exportCsv = async () => {
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const rows = [
      ['Rank', 'Team', 'Owner', 'Active', 'IR', 'Cap Hit', 'Total Points'],
      ...standings.map((s) => [s.rank, s.teamName, s.ownerName, s.activePlayersCount, s.irPlayersCount, s.totalCapHit, s.totalPoints]),
    ];
    await Share.share({
      title: `${draft?.name || 'Standings'} standings`,
      message: rows.map((r) => r.map(esc).join(',')).join('\n'),
    });
  };

  if (loading) return <ActivityIndicator color="#48CAE4" style={{ marginTop: 32 }} />;

  if (!draft) {
    return (
      <View style={[ui.body, { alignItems: 'center' }]}>
        <Text style={[ui.errorText, { marginBottom: 12 }]}>{loadError || 'Standings are not available for this draft.'}</Text>
        <TouchableOpacity style={ui.button} onPress={() => { setLoading(true); load(); }}>
          <Text style={ui.buttonText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={ui.body}>
      <View style={ui.rowBetween}>
        <Text style={ui.title}>🏆 Standings</Text>
        <TouchableOpacity style={ui.buttonGhost} onPress={exportCsv}>
          <Text style={ui.buttonText}>⬇ Export CSV</Text>
        </TouchableOpacity>
      </View>
      <Text style={[ui.sub, { marginBottom: 12 }]}>
        Real-time standings based on official NHL statistics and date-stamped roster active time.
      </Text>

      {(statsError || loadError) && (
        <View style={[ui.banner, ui.bannerWarn]}>
          <Text style={ui.warnText}>
            {statsError
              ? 'NHL stats are temporarily unavailable, so the points below may show as 0. Your picks are safe; check back in a few minutes.'
              : `Couldn't refresh standings (${loadError}). Showing the last loaded data.`}
          </Text>
          <TouchableOpacity onPress={load}><Text style={[ui.link, { marginTop: 6 }]}>Refresh</Text></TouchableOpacity>
        </View>
      )}

      {standings.length === 0 && <Text style={ui.empty}>No teams in this draft yet.</Text>}

      {standings.map((st) => {
        const isOpen = expanded === st.teamId;
        const teamPicks = picks.filter((p) => p.draft_team_id === st.teamId);
        const style = teamStyles[st.teamId];
        return (
          <View key={st.teamId} style={ui.card}>
            <TouchableOpacity onPress={() => setExpanded(isOpen ? null : st.teamId)}>
              <View style={ui.rowBetween}>
                <View style={[ui.row, { flex: 1 }]}>
                  <Text style={[ui.strong, { width: 40 }]}>
                    {st.rank === 1 ? '🥇' : st.rank === 2 ? '🥈' : st.rank === 3 ? '🥉' : `#${st.rank}`}
                  </Text>
                  {style?.icon ? (
                    <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: style.color ?? 'transparent', alignItems: 'center', justifyContent: 'center', marginRight: 8 }}>
                      <Text>{style.icon}</Text>
                    </View>
                  ) : null}
                  <View style={{ flex: 1 }}>
                    <Text style={ui.strong}>{st.teamName} {isOpen ? '▲' : '▼'}</Text>
                    <Text style={ui.sub}>
                      {st.ownerName} • {st.activePlayersCount} active • {st.irPlayersCount} IR
                      {draft.salary_cap_enabled ? ` • $${Number(st.totalCapHit).toFixed(2)}M` : ''}
                    </Text>
                  </View>
                </View>
                <Text style={[ui.title, { color: '#7dd3fc', marginBottom: 0 }]}>{Number(st.totalPoints).toFixed(1)}</Text>
              </View>
            </TouchableOpacity>

            {isOpen && (
              <View style={{ marginTop: 10 }}>
                {teamPicks.length === 0 && <Text style={ui.sub}>No players drafted yet.</Text>}
                {teamPicks.map((p) => (
                  <View key={p.id} style={[ui.rowBetween, { paddingVertical: 6, borderTopWidth: 1, borderTopColor: '#3A506B' }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={[ui.text, p.roster_status === 'ir' && { color: '#fcd34d' }]}>
                        {p.player_name} ({p.player_position}){p.roster_status === 'ir' ? ' • IR' : ''}
                      </Text>
                      <Text style={ui.sub}>
                        {p.player_team}{draft.salary_cap_enabled ? ` • $${Number(p.cap_hit).toFixed(1)}M` : ''}
                        {p.roster_status === 'ir' ? ' • Points frozen' : ''}
                      </Text>
                    </View>
                    <Text style={ui.strong}>{Number(p.liveScore || 0).toFixed(1)} pts</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}
