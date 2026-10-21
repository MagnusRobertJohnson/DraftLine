'use client';

import { useEffect, useRef, useState, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';

interface Message {
  id: number;
  user_id: string;
  body: string;
  created_at: string;
  profiles: { display_name: string | null; email: string } | null;
}

export default function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: draftId } = use(params);
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const bottom = useRef<HTMLDivElement>(null);

  const load = async () => {
    const { data, error: err } = await supabase
      .from('draft_messages')
      .select('id, user_id, body, created_at, profiles(display_name, email)')
      .eq('draft_id', draftId)
      .order('created_at', { ascending: false })
      .limit(200);
    if (err) return setError(err.message);
    setMessages(((data as any[]) ?? []).reverse());
  };

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) return router.push('/');
      setUserId(data.user.id);
    });
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [draftId]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || !userId) return;
    setText('');
    const { error: err } = await supabase.from('draft_messages').insert({ draft_id: draftId, user_id: userId, body });
    if (err) setError(err.message);
    load();
  };

  const remove = async (id: number) => {
    await supabase.from('draft_messages').delete().eq('id', id);
    load();
  };

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black text-slate-100">💬 Draft Chat</h1>
        <Link href={`/drafts/${draftId}/standings`} className="text-sm text-ice-300 hover:underline">
          ← Standings
        </Link>
      </div>
      {error && <p className="text-rose-400 text-sm">{error}</p>}
      <div className="bg-rink-card border border-rink-border rounded-xl p-4 h-[55vh] overflow-y-auto space-y-3">
        {messages.length === 0 && <p className="text-slate-400 text-sm">No messages yet. Say hello!</p>}
        {messages.map((m) => (
          <div key={m.id} className={`flex flex-col ${m.user_id === userId ? 'items-end' : 'items-start'}`}>
            <span className="text-[10px] text-slate-400">
              {m.profiles?.display_name || m.profiles?.email || 'Member'} • {new Date(m.created_at).toLocaleString()}
            </span>
            <div
              className={`px-3 py-2 rounded-lg text-sm max-w-[85%] break-words ${
                m.user_id === userId ? 'bg-ice-600 text-white' : 'bg-rink-dark text-slate-100'
              }`}
            >
              {m.body}
            </div>
            {m.user_id === userId && (
              <button onClick={() => remove(m.id)} className="text-[10px] text-slate-500 hover:text-rose-400">
                delete
              </button>
            )}
          </div>
        ))}
        <div ref={bottom} />
      </div>
      <form onSubmit={send} className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={500}
          placeholder="Write a message..."
          className="flex-1 bg-rink-dark border border-rink-border rounded-lg px-3 py-2 text-sm text-slate-100"
        />
        <button className="bg-ice-600 hover:bg-ice-500 text-white px-4 py-2 rounded-lg text-sm font-semibold">
          Send
        </button>
      </form>
      <p className="text-[10px] text-slate-500">Only the latest 200 messages per draft are kept.</p>
    </div>
  );
}
