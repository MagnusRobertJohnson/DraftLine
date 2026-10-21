import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { validateRosterSwap, getNextEasternMidnight } from '@shared/roster-validation';
import type { Draft, DraftPick } from '@shared/types';
import { getOptionalUserId, canManageDraft } from '@/lib/requireAdmin';
import { notifyUsers } from '@/lib/notify';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: draftId } = await params;
    const body = await request.json();
    const { teamId, outgoingActivePickIds, incomingIrPickIds } = body;
    const userId = await getOptionalUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
    }

    // Load draft
    const { data: draft, error: draftErr } = await supabaseAdmin
      .from('drafts')
      .select('*')
      .eq('id', draftId)
      .single();

    if (draftErr || !draft) {
      return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
    }

    // Load team
    const { data: team, error: teamErr } = await supabaseAdmin
      .from('draft_teams')
      .select('*')
      .eq('id', teamId)
      .eq('draft_id', draftId)
      .single();

    if (teamErr || !team) {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 });
    }

    // Verify ownership or admin
    if (team.user_id !== userId && !(await canManageDraft(userId, draft))) {
      return NextResponse.json({ error: 'Unauthorized to manage this team.' }, { status: 403 });
    }

    // Check if team has pending swap that locks these players
    const { data: pendingTx } = await supabaseAdmin
      .from('roster_transactions')
      .select('id, roster_transaction_players(draft_pick_id)')
      .eq('draft_team_id', teamId)
      .eq('status', 'pending');

    const pendingPickIds = new Set(
      (pendingTx || []).flatMap((t: any) =>
        (t.roster_transaction_players || []).map((tp: any) => tp.draft_pick_id)
      )
    );

    for (const id of [...outgoingActivePickIds, ...incomingIrPickIds]) {
      if (pendingPickIds.has(id)) {
        return NextResponse.json(
          { error: 'One or more of the selected players is already involved in a pending swap.' },
          { status: 400 }
        );
      }
    }

    // Load team roster
    const { data: roster, error: rosterErr } = await supabaseAdmin
      .from('draft_picks')
      .select('*')
      .eq('draft_team_id', teamId);

    if (rosterErr) throw rosterErr;

    // Validate swap rule: position parity & salary cap
    const validation = validateRosterSwap(
      draft as Draft,
      roster as DraftPick[],
      outgoingActivePickIds,
      incomingIrPickIds
    );

    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    // Calculate effective time (Next Eastern Midnight)
    const effectiveAt = getNextEasternMidnight().toISOString();

    // Insert transaction
    const { data: tx, error: txErr } = await supabaseAdmin
      .from('roster_transactions')
      .insert({
        draft_id: draftId,
        draft_team_id: teamId,
        user_id: userId || null,
        transaction_type: 'ir_swap',
        effective_at: effectiveAt,
        status: 'pending',
      })
      .select()
      .single();

    if (txErr) throw txErr;

    // Insert transaction players
    const txPlayers = [
      ...outgoingActivePickIds.map((id: string) => ({
        transaction_id: tx.id,
        draft_pick_id: id,
        from_status: 'active',
        to_status: 'ir',
      })),
      ...incomingIrPickIds.map((id: string) => ({
        transaction_id: tx.id,
        draft_pick_id: id,
        from_status: 'ir',
        to_status: 'active',
      })),
    ];

    const { error: playersErr } = await supabaseAdmin
      .from('roster_transaction_players')
      .insert(txPlayers);

    if (playersErr) throw playersErr;

    if (team.user_id === userId && draft.admin_id !== userId) {
      await notifyUsers([draft.admin_id], {
        type: 'swaps',
        title: `Roster swap in "${draft.name}"`,
        body: `${team.team_name} requested an injured-reserve swap.`,
        link: `/drafts/${draftId}/standings`,
      });
    } else if (team.user_id && team.user_id !== userId) {
      await notifyUsers([team.user_id], {
        type: 'swaps',
        title: `Roster swap on your team in "${draft.name}"`,
        body: 'The draft administrator requested a swap for your team.',
        link: `/drafts/${draftId}/roster`,
      });
    }

    return NextResponse.json({
      success: true,
      transaction: tx,
      effectiveAt,
      projectedActiveCapHit: validation.projectedActiveCapHit,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Swap failed' }, { status: 500 });
  }
}

// DELETE: Cancel pending swap
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { searchParams } = new URL(request.url);
    const transactionId = searchParams.get('transactionId');

    if (!transactionId) {
      return NextResponse.json({ error: 'Missing transactionId' }, { status: 400 });
    }

    const callerId = await getOptionalUserId(request);
    if (!callerId) {
      return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
    }
    const { id: draftId } = await params;
    const { data: tx } = await supabaseAdmin
      .from('roster_transactions')
      .select('id, user_id, draft_id, drafts(admin_id)')
      .eq('id', transactionId)
      .eq('draft_id', draftId)
      .maybeSingle();
    if (!tx) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }
    const adminId = (tx as any).drafts?.admin_id;
    if (tx.user_id !== callerId && !(await canManageDraft(callerId, { admin_id: adminId }))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { error } = await supabaseAdmin
      .from('roster_transactions')
      .delete()
      .eq('id', transactionId)
      .eq('status', 'pending');

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to cancel swap' }, { status: 500 });
  }
}
