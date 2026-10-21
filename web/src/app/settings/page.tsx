'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { authHeaders } from '@/lib/clientAuth';
import { getStoredTheme, setTheme, type ThemePref } from '@/lib/theme';
import type { Profile } from '@shared/types';

const PLANS = [
  { tier: 'free', name: 'Free member', desc: 'Join unlimited drafts by invitation.' },
  { tier: 'admin_basic', name: 'Basic admin', desc: 'Create and run up to 3 drafts per season.' },
  { tier: 'admin_top', name: 'Top admin', desc: 'Create and run up to 15 drafts per season.' },
];

const PREF_ROWS = [
  { key: 'invites', label: 'Draft invitations', desc: 'When an admin invites you to a draft.' },
  { key: 'swaps', label: 'Roster swaps', desc: 'When a player is moved to or from injured reserve.' },
  { key: 'draft_updates', label: 'Draft updates', desc: 'Teams joining, drafts finalized.' },
  { key: 'chat', label: 'Chat messages', desc: 'New messages in your draft chats.' },
  { key: 'push', label: 'Mobile push', desc: 'Send notifications to your phone.' },
  { key: 'email', label: 'Email', desc: 'Also email me these notifications.' },
];

export default function SettingsPage() {
  const router = useRouter();
  const [theme, setThemeState] = useState<ThemePref>('system');
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});
  const [newEmail, setNewEmail] = useState('');
  const [profile, setProfile] = useState<(Profile & { backup_email?: string; backup_phone?: string }) | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [backupEmail, setBackupEmail] = useState('');
  const [backupPhone, setBackupPhone] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return router.push('/');
    const { data } = await supabase.from('profiles').select('*').eq('id', auth.user.id).single();
    if (data) {
      setProfile(data);
      setDisplayName(data.display_name ?? '');
      setBackupEmail(data.backup_email ?? '');
      setBackupPhone(data.backup_phone ?? '');
      setPrefs((data as any).notification_prefs ?? {});
      setThemeState(getStoredTheme());
    }
  };
  useEffect(() => {
    load();
  }, []);

  const flash = (msg: string, isError = false) => {
    setMessage(isError ? '' : msg);
    setError(isError ? msg : '');
  };

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    const { error: err } = await supabase
      .from('profiles')
      .update({
        display_name: displayName.trim() || null,
        backup_email: backupEmail.trim() || null,
        backup_phone: backupPhone.trim() || null,
      })
      .eq('id', profile.id);
    err ? flash(err.message, true) : flash('Settings saved.');
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) return flash('Password must be at least 8 characters.', true);
    const { error: err } = await supabase.auth.updateUser({ password: newPassword });
    if (err) return flash(err.message, true);
    setNewPassword('');
    flash('Password updated.');
  };

  const changeTheme = async (t: ThemePref) => {
    setTheme(t);
    setThemeState(t);
    if (profile) await supabase.from('profiles').update({ theme: t }).eq('id', profile.id);
  };

  const savePref = async (key: string, value: boolean) => {
    if (!profile) return;
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    const { error: err } = await supabase.from('profiles').update({ notification_prefs: next }).eq('id', profile.id);
    err ? flash(err.message, true) : flash('Notification preferences saved.');
  };

  const changeEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error: err } = await supabase.auth.updateUser({ email: newEmail.trim() });
    if (err) return flash(err.message, true);
    setNewEmail('');
    flash('Check both your old and new inboxes to confirm the change.');
  };

  const changePlan = async (tier: string) => {
    const res = await fetch('/api/account/plan', {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ tier }),
    });
    const json = await res.json();
    if (!res.ok) return flash(json.error, true);
    flash('Plan updated.');
    load();
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  if (!profile) return <div className="p-8 text-center text-slate-400">Loading...</div>;

  const input =
    'w-full bg-rink-dark border border-rink-border rounded-lg px-3 py-2 text-sm text-slate-100';
  const card = 'bg-rink-card border border-rink-border rounded-xl p-5 space-y-4';

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black text-slate-100">⚙️ Settings</h1>
        <Link href="/dashboard" className="text-sm text-ice-300 hover:underline">← Dashboard</Link>
      </div>

      {message && <div className="text-emerald-400 text-sm">{message}</div>}
      {error && <div className="text-rose-400 text-sm">{error}</div>}

      <form onSubmit={saveProfile} className={card}>
        <h2 className="font-bold text-slate-100">Account</h2>
        <div>
          <label className="text-xs text-slate-400">Sign-in email</label>
          <input className={input} value={profile.email} disabled />
        </div>
        <div>
          <label className="text-xs text-slate-400">Display name</label>
          <input className={input} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-slate-400">Backup email (for account recovery)</label>
          <input type="email" className={input} value={backupEmail} onChange={(e) => setBackupEmail(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-slate-400">Backup phone (for account recovery)</label>
          <input type="tel" className={input} value={backupPhone} onChange={(e) => setBackupPhone(e.target.value)} />
        </div>
        <button className="bg-ice-600 hover:bg-ice-500 text-white px-4 py-2 rounded-lg text-sm font-semibold">
          Save
        </button>
      </form>

      <form onSubmit={changePassword} className={card}>
        <h2 className="font-bold text-slate-100">Change password</h2>
        <input
          type="password"
          className={input}
          placeholder="New password (8+ characters)"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
        <button className="bg-ice-600 hover:bg-ice-500 text-white px-4 py-2 rounded-lg text-sm font-semibold">
          Update password
        </button>
      </form>

      <div className={card}>
        <h2 className="font-bold text-slate-100">Appearance</h2>
        <div className="flex gap-2">
          {(['system', 'light', 'dark'] as ThemePref[]).map((t) => (
            <button
              key={t}
              onClick={() => changeTheme(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border capitalize ${
                theme === t ? 'border-ice-500 bg-ice-900/30 text-ice-300' : 'border-rink-border text-slate-300'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className={card}>
        <h2 className="font-bold text-slate-100">Notifications</h2>
        {PREF_ROWS.map((r) => (
          <label key={r.key} className="flex items-start justify-between gap-4 cursor-pointer">
            <span>
              <span className="block text-sm text-slate-100">{r.label}</span>
              <span className="block text-xs text-slate-400">{r.desc}</span>
            </span>
            <input
              type="checkbox"
              checked={!!prefs[r.key]}
              onChange={(e) => savePref(r.key, e.target.checked)}
              className="mt-1 rounded bg-rink-dark border-rink-border text-ice-500"
            />
          </label>
        ))}
        <p className="text-xs text-slate-400">
          Mobile push notifications are delivered once you sign in on the HockeyPool mobile app. Email
          notifications require email delivery to be enabled on the server.
        </p>
      </div>

      <form onSubmit={changeEmail} className={card}>
        <h2 className="font-bold text-slate-100">Change sign-in email</h2>
        <input
          type="email"
          className={input}
          placeholder="New email address"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
        />
        <button className="bg-ice-600 hover:bg-ice-500 text-white px-4 py-2 rounded-lg text-sm font-semibold">
          Send confirmation
        </button>
      </form>

      <div className={card}>
        <h2 className="font-bold text-slate-100">Plan</h2>
        <p className="text-xs text-amber-300">
          Payments are not connected yet. Plan changes below take effect immediately for testing.
        </p>
        <div className="space-y-2">
          {PLANS.map((p) => {
            const current = profile.subscription_tier === p.tier;
            return (
              <div
                key={p.tier}
                className={`flex items-center justify-between gap-3 p-3 rounded-lg border ${
                  current ? 'border-ice-500 bg-ice-900/30' : 'border-rink-border'
                }`}
              >
                <div>
                  <div className="text-slate-100 font-semibold text-sm">{p.name}</div>
                  <div className="text-slate-400 text-xs">{p.desc}</div>
                </div>
                {current ? (
                  <span className="text-ice-300 text-xs font-semibold">Current plan</span>
                ) : (
                  <button
                    onClick={() => changePlan(p.tier)}
                    className="bg-ice-600 hover:bg-ice-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold"
                  >
                    {p.tier === 'free' ? 'Switch' : 'Upgrade'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className={card}>
        <h2 className="font-bold text-slate-100">Session</h2>
        <button onClick={signOut} className="text-rose-400 hover:text-rose-300 text-sm font-semibold">
          Sign out
        </button>
      </div>
    </div>
  );
}
