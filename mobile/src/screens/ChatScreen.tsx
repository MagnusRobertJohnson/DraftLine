import React, { useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { ui } from '../lib/theme';

type Message = { id: number; user_id: string; body: string; created_at: string; profiles: { display_name: string | null; email: string } | null };
export default function ChatScreen({ draftId, userId }: { draftId: string; userId: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const { data, error: loadError } = await supabase.from('draft_messages')
      .select('id, user_id, body, created_at, profiles(display_name, email)').eq('draft_id', draftId)
      .order('created_at', { ascending: false }).limit(200).overrideTypes<Message[], { merge: false }>();
    if (loadError) setError(loadError.message);
    else { setMessages((data || []).reverse()); setError(''); }
  };
  useEffect(() => {
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, [draftId]);
  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    const { error: sendError } = await supabase.from('draft_messages').insert({ draft_id: draftId, user_id: userId, body });
    if (sendError) setError(sendError.message);
    else { setText(''); await load(); }
    setBusy(false);
  };
  const remove = async (id: number) => {
    const { error: deleteError } = await supabase.from('draft_messages').delete().eq('id', id);
    if (deleteError) setError(deleteError.message);
    else await load();
  };
  return <View style={{ flex: 1, padding: 16 }}>
    <Text style={ui.title}>Draft chat</Text>
    {error ? <Text style={ui.errorText}>{error}</Text> : null}
    <ScrollView style={{ flex: 1 }}>
      {messages.length === 0 && <Text style={ui.sub}>No messages yet.</Text>}
      {messages.map((message) => <View key={message.id} style={ui.card}>
        <Text style={ui.sub}>{message.profiles?.display_name || message.profiles?.email || 'Member'} · {new Date(message.created_at).toLocaleString()}</Text>
        <Text style={ui.text}>{message.body}</Text>
        {message.user_id === userId && <TouchableOpacity onPress={() => remove(message.id)}><Text style={ui.link}>Delete</Text></TouchableOpacity>}
      </View>)}
    </ScrollView>
    <TextInput style={ui.input} value={text} onChangeText={setText} maxLength={500} placeholder="Write a message..." placeholderTextColor="#64748b" />
    <TouchableOpacity style={[ui.button, busy && ui.disabled]} disabled={busy} onPress={send}><Text style={ui.buttonText}>Send</Text></TouchableOpacity>
  </View>;
}
