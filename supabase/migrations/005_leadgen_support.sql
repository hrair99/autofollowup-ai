-- ============================================
-- 005: Facebook Lead Ads (leadgen) support
-- Stores form submissions from boosted ad instant forms
-- ============================================

-- Leadgen submissions table
create table if not exists public.leadgen_submissions (
  id            uuid primary key default gen_random_uuid(),
  leadgen_id    text unique not null,       -- Meta's lead ID (deduplication key)
  page_id       text,
  form_id       text,
  ad_id         text,
  adset_id      text,
  campaign_id   text,

  -- Parsed lead contact info
  platform_user_id  text,                   -- Page-scoped user ID (for DM)
  full_name     text,
  first_name    text,
  last_name     text,
  email         text,
  phone         text,
  suburb        text,
  service_type  text,
  job_description text,

  -- Raw form data (all fields as JSON)
  raw_field_data  jsonb default '{}'::jsonb,

  -- Processing state
  status        text default 'received',    -- received | dm_sent | dm_failed | fetch_failed
  dm_sent_at    timestamptz,
  error_message text,

  -- Link to main leads table
  lead_id       uuid references public.leads(id),

  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- Indexes
create index if not exists idx_leadgen_submissions_leadgen_id
  on public.leadgen_submissions (leadgen_id);
create index if not exists idx_leadgen_submissions_page_id
  on public.leadgen_submissions (page_id);
create index if not exists idx_leadgen_submissions_status
  on public.leadgen_submissions (status);
create index if not exists idx_leadgen_submissions_created_at
  on public.leadgen_submissions (created_at desc);
create index if not exists idx_leadgen_submissions_platform_user_id
  on public.leadgen_submissions (platform_user_id);

-- RLS: service role can do everything (webhook processing)
alter table public.leadgen_submissions enable row level security;

create policy "Service role full access on leadgen_submissions"
  on public.leadgen_submissions
  for all
  using (true)
  with check (true);

-- Allow authenticated users to read their leads' submissions
create policy "Users can view leadgen_submissions via lead_id"
  on public.leadgen_submissions
  for select
  using (
    lead_id in (
      select id from public.leads where user_id = auth.uid()
    )
  );
