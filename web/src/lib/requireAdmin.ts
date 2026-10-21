import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export interface AdminAuth {
  userId?: string; // undefined when authenticated by the cron secret
  isSuperAdmin?: boolean;
  error?: NextResponse;
}

function bearer(request: NextRequest): string | undefined {
  return request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || undefined;
}

// Returns the signed-in user's id from the request token, or null.
export async function getOptionalUserId(request: NextRequest): Promise<string | null> {
  const token = bearer(request);
  if (!token) return null;
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  return error || !data.user ? null : data.user.id;
}

async function getPrivileges(userId: string) {
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('subscription_tier, is_super_admin')
    .eq('id', userId)
    .maybeSingle();
  const superAdmin = !!data?.is_super_admin;
  return {
    superAdmin,
    paidAdmin: superAdmin || ['admin_basic', 'admin_top'].includes(data?.subscription_tier ?? ''),
  };
}

// Verifies the caller is a signed-in paid admin or the super admin (or the cron job via CRON_SECRET).
export async function authenticateAdmin(
  request: NextRequest,
  options: { allowCron?: boolean } = {}
): Promise<AdminAuth> {
  const token = bearer(request);
  if (!token) return { error: NextResponse.json({ error: 'Sign in required' }, { status: 401 }) };
  if (options.allowCron && process.env.CRON_SECRET && token === process.env.CRON_SECRET) return {};

  const userId = await getOptionalUserId(request);
  if (!userId) {
    return { error: NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 }) };
  }
  const priv = await getPrivileges(userId);
  if (!priv.paidAdmin) {
    return { error: NextResponse.json({ error: 'Administrator access required' }, { status: 403 }) };
  }
  return { userId, isSuperAdmin: priv.superAdmin };
}

// Verifies the caller is the super admin.
export async function authenticateSuperAdmin(request: NextRequest): Promise<AdminAuth> {
  const userId = await getOptionalUserId(request);
  if (!userId) return { error: NextResponse.json({ error: 'Sign in required' }, { status: 401 }) };
  const priv = await getPrivileges(userId);
  if (!priv.superAdmin) {
    return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  }
  return { userId, isSuperAdmin: true };
}

// A draft can be managed by its own admin or by the super admin.
export async function canManageDraft(
  userId: string | null,
  draft: { admin_id: string }
): Promise<boolean> {
  if (!userId) return false;
  if (userId === draft.admin_id) return true;
  return (await getPrivileges(userId)).superAdmin;
}

export async function logSuperAdminAction(
  actorId: string,
  action: string,
  details: { targetUser?: string; targetDraft?: string; [key: string]: unknown } = {}
) {
  const { targetUser, targetDraft, ...rest } = details;
  await supabaseAdmin.from('super_admin_audit_log').insert({
    actor_id: actorId,
    action,
    target_user: targetUser ?? null,
    target_draft: targetDraft ?? null,
    details: rest,
  });
}
