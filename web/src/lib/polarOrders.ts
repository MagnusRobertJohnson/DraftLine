export type PolarKind = 'admin' | 'admin_pro' | 'admin_pro_upgrade';
export type PolarOrderStatus = 'paid' | 'partially_refunded' | 'refunded';

export interface PolarProductIds {
  admin?: string;
  adminPro?: string;
  adminProUpgrade?: string;
}

export interface PolarOrderAction {
  orderId: string;
  userId: string;
  kind: PolarKind;
  status: PolarOrderStatus;
}

export type PolarEventResult =
  | { action: PolarOrderAction }
  | { ignored: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function polarProductIdsFromEnv(env: Record<string, string | undefined>): PolarProductIds {
  return {
    admin: env.POLAR_PRODUCT_ID_ADMIN,
    adminPro: env.POLAR_PRODUCT_ID_ADMIN_PRO,
    adminProUpgrade: env.POLAR_PRODUCT_ID_ADMIN_PRO_UPGRADE,
  };
}

export function kindForProduct(productId: string | null | undefined, ids: PolarProductIds): PolarKind | null {
  if (!productId) return null;
  if (productId === ids.admin) return 'admin';
  if (productId === ids.adminPro) return 'admin_pro';
  if (productId === ids.adminProUpgrade) return 'admin_pro_upgrade';
  return null;
}

// Turns a verified Polar event into the purchase change to record, or explains why it is ignored.
export function orderActionFromEvent(
  event: { type: string; data?: any },
  ids: PolarProductIds
): PolarEventResult {
  if (event.type !== 'order.paid' && event.type !== 'order.refunded') {
    return { ignored: `unhandled event ${event.type}` };
  }
  const order = event.data;
  if (!order || typeof order.id !== 'string') return { ignored: 'missing order' };

  // Only one-time purchases of the configured products can grant access.
  if (order.subscription_id || order.subscription) return { ignored: 'subscription orders are not supported' };
  const productId = order.product_id ?? order.product?.id;
  const kind = kindForProduct(productId, ids);
  if (!kind) return { ignored: 'product is not an admin tier' };

  const userId = order.metadata?.supabase_user_id ?? order.customer?.external_id;
  if (typeof userId !== 'string' || !UUID.test(userId)) return { ignored: 'order is not linked to a user' };

  let status: PolarOrderStatus;
  if (event.type === 'order.paid') {
    if (order.status !== 'paid') return { ignored: 'order is not paid' };
    status = 'paid';
  } else {
    status = order.status === 'partially_refunded' ? 'partially_refunded' : 'refunded';
  }
  return { action: { orderId: order.id, userId: userId.toLowerCase(), kind, status } };
}

export type CheckoutPlan = 'admin_basic' | 'admin_top';

// Chooses the product to sell: the discounted upgrade is only offered to current Admin owners.
export function productForCheckout(
  currentTier: string | null | undefined,
  plan: CheckoutPlan,
  ids: PolarProductIds
): { productId?: string; error?: string } {
  if (currentTier === 'admin_top') return { error: 'You already have the highest plan.' };
  if (plan === 'admin_basic') {
    if (currentTier === 'admin_basic') return { error: 'You already have the Admin plan.' };
    return { productId: ids.admin };
  }
  return { productId: currentTier === 'admin_basic' ? ids.adminProUpgrade : ids.adminPro };
}
