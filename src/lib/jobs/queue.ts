// ============================================
// automation_jobs queue — Supabase-backed async worker
//
// Enqueue: called from webhook route after validation/normalization.
// Claim:   called from /api/jobs/process worker. Uses RPC claim_next_job
//          for atomic SKIP LOCKED semantics. Falls back to best-effort.
// ============================================

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import crypto from "crypto";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any, any, any>;

export type JobType = "handle_comment" | "handle_message";

export interface JobRecord {
  id: string;
  type: JobType;
  dedupe_key: string;
  payload: Record<string, unknown>;
  status: "pending" | "running" | "done" | "failed" | "dead";
  attempts: number;
  max_attempts: number;
  next_run_at: string;
  locked_at: string | null;
  lock_token: string | null;
  last_error: string | null;
}

function db(): DB {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export function makeLockToken(): string {
  return crypto.randomBytes(12).toString("hex");
}

export interface EnqueueInput {
  type: JobType;
  dedupeKey: string;
  payload: Record<string, unknown>;
  maxAttempts?: number;
  businessId?: string;
}

export interface EnqueueResult {
  enqueued: boolean;
  reason: "inserted" | "duplicate" | "error";
  jobId?: string;
  error?: string;
}

/**
 * Insert a new job. If dedupe_key already exists, return duplicate.
 */
export async function enqueueJob(input: EnqueueInput): Promise<EnqueueResult> {
  try {
    const { data, error } = await db()
      .from("automation_jobs")
      .insert({
        type: input.type,
        dedupe_key: input.dedupeKey,
        payload: input.payload,
        max_attempts: input.maxAttempts ?? 5,
        business_id: input.businessId || null,
        status: "pending",
        next_run_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error) {
      // Unique violation → dedupe hit
      if ((error.code === "23505") || /duplicate/i.test(error.message)) {
        return { enqueued: false, reason: "duplicate" };
      }
      return { enqueued: false, reason: "error", error: error.message };
    }
    return { enqueued: true, reason: "inserted", jobId: data!.id };
  } catch (e) {
    return { enqueued: false, reason: "error", error: String(e) };
  }
}

/**
 * Atomically claim the next pending job (preferred: RPC with SKIP LOCKED).
 * Falls back to best-effort update if RPC is missing.
 */
export async function claimNextJob(types?: JobType[]): Promise<JobRecord | null> {
  const lockToken = makeLockToken();
  const supabase = db();

  // Preferred path: RPC claim_next_job
  try {
    const { data, error } = await supabase.rpc("claim_next_job", {
      p_lock_token: lockToken,
      p_types: types || null,
    });
    if (!error && data && Array.isArray(data) && data.length > 0) {
      return data[0] as JobRecord;
    }
  } catch {
    // Fall through to fallback
  }

  // Fallback: find + update (race-prone but better than nothing)
  const typeFilter = types && types.length > 0 ? types : null;
  const q = supabase
    .from("automation_jobs")
    .select("*")
    .in("status", ["pending", "failed"])
    .lte("next_run_at", new Date().toISOString())
    .order("next_run_at", { ascending: true })
    .limit(1);
  if (typeFilter) q.in("type", typeFilter);
  const { data: row } = await q.single();
  if (!row) return null;

  const { data: updated } = await supabase
    .from("automation_jobs")
    .update({
      status: "running",
      locked_at: new Date().toISOString(),
      lock_token: lockToken,
      attempts: (row.attempts || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .select("*")
    .single();

  return updated as JobRecord | null;
}

export async function completeJob(id: string): Promise<void> {
  await db()
    .from("automation_jobs")
    .update({
      status: "done",
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      lock_token: null,
      locked_at: null,
    })
    .eq("id", id);
}

/**
 * Record a failure. Caller decides whether to retry by passing the current
 * attempt count and max_attempts — we compute backoff here.
 */
export async function failJob(
  id: string,
  opts: { attempts: number; maxAttempts: number; error: string }
): Promise<void> {
  const isDead = opts.attempts >= opts.maxAttempts;
  // Exponential backoff: 30s, 2m, 8m, 30m, ...
  const delayMs = Math.min(30_000 * Math.pow(4, opts.attempts - 1), 30 * 60_000);
  const nextRun = new Date(Date.now() + delayMs).toISOString();

  await db()
    .from("automation_jobs")
    .update({
      status: isDead ? "dead" : "failed",
      last_error: opts.error.substring(0, 2000),
      next_run_at: nextRun,
      updated_at: new Date().toISOString(),
      lock_token: null,
      locked_at: null,
    })
    .eq("id", id);
}