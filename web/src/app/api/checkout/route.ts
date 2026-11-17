import { NextRequest, NextResponse } from 'next/server';
import { createPolar } from '@polar-sh/sdk/2026-10';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getOptionalUserId } from '@/lib/requireAdmin';
import { CheckoutPlan, polarProductIdsFromEnv, productForCheckout } from '@/lib/polarOrders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Starts a Polar checkout for the signed-in user. The user id comes only from the verified session.
export async function POST(request: NextRequest) {
  const userId = await getOptionalUserId(request);
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const plan: CheckoutPlan | undefined =
    body?.plan === 'admin_basic' || body?.plan === 'admin_top' ? body.plan : undefined;
  if (!plan) return NextResponse.json({ error: 'Choose a plan' }, { status: 400 });

  const accessToken = process.env.POLAR_ACCESS_TOKEN;
  if (!accessToken) {
    return NextResponse.json({ error: 'Purchasing is not available yet.' }, { status: 503 });
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('subscription_tier, is_super_admin')
    .eq('id', userId)
    .maybeSingle();
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  if (profile.is_super_admin) {
    return NextResponse.json({ error: 'The owner account does not need a plan.' }, { status: 400 });
  }

  const { productId, error } = productForCheckout(profile.subscription_tier, plan, polarProductIdsFromEnv(process.env));
  if (error) return NextResponse.json({ error }, { status: 400 });
  if (!productId) return NextResponse.json({ error: 'Purchasing is not available yet.' }, { status: 503 });

  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin).replace(/\/$/, '');

  try {
    const polar = createPolar({
      accessToken,
      environment: process.env.POLAR_SERVER === 'production' ? 'production' : 'sandbox',
    });
    const checkout = await polar.checkouts.create({
      products: [productId],
      external_customer_id: userId,
      customer_email: authUser.user?.email ?? undefined,
      metadata: { supabase_user_id: userId },
      success_url: `${appUrl}/settings?purchase=success`,
    });
    return NextResponse.json({ url: checkout.url });
  } catch (err) {
    console.error('Polar checkout creation failed', err);
    return NextResponse.json({ error: 'Could not start checkout. Please try again.' }, { status: 502 });
  }
}
