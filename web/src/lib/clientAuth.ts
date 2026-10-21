import { supabase } from '@/lib/supabase/client';

export async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    : { 'Content-Type': 'application/json' };
}

export async function fetchIsAdmin(): Promise<boolean> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) return false;
  const { data: profile } = await supabase
    .from('profiles')
    .select('subscription_tier, is_super_admin')
    .eq('id', data.user.id)
    .maybeSingle();
  return (
    !!profile?.is_super_admin ||
    profile?.subscription_tier === 'admin_basic' ||
    profile?.subscription_tier === 'admin_top'
  );
}
