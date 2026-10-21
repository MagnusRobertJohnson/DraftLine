import { NextRequest, NextResponse } from 'next/server';
import { POST } from '../../players/route';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Daily salary sync, triggered by Vercel Cron (see web/vercel.json)
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return POST(
    new NextRequest(request.url, {
      method: 'POST',
      body: '{}',
      headers: { authorization: `Bearer ${secret}` },
    })
  );
}
