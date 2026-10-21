import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { authenticateSuperAdmin, logSuperAdminAction } from '@/lib/requireAdmin';

export const dynamic = 'force-dynamic';

const TIERS = ['free', 'admin_basic', 'admin_top'];

export async function GET(request: NextRequest) {
  const auth = await authenticateSuperAdmin(request);
  if (auth.error) return auth.error;

  const q = new URL(request.url).searchParams.get('q')?.trim().replace(/[,%()]/g, '') ?? '';
  let query = supabaseAdmin
    .from('profiles')
    .select('id, email, display_name, subscription_tier, is_super_admin, created_at')
    .order('created_at', { ascending: false })
    .limit(100);
  if (q) query = query.or(`email.ilike.%${q}%,display_name.ilike.%${q}%`);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ users: data });
}

// Grant or change a user's tier.
export async function PATCH(request: NextRequest) {
  const auth = await authenticateSuperAdmin(request);
  if (auth.error) return auth.error;

  const { userId, tier } = await request.json();
  if (!userId || !TIERS.includes(tier)) {
    return NextResponse.json({ error: 'userId and a valid tier are required' }, { status: 400 });
  }

  const { data: before } = await supabaseAdmin
    .from('profiles')
    .select('subscription_tier')
    .eq('id', userId)
    .maybeSingle();
  if (!before) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const { error } = await supabaseAdmin
    .from('profiles')
    .update({ subscription_tier: tier })
    .eq('id', userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logSuperAdminAction(auth.userId!, 'set_tier', {
    targetUser: userId,
    from: before.subscription_tier,
    to: tier,
  });
  return NextResponse.json({ success: true });
}
