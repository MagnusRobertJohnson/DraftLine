import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { ui } from '../lib/theme';

type Notification = { id: number; title: string; body: string | null; link: string | null; read: boolean; created_at: string };
export default function NotificationsScreen({ userId, onBack, onOpen }: {
  userId: string; onBack: () => void; onOpen: (link: string) => void;
}) {
  const [items, setItems] = useState<Notification[] | null>(null);
  const [error, setError] = useState('');
  const load = async () => {
    const { data, error: loadError } = await supabase.from('notifications').select('*').eq('user_id', userId)
      .order('created_at', { ascending: false }).limit(100);
    if (loadError) setError(loadError.message);
    else { setItems((data || []) as Notification[]); setError(''); }
  };
  useEffect(() => { load(); }, [userId]);
  const open = async (item: Notification) => {
    if (!item.read) {
      const { error: updateError } = await supabase.from('notifications').update({ read: true }).eq('id', item.id).eq('user_id', userId);
      if (updateError) { setError(updateError.message); return; }
    }
    if (item.link) onOpen(item.link);
    else await load();
  };
  const markAll = async () => {
    const { error: updateError } = await supabase.from('notifications').update({ read: true }).eq('user_id', userId).eq('read', false);
    if (updateError) setError(updateError.message); else await load();
  };
  const clearAll = () => Alert.alert('Clear notifications?', 'This removes all your notifications.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Clear', style: 'destructive', onPress: async () => {
      const { error: deleteError } = await supabase.from('notifications').delete().eq('user_id', userId);
      if (deleteError) setError(deleteError.message); else await load();
    } },
  ]);
  return <ScrollView contentContainerStyle={ui.body}>
    <TouchableOpacity onPress={onBack}><Text style={ui.link}>← Dashboard</Text></TouchableOpacity>
    <Text style={[ui.title, { marginVertical: 12 }]}>Notifications</Text>
    {error ? <View><Text style={ui.errorText}>{error}</Text><TouchableOpacity onPress={load}><Text style={ui.link}>Try again</Text></TouchableOpacity></View> : null}
    {items && items.length > 0 && <View style={[ui.row, ui.gap, { marginBottom: 12 }]}>
      <TouchableOpacity onPress={markAll}><Text style={ui.link}>Mark all read</Text></TouchableOpacity>
      <TouchableOpacity onPress={clearAll}><Text style={ui.link}>Clear all</Text></TouchableOpacity>
    </View>}
    {items === null ? <Text style={ui.sub}>Loading...</Text> : items.length === 0 ? <Text style={ui.sub}>No notifications.</Text> :
      items.map((item) => <TouchableOpacity key={item.id} style={ui.card} onPress={() => open(item)}>
        <Text style={ui.strong}>{item.read ? '' : '● '}{item.title}</Text>
        {item.body && <Text style={ui.text}>{item.body}</Text>}
        <Text style={ui.sub}>{new Date(item.created_at).toLocaleString()}</Text>
      </TouchableOpacity>)}
  </ScrollView>;
}
