import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getOptionalUserId, canManageDraft } from '@/lib/requireAdmin';
import { getEffectiveSalaries } from '@/lib/salaries';

export const dynamic = 'force-dynamic';

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
