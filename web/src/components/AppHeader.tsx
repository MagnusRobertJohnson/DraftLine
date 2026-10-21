'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { applyTheme, getStoredTheme, setTheme, type ThemePref } from '@/lib/theme';

export default function AppHeader() {
  const [unread, setUnread] = useState(0);
  const [signedIn, setSignedIn] = useState(false);
  const [theme, setThemeState] = useState<ThemePref>('system');

  useEffect(() => {
    const stored = getStoredTheme();
    setThemeState(stored);
    applyTheme(stored);

    let timer: ReturnType<typeof setInterval> | undefined;
    const refresh = async () => {
      const { count } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('read', false);
      setUnread(count ?? 0);
    };
    const init = async (userId?: string) => {
      if (timer) clearInterval(timer);
      setSignedIn(!!userId);
      if (!userId) return setUnread(0);
      // Sync the saved theme from the account on first load.
      const { data } = await supabase.from('profiles').select('theme').eq('id', userId).maybeSingle();
      const saved = (data as any)?.theme as ThemePref | undefined;
      if (saved && saved !== getStoredTheme()) {
        setTheme(saved);
        setThemeState(saved);
      }
      refresh();
      timer = setInterval(refresh, 60000);
    };

    supabase.auth.getSession().then(({ data }) => init(data.session?.user.id));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => init(s?.user.id));
    return () => {
      sub.subscription.unsubscribe();
      if (timer) clearInterval(timer);
    };
  }, []);

  const cycleTheme = async () => {
    const next: ThemePref = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    setThemeState(next);
    const { data } = await supabase.auth.getUser();
    if (data.user) await supabase.from('profiles').update({ theme: next }).eq('id', data.user.id);
  };

  return (
    <header className="border-b border-rink-border bg-rink-card/80 backdrop-blur sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
        <a href="/" className="flex items-center gap-2">
          <span className="text-2xl">🏒</span>
          <span className="font-extrabold text-xl tracking-tight bg-gradient-to-r from-ice-300 via-rink-accent to-ice-100 bg-clip-text text-transparent">
            HockeyPool
          </span>
        </a>
        <nav className="flex items-center gap-4 text-sm font-medium">
          <a href="/dashboard" className="text-slate-300 hover:text-white transition">
            Dashboard
          </a>
          <a href="/players" className="text-slate-300 hover:text-white transition">
            Players
          </a>
          {signedIn && (
            <>
              <a href="/profile" className="text-slate-300 hover:text-white transition hidden sm:inline">
                Profile
              </a>
              <a href="/settings" className="text-slate-300 hover:text-white transition hidden sm:inline">
                Settings
              </a>
              <a href="/notifications" className="relative text-lg" aria-label="Notifications">
                🔔
                {unread > 0 && (
                  <span className="absolute -top-1.5 -right-2 bg-rose-500 text-white text-[10px] font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
                    {unread > 9 ? '9+' : unread}
                  </span>
                )}
              </a>
            </>
          )}
          <button onClick={cycleTheme} className="text-lg" aria-label="Toggle light/dark theme">
            {theme === 'dark' ? '🌙' : theme === 'light' ? '☀️' : '🌓'}
          </button>
        </nav>
      </div>
    </header>
  );
}
