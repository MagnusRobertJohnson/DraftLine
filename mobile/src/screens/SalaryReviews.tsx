import React, { useEffect, useState } from 'react';
import { Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { SalaryReview } from '../../../shared/salary';
import { buildSalaryReviewChoices, type SalaryReviewInputs } from '../../../shared/salary-review';
import { formatReviewPlayerStats, type SalaryReviewPlayerInfo } from '../../../shared/salary-review-stats';
import { api } from '../lib/api';
import { ui } from '../lib/theme';

export default function SalaryReviews({ refresh, onSaved }: { refresh: number; onSaved: () => void }) {
  const [reviews, setReviews] = useState<SalaryReview[]>([]);
  const [open, setOpen] = useState(false);
  const [inputs, setInputs] = useState<SalaryReviewInputs>({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [playerInfo, setPlayerInfo] = useState<Record<number, SalaryReviewPlayerInfo>>({});
  const [statsWarning, setStatsWarning] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await api('/api/players/salary-reviews');
      if (!res.ok) throw new Error(res.data.error || 'Could not load salary reviews');
      setReviews(res.data.reviews);
      setPlayerInfo(res.data.playerInfo ?? {});
      setStatsWarning(res.data.statsWarning ?? null);
      setError('');
      if (refresh > 0 && res.data.reviews.length) setOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load salary reviews');
    }
  };
  useEffect(() => { void load(); }, [refresh]);

  const save = async (review: SalaryReview) => {
    setError('');
    try {
      const choices = buildSalaryReviewChoices(review, inputs);
      setSaving(true);
      const res = await api('/api/players/salary-reviews', {
        method: 'POST', body: { key: review.key, fingerprint: review.fingerprint, choices },
      });
      if (!res.ok) throw new Error(res.data.error || 'Could not save salary review');
      setInputs({});
      await load();
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save salary review');
    } finally {
      setSaving(false);
    }
  };
  const update = (id: number, patch: Partial<{ selection: string; manual: string }>) =>
    setInputs((previous) => ({ ...previous, [id]: { ...(previous[id] ?? { selection: '', manual: '' }), ...patch } }));

  return (
    <>
      {error ? (
        <View style={[ui.banner, ui.bannerError]}>
          <Text style={ui.errorText}>{error}</Text>
          <TouchableOpacity onPress={load}><Text style={ui.link}>Reload reviews</Text></TouchableOpacity>
        </View>
      ) : null}
      {reviews.length > 0 && (
        <View style={[ui.banner, ui.bannerWarn]}>
          <Text style={ui.warnText}>{reviews.length} salary match group{reviews.length === 1 ? '' : 's'} need review. Their shared salaries are unknown until resolved.</Text>
          <TouchableOpacity onPress={() => setOpen(true)}><Text style={ui.link}>Review players</Text></TouchableOpacity>
        </View>
      )}
      <Modal visible={open && reviews.length > 0} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={ui.container}>
          <ScrollView contentContainerStyle={ui.body}>
            <View style={ui.rowBetween}>
              <Text style={ui.title}>Review ambiguous salaries</Text>
              <TouchableOpacity onPress={() => setOpen(false)}><Text style={ui.link}>Close</Text></TouchableOpacity>
            </View>
            <Text style={[ui.sub, { marginBottom: 12 }]}>
              Confirm a previous salary, choose a source salary, enter a different salary, or mark each player unknown. These values may be from an earlier sync and are not verified recommendations. Shared salaries are rounded to $0.01M. Private overrides still take precedence for their owner; locked drafts are unchanged.
            </Text>
            {error ? <Text style={ui.errorText}>{error}</Text> : null}
            {statsWarning ? <Text style={ui.warnText}>{statsWarning}</Text> : null}
            {reviews.map((review) => (
              <View key={review.key} style={ui.card}>
                <Text style={ui.cardTitle}>Possible source salaries</Text>
                {review.details.salaries.map((salary, index) => (
                  <Text key={index} style={ui.text}>
                    {index + 1}. {salary.name}: ${salary.capHit.toFixed(3)}M{salary.teamAbbrev ? ` — ${salary.teamAbbrev}` : ''}{salary.position ? `, ${salary.position}` : ''}
                  </Text>
                ))}
                {review.details.players.map((player) => {
                  const selection = inputs[player.id]?.selection || '';
                  const options = [
                    { value: 'unknown', label: 'Mark unknown' },
                    { value: 'manual', label: 'Enter a salary' },
                    ...(Number(review.details.previousSalaries?.[player.id]) > 0
                      ? [{ value: 'previous', label: `Keep previous shared salary: $${Number(review.details.previousSalaries?.[player.id]).toFixed(2)}M` }] : []),
                    ...review.details.salaries.map((s, index) => ({
                      value: `source:${index}`,
                      label: `Source ${index + 1}: ${s.name} — $${s.capHit.toFixed(3)}M${s.teamAbbrev ? ` (${s.teamAbbrev})` : ''}`,
                    })),
                  ];
                  return (
                    <View key={player.id} style={{ marginTop: 16 }}>
                      <Text style={ui.strong}>{player.fullName} — {player.teamAbbrev || 'team unavailable'} — {playerInfo[player.id]?.position || 'position unavailable'} — NHL ID {player.id}</Text>
                      <Text style={ui.sub}>{formatReviewPlayerStats(playerInfo[player.id])}</Text>
                      {options.map((option) => (
                        <TouchableOpacity key={option.value} onPress={() => update(player.id, { selection: option.value })}
                          accessibilityRole="radio" accessibilityState={{ checked: selection === option.value }}
                          style={[ui.buttonGhost, { marginTop: 6, alignItems: 'flex-start' }, selection === option.value && { borderColor: '#38BDF8' }]}>
                          <Text style={ui.text}>{selection === option.value ? '✓ ' : ''}{option.label}</Text>
                        </TouchableOpacity>
                      ))}
                      {selection === 'manual' && (
                        <TextInput style={[ui.input, { marginTop: 6 }]} keyboardType="decimal-pad"
                          accessibilityLabel={`Salary in millions for ${player.fullName}, NHL ID ${player.id}`}
                          placeholder="Salary in millions, e.g. 0.95" placeholderTextColor="#64748b"
                          value={inputs[player.id]?.manual || ''} onChangeText={(text) => update(player.id, { manual: text })} />
                      )}
                    </View>
                  );
                })}
                <TouchableOpacity style={[ui.button, { marginTop: 16 }, saving && ui.disabled]} disabled={saving} onPress={() => save(review)}>
                  <Text style={ui.buttonText}>{saving ? 'Saving...' : 'Save shared salaries'}</Text>
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}
