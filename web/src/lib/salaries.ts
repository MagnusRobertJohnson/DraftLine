import { supabaseAdmin } from '@/lib/supabase/admin';

// Shared automatic salaries, with the admin's own overrides applied on top.
export async function getEffectiveSalaries(
  adminId: string,
  seasonId: string
): Promise<{ salaries: Map<number, number>; overrides: Map<number, number> }> {
  const [shared, own] = await Promise.all([
    supabaseAdmin.from('player_salaries').select('nhl_player_id, cap_hit').eq('season_id', seasonId),
    supabaseAdmin
      .from('admin_salary_overrides')
      .select('nhl_player_id, cap_hit')
      .eq('admin_id', adminId)
      .eq('season_id', seasonId),
  ]);
  if (shared.error) throw shared.error;
  if (own.error) throw own.error;

  const salaries = new Map<number, number>();
  const overrides = new Map<number, number>();
  for (const r of shared.data ?? []) salaries.set(r.nhl_player_id, Number(r.cap_hit));
  for (const r of own.data ?? []) {
    salaries.set(r.nhl_player_id, Number(r.cap_hit));
    overrides.set(r.nhl_player_id, Number(r.cap_hit));
  }
  return { salaries, overrides };
}

// Returns the draft's locked salaries, creating the snapshot on first use.
export async function getOrLockDraftSalaries(draft: {
  id: string;
  admin_id: string;
  season_id: string;
}): Promise<Map<number, number>> {
  const load = async () => {
    const { data, error } = await supabaseAdmin
      .from('draft_salaries')
      .select('nhl_player_id, cap_hit')
      .eq('draft_id', draft.id)
      .range(0, 4999);
    if (error) throw error;
    return data ?? [];
  };

  let rows = await load();
  if (rows.length === 0) {
    const { salaries } = await getEffectiveSalaries(draft.admin_id, draft.season_id);
    const snapshot = [...salaries].map(([nhl_player_id, cap_hit]) => ({
      draft_id: draft.id,
      nhl_player_id,
      cap_hit,
    }));
    for (let i = 0; i < snapshot.length; i += 500) {
      const { error } = await supabaseAdmin
        .from('draft_salaries')
        .upsert(snapshot.slice(i, i + 500), {
          onConflict: 'draft_id,nhl_player_id',
          ignoreDuplicates: true,
        });
      if (error) throw error;
    }
    rows = await load();
  }
  return new Map(rows.map((r) => [r.nhl_player_id as number, Number(r.cap_hit)]));
}
