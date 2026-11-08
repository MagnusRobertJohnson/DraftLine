import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { CURRENT_SEASON } from '../../../shared/nhl';
import type { Draft } from '../../../shared/types';
import { supabase } from '../lib/supabase';
import { ui } from '../lib/theme';

type Settings = {
  season_type: 'regular' | 'playoffs';
  forwards_count: number;
  defense_count: number;
  goalies_count: number;
  injured_reserve_count: number;
  salary_cap_enabled: boolean;
  salary_cap_amount: number;
};
type Template = { id: string; name: string; settings: Settings; scoring: { stat: string; enabled: boolean; weight: number }[] };

export default function CreateDraftScreen({ userId, onBack, onCreated }: {
  userId: string; onBack: () => void; onCreated: (draft: Draft) => void;
}) {
  const [name, setName] = useState('');
  const [seasonType, setSeasonType] = useState<'regular' | 'playoffs'>('regular');
  const [forwards, setForwards] = useState('9');
  const [defense, setDefense] = useState('4');
  const [goalies, setGoalies] = useState('2');
  const [ir, setIr] = useState('2');
  const [capEnabled, setCapEnabled] = useState(false);
  const [cap, setCap] = useState('88');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [saveTemplate, setSaveTemplate] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.from('draft_templates').select('id, name, settings, scoring')
      .eq('admin_id', userId).order('created_at', { ascending: false })
      .then(({ data, error: loadError }) => {
        if (loadError) setError(`Could not load templates: ${loadError.message}`);
        else setTemplates((data || []) as Template[]);
      });
  }, [userId]);

  const applyTemplate = (template: Template) => {
    setTemplateId(template.id);
    setSeasonType(template.settings.season_type ?? 'regular');
    setForwards(String(template.settings.forwards_count));
    setDefense(String(template.settings.defense_count));
    setGoalies(String(template.settings.goalies_count));
    setIr(String(template.settings.injured_reserve_count));
    setCapEnabled(template.settings.salary_cap_enabled);
    setCap(String(template.settings.salary_cap_amount));
  };

  const create = async () => {
    const counts = [forwards, defense, goalies, ir].map(Number);
    if (!name.trim() || [forwards, defense, goalies, ir].some((value) => !/^\d+$/.test(value)) || counts.some((value) => !Number.isSafeInteger(value))) {
      setError('Enter a draft name and non-negative whole numbers for each roster position.');
      return;
    }
    if (capEnabled && (!cap.trim() || !Number.isFinite(Number(cap)) || Number(cap) <= 0)) {
      setError('Enter a positive salary cap in millions.');
      return;
    }
    setBusy(true);
    setError('');
    const settings: Settings = {
      season_type: seasonType, forwards_count: counts[0], defense_count: counts[1],
      goalies_count: counts[2], injured_reserve_count: counts[3],
      salary_cap_enabled: capEnabled, salary_cap_amount: Number(cap) || 0,
    };
    const { data, error: createError } = await supabase.from('drafts').insert({
      admin_id: userId, season_id: CURRENT_SEASON, name: name.trim(), ...settings,
    }).select().single();
    if (createError || !data) {
      setError(createError?.message || 'Draft could not be created.');
      setBusy(false);
      return;
    }
    const draft = data as Draft;
    const template = templates.find((item) => item.id === templateId);
    if (template) {
      for (const weight of template.scoring) {
        const { error: weightError } = await supabase.from('draft_scoring_weights')
          .update({ enabled: weight.enabled, weight: weight.weight })
          .eq('draft_id', draft.id).eq('stat', weight.stat);
        if (weightError) {
          setBusy(false);
          onCreated(draft);
          Alert.alert('Draft created with a warning', `The draft was created, but the template scoring could not be fully applied: ${weightError.message}`);
          return;
        }
      }
    }
    if (saveTemplate) {
      const { data: weights, error: weightsError } = await supabase.from('draft_scoring_weights')
        .select('stat, enabled, weight').eq('draft_id', draft.id);
      if (weightsError) {
        setBusy(false);
        onCreated(draft);
        Alert.alert('Draft created with a warning', `The draft was created, but its template could not be saved: ${weightsError.message}`);
        return;
      }
      const { error: templateError } = await supabase.from('draft_templates').insert({
        admin_id: userId, name: name.trim().slice(0, 60), settings, scoring: weights,
      });
      if (templateError) {
        setBusy(false);
        onCreated(draft);
        Alert.alert('Draft created with a warning', `The draft was created, but its template could not be saved: ${templateError.message}`);
        return;
      }
    }
    setBusy(false);
    onCreated(draft);
  };

  return (
    <ScrollView contentContainerStyle={ui.body} keyboardShouldPersistTaps="handled">
      <TouchableOpacity onPress={onBack}><Text style={ui.link}>← Dashboard</Text></TouchableOpacity>
      <Text style={[ui.title, { marginVertical: 12 }]}>Create draft</Text>
      {error ? <Text style={[ui.errorText, { marginBottom: 10 }]}>{error}</Text> : null}
      {templates.length > 0 && <View style={ui.card}>
        <Text style={ui.cardTitle}>Start from a template</Text>
        <TouchableOpacity onPress={() => setTemplateId('')}><Text style={ui.link}>{!templateId ? '✓ ' : ''}Default rules</Text></TouchableOpacity>
        {templates.map((template) => <TouchableOpacity key={template.id} onPress={() => applyTemplate(template)}>
          <Text style={[ui.link, { marginTop: 8 }]}>{templateId === template.id ? '✓ ' : ''}{template.name}</Text>
        </TouchableOpacity>)}
      </View>}
      <Text style={ui.sub}>Draft name</Text>
      <TextInput style={ui.input} value={name} onChangeText={setName} placeholder="Draft name" placeholderTextColor="#64748b" />
      <Text style={ui.sub}>Season type</Text>
      <View style={[ui.row, { marginVertical: 10 }]}>{(['regular', 'playoffs'] as const).map((type) =>
        <TouchableOpacity key={type} style={[ui.chip, seasonType === type && ui.chipActive]} onPress={() => setSeasonType(type)}>
          <Text style={[ui.chipText, seasonType === type && ui.chipTextActive]}>{type === 'regular' ? 'Regular season' : 'Playoffs'}</Text>
        </TouchableOpacity>)}</View>
      {([
        ['Forwards', forwards, setForwards], ['Defense', defense, setDefense],
        ['Goalies', goalies, setGoalies], ['Injured reserve', ir, setIr],
      ] as const).map(([label, value, setValue]) => <View key={label}>
        <Text style={ui.sub}>{label}</Text>
        <TextInput style={ui.input} keyboardType="number-pad" value={value} onChangeText={setValue} />
      </View>)}
      <View style={ui.rowBetween}><Text style={ui.text}>Enable salary cap</Text><Switch value={capEnabled} onValueChange={setCapEnabled} /></View>
      {capEnabled && <><Text style={ui.sub}>Salary cap ($ millions)</Text>
        <TextInput style={ui.input} keyboardType="decimal-pad" value={cap} onChangeText={setCap} /></>}
      <View style={ui.rowBetween}><Text style={ui.text}>Save settings as a template</Text><Switch value={saveTemplate} onValueChange={setSaveTemplate} /></View>
      <TouchableOpacity style={[ui.button, busy && ui.disabled]} disabled={busy} onPress={create}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={ui.buttonText}>Create draft</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}
