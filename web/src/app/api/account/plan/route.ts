import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST() {
  return NextResponse.json({ error: 'Plan changes require a verified purchase. Purchasing is not available yet.' }, { status: 403 });
}
