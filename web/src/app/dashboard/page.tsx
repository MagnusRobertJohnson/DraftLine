'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import { authHeaders } from '@/lib/clientAuth';
import type { Draft, Profile, SubscriptionTier } from '@shared/types';
import { CURRENT_SEASON } from '@shared/nhl';

function DashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [managedDrafts, setManagedDrafts] = useState<Draft[]>([]);
  const [memberDrafts, setMemberDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);

  // New Draft Modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [seasonType, setSeasonType] = useState<'regular' | 'playoffs'>('regular');
  const [forwardsCount, setForwardsCount] = useState(9);
  const [defenseCount, setDefenseCount] = useState(4);
  const [goaliesCount, setGoaliesCount] = useState(2);
  const [irCount, setIrCount] = useState(2);
  const [salaryCapEnabled, setSalaryCapEnabled] = useState(false);
  const [salaryCapAmount, setSalaryCapAmount] = useState(88.0);
  const [createError, setCreateError] = useState('');
  const [templates, setTemplates] = useState<any[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);

  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    const s = t.settings;
    setSeasonType(s.season_type ?? 'regular');
    setForwardsCount(s.forwards_count);
    setDefenseCount(s.defense_count);
    setGoaliesCount(s.goalies_count);
    setIrCount(s.injured_reserve_count);
    setSalaryCapEnabled(!!s.salary_cap_enabled);
    setSalaryCapAmount(Number(s.salary_cap_amount ?? 88));
  };

  const deleteTemplate = async () => {
    if (!templateId || !confirm('Delete this template?')) return;
    await supabase.from('draft_templates').delete().eq('id', templateId);
    setTemplateId('');
    setTemplates((prev) => prev.filter((t) => t.id !== templateId));
  };

  // Join Draft Modal state
  const [joinCode, setJoinCode] = useState(searchParams.get('join') || '');
  const [joinTeamName, setJoinTeamName] = useState('');
  const [showJoinModal, setShowJoinModal] = useState(Boolean(searchParams.get('join')));
  const [joinError, setJoinError] = useState('');

  const loadData = async () => {
    setLoading(true);
    const { data: authData } = await supabase.auth.getUser();
    if (!authData?.user) {
      const pending = searchParams.get('join');
      router.push(pending ? `/?join=${encodeURIComponent(pending)}` : '/');
      return;
    }

    // Load this admin's saved draft templates
    const { data: tpls } = await supabase
      .from('draft_templates')
      .select('id, name, settings, scoring')
      .order('created_at', { ascending: false });
    setTemplates((tpls as any[]) || []);

    // Load profile
    const { data: prof } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', authData.user.id)
      .single();

    if (prof) {
      setProfile(prof as Profile);
    }

    // Load managed drafts
    const { data: managed } = await supabase
      .from('drafts')
      .select('*')
      .eq('admin_id', authData.user.id)
      .order('created_at', { ascending: false });

    if (managed) setManagedDrafts(managed as Draft[]);

    // Load member drafts
    const { data: memberships } = await supabase
      .from('draft_teams')
      .select('draft_id, drafts(*)')
      .eq('user_id', authData.user.id);

    if (memberships) {
      const draftsJoined = memberships
        .map((m: any) => m.drafts)
        .filter((d) => d && d.admin_id !== authData.user.id);
      setMemberDrafts(draftsJoined as Draft[]);
    }

    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError('');
    if (!profile) return;

    try {
      const { data, error } = await supabase
        .from('drafts')
        .insert({
          admin_id: profile.id,
          season_id: CURRENT_SEASON,
          name: draftName,
          season_type: seasonType,
          forwards_count: Number(forwardsCount),
          defense_count: Number(defenseCount),
          goalies_count: Number(goaliesCount),
          injured_reserve_count: Number(irCount),
          salary_cap_enabled: salaryCapEnabled,
          salary_cap_amount: Number(salaryCapAmount),
        })
        .select()
        .single();

      if (error) throw error;

      // Apply the template's scoring rules, or save this draft's rules as a new template
      const template = templates.find((t) => t.id === templateId);
      if (template) {
        for (const w of template.scoring as { stat: string; enabled: boolean; weight: number }[]) {
          await supabase
            .from('draft_scoring_weights')
            .update({ enabled: w.enabled, weight: w.weight })
            .eq('draft_id', data.id)
            .eq('stat', w.stat);
        }
      }
      if (saveAsTemplate) {
        const { data: ws } = await supabase
          .from('draft_scoring_weights')
          .select('stat, enabled, weight')
          .eq('draft_id', data.id);
        await supabase.from('draft_templates').insert({
          admin_id: profile.id,
          name: draftName.trim().slice(0, 60),
          settings: {
            season_type: seasonType,
            forwards_count: Number(forwardsCount),
            defense_count: Number(defenseCount),
            goalies_count: Number(goaliesCount),
            injured_reserve_count: Number(irCount),
            salary_cap_enabled: salaryCapEnabled,
            salary_cap_amount: Number(salaryCapAmount),
          },
          scoring: ws ?? [],
        });
      }

      setShowCreateModal(false);
      router.push(`/drafts/${data.id}/admin`);
    } catch (err: any) {
      setCreateError(err.message || 'Failed to create draft');
    }
  };

  const handleJoinDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    setJoinError('');
    if (!profile || !joinCode || !joinTeamName) return;

    try {
      // Find draft by invite code
      const { data: draft, error: draftErr } = await supabase
        .from('drafts')
        .select('id, name')
        .eq('invite_code', joinCode.trim().toUpperCase())
        .single();

      if (draftErr || !draft) {
        throw new Error('Draft not found with that invite code. Please check and try again.');
      }

      // Check if team already exists for this user
      const { data: existingTeam } = await supabase
        .from('draft_teams')
        .select('id')
        .eq('draft_id', draft.id)
        .eq('user_id', profile.id)
        .maybeSingle();

      if (existingTeam) {
        router.push(`/drafts/${draft.id}`);
        return;
      }

      // Get count of teams to set draft_order
      const { count } = await supabase
        .from('draft_teams')
        .select('*', { count: 'exact', head: true })
        .eq('draft_id', draft.id);

      const nextOrder = (count || 0) + 1;

      const { error: teamErr } = await supabase.from('draft_teams').insert({
        draft_id: draft.id,
        user_id: profile.id,
        team_name: joinTeamName.trim(),
        draft_order: nextOrder,
      });

      if (teamErr) throw teamErr;

      fetch(`/api/drafts/${draft.id}/joined`, { method: 'POST', headers: await authHeaders() }).catch(() => {});

      setShowJoinModal(false);
      router.push(`/drafts/${draft.id}`);
    } catch (err: any) {
      setJoinError(err.message || 'Failed to join draft');
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  if (loading) {
    return <div className="p-8 text-center text-slate-400">Loading your pools...</div>;
  }

  const isAdmin =
    !!profile?.is_super_admin ||
    profile?.subscription_tier === 'admin_basic' ||
    profile?.subscription_tier === 'admin_top';
  const tierLabel = profile?.is_super_admin
    ? 'Meta-Admin (Unlimited)'
    : profile?.subscription_tier === 'admin_top' || profile?.subscription_tier === 'admin_basic'
      ? 'Admin (Up to 5 drafts per season)'
      : 'Standard Member (Free)';

  return (
    <div className="space-y-8">
      {/* Top Welcome Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-rink-card border border-rink-border p-6 rounded-xl">
        <div>
          <h1 className="text-2xl font-black text-slate-100">
            Welcome, {profile?.display_name || profile?.email}
          </h1>
          <div className="flex items-center gap-3 mt-1 text-sm text-slate-400">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-ice-900 border border-ice-700 text-ice-300">
              {tierLabel}
            </span>
            <span>{profile?.email}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowJoinModal(true)}
            className="bg-rink-dark hover:bg-rink-card border border-rink-border text-ice-200 px-4 py-2.5 rounded-lg text-sm font-semibold transition"
          >
            🎟️ Join with Code
          </button>
          {isAdmin ? (
            <button
              onClick={() => setShowCreateModal(true)}
              className="bg-ice-600 hover:bg-ice-500 text-white px-5 py-2.5 rounded-lg text-sm font-semibold transition shadow-md"
            >
              + Create New Draft
            </button>
          ) : (
            <Link
              href="/settings"
              className="bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 px-4 py-2.5 rounded-lg text-sm font-semibold transition"
            >
              ⭐ Become an Admin
            </Link>
          )}
          {profile?.is_super_admin && (
            <Link
              href="/super-admin"
              className="bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 px-4 py-2.5 rounded-lg text-sm font-semibold transition"
            >
              🛡️ Meta-Admin
            </Link>
          )}
          <Link href="/profile" className="text-slate-300 hover:text-ice-300 text-sm px-2 py-2 transition">
            👤 Profile
          </Link>
          <Link href="/settings" className="text-slate-300 hover:text-ice-300 text-sm px-2 py-2 transition">
            ⚙️ Settings
          </Link>
          <button
            onClick={handleLogout}
            className="text-slate-400 hover:text-rose-400 text-sm px-3 py-2 transition"
          >
            Sign Out
          </button>
        </div>
      </div>

      {/* Managed Drafts Section */}
      {isAdmin && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
              <span>👑</span> Drafts You Manage ({managedDrafts.length})
            </h2>
          </div>

          {managedDrafts.length === 0 ? (
            <div className="bg-rink-card/50 border border-dashed border-rink-border p-8 rounded-xl text-center text-slate-400">
              You haven't created any drafts yet for this season.
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {managedDrafts.map((d) => (
                <div
                  key={d.id}
                  className="bg-rink-card border border-rink-border p-5 rounded-xl hover:border-rink-accent transition flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <h3 className="font-bold text-lg text-slate-100">{d.name}</h3>
                      <span className="text-xs px-2 py-0.5 rounded uppercase font-semibold tracking-wider bg-slate-800 text-slate-300 border border-slate-700">
                        {d.status}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mb-3">
                      {d.season_type === 'regular' ? 'Regular Season' : 'Playoffs'} •{' '}
                      {d.forwards_count}F, {d.defense_count}D, {d.goalies_count}G, {d.injured_reserve_count}IR
                    </p>
                    <div className="text-xs font-mono bg-rink-dark p-2 rounded border border-rink-border/50 text-ice-300 flex items-center justify-between">
                      <span>Invite Code:</span>
                      <span className="font-bold tracking-widest">{d.invite_code}</span>
                    </div>
                  </div>
                  <div className="mt-4 pt-4 border-t border-rink-border flex gap-2">
                    <button
                      onClick={() => router.push(`/drafts/${d.id}`)}
                      className="flex-1 bg-rink-dark hover:bg-rink-border text-xs font-semibold py-2 rounded text-slate-200 transition text-center"
                    >
                      Draft Board
                    </button>
                    <button
                      onClick={() => router.push(`/drafts/${d.id}/admin`)}
                      className="flex-1 bg-ice-600 hover:bg-ice-500 text-xs font-semibold py-2 rounded text-white transition text-center"
                    >
                      Admin Console
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Member Drafts Section */}
      <div className="space-y-4">
        <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
          <span>🏒</span> Pools You've Joined ({memberDrafts.length})
        </h2>

        {memberDrafts.length === 0 ? (
          <div className="bg-rink-card/50 border border-dashed border-rink-border p-8 rounded-xl text-center text-slate-400">
            You haven't joined any draft pools yet. Ask your administrator for an invite code or click "Join with Code".
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {memberDrafts.map((d) => (
              <div
                key={d.id}
                className="bg-rink-card border border-rink-border p-5 rounded-xl hover:border-rink-accent transition flex flex-col justify-between"
              >
                <div>
                  <h3 className="font-bold text-lg text-slate-100 mb-1">{d.name}</h3>
                  <p className="text-xs text-slate-400 mb-3">
                    {d.season_type === 'regular' ? 'Regular Season' : 'Playoffs'} • Status: {d.status}
                  </p>
                </div>
                <div className="mt-4 pt-4 border-t border-rink-border flex gap-2">
                  <button
                    onClick={() => router.push(`/drafts/${d.id}`)}
                    className="flex-1 bg-rink-dark hover:bg-rink-border text-xs font-semibold py-2 rounded text-slate-200 transition text-center"
                  >
                    Draft Board
                  </button>
                  <button
                    onClick={() => router.push(`/drafts/${d.id}/roster`)}
                    className="flex-1 bg-rink-accent hover:bg-rink-highlight text-xs font-semibold py-2 rounded text-rink-dark transition text-center"
                  >
                    My Team & IR
                  </button>
                  <button
                    onClick={() => router.push(`/drafts/${d.id}/standings`)}
                    className="flex-1 bg-ice-700 hover:bg-ice-600 text-xs font-semibold py-2 rounded text-white transition text-center"
                  >
                    Standings
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal: Create Draft */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-rink-card border border-rink-border rounded-xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <h3 className="text-xl font-bold">Create New Draft Pool</h3>
            {createError && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm rounded">
                {createError}
              </div>
            )}
            <form onSubmit={handleCreateDraft} className="space-y-4 text-sm">
              {templates.length > 0 && (
                <div>
                  <label className="block text-xs text-slate-400 uppercase font-semibold mb-1">
                    Start from a template
                  </label>
                  <div className="flex gap-2">
                    <select
                      value={templateId}
                      onChange={(e) => applyTemplate(e.target.value)}
                      className="flex-1 bg-rink-dark border border-rink-border rounded p-2.5 text-slate-100"
                    >
                      <option value="">None (default rules)</option>
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                    {templateId && (
                      <button type="button" onClick={deleteTemplate} className="text-rose-400 text-xs px-2">
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              )}
              <div>
                <label className="block text-xs text-slate-400 uppercase font-semibold mb-1">
                  Draft Pool Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. 2026 Stanley Cup Playoffs Pool"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  className="w-full bg-rink-dark border border-rink-border rounded p-2.5 text-slate-100"
                  required
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 uppercase font-semibold mb-1">
                  Season Type
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setSeasonType('regular')}
                    className={`py-2 text-center rounded border font-medium ${
                      seasonType === 'regular'
                        ? 'bg-ice-600 border-ice-400 text-white'
                        : 'bg-rink-dark border-rink-border text-slate-300'
                    }`}
                  >
                    Regular Season
                  </button>
                  <button
                    type="button"
                    onClick={() => setSeasonType('playoffs')}
                    className={`py-2 text-center rounded border font-medium ${
                      seasonType === 'playoffs'
                        ? 'bg-ice-600 border-ice-400 text-white'
                        : 'bg-rink-dark border-rink-border text-slate-300'
                    }`}
                  >
                    Playoffs
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Forwards</label>
                  <input
                    type="number"
                    min={0}
                    value={forwardsCount}
                    onChange={(e) => setForwardsCount(Number(e.target.value))}
                    className="w-full bg-rink-dark border border-rink-border rounded p-2 text-center"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Defense</label>
                  <input
                    type="number"
                    min={0}
                    value={defenseCount}
                    onChange={(e) => setDefenseCount(Number(e.target.value))}
                    className="w-full bg-rink-dark border border-rink-border rounded p-2 text-center"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Goalies</label>
                  <input
                    type="number"
                    min={0}
                    value={goaliesCount}
                    onChange={(e) => setGoaliesCount(Number(e.target.value))}
                    className="w-full bg-rink-dark border border-rink-border rounded p-2 text-center"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">IR Slots</label>
                  <input
                    type="number"
                    min={0}
                    value={irCount}
                    onChange={(e) => setIrCount(Number(e.target.value))}
                    className="w-full bg-rink-dark border border-rink-border rounded p-2 text-center"
                  />
                </div>
              </div>

              <div className="pt-2 border-t border-rink-border">
                <div className="flex items-center justify-between mb-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={salaryCapEnabled}
                      onChange={(e) => setSalaryCapEnabled(e.target.checked)}
                      className="rounded bg-rink-dark border-rink-border text-ice-500"
                    />
                    <span className="font-medium text-slate-200">Enable Salary Cap</span>
                  </label>
                  {salaryCapEnabled && (
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-slate-400">$</span>
                      <input
                        type="number"
                        step={0.5}
                        value={salaryCapAmount}
                        onChange={(e) => setSalaryCapAmount(Number(e.target.value))}
                        className="w-20 bg-rink-dark border border-rink-border rounded p-1 text-center font-mono"
                      />
                      <span className="text-xs text-slate-400">M</span>
                    </div>
                  )}
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={saveAsTemplate}
                  onChange={(e) => setSaveAsTemplate(e.target.checked)}
                  className="rounded bg-rink-dark border-rink-border text-ice-500"
                />
                <span className="text-slate-300">Also save these rules as a template (named after this draft)</span>
              </label>

              <div className="flex justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded text-slate-300 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-ice-600 hover:bg-ice-500 text-white font-semibold px-5 py-2 rounded transition"
                >
                  Create Draft
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Join Draft */}
      {showJoinModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-rink-card border border-rink-border rounded-xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <h3 className="text-xl font-bold">Join Draft Pool</h3>
            {joinError && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm rounded">
                {joinError}
              </div>
            )}
            <form onSubmit={handleJoinDraft} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs text-slate-400 uppercase font-semibold mb-1">
                  Draft Invite Code
                </label>
                <input
                  type="text"
                  placeholder="8-character code"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  maxLength={8}
                  className="w-full bg-rink-dark border border-rink-border rounded p-2.5 font-mono text-center tracking-widest text-ice-300 uppercase"
                  required
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 uppercase font-semibold mb-1">
                  Your Team Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Broad Street Bullies"
                  value={joinTeamName}
                  onChange={(e) => setJoinTeamName(e.target.value)}
                  className="w-full bg-rink-dark border border-rink-border rounded p-2.5 text-slate-100"
                  required
                />
              </div>

              <div className="flex justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowJoinModal(false)}
                  className="px-4 py-2 rounded text-slate-300 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-gradient-to-r from-ice-600 to-ice-500 hover:from-ice-500 hover:to-ice-400 text-white font-semibold px-5 py-2 rounded transition"
                >
                  Join Pool
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-400">Loading dashboard...</div>}>
      <DashboardContent />
    </Suspense>
  );
}
