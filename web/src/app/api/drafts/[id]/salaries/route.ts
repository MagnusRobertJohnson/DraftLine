import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getOptionalUserId, canManageDraft } from '@/lib/requireAdmin';
import { getEffectiveSalaries } from '@/lib/salaries';

export const dynamic = 'force-dynamic';

// PUT: Set one player's cap hit for this draft. Before the first pick this saves the admin's own
// override; afterwards it edits the draft's locked snapshot so missing salaries can still be fixed.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: draftId } = await params;
    const { data: draft } = await supabaseAdmin.from('drafts').select('*').eq('id', draftId).single();
    if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });

    const userId = await getOptionalUserId(request);
    if (!userId || !(await canManageDraft(userId, draft))) {
      return NextResponse.json({ error: 'Only the draft administrator can do this' }, { status: 403 });
    }

    const body = await request.json();
    const playerId = Number(body.playerId);
    const capHit = Number(body.capHit);
    if (!playerId || !Number.isFinite(capHit) || capHit < 0 || capHit >= 10000) {
      return NextResponse.json({ error: 'playerId and a valid capHit (in $M) are required' }, { status: 400 });
    }

    const { count } = await supabaseAdmin
      .from('draft_salaries')
      .select('nhl_player_id', { count: 'exact', head: true })
      .eq('draft_id', draftId);

    if (count && count > 0) {
      const { error } = await supabaseAdmin
        .from('draft_salaries')
        .upsert({ draft_id: draftId, nhl_player_id: playerId, cap_hit: capHit }, { onConflict: 'draft_id,nhl_player_id' });
      if (error) throw error;
    } else {
      const { error } = await supabaseAdmin.from('admin_salary_overrides').upsert(
        {
          admin_id: draft.admin_id,
          season_id: draft.season_id,
          nhl_player_id: playerId,
          player_name: body.playerName || String(playerId),
          cap_hit: capHit,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'admin_id,season_id,nhl_player_id' }
      );
      if (error) throw error;
    }
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to save salary' }, { status: 500 });
  }
}

// GET: Salaries for a draft's admin screen. Locked snapshot once picks exist, otherwise the
// admin's current effective salaries (shared values plus their overrides).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: draftId } = await params;
    const { data: draft } = await supabaseAdmin.from('drafts').select('*').eq('id', draftId).single();
    if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });

    const userId = await getOptionalUserId(request);
    if (!userId || !(await canManageDraft(userId, draft))) {
      return NextResponse.json({ error: 'Only the draft administrator can do this' }, { status: 403 });
    }

    const { data: locked } = await supabaseAdmin
      .from('draft_salaries')
      .select('nhl_player_id, cap_hit')
      .eq('draft_id', draftId)
      .range(0, 4999);

    if (locked && locked.length > 0) {
      return NextResponse.json({
        locked: true,
        salaries: Object.fromEntries(locked.map((r) => [r.nhl_player_id, Number(r.cap_hit)])),
      });
    }

    const { salaries } = await getEffectiveSalaries(draft.admin_id, draft.season_id);
    return NextResponse.json({ locked: false, salaries: Object.fromEntries(salaries) });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to load salaries' }, { status: 500 });
  }
}
