-- Records Polar purchases and applies them to profiles.subscription_tier.
-- Apply in the Supabase SQL Editor AFTER admin_tier_limits.sql.
BEGIN;

CREATE TABLE IF NOT EXISTS public.polar_webhook_events (
  webhook_id text PRIMARY KEY,
  event_type text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.polar_orders (
  order_id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('admin', 'admin_pro', 'admin_pro_upgrade')),
  status text NOT NULL CHECK (status IN ('paid', 'partially_refunded', 'refunded')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS polar_orders_user_idx ON public.polar_orders (user_id);

-- No client access: only the server (service role) reads or writes these tables.
ALTER TABLE public.polar_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.polar_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.polar_webhook_events, public.polar_orders FROM PUBLIC, anon, authenticated;

-- Applies one verified Polar order event exactly once and recomputes the user's tier.
-- An upgrade only counts while a valid Admin or Admin Pro order also exists,
-- so refunding the base purchase cannot leave a discounted Admin Pro behind.
CREATE OR REPLACE FUNCTION public.apply_polar_order(
  p_webhook_id text,
  p_event_type text,
  p_order_id text,
  p_user_id uuid,
  p_kind text,
  p_status text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  new_tier text := 'free';
  has_admin boolean;
  has_pro boolean;
  has_upgrade boolean;
  is_owner boolean;
BEGIN
  IF p_status NOT IN ('paid', 'partially_refunded', 'refunded') THEN
    RAISE EXCEPTION 'Unsupported order status %', p_status;
  END IF;

  INSERT INTO public.polar_webhook_events (webhook_id, event_type)
  VALUES (p_webhook_id, p_event_type)
  ON CONFLICT (webhook_id) DO NOTHING;
  IF NOT FOUND THEN RETURN 'duplicate'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RETURN 'unknown_user';
  END IF;

  -- A refund is final: a late or retried "paid" event must not undo it.
  INSERT INTO public.polar_orders (order_id, user_id, kind, status)
  VALUES (p_order_id, p_user_id, p_kind, p_status)
  ON CONFLICT (order_id) DO UPDATE
    SET status = CASE WHEN public.polar_orders.status = 'refunded' THEN 'refunded' ELSE EXCLUDED.status END,
        updated_at = now()
    WHERE public.polar_orders.user_id = EXCLUDED.user_id;

  SELECT
    coalesce(bool_or(kind = 'admin'), false),
    coalesce(bool_or(kind = 'admin_pro'), false),
    coalesce(bool_or(kind = 'admin_pro_upgrade'), false)
  INTO has_admin, has_pro, has_upgrade
  FROM public.polar_orders
  WHERE user_id = p_user_id AND status IN ('paid', 'partially_refunded');

  IF has_pro OR (has_upgrade AND has_admin) THEN
    new_tier := 'admin_top';
  ELSIF has_admin THEN
    new_tier := 'admin_basic';
  END IF;

  SELECT is_super_admin INTO is_owner FROM public.profiles WHERE id = p_user_id;
  IF NOT is_owner THEN
    UPDATE public.profiles SET subscription_tier = new_tier WHERE id = p_user_id;
  END IF;

  RETURN 'applied';
END;
$$;

REVOKE ALL ON FUNCTION public.apply_polar_order(text, text, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_polar_order(text, text, text, uuid, text, text) TO service_role;

COMMIT;
