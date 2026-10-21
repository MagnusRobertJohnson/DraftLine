import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getOptionalUserId } from '@/lib/requireAdmin';
import { TEAM_ICONS } from '@shared/team-style';

export const dynamic = 'force-dynamic';

// A team's owner sets their own team colour and icon.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await getOptionalUserId(request);
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  const { color, icon } = await request.json();
  if (color !== null && !/^#[0-9a-fA-F]{6}$/.test(String(color))) {
    return NextResponse.json({ error: 'Invalid colour' }, { status: 400 });
  }
  if (icon !== null && !TEAM_ICONS.includes(icon)) {
    return NextResponse.json({ error: 'Invalid icon' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('draft_teams')
    .update({ team_color: color, team_icon: icon })
    .eq('draft_id', id)
    .eq('user_id', userId)
    .select('id');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: 'You do not have a team in this draft' }, { status: 403 });
  return NextResponse.json({ success: true });
}
