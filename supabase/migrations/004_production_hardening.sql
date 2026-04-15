-- ============================================
-- AutoFollowUp AI v4 — Production Hardening
-- Run AFTER 001 / 002 / 003 in the Supabase SQL Editor.
--
-- Adds:
--   1. Unique index on messages.platform_message_id for webhook idempotency
--   2. enquiry_form_completed_at timestamp (to complement the existing boolean)
--   3. auto_follow_up_enabled toggle on settings
--   4. Defensive backfill of conversion_stage for any legacy leads
-- ============================================

-- ============================================
-- 1. WEBHOOK IDEMPOTENCY
-- Meta can redeliver the same webhook event. We already store
-- platform_message_id on messages — enforcing uniqueness makes
-- the webhook safe to replay.
-- ============================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_platform_message_id_unique
  ON public.messages(platform_message_id)
  WHERE platform_message_id IS NOT NULL;

-- ============================================
-- 2. ENQUIRY FORM COMPLETION TIMESTAMP
-- The boolean was useful but loses ordering. Having a timestamp
-- lets us compute time-to-conversion metrics later.
-- ============================================
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS enquiry_form_completed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_leads_enquiry_form_completed_at
  ON public.leads(enquiry_form_completed_at)
  WHERE enquiry_form_completed_at IS NOT NULL;

-- When the boolean is flipped, stamp the timestamp.
CREATE OR REPLACE FUNCTION public.stamp_enquiry_form_completed_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.enquiry_form_completed = true
     AND (OLD.enquiry_form_completed IS DISTINCT FROM NEW.enquiry_form_completed)
     AND NEW.enquiry_form_completed_at IS NULL THEN
    NEW.enquiry_form_completed_at := now();
  END IF;

  IF NEW.enquiry_form_completed = false
     AND (OLD.enquiry_form_completed IS DISTINCT FROM NEW.enquiry_form_completed) THEN
    NEW.enquiry_form_completed_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stamp_enquiry_form_completed_at ON public.leads;
CREATE TRIGGER stamp_enquiry_form_completed_at
  BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.stamp_enquiry_form_completed_at();

-- ============================================
-- 3. AUTO FOLLOW-UP TOGGLE
-- Lets the business disable the auto-scheduler without
-- having to zero out max_follow_ups.
-- ============================================
ALTER TABLE public.settings
  ADD COLUMN IF NOT EXISTS auto_follow_up_enabled boolean DEFAULT true;

-- ============================================
-- 4. BACKFILL: any legacy lead without a stage
-- ============================================
UPDATE public.leads
  SET conversion_stage = 'new'
  WHERE conversion_stage IS NULL;

-- ============================================
-- 5. RPC: mark_form_completed (callable from server actions)
-- ============================================
CREATE OR REPLACE FUNCTION public.mark_form_completed(lead_id_param uuid, completed boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.leads
    SET enquiry_form_completed = completed,
        status = CASE WHEN completed THEN 'booked' ELSE status END,
        conversion_stage = CASE WHEN completed THEN 'booked' ELSE conversion_stage END
    WHERE id = lead_id_param;

  -- Cancel any pending follow-ups for this lead
  IF completed THEN
    UPDATE public.follow_ups
      SET status = 'cancelled'
      WHERE lead_id = lead_id_param
        AND status = 'pending';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_form_completed(uuid, boolean) TO authenticated;
