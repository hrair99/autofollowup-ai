-- ============================================
-- 009: Business Profiles Layer
-- Adds industry-specific configuration per business.
-- Supports: custom intents, entity fields, reply templates,
-- banned phrases, lead field schemas, service areas.
-- ============================================

-- 1. Add industry column to businesses
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS industry text DEFAULT 'generic';

-- Set existing HR AIR business to HVAC
UPDATE public.businesses
  SET industry = 'hvac'
  WHERE industry IS NULL OR industry = 'generic';

-- 2. Business profiles table (DB-level overrides on top of built-in profiles)
CREATE TABLE IF NOT EXISTS public.business_profiles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  industry        text NOT NULL DEFAULT 'generic',
  industry_label  text,
  service_categories  text[] DEFAULT '{}',
  banned_phrases      text[] DEFAULT '{}',
  default_service_areas text[] DEFAULT '{}',
  default_tone    text DEFAULT 'friendly Australian casual-professional',
  quick_lead_keywords text[] DEFAULT '{}',
  reply_templates jsonb DEFAULT '{}',    -- { classification: [template strings] }
  dm_templates    jsonb DEFAULT '{}',    -- { classification: [template strings] }
  lead_field_schema   jsonb DEFAULT '[]',  -- LeadFieldSchema[]
  custom_intents  jsonb DEFAULT '[]',    -- BusinessIntent[] (serialized without RegExp)
  custom_entity_fields jsonb DEFAULT '[]', -- EntityField[] (serialized without RegExp)
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  UNIQUE (business_id)
);

CREATE INDEX IF NOT EXISTS idx_business_profiles_biz
  ON public.business_profiles (business_id);

-- 3. RLS
ALTER TABLE public.business_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own business profile"
  ON public.business_profiles FOR SELECT
  USING (business_id IN (
    SELECT business_id FROM public.user_businesses WHERE user_id = auth.uid()
  ));

CREATE POLICY "Users can update own business profile"
  ON public.business_profiles FOR UPDATE
  USING (business_id IN (
    SELECT business_id FROM public.user_businesses WHERE user_id = auth.uid()
  ));

CREATE POLICY "Users can insert own business profile"
  ON public.business_profiles FOR INSERT
  WITH CHECK (business_id IN (
    SELECT business_id FROM public.user_businesses WHERE user_id = auth.uid()
  ));
