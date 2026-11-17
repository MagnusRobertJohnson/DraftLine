import { NextRequest, NextResponse } from 'next/server';
import { webhooks } from '@polar-sh/sdk/2026-10';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { orderActionFromEvent, polarProductIdsFromEnv } from '@/lib/polarOrders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const secret = process.env.POLAR_WEBHOOK_SECRET;
  if (!secret) {
    console.error('POLAR_WEBHOOK_SECRET is not configured');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  // The signature covers the exact raw body, so it must not be parsed first.
  const rawBody = await request.text();
  let event;
  try {
    event = await webhooks.validateEvent(rawBody, Object.fromEntries(request.headers), secret);
  } catch (error) {
    if (error instanceof webhooks.PolarWebhookVerificationError) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
    }
    if (error instanceof webhooks.PolarWebhookUnknownTypeError) {
      return NextResponse.json({ received: true }, { status: 202 });
    }
    return NextResponse.json({ error: 'Invalid webhook' }, { status: 400 });
  }

  const result = orderActionFromEvent(event as any, polarProductIdsFromEnv(process.env));
  if ('ignored' in result) {
    return NextResponse.json({ received: true, ignored: result.ignored });
  }

  const { action } = result;
  const { data, error } = await supabaseAdmin.rpc('apply_polar_order', {
    p_webhook_id: request.headers.get('webhook-id'),
    p_event_type: event.type,
    p_order_id: action.orderId,
    p_user_id: action.userId,
    p_kind: action.kind,
    p_status: action.status,
  });
  if (error) {
    // A non-2xx response makes Polar retry the event.
    console.error('Polar webhook failed to apply order', action.orderId, error.message);
    return NextResponse.json({ error: 'Could not apply order' }, { status: 500 });
  }
  return NextResponse.json({ received: true, result: data });
}
