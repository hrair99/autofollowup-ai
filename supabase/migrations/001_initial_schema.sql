-- AutoFollowUp AI - Initial Schema
-- Run this in Supabase SQL Editor

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================
-- LEADS
-- ============================================
create table public.leads (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  email text not null,
  phone text,
  company text,
  source text default 'manual',
  status text default 'new' check (status in ('new', 'contacted', 'following_up', 'responded', 'booked', 'dead')),
  notes text,
  last_contacted_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================
-- MESSAGES
-- ============================================
create table public.messages (
  id uuid default uuid_generate_v4() primary key,
  lead_id uuid references public.leads(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  direction text not null check (direction in ('outbound', 'inbound')),
  channel text default 'email' check (channel in ('email', 'sms', 'manual')),
  subject text,
  body text not null,
  status text default 'draft' check (status in ('draft', 'sent', 'delivered', 'failed')),
  sent_at timestamptz,
  created_at timestamptz default now()
);

-- ============================================
-- FOLLOW_UPS
-- ============================================
create table public.follow_ups (
  id uuid default uuid_generate_v4() primary key,
  lead_id uuid references public.leads(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  step_number integer not null default 1,
  scheduled_at timestamptz not null,
  executed_at timestamptz,
  status text default 'pending' check (status in ('pending', 'sent', 'skipped', 'cancelled')),
  message_id uuid references public.messages(id),
  created_at timestamptz default now()
);

-- ============================================
-- SETTINGS (per-user)
-- ============================================
create table public.settings (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade unique not null,
  max_follow_ups integer default 5,
  follow_up_interval_days integer default 3,
  stop_on_reply boolean default true,
  ai_tone text default 'professional' check (ai_tone in ('professional', 'friendly', 'casual', 'urgent')),
  business_name text,
  business_description text,
  signature text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
alter table public.leads enable row level security;
alter table public.messages enable row level security;
alter table public.follow_ups enable row level security;
alter table public.settings enable row level security;

-- Leads policies
create policy "Users can view own leads" on public.leads for select using (auth.uid() = user_id);
create policy "Users can insert own leads" on public.leads for insert with check (auth.uid() = user_id);
create policy "Users can update own leads" on public.leads for update using (auth.uid() = user_id);
create policy "Users can delete own leads" on public.leads for delete using (auth.uid() = user_id);

-- Messages policies
create policy "Users can view own messages" on public.messages for select using (auth.uid() = user_id);
create policy "Users can insert own messages" on public.messages for insert with check (auth.uid() = user_id);
create policy "Users can update own messages" on public.messages for update using (auth.uid() = user_id);

-- Follow-ups policies
create policy "Users can view own follow_ups" on public.follow_ups for select using (auth.uid() = user_id);
create policy "Users can insert own follow_ups" on public.follow_ups for insert with check (auth.uid() = user_id);
create policy "Users can update own follow_ups" on public.follow_ups for update using (auth.uid() = user_id);

-- Settings policies
create policy "Users can view own settings" on public.settings for select using (auth.uid() = user_id);
create policy "Users can insert own settings" on public.settings for insert with check (auth.uid() = user_id);
create policy "Users can update own settings" on public.settings for update using (auth.uid() = user_id);

-- ============================================
-- INDEXES
-- ============================================
create index idx_leads_user_id on public.leads(user_id);
create index idx_leads_status on public.leads(status);
create index idx_messages_lead_id on public.messages(lead_id);
create index idx_follow_ups_lead_id on public.follow_ups(lead_id);
create index idx_follow_ups_status_scheduled on public.follow_ups(status, scheduled_at);

-- ============================================
-- UPDATED_AT TRIGGER
-- ============================================
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  Nep”pJansed_at = now();
  return new;
end;
$$ language plpgsql;

create trigger leads_updated_at before update on public.leads
  for each row execute function public.handle_updated_at();

create trigger settings_updated_at before update on public.settingsfor each row execute function public.handle_updated_at();
