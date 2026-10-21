import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getOptionalUserId } from '@/lib/requireAdmin';

export const dynamic = 'force-dynamic';

const TIERS = ['free', 'admin_basic', 'admin_top'];

// PLACEHOLDER: switches the caller's own plan with no payment.
// Before launch, remove this and change the tier from a payment-provider webhook instead,
// or set PLACEHOLDER_PLAN_CHANGES=false to disable it.
export async function POST(request: NextRequest) {
  if (process.env.PLACEHOLDER_PLAN_CHANGES === 'false') {
    return NextResponse.json({ error: 'Plan changes require payment.' }, { status: 403 });
  }
  const userId = await getOptionalUserId(request);
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  const { tier } = await request.json();
  if (!TIERS.includes(tier)) {
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('profiles')
    .update({ subscription_tier: tier })
    .eq('id', userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
