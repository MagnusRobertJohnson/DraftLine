import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json({ error: 'Plan changes require a verified purchase.' }, { status: 403 });
}
