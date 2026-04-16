-- ============================================
-- 008: SaaS production layer
-- Adds: usage tracking, onboarding state, lead scoring,
-- ROI tracking, confidence tier columns
-- ============================================

-- 1. Usage tracking per business per month
CREATE TABLE IF NOT EXISTS public.business_usage (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  period          text NOT NULL,                    -- YYYY-MM format
  comments_processed  int DEFAULT 0,
  dms_sent            int DEFAULT 0,
  public_replies_sent int DEFAULT 0,
  ai_calls            int DEFAULT 0,
  leads_created       int DEFAULT 0,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  UNIQUE (business_id, period)
);

CREATE INDEX IF NOT EXISTS idx_business_usage_biz_period
  ON public.business_usage (business_id, period);

-- 2. Onboarding state on businesses
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarding_step      text DEFAULT 'connect_facebook',
  ADD COLUMN IF NOT EXISTS estimated_lead_value  numeric(10,2) DEFAULT 300.00,
  ADD COLUMN IF NOT EXISTS trial_ends_at        timestamptz;

-- 3. Lead scoring columns
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS lead_score         int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS score_breakdown    jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS needs_manual_review boolean DEFAULT false;

-- 4. Plan limits table (configurable per plan)
CREATE TABLE IF NOT EXISTS public.plan_limits (
  plan_name             text PRIMARY KEY,
  comments_per_month    int NOT NULL DEFAULT 300,
  dms_per_month         int NOT NULL DEFAULT 200,
  ai_calls_per_month    int NOT NULL DEFAULT 500,
  max_pages             int NOT NULL DEFAULT 1,
  priority_support      boolean DEFAULT false,
  custom_branding       boolean DEFAULT false
);

-- Seed default plans
INSERT INTO public.plan_limits (plan_name, comments_per_month, dms_per_month, ai_calls_per_month, max_pages, priority_support, custom_branding)
VALUES
  ('free',      50,   30,   100,  1, false, false),
  ('starter',   300,  200,  500,  2, false, false),
  ('pro',       2000, 1500, 5000, 5, true,  false),
  ('unlimited', -1,   -1,   -1,   -1, true, true)
ON CONFLICT (plan_name) DO NOTHING;

-- 5. Settings additions for confidence tiers
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS confidence_high_threshold   numeric(3,2) DEFAULT 0.85,
  ADD COLUMN IF NOT EXISTS confidence_safe_threshold   numeric(3,2) DEFAULT 0.60,
  ADD COLUMN IF NOT EXISTS comment_user_cooldown_hours int DEFAULT 24,
  ADD COLUMN IF NOT EXISTS comment_max_actions_per_comment int DEFAULT 2;

-- 6. Alerts table for dashboard surface
CREATE TABLE IF NOT EXISTS public.business_alerts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  alert_type      text NOT NULL,       -- token_invalid, token_expiring, no_activity, high_failure_rate, usage_limit, dead_jobs
  severity        text NOT NULL,       -- warning | critical
  message         text NOT NULL,
  metadata        jsonb DEFAULT '{}',
  acknowledged    boolean DEFAULT false,
  acknowledged_at timestamptz,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_business_alerts_biz
  ON public.business_alerts (business_id, acknowledged, created_at DESC);

-- 7. RLS policies for new tables
ALTER TABLE public.business_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own business usage"
  ON public.business_usage FOR SELECT
  USING (business_id IN (
    SELECT business_id FROM public.user_businesses WHERE user_id = auth.uid()
  ));

CREATE POLICY "Users can view own business alerts"
  ON public.business_alerts FOR SELECT
  USING (business_id IN (
    SELECT business_id FROM public.user_businesses WHERE user_id = auth.uid()
  ));

CREATE POLICY "Users can acknowledge own business alerts"
  ON public.business_alerts FOR UPDATE
  USING (business_id IN (
    SELECT business_id FROM public.user_businesses WHERE user_id = auth.uid()
  ));

-- 8. Helper function: increment usage counter atomically
CREATE OR REPLACE FUNCTION public.increment_usage(
  p_business_id uuid,
  p_field text,
  p_amount int DEFAULT 1
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_period text := to_char(now(), 'YYYY-MM');
BEGIN
  INSERT INTO public.business_usage (business_id, period)
  VALUES (p_business_id, v_period)
  ON CONFLICT (business_id, period) DO NOTHING;

  EXECUTE format(
    'UPDATE public.business_usage SET %I = %I + $1, updated_at = now() WHERE business_id = $2 AND period = $3',
    p_field, p_field
  ) USING p_amount, p_business_id, v_period;
END;
$$;
