'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';

interface Notification {
  id: number;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  created_at: string;
}

export default function NotificationsPage() {
  const router = useRouter();
  const [items, setItems] = useState<Notification[] | null>(null);

  const load = async () => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return router.push('/');
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    setItems((data as Notification[]) ?? []);
  };
  useEffect(() => {
    load();
  }, []);

  const open = async (n: Notification) => {
    if (!n.read) await supabase.from('notifications').update({ read: true }).eq('id', n.id);
    if (n.link) router.push(n.link);
    else load();
  };

  const markAll = async () => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;
    await supabase.from('notifications').update({ read: true }).eq('user_id', auth.user.id).eq('read', false);
    load();
  };

  const clearAll = async () => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;
    await supabase.from('notifications').delete().eq('user_id', auth.user.id);
    load();
  };

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black text-slate-100">🔔 Notifications</h1>
        <Link href="/settings" className="text-sm text-ice-300 hover:underline">Preferences</Link>
      </div>
      {items && items.length > 0 && (
        <div className="flex gap-4 text-xs">
          <button onClick={markAll} className="text-ice-300 hover:underline">Mark all read</button>
          <button onClick={clearAll} className="text-rose-400 hover:underline">Clear all</button>
        </div>
      )}
      {items === null ? (
        <p className="text-slate-400">Loading...</p>
      ) : items.length === 0 ? (
        <p className="text-slate-400 text-sm">You're all caught up. Notifications are kept for 30 days.</p>
      ) : (
        <div className="space-y-2">
          {items.map((n) => (
            <button
              key={n.id}
              onClick={() => open(n)}
              className={`w-full text-left p-4 rounded-xl border transition ${
                n.read ? 'border-rink-border bg-rink-card' : 'border-ice-500/60 bg-ice-900/30'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold text-sm text-slate-100">{n.title}</span>
                <span className="text-[10px] text-slate-400 whitespace-nowrap">
                  {new Date(n.created_at).toLocaleString()}
                </span>
              </div>
              {n.body && <p className="text-xs text-slate-300 mt-1">{n.body}</p>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
