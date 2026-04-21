-- ============================================
-- 011: SaaS Upgrade — business_configs, conversation_handoffs,
-- onboarding_sessions, and pipeline improvements
-- Safe to run multiple times (IF NOT EXISTS / CREATE OR REPLACE).
-- ============================================

-- ============================================
-- 1. business_configs — Per-business key/value config
-- Replaces the monolithic settings table for multi-tenant use.
-- Each row is one config key for one business, making it easy
-- to override defaults without touching a wide row.
-- ============================================

CREATE TABLE IF NOT EXISTS public.business_configs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  config_key      text NOT NULL,
  config_value    jsonb NOT NULL DEFAULT '{}',
  updated_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  UNIQUE (business_id, config_key)
);

CREATE INDEX IF NOT EXISTS idx_business_configs_biz
  ON public.business_configs (business_id);

COMMENT ON TABLE public.business_configs IS
  'Per-business configuration store. Keys follow dot notation: ai.tone, reply.first_behaviour, service.areas, etc.';

-- Seed known config keys for existing businesses (from their settings row)
INSERT INTO public.business_configs (business_id, config_key, config_value, updated_by)
SELECT
  s.business_id,
  'ai.tone',
  to_jsonb(s.ai_tone),
  s.user_id
FROM public.settings s
WHERE s.business_id IS NOT NULL
ON CONFLICT (business_id, config_key) DO NOTHING;

INSERT INTO public.business_configs (business_id, config_key, config_value, updated_by)
SELECT
  s.business_id,
  'reply.first_behaviour',
  to_jsonb(s.first_reply_behaviour),
  s.user_id
FROM public.settings s
WHERE s.business_id IS NOT NULL
ON CONFLICT (business_id, config_key) DO NOTHING;

INSERT INTO public.business_configs (business_id, config_key, config_value, updated_by)
SELECT
  s.business_id,
  'service.areas',
  to_jsonb(s.service_areas),
  s.user_id
FROM public.settings s
WHERE s.business_id IS NOT NULL
ON CONFLICT (business_id, config_key) DO NOTHING;

INSERT INTO public.business_configs (business_id, config_key, config_value, updated_by)
SELECT
  s.business_id,
  'service.categories',
  to_jsonb(s.service_categories),
  s.user_id
FROM public.settings s
WHERE s.business_id IS NOT NULL
ON CONFLICT (business_id, config_key) DO NOTHING;

INSERT INTO public.business_configs (business_id, config_key, config_value, updated_by)
SELECT
  s.business_id,
  'business.info',
  jsonb_build_object(
    'name', s.business_name,
    'description', s.business_description,
    'contact_email', s.contact_email,
    'contact_phone', s.contact_phone,
    'enquiry_form_url', s.enquiry_form_url,
    'service_type', s.service_type,
    'callout_fee', s.callout_fee,
    'quote_policy', s.quote_policy,
    'emergency_available', s.emergency_available,
    'after_hours_available', s.after_hours_available,
    'operating_hours', s.operating_hours
  ),
  s.user_id
FROM public.settings s
WHERE s.business_id IS NOT NULL
ON CONFLICT (business_id, config_key) DO NOTHING;

INSERT INTO public.business_configs (business_id, config_key, config_value, updated_by)
SELECT
  s.business_id,
  'comment.automation',
  jsonb_build_object(
    'monitoring_enabled', s.comment_monitoring_enabled,
    'private_reply_enabled', s.private_reply_enabled,
    'public_reply_enabled', s.public_reply_enabled,
    'confidence_threshold', s.comment_confidence_threshold,
    'escalation_threshold', s.comment_escalation_threshold,
    'cooldown_minutes', s.comment_cooldown_minutes,
    'lead_keywords', s.comment_lead_keywords
  ),
  s.user_id
FROM public.settings s
WHERE s.business_id IS NOT NULL
ON CONFLICT (business_id, config_key) DO NOTHING;

INSERT INTO public.business_configs (business_id, config_key, config_value, updated_by)
SELECT
  s.business_id,
  'followup.config',
  jsonb_build_object(
    'max_follow_ups', s.max_follow_ups,
    'interval_days', s.follow_up_interval_days,
    'stop_on_reply', s.stop_on_reply,
    'auto_enabled', coalesce(s.auto_follow_up_enabled, false)
  ),
  s.user_id
FROM public.settings s
WHERE s.business_id IS NOT NULL
ON CONFLICT (business_id, config_key) DO NOTHING;

INSERT INTO public.business_configs (business_id, config_key, config_value, updated_by)
SELECT
  s.business_id,
  'rate_limits',
  jsonb_build_object(
    'comments_per_hour', s.rate_limit_comments_per_hour,
    'dms_per_hour', s.rate_limit_dms_per_hour,
    'public_replies_per_hour', s.rate_limit_public_replies_per_hour
  ),
  s.user_id
FROM public.settings s
WHERE s.business_id IS NOT NULL
ON CONFLICT (business_id, config_key) DO NOTHING;


-- ============================================
-- 2. conversation_handoffs — Human takeover tracking
-- When AI escalates or a human claims a conversation,
-- we pause automation and track the handoff lifecycle.
-- ============================================

CREATE TABLE IF NOT EXISTS public.conversation_handoffs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  lead_id         uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,

  -- Who triggered and who claimed
  triggered_by    text NOT NULL DEFAULT 'ai',    -- 'ai' | 'human' | 'keyword' | 'threshold'
  trigger_reason  text,                           -- e.g. 'angry_customer', 'low_confidence', 'escalation_keyword'
  claimed_by      uuid REFERENCES auth.users(id), -- The human who picked it up (null = unclaimed)
  claimed_at      timestamptz,

  -- State
  status          text NOT NULL DEFAULT 'open',  -- open | claimed | resolved | expired
  priority        text NOT NULL DEFAULT 'normal', -- low | normal | high | urgent

  -- Context for the human
  context_summary text,                           -- AI-generated summary of the conversation so far
  last_customer_message text,                     -- The message that triggered escalation
  source_channel  text,                           -- 'messenger' | 'comment' | 'leadgen'
  source_id       text,                           -- comment_id or message_id that triggered it

  -- Resolution
  resolution_notes text,
  resolved_at     timestamptz,
  resolved_by     uuid REFERENCES auth.users(id),

  -- Auto-expiry: if no human claims within X hours, resume AI
  expires_at      timestamptz,
  auto_resumed    boolean DEFAULT false,

  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_handoffs_business_status
  ON public.conversation_handoffs (business_id, status)
  WHERE status IN ('open', 'claimed');

CREATE INDEX IF NOT EXISTS idx_handoffs_lead
  ON public.conversation_handoffs (lead_id);

CREATE INDEX IF NOT EXISTS idx_handoffs_claimed_by
  ON public.conversation_handoffs (claimed_by)
  WHERE status = 'claimed';

CREATE INDEX IF NOT EXISTS idx_handoffs_expires
  ON public.conversation_handoffs (expires_at)
  WHERE status IN ('open', 'claimed') AND expires_at IS NOT NULL;


-- ============================================
-- 3. onboarding_sessions — Detailed onboarding progress
-- Tracks each step of the setup wizard with timing data
-- so we can measure where businesses drop off.
-- ============================================

CREATE TABLE IF NOT EXISTS public.onboarding_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id),

  -- Steps completed (ordered)
  steps_completed text[] DEFAULT '{}',
  current_step    text NOT NULL DEFAULT 'welcome',

  -- Step timing (JSON: { "welcome": { started_at, completed_at }, ... })
  step_timing     jsonb DEFAULT '{}',

  -- Overall state
  status          text NOT NULL DEFAULT 'in_progress',  -- in_progress | completed | abandoned
  completed_at    timestamptz,
  abandoned_at    timestamptz,

  -- Source tracking
  referral_source text,                           -- How they found us
  utm_params      jsonb DEFAULT '{}',

  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_business
  ON public.onboarding_sessions (business_id);

CREATE INDEX IF NOT EXISTS idx_onboarding_status
  ON public.onboarding_sessions (status)
  WHERE status = 'in_progress';


-- ============================================
-- 4. Enrich leads table for handoff awareness
-- ============================================

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS handoff_active boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS handoff_id uuid REFERENCES public.conversation_handoffs(id),
  ADD COLUMN IF NOT EXISTS response_time_seconds int,
  ADD COLUMN IF NOT EXISTS first_response_at timestamptz,
  ADD COLUMN IF NOT EXISTS message_count int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_inbound_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_outbound_at timestamptz;


-- ============================================
-- 5. Enrich automation_jobs for better observability
-- ============================================

ALTER TABLE public.automation_jobs
  ADD COLUMN IF NOT EXISTS priority int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS result jsonb;

-- Index for priority-based claiming
CREATE INDEX IF NOT EXISTS idx_automation_jobs_priority
  ON public.automation_jobs (priority DESC, next_run_at ASC)
  WHERE status IN ('pending', 'failed');


-- ============================================
-- 6. RLS policies for new tables
-- ============================================

ALTER TABLE public.business_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_handoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_sessions ENABLE ROW LEVEL SECURITY;

-- business_configs: business members can read, admins can write
CREATE POLICY "Users can view own business configs"
  ON public.business_configs FOR SELECT
  USING (business_id IN (SELECT public.user_business_ids()));

CREATE POLICY "Admins can manage business configs"
  ON public.business_configs FOR ALL
  USING (business_id IN (
    SELECT business_id FROM public.user_businesses
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
  ));

CREATE POLICY "Service role full access on business_configs"
  ON public.business_configs FOR ALL
  USING (true) WITH CHECK (true);

-- conversation_handoffs: business members can view, team can claim/resolve
CREATE POLICY "Users can view own business handoffs"
  ON public.conversation_handoffs FOR SELECT
  USING (business_id IN (SELECT public.user_business_ids()));

CREATE POLICY "Members can manage handoffs"
  ON public.conversation_handoffs FOR ALL
  USING (business_id IN (SELECT public.user_business_ids()));

CREATE POLICY "Service role full access on conversation_handoffs"
  ON public.conversation_handoffs FOR ALL
  USING (true) WITH CHECK (true);

-- onboarding_sessions: users see their own
CREATE POLICY "Users can view own onboarding"
  ON public.onboarding_sessions FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can manage own onboarding"
  ON public.onboarding_sessions FOR ALL
  USING (user_id = auth.uid());

CREATE POLICY "Service role full access on onboarding_sessions"
  ON public.onboarding_sessions FOR ALL
  USING (true) WITH CHECK (true);


-- ============================================
-- 7. Helper functions
-- ============================================

-- Get business config value with fallback
CREATE OR REPLACE FUNCTION public.get_business_config(
  p_business_id uuid,
  p_key text,
  p_default jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT COALESCE(
    (SELECT config_value FROM public.business_configs
     WHERE business_id = p_business_id AND config_key = p_key),
    p_default
  );
$$;

-- Set business config value (upsert)
CREATE OR REPLACE FUNCTION public.set_business_config(
  p_business_id uuid,
  p_key text,
  p_value jsonb,
  p_user_id uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.business_configs (business_id, config_key, config_value, updated_by)
  VALUES (p_business_id, p_key, p_value, p_user_id)
  ON CONFLICT (business_id, config_key)
  DO UPDATE SET
    config_value = p_value,
    updated_by = p_user_id,
    updated_at = now();
END;
$$;

-- Create a handoff and pause AI on the lead
CREATE OR REPLACE FUNCTION public.create_handoff(
  p_business_id uuid,
  p_lead_id uuid,
  p_trigger text DEFAULT 'ai',
  p_reason text DEFAULT NULL,
  p_context text DEFAULT NULL,
  p_last_message text DEFAULT NULL,
  p_channel text DEFAULT NULL,
  p_source_id text DEFAULT NULL,
  p_priority text DEFAULT 'normal',
  p_expire_hours int DEFAULT 24
) RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_handoff_id uuid;
BEGIN
  -- Create handoff record
  INSERT INTO public.conversation_handoffs (
    business_id, lead_id, triggered_by, trigger_reason,
    context_summary, last_customer_message, source_channel, source_id,
    priority, expires_at
  ) VALUES (
    p_business_id, p_lead_id, p_trigger, p_reason,
    p_context, p_last_message, p_channel, p_source_id,
    p_priority,
    CASE WHEN p_expire_hours > 0 THEN now() + (p_expire_hours || ' hours')::interval ELSE NULL END
  )
  RETURNING id INTO v_handoff_id;

  -- Pause AI on this lead
  UPDATE public.leads
  SET handoff_active = true,
      handoff_id = v_handoff_id,
      requires_human_review = true,
      escalation_reason = COALESCE(p_reason, 'human_handoff'),
      updated_at = now()
  WHERE id = p_lead_id;

  RETURN v_handoff_id;
END;
$$;

-- Resolve a handoff and resume AI
CREATE OR REPLACE FUNCTION public.resolve_handoff(
  p_handoff_id uuid,
  p_user_id uuid,
  p_notes text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_lead_id uuid;
BEGIN
  -- Update handoff
  UPDATE public.conversation_handoffs
  SET status = 'resolved',
      resolved_at = now(),
      resolved_by = p_user_id,
      resolution_notes = p_notes,
      updated_at = now()
  WHERE id = p_handoff_id
  RETURNING lead_id INTO v_lead_id;

  -- Resume AI on the lead
  IF v_lead_id IS NOT NULL THEN
    UPDATE public.leads
    SET handoff_active = false,
        handoff_id = NULL,
        requires_human_review = false,
        updated_at = now()
    WHERE id = v_lead_id;
  END IF;
END;
$$;

-- Auto-expire stale handoffs (call from cron)
CREATE OR REPLACE FUNCTION public.expire_stale_handoffs()
RETURNS int
LANGUAGE plpgsql
AS $$
DECLARE
  v_count int;
BEGIN
  WITH expired AS (
    UPDATE public.conversation_handoffs
    SET status = 'expired',
        auto_resumed = true,
        updated_at = now()
    WHERE status IN ('open', 'claimed')
      AND expires_at IS NOT NULL
      AND expires_at < now()
    RETURNING lead_id
  )
  UPDATE public.leads
  SET handoff_active = false,
      handoff_id = NULL,
      updated_at = now()
  WHERE id IN (SELECT lead_id FROM expired);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Updated claim_next_job with priority support
CREATE OR REPLACE FUNCTION public.claim_next_job(
  p_lock_token text,
  p_types text[] DEFAULT NULL,
  p_business_id uuid DEFAULT NULL
)
RETURNS SETOF public.automation_jobs
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.automation_jobs
  SET
    status     = 'running',
    locked_at  = now(),
    started_at = now(),
    lock_token = p_lock_token,
    attempts   = attempts + 1,
    updated_at = now()
  WHERE id = (
    SELECT id FROM public.automation_jobs
    WHERE status IN ('pending', 'failed')
      AND next_run_at <= now()
      AND attempts < max_attempts
      AND (p_types IS NULL OR type = ANY(p_types))
      AND (p_business_id IS NULL OR business_id = p_business_id)
    ORDER BY priority DESC, next_run_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;
