'use client';

import { useEffect, useState } from 'react';
import type { SalaryReview } from '@shared/salary';
import { buildSalaryReviewChoices, type SalaryReviewInputs } from '@shared/salary-review';
import { formatReviewPlayerStats, type SalaryReviewPlayerInfo } from '@shared/salary-review-stats';
import { authHeaders } from '@/lib/clientAuth';

export default function SalaryReviews({ refresh, onSaved }: { refresh: number; onSaved: () => void }) {
  const [reviews, setReviews] = useState<SalaryReview[]>([]);
  const [open, setOpen] = useState(false);
  const [inputs, setInputs] = useState<SalaryReviewInputs>({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [playerInfo, setPlayerInfo] = useState<Record<number, SalaryReviewPlayerInfo>>({});
  const [statsWarning, setStatsWarning] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await fetch('/api/players/salary-reviews', { headers: await authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load salary reviews');
      setReviews(data.reviews);
      setPlayerInfo(data.playerInfo ?? {});
      setStatsWarning(data.statsWarning ?? null);
      setError('');
      if (refresh > 0 && data.reviews.length) setOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load salary reviews');
    }
  };
  useEffect(() => { void load(); }, [refresh]);

  const save = async (review: SalaryReview) => {
    setError('');
    try {
      const choices = buildSalaryReviewChoices(review, inputs);
      setSaving(true);
      const res = await fetch('/api/players/salary-reviews', {
        method: 'POST', headers: await authHeaders(),
        body: JSON.stringify({ key: review.key, fingerprint: review.fingerprint, choices }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save salary review');
      setInputs({});
      await load();
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save salary review');
    } finally {
      setSaving(false);
    }
  };
  const update = (id: number, patch: Partial<{ selection: string; manual: string }>) =>
    setInputs((previous) => ({ ...previous, [id]: { ...(previous[id] ?? { selection: '', manual: '' }), ...patch } }));

  return (
    <>
      {error && <div role="alert" className="p-3 rounded-lg bg-rose-500/10 text-rose-300">{error} <button className="underline" onClick={load}>Reload reviews</button></div>}
      {reviews.length > 0 && (
        <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300">
          {reviews.length} salary match group{reviews.length === 1 ? '' : 's'} need review. Their shared salaries are unknown until resolved.{' '}
          <button className="font-bold underline" onClick={() => setOpen(true)}>Review players</button>
        </div>
      )}
      {open && reviews.length > 0 && (
        <div role="dialog" aria-modal="true" aria-labelledby="salary-review-title" className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-rink-card border border-rink-border rounded-xl p-5 w-full max-w-3xl max-h-[90vh] overflow-y-auto space-y-4 text-slate-200">
            <div className="flex justify-between gap-4">
              <h2 id="salary-review-title" className="text-xl font-bold">Review ambiguous salaries</h2>
              <button onClick={() => setOpen(false)} className="underline">Close</button>
            </div>
            <p className="text-sm text-slate-400">Confirm a previous salary, choose a source salary, enter a different salary, or mark each player unknown. These values may be from an earlier sync and are not verified recommendations. Shared salaries are rounded to $0.01M. Private overrides still take precedence for their owner; locked drafts are unchanged.</p>
            {statsWarning && <p className="text-amber-300">{statsWarning}</p>}
            {error && <p role="alert" className="text-rose-300">{error}</p>}
            {reviews.map((review) => (
              <section key={review.key} className="border border-rink-border rounded-lg p-4 space-y-3">
                <p className="font-bold">Possible source salaries</p>
                <ul className="text-sm text-slate-300">
                  {review.details.salaries.map((salary, index) => (
                    <li key={index}>{index + 1}. {salary.name}: ${salary.capHit.toFixed(3)}M{salary.teamAbbrev ? ` — ${salary.teamAbbrev}` : ''}{salary.position ? `, ${salary.position}` : ''}</li>
                  ))}
                </ul>
                {review.details.players.map((player) => (
                  <div key={player.id} className="space-y-1">
                    <label className="block font-semibold" htmlFor={`review-${player.id}`}>
                      {player.fullName} — {player.teamAbbrev || 'team unavailable'} — {playerInfo[player.id]?.position || 'position unavailable'} — NHL ID {player.id}
                    </label>
                    <p className="text-sm text-slate-400">{formatReviewPlayerStats(playerInfo[player.id])}</p>
                    <select id={`review-${player.id}`} className="bg-slate-900 rounded p-2 w-full" value={inputs[player.id]?.selection || ''}
                      onChange={(e) => update(player.id, { selection: e.target.value })}>
                      <option value="">Choose an action</option>
                      <option value="unknown">Mark unknown</option>
                      <option value="manual">Enter a salary</option>
                      {Number(review.details.previousSalaries?.[player.id]) > 0 && (
                        <option value="previous">Keep previous shared salary: ${Number(review.details.previousSalaries?.[player.id]).toFixed(2)}M</option>
                      )}
                      {review.details.salaries.map((salary, index) => (
                        <option key={index} value={`source:${index}`}>Source {index + 1}: {salary.name} — ${salary.capHit.toFixed(3)}M{salary.teamAbbrev ? ` (${salary.teamAbbrev})` : ''}</option>
                      ))}
                    </select>
                    {inputs[player.id]?.selection === 'manual' && (
                      <input aria-label={`Salary in millions for ${player.fullName}, NHL ID ${player.id}`} className="bg-slate-900 rounded p-2 w-full"
                        inputMode="decimal" placeholder="Salary in millions, e.g. 0.95"
                        value={inputs[player.id]?.manual || ''} onChange={(e) => update(player.id, { manual: e.target.value })} />
                    )}
                  </div>
                ))}
                <button disabled={saving} onClick={() => save(review)} className="bg-ice-600 rounded px-4 py-2 font-semibold disabled:opacity-50">
                  {saving ? 'Saving...' : 'Save shared salaries'}
                </button>
              </section>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
