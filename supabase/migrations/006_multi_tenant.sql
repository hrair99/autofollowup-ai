-- ============================================
-- 006: Multi-tenant architecture
-- Adds businesses, user_businesses, business_pages tables
-- Adds business_id to all existing tables
-- Updates RLS policies for business-scoped access
-- ============================================

-- ============================================
-- 1. Core multi-tenant tables
-- ============================================

-- Businesses (company/organisation master)
create table if not exists public.businesses (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text unique not null,             -- URL-safe identifier
  owner_id      uuid not null references auth.users(id),

  -- Business profile
  business_name   text,                           -- Display name (used in DMs)
  description     text,
  logo_url        text,
  website         text,

  -- Contact
  contact_email   text,
  contact_phone   text,

  -- Subscription / billing
  plan            text default 'free',            -- free | starter | pro | enterprise
  stripe_customer_id    text,
  stripe_subscription_id text,
  subscription_status   text default 'active',    -- active | past_due | canceled | trialing

  -- Safety
  mode            text default 'monitor',         -- monitor | active  (safe mode for new businesses)

  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create index if not exists idx_businesses_owner on public.businesses (owner_id);
create index if not exists idx_businesses_slug on public.businesses (slug);

-- User ↔ Business membership (many-to-many)
create table if not exists public.user_businesses (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  business_id   uuid not null references public.businesses(id) on delete cascade,
  role          text not null default 'member',   -- owner | admin | member | viewer
  created_at    timestamptz default now(),
  unique (user_id, business_id)
);

create index if not exists idx_user_businesses_user on public.user_businesses (user_id);
create index if not exists idx_user_businesses_business on public.user_businesses (business_id);

-- Business ↔ Meta Page connections (replaces env var tokens)
create table if not exists public.business_pages (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  page_id         text not null,                  -- Meta Page ID
  page_name       text,
  access_token    text not null,                  -- Page access token (encrypted at rest via Supabase)
  is_active       boolean default true,
  subscribed_fields text[] default '{}',          -- e.g. {feed, messages, leadgen}
  token_expires_at  timestamptz,                  -- Track token expiry
  token_status    text default 'valid',           -- valid | expiring | expired | invalid
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  unique (business_id, page_id)
);

create index if not exists idx_business_pages_business on public.business_pages (business_id);
create index if not exists idx_business_pages_page_id on public.business_pages (page_id);

-- ============================================
-- 2. Add business_id to existing tables
-- ============================================

-- Settings: add business_id (nullable initially for migration)
alter table public.settings add column if not exists business_id uuid references public.businesses(id);
create index if not exists idx_settings_business on public.settings (business_id);

-- Leads: add business_id
alter table public.leads add column if not exists business_id uuid references public.businesses(id);
create index if not exists idx_leads_business on public.leads (business_id);

-- Messages: add business_id (denormalised for direct queries)
alter table public.messages add column if not exists business_id uuid references public.businesses(id);
create index if not exists idx_messages_business on public.messages (business_id);

-- Follow-ups: add business_id
alter table public.follow_ups add column if not exists business_id uuid references public.businesses(id);
create index if not exists idx_follow_ups_business on public.follow_ups (business_id);

-- Comments: add business_id
alter table public.comments add column if not exists business_id uuid references public.businesses(id);
create index if not exists idx_comments_business on public.comments (business_id);

-- Leadgen submissions: add business_id
alter table public.leadgen_submissions add column if not exists business_id uuid references public.businesses(id);
create index if not exists idx_leadgen_submissions_business on public.leadgen_submissions (business_id);

-- Automation logs: add business_id
alter table public.automation_logs add column if not exists business_id uuid references public.businesses(id);
create index if not exists idx_automation_logs_business on public.automation_logs (business_id);

-- Automation jobs: add business_id
alter table public.automation_jobs add column if not exists business_id uuid references public.businesses(id);
create index if not exists idx_automation_jobs_business on public.automation_jobs (business_id);

-- Webhook deliveries: add business_id (nullable — some webhooks may not map to a business)
alter table public.webhook_deliveries add column if not exists business_id uuid references public.businesses(id);

-- FAQ entries: add business_id
alter table public.faq_entries add column if not exists business_id uuid references public.businesses(id);
create index if not exists idx_faq_entries_business on public.faq_entries (business_id);

-- AI classifications: add business_id
alter table public.ai_classifications add column if not exists business_id uuid references public.businesses(id);

-- Conversation events: add business_id
alter table public.conversation_events add column if not exists business_id uuid references public.businesses(id);

-- ============================================
-- 3. Business-scoped settings (new columns for v4)
-- ============================================

alter table public.settings add column if not exists
  rate_limit_comments_per_hour int default 60;
alter table public.settings add column if not exists
  rate_limit_dms_per_hour int default 30;
alter table public.settings add column if not exists
  rate_limit_public_replies_per_hour int default 30;

-- ============================================
-- 4. RLS policies for new tables
-- ============================================

-- Helper function: check if user belongs to a business
create or replace function public.user_in_business(p_business_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.user_businesses
    where user_id = auth.uid()
      and business_id = p_business_id
  );
$$;

-- Helper function: get all business_ids for current user
create or replace function public.user_business_ids()
returns setof uuid
language sql
security definer
stable
as $$
  select business_id from public.user_businesses
  where user_id = auth.uid();
$$;

-- Businesses: users can see businesses they belong to
alter table public.businesses enable row level security;

create policy "Users can view their businesses"
  on public.businesses for select
  using (id in (select public.user_business_ids()));

create policy "Owners can update their businesses"
  on public.businesses for update
  using (owner_id = auth.uid());

create policy "Authenticated users can create businesses"
  on public.businesses for insert
  with check (owner_id = auth.uid());

create policy "Service role full access on businesses"
  on public.businesses for all
  using (true) with check (true);

-- User businesses: users can see their own memberships
alter table public.user_businesses enable row level security;

create policy "Users can view their memberships"
  on public.user_businesses for select
  using (user_id = auth.uid());

create policy "Service role full access on user_businesses"
  on public.user_businesses for all
  using (true) with check (true);

-- Business pages: users can manage pages for their businesses
alter table public.business_pages enable row level security;

create policy "Users can view their business pages"
  on public.business_pages for select
  using (business_id in (select public.user_business_ids()));

create policy "Admins can manage business pages"
  on public.business_pages for all
  using (
    business_id in (
      select business_id from public.user_businesses
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

create policy "Service role full access on business_pages"
  on public.business_pages for all
  using (true) with check (true);

-- ============================================
-- 5. Data migration: create business for existing user
-- ============================================

-- This creates a business for each existing user and migrates their data.
-- Run once after deploying the migration.

do $$
declare
  v_user record;
  v_business_id uuid;
  v_settings record;
begin
  -- For each user with settings
  for v_user in
    select distinct s.user_id, s.business_name, u.email
    from public.settings s
    join auth.users u on u.id = s.user_id
  loop
    -- Create business
    insert into public.businesses (
      id, name, slug, owner_id, business_name, mode
    ) values (
      gen_random_uuid(),
      coalesce(v_user.business_name, split_part(v_user.email, '@', 1)),
      lower(regexp_replace(
        coalesce(v_user.business_name, split_part(v_user.email, '@', 1)),
        '[^a-zA-Z0-9]+', '-', 'g'
      )) || '-' || substr(gen_random_uuid()::text, 1, 8),
      v_user.user_id,
      v_user.business_name,
      'active'  -- Existing users start in active mode
    )
    returning id into v_business_id;

    -- Create membership
    insert into public.user_businesses (user_id, business_id, role)
    values (v_user.user_id, v_business_id, 'owner');

    -- Update settings
    update public.settings
    set business_id = v_business_id
    where user_id = v_user.user_id;

    -- Update leads
    update public.leads
    set business_id = v_business_id
    where user_id = v_user.user_id;

    -- Update messages
    update public.messages
    set business_id = v_business_id
    where user_id = v_user.user_id;

    -- Update follow-ups
    update public.follow_ups
    set business_id = v_business_id
    where user_id = v_user.user_id;

    -- Update comments (if they have user_id)
    update public.comments
    set business_id = v_business_id
    where user_id = v_user.user_id;

    -- Update automation logs (via lead_id)
    update public.automation_logs
    set business_id = v_business_id
    where lead_id in (select id from public.leads where user_id = v_user.user_id);

    -- Update FAQ entries
    update public.faq_entries
    set business_id = v_business_id
    where user_id = v_user.user_id;

    -- Update leadgen submissions (via lead_id)
    update public.leadgen_submissions
    set business_id = v_business_id
    where lead_id in (select id from public.leads where user_id = v_user.user_id);

    raise notice 'Migrated user % to business %', v_user.user_id, v_business_id;
  end loop;
end
$$;

-- ============================================
-- 6. Lookup function: page_id → business_id
-- Used by webhook handlers to route events
-- ============================================

create or replace function public.business_for_page(p_page_id text)
returns uuid
language sql
security definer
stable
as $$
  select business_id from public.business_pages
  where page_id = p_page_id and is_active = true
  limit 1;
$$;

-- ============================================
-- 7. Updated claim_next_job with business_id support
-- ============================================

create or replace function public.claim_next_job(
  p_lock_token text,
  p_types text[] default null,
  p_business_id uuid default null
)
returns setof public.automation_jobs
language plpgsql
security definer
as $$
begin
  return query
  update public.automation_jobs
  set
    status     = 'running',
    locked_at  = now(),
    lock_token = p_lock_token,
    attempts   = attempts + 1,
    updated_at = now()
  where id = (
    select id from public.automation_jobs
    where status = 'pending'
      and next_run_at <= now()
      and (p_types is null or type = any(p_types))
      and (p_business_id is null or business_id = p_business_id)
    order by next_run_at
    limit 1
    for update skip locked
  )
  returning *;
end;
$$;
