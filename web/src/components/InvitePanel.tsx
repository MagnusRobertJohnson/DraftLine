'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { authHeaders } from '@/lib/clientAuth';
import type { Draft } from '@shared/types';

interface Invite {
  email: string;
  emailed: boolean;
  joined: boolean;
}

export default function InvitePanel({ draft }: { draft: Draft }) {
  const [text, setText] = useState('');
  const [invites, setInvites] = useState<Invite[]>([]);
  const [emailConfigured, setEmailConfigured] = useState(true);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const joinLink = `${typeof window !== 'undefined' ? window.location.origin : ''}/dashboard?join=${draft.invite_code}`;

  const load = async () => {
    const res = await fetch(`/api/drafts/${draft.id}/invites`, { headers: await authHeaders() });
    if (!res.ok) return;
    const json = await res.json();
    setInvites(json.invites);
    setEmailConfigured(json.emailConfigured);
  };
  useEffect(() => {
    load();
  }, [draft.id]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    setErr('');
    const emails = text.split(/[\s,;]+/).filter(Boolean);
    const res = await fetch(`/api/drafts/${draft.id}/invites`, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ emails }),
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) return setErr(json.error);
    setText('');
    setMsg(
      json.sent === json.saved
        ? `Invitation sent to ${json.sent} ${json.sent === 1 ? 'person' : 'people'}.`
        : `Saved ${json.saved} invite(s), but ${json.saved - json.sent} email(s) could not be sent. Share the link below instead.`
    );
    load();
  };

  const saveTemplate = async () => {
    const name = prompt('Template name?', draft.name);
    if (!name) return;
    const { data: ws } = await supabase
      .from('draft_scoring_weights')
      .select('stat, enabled, weight')
      .eq('draft_id', draft.id);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return setErr('Not signed in');
    const { error } = await supabase.from('draft_templates').insert({
      admin_id: u.user.id,
      name: name.trim().slice(0, 60),
      settings: {
        season_type: draft.season_type,
        forwards_count: draft.forwards_count,
        defense_count: draft.defense_count,
        goalies_count: draft.goalies_count,
        injured_reserve_count: draft.injured_reserve_count,
        salary_cap_enabled: draft.salary_cap_enabled,
        salary_cap_amount: draft.salary_cap_amount,
      },
      scoring: ws ?? [],
    });
    error ? setErr(error.message) : setMsg('Template saved. Pick it when creating your next draft.');
  };

  return (
    <div className="bg-rink-card border border-rink-border rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-bold text-slate-100 text-sm">✉️ Invite people</h3>
        <button onClick={saveTemplate} className="text-xs text-ice-300 hover:underline">
          💾 Save rules as template
        </button>
      </div>

      <form onSubmit={send} className="space-y-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          placeholder="Enter email addresses separated by commas or spaces"
          className="w-full bg-rink-dark border border-rink-border rounded-lg px-3 py-2 text-sm text-slate-100"
        />
        <button
          disabled={busy || !text.trim()}
          className="bg-ice-600 hover:bg-ice-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-semibold"
        >
          {busy ? 'Sending...' : 'Send invitations'}
        </button>
      </form>

      {!emailConfigured && (
        <p className="text-xs text-amber-300">
          Email sending isn't set up on this server yet, so invitations are only recorded. Share the link below instead.
        </p>
      )}
      {msg && <p className="text-xs text-emerald-400">{msg}</p>}
      {err && <p className="text-xs text-rose-400">{err}</p>}

      <div className="text-xs text-slate-400 break-all">
        Invite link: <button className="text-ice-300 hover:underline" onClick={() => navigator.clipboard.writeText(joinLink)}>copy</button>{' '}
        <span className="font-mono">{joinLink}</span>
      </div>

      {invites.length > 0 && (
        <div className="divide-y divide-rink-border text-xs">
          {invites.map((i) => (
            <div key={i.email} className="flex items-center justify-between py-1.5">
              <span className="text-slate-300">{i.email}</span>
              <span className={i.joined ? 'text-emerald-400' : 'text-slate-400'}>
                {i.joined ? 'Joined' : i.emailed ? 'Invited' : 'Saved (not emailed)'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
