-- Account settings: recovery contact details and display preferences.
-- Run once in the Supabase SQL Editor.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS backup_email TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS backup_phone TEXT;
-- Existing "Users can update their own profile" policy already covers these columns.
