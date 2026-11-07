'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';

export default function HomePage() {
  const router = useRouter();
  const [inviteCode, setInviteCode] = useState('');
  const [pendingJoin, setPendingJoin] = useState(false);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('join');
    if (code) {
      setInviteCode(code.toUpperCase().slice(0, 8));
      setPendingJoin(true);
    }
  }, []);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isRegister, setIsRegister] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      if (isRegister) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: displayName || email.split('@')[0] },
          },
        });
        if (error) throw error;
        setSuccessMsg('Account created successfully! Check your email to confirm if required, or sign in.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        router.push(pendingJoin && inviteCode ? `/dashboard?join=${encodeURIComponent(inviteCode)}` : '/dashboard');
      }
    } catch (err: any) {
      const msg: string = err?.message || 'Authentication failed';
      setErrorMsg(
        /failed to fetch|networkerror|load failed/i.test(msg)
          ? "Can't reach the DraftLine server. Check your internet connection and try again. If it persists, the service may be temporarily offline."
          : msg
      );
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email) return setErrorMsg('Enter your email above first.');
    setErrorMsg('');
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/settings`,
    });
    if (error) return setErrorMsg(error.message);
    setSuccessMsg('If that email has an account, a reset link is on its way. Use it, then set a new password in Settings.');
  };

  const handleJoinByCode = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteCode.trim()) return;
    router.push(`/dashboard?join=${encodeURIComponent(inviteCode.trim().toUpperCase())}`);
  };

  return (
    <div className="max-w-4xl mx-auto py-12 px-4">
      <div className="text-center mb-12">
        <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-4">
          The Next-Generation{' '}
          <span className="bg-gradient-to-r from-ice-300 via-rink-accent to-ice-100 bg-clip-text text-transparent">
            Fantasy Hockey
          </span>{' '}
          Pool Platform
        </h1>
        <p className="text-slate-300 max-w-2xl mx-auto text-lg">
          Live draft board synchronization across web and mobile. Custom scoring, salary cap
          enforcement, and real-time injured reserve team management.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-8 items-start">
        {/* Card 1: Have an Invite Code? */}
        <div className="bg-rink-card border border-rink-border p-6 rounded-xl shadow-lg">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xl">🎟️</span>
            <h2 className="text-xl font-bold">Have an Invite Code?</h2>
          </div>
          <p className="text-slate-400 text-sm mb-6">
            Enter the 8-character invite code provided by your draft administrator to jump straight into your pool.
          </p>
          <form onSubmit={handleJoinByCode} className="space-y-4">
            <div>
              <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1 font-semibold">
                Draft Invite Code
              </label>
              <input
                type="text"
                placeholder="e.g. 7A8B9C1D"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                maxLength={8}
                className="w-full bg-rink-dark border border-rink-border rounded-lg px-4 py-3 text-center text-xl font-mono tracking-widest text-ice-300 focus:outline-none focus:border-rink-accent uppercase"
                required
              />
            </div>
            <button
              type="submit"
              className="w-full bg-gradient-to-r from-ice-600 to-ice-500 hover:from-ice-500 hover:to-ice-400 text-white font-semibold py-3 px-4 rounded-lg transition shadow-md"
            >
              Enter Draft Pool
            </button>
          </form>
        </div>

        {/* Card 2: Account Login / Register */}
        <div className="bg-rink-card border border-rink-border p-6 rounded-xl shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold">{isRegister ? 'Create Account' : 'Sign In'}</h2>
            <button
              type="button"
              onClick={() => {
                setIsRegister(!isRegister);
                setErrorMsg('');
                setSuccessMsg('');
              }}
              className="text-xs text-rink-accent hover:underline"
            >
              {isRegister ? 'Already have an account? Sign in' : "Don't have an account? Register"}
            </button>
          </div>

          {errorMsg && (
            <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm rounded-lg">
              {errorMsg}
            </div>
          )}
          {successMsg && (
            <div className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm rounded-lg">
              {successMsg}
            </div>
          )}

          <form onSubmit={handleAuth} className="space-y-4">
            {isRegister && (
              <div>
                <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1 font-semibold">
                  Display Name / Nickname
                </label>
                <input
                  type="text"
                  placeholder="e.g. Connor McDavid"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full bg-rink-dark border border-rink-border rounded-lg px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-rink-accent"
                />
              </div>
            )}
            <div>
              <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1 font-semibold">
                Email Address
              </label>
              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-rink-dark border border-rink-border rounded-lg px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-rink-accent"
                required
              />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1 font-semibold">
                Password
              </label>
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-rink-dark border border-rink-border rounded-lg px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-rink-accent"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-rink-accent hover:bg-rink-highlight text-rink-dark font-bold py-3 px-4 rounded-lg transition shadow-md disabled:opacity-50"
            >
              {loading ? 'Please wait...' : isRegister ? 'Register & Continue' : 'Sign In'}
            </button>
            {!isRegister && (
              <button
                type="button"
                onClick={handleForgotPassword}
                className="w-full text-xs text-rink-accent hover:underline"
              >
                Forgot password?
              </button>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
