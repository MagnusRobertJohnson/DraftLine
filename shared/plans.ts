import type { SubscriptionTier } from './types';

export const PLANS: { tier: SubscriptionTier; name: string; description: string }[] = [
  { tier: 'free', name: 'Free member', description: 'Join unlimited drafts by invitation.' },
  { tier: 'admin_basic', name: 'Admin', description: 'Create up to 3 drafts per season.' },
  { tier: 'admin_top', name: 'Admin Pro', description: 'Create up to 15 drafts per season.' },
];

export function planName(tier: SubscriptionTier): string {
  return PLANS.find((plan) => plan.tier === tier)?.name ?? tier;
}
