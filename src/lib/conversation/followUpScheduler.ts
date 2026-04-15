// ============================================
// Follow-up Scheduler (engine-side)
//
// Called at the end of every Messenger conversation turn. Looks at the
// lead's current state and decides whether to enqueue the next follow-up
// row in `follow_ups`. The existing cron worker (`/api/cron/follow-ups`)
// picks them up and sends them.
//
// Rules (mirrors Harrison's spec section 10):
//   - Stop if lead is booked, dead, or marked form-completed.
//   - Stop if the lead has more pending follow-ups than max_follow_ups.
//   - Stop if settings.auto_follow_up_enabled is false.
//   - Stop if settings.stop_on_reply is true AND this turn was a reply
//     (engine handles cancellation on reply, so this just avoids
//     re-scheduling until the bot next sends something).
//   - Otherwise, cancel existing pending follow-ups and enqueue ONE
//     fresh pending follow-up at now() + interval_days.
// ============================================

import { SupabaseClient } from "@supabase/supabase-js";
import type { Lead, Settings } from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any, any, any>;

interface ScheduleContext {
  supabase: DB;
  lead: Lead;
  settings: Settings;
  /** The lead's conversion stage AFTER this turn's updates. */
  stageAfterTurn: string;
  /** Did the engine send an outbound reply this turn? */
  botRepliedThisTurn: boolean;
}

export interface ScheduleResult {
  action: "scheduled" | "skipped";
  reason: string;
  scheduledAt?: string;
  stepNumber?: number;
}

export async function scheduleNextFollowUp(
  ctx: ScheduleContext
): Promise<ScheduleResult> {
  const { supabase, lead, settings, stageAfterTurn, botRepliedThisTurn } = ctx;

  // --- Guard: auto scheduling opt-out ---
  // `auto_follow_up_enabled` defaults to true; we read it defensively
  // so behaviour remains correct even on legacy settings rows without
  // the column.
  if (settings.auto_follow_up_enabled === false) {
    return { action: "skipped", reason: "auto_follow_up_disabled" };
  }

  // --- Guard: terminal stages ---
  if (
    stageAfterTurn === "booked" ||
    stageAfterTurn === "dead" ||
    lead.enquiry_form_completed
  ) {
    return { action: "skipped", reason: `terminal_stage:${stageAfterTurn}` };
  }

  // --- Guard: we only schedule follow-ups after outbound replies. If
  // the bot didn't reply (auto-reply disabled or error), there's no
  // point chasing the customer. ---
  if (!botRepliedThisTurn) {
    return { action: "skipped", reason: "no_outbound_this_turn" };
  }

  // --- Count existing sent/pending follow-ups ---
  const { data: existing } = await supabase
    .from("follow_ups")
    .select("id, status, step_number")
    .eq("lead_id", lead.id);

  const allRows = existing || [];
  const sent = allRows.filter((r) => r.status === "sent").length;
  const pending = allRows.filter((r) => r.status === "pending");

  const maxFollowUps = settings.max_follow_ups ?? 5;
  if (sent >= maxFollowUps) {
    return { action: "skipped", reason: "max_follow_ups_reached" };
  }

  // --- Cancel existing pending rows so we only keep one "next" row
  // in flight. This keeps behaviour predictable when the customer
  // sends multiple messages before the scheduled time. ---
  if (pending.length > 0) {
    await supabase
      .from("follow_ups")
      .update({ status: "cancelled" })
      .in(
        "id",
        pending.map((r) => r.id)
      );
  }

  // --- Enqueue the next one ---
  const intervalDays = settings.follow_up_interval_days ?? 3;
  const stepNumber = sent + 1;
  const scheduledAt = new Date(
    Date.now() + intervalDays * 24 * 60 * 60 * 1000
  ).toISOString();

  const { error: insertError } = await supabase.from("follow_ups").insert({
    lead_id: lead.id,
    user_id: lead.user_id,
    step_number: stepNumber,
    scheduled_at: scheduledAt,
    status: "pending",
  });

  if (insertError) {
    console.error(
      "[FollowUpScheduler] Failed to insert follow-up:",
      insertError
    );
    return { action: "skipped", reason: "insert_failed" };
  }

  return {
    action: "scheduled",
    reason: `enqueued_step_${stepNumber}`,
    scheduledAt,
    stepNumber,
  };
}
