-- ============================================
-- AutoFollowUp AI — Production Hardening Migration
-- Adds webhook observability + async job queue
-- Safe to run multiple times (IF NOT EXISTS everywhere).
-- ============================================

-- --- webhook_deliveries: one row per inbound webhook POST ---
create table if not exists public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  request_id text not null,
  object_type text,
  event_types jsonb not null default '[]'::jsonb,
  raw_present boolean not null default false,
  signature_verified boolean not null default false,
  signature_skipped boolean not null default false,
  normalized_count int not null default 0,
  dropped_count int not null default 0,
  drop_reasons jsonb not null default '[]'::jsonb,
  status text not null default 'received', -- received | processed | error | rejected
  error text,
  raw_excerpt text,                          -- first ~1KB of body, NEVER secrets
  payload_hash text                          -- sha256 of raw body for dedupe
);

create index if not exists webhook_deliveries_created_idx
  on public.webhook_deliveries (created_at desc);
create index if not exists webhook_deliveries_request_id_idx
  on public.webhook_deliveries (request_id);
create index if not exists webhook_deliveries_status_idx
  on public.webhook_deliveries (status);

-- --- automation_jobs: async queue for comment/message processing ---
create table if not exists public.automation_jobs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  type text not null,                        -- 'handle_comment' | 'handle_message'
  dedupe_key text not null,                  -- e.g. comment:{commentId} — unique idempotency
  payload jsonb not null,
  status text not null default 'pending',    -- pending | running | done | failed | dead
  attempts int not null default 0,
  max_attempts int not null default 5,
  next_run_at timestamptz not null default now(),
  locked_at timestamptz,
  lock_token text,
  last_error text,
  completed_at timestamptz
);

create unique index if not exists automation_jobs_dedupe_unique
  on public.automation_jobs (dedupe_key);
create index if not exists automation_jobs_status_next_run_idx
  on public.automation_jobs (status, next_run_at)
  where status in ('pending', 'failed');
create index if not exists automation_jobs_type_idx
  on public.automation_jobs (type);

-- --- Enrich automation_logs with decision trace fields (idempotent) ---
alter table public.automation_logs
  add column if not exists decision_trace jsonb;
alter table public.automation_logs
  add column if not exists drop_reason text;
alter table public.automation_logs
  add column if not exists rule_intent text;
alter table public.automation_logs
  add column if not exists rule_confidence real;

-- --- Optional cooldown settings on settings (idempotent) ---
alter table public.settings
  add column if not exists comment_user_cooldown_hours int default 24;
alter table public.settings
  add column if not exists comment_max_actions_per_comment int default 1;

-- --- RPC helper: claim one pending job atomically ---
create or replace function public.claim_next_job(p_lock_token text, p_types text[] default null)
returns setof public.automation_jobs
language plpgsql
as $$
begin
  return query
  update public.automation_jobs aj
  set status = 'running',
      locked_at = now(),
      lock_token = p_lock_token,
      attempts = aj.attempts + 1,
      updated_at = now()
  where aj.id = (
    select id from public.automation_jobs
    where status in ('pending', 'failed')
      and next_run_at <= now()
      and attempts < max_attempts
      and (p_types is null or type = any(p_types))
    order by next_run_at asc
    for update skip locked
    limit 1
  )
  returning *;
end;
$$;
