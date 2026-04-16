-- ============================================
-- 007: Add Meta user token storage to businesses
-- Stores the long-lived user token from OAuth flow
-- so we can fetch page tokens on demand.
-- ============================================

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS meta_user_token text,
  ADD COLUMN IF NOT EXISTS meta_token_expires_at timestamptz;

-- Index for token expiry checks
CREATE INDEX IF NOT EXISTS idx_businesses_token_expires
  ON public.businesses (meta_token_expires_at)
  WHERE meta_user_token IS NOT NULL;

COMMENT ON COLUMN public.businesses.meta_user_token IS 'Long-lived Meta user token (~60 days). Used to fetch page tokens.';
COMMENT ON COLUMN public.businesses.meta_token_expires_at IS 'When the user token expires. Null = unknown/never.';
