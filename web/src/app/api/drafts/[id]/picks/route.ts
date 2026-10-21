import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getOptionalUserId, canManageDraft, logSuperAdminAction } from '@/lib/requireAdmin';
import { notifyUsers, getDraftParticipantIds } from '@/lib/notify';
import { getOrLockDraftSalaries } from '@/lib/salaries';

export const dynamic = 'force-dynamic';

// POST: Add a pick or undo a pick
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: draftId } = await params;
    const body = await request.json();
    const { action } = body;

    // Load draft details
    const { data: draft, error: draftErr } = await supabaseAdmin
      .from('drafts')
      .select('*')
      .eq('id', draftId)
      .single();

    if (draftErr || !draft) {
      return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
    }

    const userId = await getOptionalUserId(request);
    if (!userId || !(await canManageDraft(userId, draft))) {
      return NextResponse.json({ error: 'Only the draft administrator can do this' }, { status: 403 });
    }
    if (userId !== draft.admin_id) {
      await logSuperAdminAction(userId, `draft_${action}`, { targetDraft: draftId, draftName: draft.name });
    }

    if (action === 'make_pick') {
      const { teamId, pickNumber, nhlPlayerId, playerName, position, team } = body;

      // Salaries are locked in for this draft at its first pick; the server decides the cap hit
      const lockedSalaries = await getOrLockDraftSalaries(draft);
      const capHit = lockedSalaries.get(Number(nhlPlayerId)) ?? 0;

      // Check if player is already drafted
      const { data: existingPick } = await supabaseAdmin
        .from('draft_picks')
        .select('id, player_name')
        .eq('draft_id', draftId)
        .eq('nhl_player_id', nhlPlayerId)
        .maybeSingle();

      if (existingPick) {
        return NextResponse.json(
          { error: `${existingPick.player_name} has already been drafted.` },
          { status: 400 }
        );
      }

      // Check salary cap if enabled
      if (draft.salary_cap_enabled) {
        const { data: teamPicks } = await supabaseAdmin
          .from('draft_picks')
          .select('cap_hit')
          .eq('draft_id', draftId)
          .eq('draft_team_id', teamId);

        const currentTeamCap = (teamPicks || []).reduce((sum, p) => sum + Number(p.cap_hit || 0), 0);
        if (currentTeamCap + Number(capHit) > Number(draft.salary_cap_amount) + 0.0001) {
          return NextResponse.json(
            {
              error: `Drafting this player would exceed the $${draft.salary_cap_amount}M salary cap (current: $${currentTeamCap.toFixed(2)}M + player: $${Number(capHit).toFixed(2)}M).`,
            },
            { status: 400 }
          );
        }
      }

      // Insert pick
      const { data: pick, error: pickErr } = await supabaseAdmin
        .from('draft_picks')
        .insert({
          draft_id: draftId,
          draft_team_id: teamId,
          pick_number: pickNumber,
          nhl_player_id: nhlPlayerId,
          player_name: playerName,
          player_position: position,
          player_team: team,
          roster_status: 'active',
          cap_hit: Number(capHit),
        })
        .select()
        .single();

      if (pickErr) throw pickErr;

      // Update draft current_pick
      await supabaseAdmin
        .from('drafts')
        .update({
          current_pick: pickNumber + 1,
          status: draft.status === 'setup' ? 'active' : draft.status,
          updated_at: new Date().toISOString(),
        })
        .eq('id', draftId);

      return NextResponse.json({ success: true, pick });
    }

    if (action === 'undo_pick') {
      // Find highest pick_number for this draft
      const { data: lastPick } = await supabaseAdmin
        .from('draft_picks')
        .select('*')
        .eq('draft_id', draftId)
        .order('pick_number', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!lastPick) {
        return NextResponse.json({ error: 'No picks to undo.' }, { status: 400 });
      }

      // Delete the last pick
      const { error: delErr } = await supabaseAdmin
        .from('draft_picks')
        .delete()
        .eq('id', lastPick.id);

      if (delErr) throw delErr;

      // Decrement current_pick
      await supabaseAdmin
        .from('drafts')
        .update({
          current_pick: Math.max(1, lastPick.pick_number),
          updated_at: new Date().toISOString(),
        })
        .eq('id', draftId);

      return NextResponse.json({ success: true, undonePick: lastPick });
    }

    if (action === 'finalize_draft') {
      const { error: finErr } = await supabaseAdmin
        .from('drafts')
        .update({
          status: 'confirmed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', draftId);

      if (finErr) throw finErr;
      await notifyUsers(
        (await getDraftParticipantIds(draftId)).filter((u) => u !== userId),
        {
          type: 'draft_updates',
          title: `"${draft.name}" is final`,
          body: 'Rosters are confirmed. Check the standings and manage your injured reserve.',
          link: `/drafts/${draftId}/standings`,
        }
      );
      return NextResponse.json({ success: true, status: 'confirmed' });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Pick operation failed' }, { status: 500 });
  }
}
