import React, { useEffect, useState } from 'react';
import { ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { ui } from '../lib/theme';
import type { Profile } from '../../../shared/types';

type SettingsProfile = Profile & {
  backup_email: string | null;
  backup_phone: string | null;
  notification_prefs: Record<string, boolean> | null;
};

const preferences = [
  ['invites', 'Draft invitations'], ['swaps', 'Roster swaps'], ['draft_updates', 'Draft updates'],
  ['chat', 'Chat messages'], ['push', 'Mobile push'], ['email', 'Email'],
] as const;

export default function SettingsScreen({ userId, onBack, onProfileChanged }: {
  userId: string; onBack: () => void; onProfileChanged: () => void;
}) {
  const [profile, setProfile] = useState<SettingsProfile | null>(null);
  const [name, setName] = useState('');
  const [backupEmail, setBackupEmail] = useState('');
  const [backupPhone, setBackupPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    const { data, error: loadError } = await supabase.from('profiles').select('*').eq('id', userId).single();
    if (loadError || !data) {
      setError(loadError?.message || 'Could not load settings.');
      return;
    }
    const value = data as SettingsProfile;
    setProfile(value);
    setName(value.display_name ?? '');
    setBackupEmail(value.backup_email ?? '');
    setBackupPhone(value.backup_phone ?? '');
    setPrefs(value.notification_prefs ?? {});
    setError('');
  };
  useEffect(() => { load(); }, [userId]);

  const show = (err: { message: string } | null, success: string) => {
    setError(err?.message ?? '');
    setMessage(err ? '' : success);
  };
  const save = async () => {
    const { error: saveError } = await supabase.from('profiles').update({
      display_name: name.trim() || null, backup_email: backupEmail.trim() || null, backup_phone: backupPhone.trim() || null,
    }).eq('id', userId);
    show(saveError, 'Settings saved.');
    if (!saveError) onProfileChanged();
  };
  const savePreference = async (key: string, value: boolean) => {
    const next = { ...prefs, [key]: value };
    const { error: saveError } = await supabase.from('profiles').update({ notification_prefs: next }).eq('id', userId);
    if (!saveError) setPrefs(next);
    show(saveError, 'Notification preferences saved.');
  };
  const updatePassword = async () => {
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (!updateError) setPassword('');
    show(updateError, 'Password updated.');
  };
  const updateEmail = async () => {
    if (!email.trim()) { setError('Enter your new email address.'); return; }
    const { error: updateError } = await supabase.auth.updateUser({ email: email.trim() });
    if (!updateError) setEmail('');
    show(updateError, 'Check both your old and new inboxes to confirm the change.');
  };

  return <ScrollView contentContainerStyle={ui.body} keyboardShouldPersistTaps="handled">
    <TouchableOpacity onPress={onBack}><Text style={ui.link}>← Dashboard</Text></TouchableOpacity>
    <Text style={[ui.title, { marginVertical: 12 }]}>Settings</Text>
    {error ? <Text style={[ui.errorText, { marginBottom: 10 }]}>{error}</Text> : null}
    {message ? <Text style={[ui.okText, { marginBottom: 10 }]}>{message}</Text> : null}
    {!profile ? <TouchableOpacity onPress={load}><Text style={ui.link}>Retry loading settings</Text></TouchableOpacity> : <>
      <View style={ui.card}>
        <Text style={ui.cardTitle}>Account</Text>
        <Text style={ui.sub}>Sign-in email: {profile.email}</Text>
        <Text style={ui.sub}>Display name</Text><TextInput style={ui.input} value={name} onChangeText={setName} />
        <Text style={ui.sub}>Backup email</Text><TextInput style={ui.input} value={backupEmail} onChangeText={setBackupEmail} autoCapitalize="none" keyboardType="email-address" />
        <Text style={ui.sub}>Backup phone</Text><TextInput style={ui.input} value={backupPhone} onChangeText={setBackupPhone} keyboardType="phone-pad" />
        <TouchableOpacity style={ui.button} onPress={save}><Text style={ui.buttonText}>Save account</Text></TouchableOpacity>
      </View>
      <View style={ui.card}>
        <Text style={ui.cardTitle}>Change email</Text>
        <TextInput style={ui.input} value={email} onChangeText={setEmail} placeholder="New email" placeholderTextColor="#64748b" autoCapitalize="none" keyboardType="email-address" />
        <TouchableOpacity style={ui.button} onPress={updateEmail}><Text style={ui.buttonText}>Update email</Text></TouchableOpacity>
      </View>
      <View style={ui.card}>
        <Text style={ui.cardTitle}>Change password</Text>
        <TextInput style={ui.input} value={password} onChangeText={setPassword} placeholder="New password (8+ characters)" placeholderTextColor="#64748b" secureTextEntry />
        <TouchableOpacity style={ui.button} onPress={updatePassword}><Text style={ui.buttonText}>Update password</Text></TouchableOpacity>
      </View>
      <View style={ui.card}>
        <Text style={ui.cardTitle}>Notification preferences</Text>
        {preferences.map(([key, label]) => <View key={key} style={ui.rowBetween}>
          <Text style={ui.text}>{label}</Text><Switch value={!!prefs[key]} onValueChange={(value) => savePreference(key, value)} />
        </View>)}
      </View>
      <View style={ui.card}><Text style={ui.cardTitle}>Your plan</Text><Text style={ui.text}>{profile.is_super_admin ? 'Super admin' : profile.subscription_tier}</Text></View>
    </>}
  </ScrollView>;
}
