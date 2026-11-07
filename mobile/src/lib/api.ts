import { supabase } from './supabase';

// Base URL of the deployed DraftLine web app (the mobile app calls its /api routes).
export const API_URL = (process.env.EXPO_PUBLIC_API_URL || '').replace(/\/$/, '');

export interface ApiResult<T = any> {
  ok: boolean;
  status: number;
  data: T;
}

export function friendlyNetworkError(message: string): string {
  return /network request failed|failed to fetch|load failed|networkerror/i.test(message)
    ? "Can't reach the DraftLine server. Check your internet connection and try again. If it persists, the service may be temporarily offline."
    : message;
}

export async function api<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<ApiResult<T>> {
  if (!API_URL) {
    throw new Error('EXPO_PUBLIC_API_URL is not set. Add the web app address to mobile/.env.');
  }
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data: json as T };
  } catch (err: any) {
    throw new Error(friendlyNetworkError(err?.message || 'Request failed'));
  }
}

export async function fetchIsPaidAdmin(userId: string): Promise<boolean> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('subscription_tier, is_super_admin')
    .eq('id', userId)
    .maybeSingle();
  return (
    !!profile?.is_super_admin ||
    profile?.subscription_tier === 'admin_basic' ||
    profile?.subscription_tier === 'admin_top'
  );
}
