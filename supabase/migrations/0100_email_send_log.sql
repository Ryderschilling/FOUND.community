-- email_send_log
-- Lightweight dedup table for the send-email edge function.
-- Prevents the same email+action from being sent twice within a cooldown window,
-- and stops Supabase retry loops from multiplying Resend sends.

CREATE TABLE IF NOT EXISTS public.email_send_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email       text        NOT NULL,
  action_type text        NOT NULL,  -- 'signup', 'recovery', 'magic_link', etc.
  sent_at     timestamptz NOT NULL DEFAULT now()
);

-- Fast lookup by email + action for dedup check
CREATE INDEX idx_email_send_log_lookup
  ON public.email_send_log (email, action_type, sent_at DESC);

-- Auto-purge rows older than 24 hours (keep the table tiny)
CREATE OR REPLACE FUNCTION public.purge_old_email_send_log()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  DELETE FROM public.email_send_log
  WHERE sent_at < now() - INTERVAL '24 hours';
$$;

-- RLS: edge function uses service role, no user-facing access needed
ALTER TABLE public.email_send_log ENABLE ROW LEVEL SECURITY;
-- No policies = only service role (bypasses RLS) can read/write
