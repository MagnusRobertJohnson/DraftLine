import React, { useEffect, useState } from 'react';
import { Share, Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { Draft } from '../../../shared/types';
import { api, API_URL } from '../lib/api';
import { ui } from '../lib/theme';

type Invite = { email: string; emailed: boolean; joined: boolean };
export default function InvitePanel({ draft }: { draft: Draft }) {
  const [emails, setEmails] = useState('');
  const [invites, setInvites] = useState<Invite[]>([]);
  const [emailConfigured, setEmailConfigured] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const link = `${API_URL}/dashboard?join=${encodeURIComponent(draft.invite_code)}`;
  const load = async () => {
    try {
      const result = await api(`/api/drafts/${draft.id}/invites`);
      if (!result.ok) throw new Error(result.data.error || 'Could not load invitations.');
      setInvites(result.data.invites);
      setEmailConfigured(result.data.emailConfigured);
      setError('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load invitations.'); }
  };
  useEffect(() => { load(); }, [draft.id]);
  const send = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await api(`/api/drafts/${draft.id}/invites`, {
        method: 'POST', body: { emails: emails.split(/[\s,;]+/).filter(Boolean) },
      });
      if (!result.ok) throw new Error(result.data.error || 'Could not send invitations.');
      setEmails('');
      setMessage(`Saved ${result.data.saved} invitation(s); ${result.data.sent} email(s) sent. Share the link if an email was not sent.`);
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not send invitations.'); }
    finally { setBusy(false); }
  };
  return <View style={ui.card}>
    <Text style={ui.cardTitle}>Invite people</Text>
    <TextInput style={ui.input} value={emails} onChangeText={setEmails} placeholder="Email addresses, separated by commas" placeholderTextColor="#64748b" autoCapitalize="none" multiline />
    <TouchableOpacity style={[ui.button, (!emails.trim() || busy) && ui.disabled]} disabled={!emails.trim() || busy} onPress={send}>
      <Text style={ui.buttonText}>{busy ? 'Sending...' : 'Send invitations'}</Text>
    </TouchableOpacity>
    {!emailConfigured && <Text style={ui.warnText}>Email sending is not configured. Share the invite link instead.</Text>}
    {message ? <Text style={ui.okText}>{message}</Text> : null}
    {error ? <Text style={ui.errorText}>{error}</Text> : null}
    <TouchableOpacity onPress={async () => {
      try { await Share.share({ message: `Join ${draft.name} on DraftLine: ${link}\nInvite code: ${draft.invite_code}` }); }
      catch (err) { setError(err instanceof Error ? err.message : 'Could not share the invitation.'); }
    }}><Text style={[ui.link, { marginVertical: 8 }]}>Share invite link</Text></TouchableOpacity>
    {invites.map((invite) => <Text style={ui.sub} key={invite.email}>
      {invite.email} · {invite.joined ? 'Joined' : invite.emailed ? 'Invited' : 'Saved (not emailed)'}
    </Text>)}
  </View>;
}
