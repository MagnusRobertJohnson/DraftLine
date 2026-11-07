import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getOptionalUserId, canManageDraft } from '@/lib/requireAdmin';

export const dynamic = 'force-dynamic';

function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// POST: Change the pick order before the draft begins.
// Actions: randomize | set_order (teamIds in pick order) | set_type (snake | linear)
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: draftId } = await params;
    const body = await request.json();

    const { data: draft } = await supabaseAdmin.from('drafts').select('*').eq('id', draftId).single();
    if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });

    const userId = await getOptionalUserId(request);
    if (!userId || !(await canManageDraft(userId, draft))) {
      return NextResponse.json({ error: 'Only the draft administrator can do this' }, { status: 403 });
    }

    const { count: pickCount } = await supabaseAdmin
      .from('draft_picks')
      .select('id', { count: 'exact', head: true })
      .eq('draft_id', draftId);
    if (draft.status !== 'setup' || (pickCount ?? 0) > 0) {
      return NextResponse.json(
        { error: 'The pick order is locked once the draft has begun. Undo all picks to change it.' },
        { status: 409 }
      );
    }

    if (body.action === 'set_type') {
      if (body.type !== 'snake' && body.type !== 'linear') {
        return NextResponse.json({ error: 'Order type must be snake or linear' }, { status: 400 });
      }
      const { error } = await supabaseAdmin
        .from('drafts')
        .update({ pick_order_type: body.type, updated_at: new Date().toISOString() })
        .eq('id', draftId);
      if (error) throw error;
      return NextResponse.json({ success: true });
    }

    const { data: teams, error: teamsErr } = await supabaseAdmin
      .from('draft_teams')
      .select('id, draft_order')
      .eq('draft_id', draftId)
      .order('draft_order', { ascending: true });
    if (teamsErr) throw teamsErr;
    const currentIds = (teams ?? []).map((t) => t.id as string);

    let newOrder: string[];
    if (body.action === 'randomize') {
      newOrder = shuffle(currentIds);
    } else if (body.action === 'set_order') {
      const ids: unknown = body.teamIds;
      if (
        !Array.isArray(ids) ||
        ids.length !== currentIds.length ||
        new Set(ids).size !== ids.length ||
        !ids.every((id) => currentIds.includes(id))
      ) {
        return NextResponse.json({ error: 'teamIds must list every team exactly once' }, { status: 400 });
      }
      newOrder = ids as string[];
    } else {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    // draft_order is unique per draft, so first move every team out of the way, then assign final positions
    const offset = currentIds.length + 1000;
    for (let i = 0; i < newOrder.length; i++) {
      const { error } = await supabaseAdmin
        .from('draft_teams')
        .update({ draft_order: offset + i + 1 })
        .eq('id', newOrder[i])
        .eq('draft_id', draftId);
      if (error) throw error;
    }
    for (let i = 0; i < newOrder.length; i++) {
      const { error } = await supabaseAdmin
        .from('draft_teams')
        .update({ draft_order: i + 1, updated_at: new Date().toISOString() })
        .eq('id', newOrder[i])
        .eq('draft_id', draftId);
      if (error) throw error;
    }

    return NextResponse.json({ success: true, order: newOrder });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to update pick order' }, { status: 500 });
  }
}
