-- Draft pick order style: 'snake' (order reverses every other round) or 'linear' (same order every round).
-- Run once in the Supabase SQL editor. Existing drafts keep the snake behavior they already used.
ALTER TABLE public.drafts
  ADD COLUMN IF NOT EXISTS pick_order_type TEXT NOT NULL DEFAULT 'snake'
  CHECK (pick_order_type IN ('snake', 'linear'));
