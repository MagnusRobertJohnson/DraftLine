import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { authenticateSuperAdmin } from '@/lib/requireAdmin';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await authenticateSuperAdmin(request);
  if (auth.error) return auth.error;

  const { data: drafts, error } = await supabaseAdmin
    .from('drafts')
    .select('id, name, status, season_id, admin_id, created_at, draft_teams(id)')
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const adminIds = [...new Set((drafts ?? []).map((d) => d.admin_id))];
  const { data: admins } = await supabaseAdmin
    .from('profiles')
    .select('id, email, display_name')
    .in('id', adminIds);
  const byId = new Map((admins ?? []).map((a) => [a.id, a]));

  return NextResponse.json({
    drafts: (drafts ?? []).map((d: any) => ({
      id: d.id,
      name: d.name,
      status: d.status,
      season_id: d.season_id,
      created_at: d.created_at,
      teamCount: d.draft_teams?.length ?? 0,
      adminEmail: byId.get(d.admin_id)?.email ?? 'unknown',
      adminName: byId.get(d.admin_id)?.display_name ?? null,
    })),
  });
}
