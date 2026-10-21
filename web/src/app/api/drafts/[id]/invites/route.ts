import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getOptionalUserId, canManageDraft } from '@/lib/requireAdmin';
import { sendEmail, escapeHtml, emailConfigured } from '@/lib/email';
import { notifyUsers } from '@/lib/notify';

export const dynamic = 'force-dynamic';

const MAX_PER_REQUEST = 20;
const MAX_PER_DRAFT = 100;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function authorize(request: NextRequest, draftId: string) {
  const userId = await getOptionalUserId(request);
  const { data: draft } = await supabaseAdmin
    .from('drafts')
    .select('id, name, admin_id, invite_code')
    .eq('id', draftId)
    .maybeSingle();
  if (!draft) return { error: NextResponse.json({ error: 'Draft not found' }, { status: 404 }) };
  if (!userId || !(await canManageDraft(userId, draft))) {
    return { error: NextResponse.json({ error: 'Only the draft administrator can do this' }, { status: 403 }) };
  }
  return { userId, draft };
}

// List invites and whether each invitee has joined yet.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorize(request, id);
  if (auth.error) return auth.error;

  const [{ data: invites }, { data: teams }] = await Promise.all([
    supabaseAdmin.from('draft_invites').select('email, emailed, created_at').eq('draft_id', id).order('created_at', { ascending: false }),
    supabaseAdmin.from('draft_teams').select('profiles(email)').eq('draft_id', id),
  ]);
  const joined = new Set((teams ?? []).map((t: any) => t.profiles?.email?.toLowerCase()).filter(Boolean));
  return NextResponse.json({
    emailConfigured: emailConfigured(),
    invites: (invites ?? []).map((i: any) => ({ ...i, joined: joined.has(i.email) })),
  });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await authorize(request, id);
  if (auth.error) return auth.error;
  const draft = auth.draft!;

  const body = await request.json();
  const emails = [...new Set<string>(
    (Array.isArray(body.emails) ? body.emails : [])
      .map((e: unknown) => String(e).trim().toLowerCase())
      .filter((e: string) => EMAIL_RE.test(e))
  )].slice(0, MAX_PER_REQUEST);
  if (emails.length === 0) {
    return NextResponse.json({ error: 'Enter at least one valid email address.' }, { status: 400 });
  }

  const { count } = await supabaseAdmin
    .from('draft_invites')
    .select('*', { count: 'exact', head: true })
    .eq('draft_id', id);
  if ((count ?? 0) + emails.length > MAX_PER_DRAFT) {
    return NextResponse.json({ error: `A draft can have at most ${MAX_PER_DRAFT} email invites.` }, { status: 400 });
  }

  const base = (process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, '');
  const link = `${base}/dashboard?join=${draft.invite_code}`;
  const { data: inviter } = await supabaseAdmin.from('profiles').select('display_name, email').eq('id', auth.userId!).maybeSingle();
  const inviterName = inviter?.display_name || inviter?.email || 'A draft administrator';

  let sent = 0;
  for (const email of emails) {
    const ok = await sendEmail(
      email,
      `You're invited to join "${draft.name}" on HockeyPool`,
      `<p>${escapeHtml(inviterName)} invited you to join the hockey pool <strong>${escapeHtml(draft.name)}</strong>.</p>
       <p><a href="${link}">Join the pool</a></p>
       <p>Or sign in and enter invite code <strong>${draft.invite_code}</strong>.</p>`
    );
    if (ok) sent++;
    await supabaseAdmin
      .from('draft_invites')
      .upsert({ draft_id: id, email, invited_by: auth.userId!, emailed: ok }, { onConflict: 'draft_id,email' });
  }

  // Invitees who already have an account also get an in-app notification.
  const { data: existing } = await supabaseAdmin.from('profiles').select('id').in('email', emails);
  await notifyUsers((existing ?? []).map((p: any) => p.id), {
    type: 'invites',
    title: `You're invited to "${draft.name}"`,
    body: `${inviterName} invited you to join. Tap to join.`,
    link: `/dashboard?join=${draft.invite_code}`,
  });

  return NextResponse.json({
    sent,
    saved: emails.length,
    emailConfigured: emailConfigured(),
    link,
  });
}
