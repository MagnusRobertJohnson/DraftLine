import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getOptionalUserId } from '@/lib/requireAdmin';
import { notifyUsers } from '@/lib/notify';

export const dynamic = 'force-dynamic';

// Called by the app right after someone joins a draft; tells the draft's admin.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await getOptionalUserId(request);
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  const { data: team } = await supabaseAdmin
    .from('draft_teams')
    .select('team_name, created_at, drafts(name, admin_id)')
    .eq('draft_id', id)
    .eq('user_id', userId)
    .maybeSingle();
  const draft = (team as any)?.drafts;
  if (!team || !draft) return NextResponse.json({ error: 'Not a member of this draft' }, { status: 403 });

  // Only notify for teams created in the last few minutes so this can't be used to spam
  if (Date.now() - new Date(team.created_at).getTime() > 10 * 60 * 1000 || draft.admin_id === userId) {
    return NextResponse.json({ success: true, skipped: true });
  }

  await notifyUsers([draft.admin_id], {
    type: 'draft_updates',
    title: `New team in "${draft.name}"`,
    body: `${team.team_name} joined your draft.`,
    link: `/drafts/${id}/admin`,
  });
  return NextResponse.json({ success: true });
}
