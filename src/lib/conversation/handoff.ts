// ============================================
// Conversation Handoff — Human takeover system
//
// When the AI can't handle a conversation (low confidence, angry customer,
// explicit escalation), this module pauses automation for that lead and
// creates a handoff record for a human to pick up.
//
// Lifecycle: trigger → open → claimed → resolved (or expired)
// While a handoff is active, the conversation engine skips AI replies.
// ============================================

import { createClient, SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any, any, any>;

let _supabase: DB | null = null;
function db(): DB {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabase;
}

// ============================================
// Types
// ============================================

export type HandoffTrigger = "ai" | "human" | "keyword" | "threshold";
export type HandoffStatus = "open" | "claimed" | "resolved" | "expired";
export type HandoffPriority = "low" | "normal" | "high" | "urgent";

export interface HandoffRecord {
  id: string;
  business_id: string;
  lead_id: string;
  triggered_by: HandoffTrigger;
  trigger_reason: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  status: HandoffStatus;
  priority: HandoffPriority;
  context_summary: string | null;
  last_customer_message: string | null;
  source_channel: string | null;
  source_id: string | null;
  resolution_notes: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  expires_at: string | null;
  auto_resumed: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateHandoffInput {
  businessId: string;
  leadId: string;
  trigger: HandoffTrigger;
  reason?: string;
  contextSummary?: string;
  lastCustomerMessage?: string;
  sourceChannel?: string;  // "messenger" | "comment" | "leadgen"
  sourceId?: string;       // comment_id or message_id
  priority?: HandoffPriority;
  expireHours?: number;    // 0 = never expires
}

// ============================================
// Core functions
// ============================================

/**
 * Create a handoff and pause AI on the lead.
 * Uses the database function for atomicity.
 */
export async function createHandoff(
  input: CreateHandoffInput
): Promise<{ handoffId: string } | null> {
  const supabase = db();

  try {
    // Use the SQL function for atomic create + lead update
    const { data, error } = await supabase.rpc("create_handoff", {
      p_business_id: input.businessId,
      p_lead_id: input.leadId,
      p_trigger: input.trigger,
      p_reason: input.reason || null,
      p_context: input.contextSummary || null,
      p_last_message: input.lastCustomerMessage || null,
      p_channel: input.sourceChannel || null,
      p_source_id: input.sourceId || null,
      p_priority: input.priority || "normal",
      p_expire_hours: input.expireHours ?? 24,
    });

    if (error) {
      console.error("[Handoff] Failed to create:", error);
      return null;
    }

    const handoffId = data as string;
    console.log(
      `[Handoff] Created ${handoffId} for lead ${input.leadId} ` +
        `(trigger=${input.trigger}, reason=${input.reason})`
    );

    return { handoffId };
  } catch (err) {
    console.error("[Handoff] Error creating handoff:", err);
    return null;
  }
}

/**
 * Check if a lead currently has an active handoff.
 * Used by the conversation engine to decide whether to skip AI replies.
 */
export async function isHandoffActive(leadId: string): Promise<boolean> {
  const supabase = db();

  const { data } = await supabase
    .from("leads")
    .select("handoff_active")
    .eq("id", leadId)
    .maybeSingle();

  return data?.handoff_active === true;
}

/**
 * Get the active handoff for a lead (if any).
 */
export async function getActiveHandoff(
  leadId: string
): Promise<HandoffRecord | null> {
  const supabase = db();

  const { data } = await supabase
    .from("conversation_handoffs")
    .select("*")
    .eq("lead_id", leadId)
    .in("status", ["open", "claimed"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data as HandoffRecord | null;
}

/**
 * Claim a handoff (human picks it up).
 */
export async function claimHandoff(
  handoffId: string,
  userId: string
): Promise<boolean> {
  const supabase = db();

  const { error } = await supabase
    .from("conversation_handoffs")
    .update({
      status: "claimed",
      claimed_by: userId,
      claimed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", handoffId)
    .in("status", ["open"]); // Can only claim open handoffs

  if (error) {
    console.error("[Handoff] Failed to claim:", error);
    return false;
  }

  console.log(`[Handoff] ${handoffId} claimed by ${userId}`);
  return true;
}

/**
 * Resolve a handoff and resume AI on the lead.
 * Uses the database function for atomicity.
 */
export async function resolveHandoff(
  handoffId: string,
  userId: string,
  notes?: string
): Promise<boolean> {
  const supabase = db();

  try {
    const { error } = await supabase.rpc("resolve_handoff", {
      p_handoff_id: handoffId,
      p_user_id: userId,
      p_notes: notes || null,
    });

    if (error) {
      console.error("[Handoff] Failed to resolve:", error);
      return false;
    }

    console.log(`[Handoff] ${handoffId} resolved by ${userId}`);
    return true;
  } catch (err) {
    console.error("[Handoff] Error resolving:", err);
    return false;
  }
}

/**
 * Get all open/claimed handoffs for a business.
 * For the dashboard queue view.
 */
export async function getBusinessHandoffs(
  businessId: string,
  opts?: { status?: HandoffStatus[]; limit?: number }
): Promise<HandoffRecord[]> {
  const supabase = db();

  let query = supabase
    .from("conversation_handoffs")
    .select("*")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(opts?.limit ?? 50);

  if (opts?.status && opts.status.length > 0) {
    query = query.in("status", opts.status);
  }

  const { data } = await query;
  return (data || []) as HandoffRecord[];
}

/**
 * Expire stale handoffs. Call from a cron job.
 * Returns the number of handoffs expired.
 */
export async function expireStaleHandoffs(): Promise<number> {
  const supabase = db();

  try {
    const { data, error } = await supabase.rpc("expire_stale_handoffs");
    if (error) {
      console.error("[Handoff] Failed to expire stale:", error);
      return 0;
    }
    const count = data as number;
    if (count > 0) {
      console.log(`[Handoff] Expired ${count} stale handoff(s)`);
    }
    return count;
  } catch {
    return 0;
  }
}

// ============================================
// Integration helpers — used by engine/commentHandler
// ============================================

/**
 * Determine if a conversation should be escalated to a human.
 * Called by the conversation engine after classification.
 */
export function shouldEscalate(opts: {
  confidence: number;
  sentiment: string;
  intent: string;
  escalationKeywords: string[];
  messageText: string;
  lowConfidenceThreshold?: number;
}): { escalate: boolean; trigger: HandoffTrigger; reason: string; priority: HandoffPriority } {
  const threshold = opts.lowConfidenceThreshold ?? 0.3;

  // 1. Angry customer
  if (opts.sentiment === "angry" || opts.sentiment === "negative") {
    return {
      escalate: true,
      trigger: "ai",
      reason: "negative_sentiment",
      priority: opts.sentiment === "angry" ? "urgent" : "high",
    };
  }

  // 2. Escalation keywords
  const lowerText = opts.messageText.toLowerCase();
  const matched = opts.escalationKeywords.find((kw) =>
    lowerText.includes(kw.toLowerCase())
  );
  if (matched) {
    return {
      escalate: true,
      trigger: "keyword",
      reason: `escalation_keyword:${matched}`,
      priority: "high",
    };
  }

  // 3. Very low confidence
  if (opts.confidence < threshold) {
    return {
      escalate: true,
      trigger: "threshold",
      reason: `low_confidence:${opts.confidence.toFixed(2)}`,
      priority: "normal",
    };
  }

  // 4. Complaint intent
  if (opts.intent === "complaint") {
    return {
      escalate: true,
      trigger: "ai",
      reason: "complaint_detected",
      priority: "high",
    };
  }

  return { escalate: false, trigger: "ai", reason: "", priority: "normal" };
}

/**
 * Check handoff + escalation in one call.
 * Returns true if we should SKIP AI reply (handoff active or newly created).
 */
export async function checkHandoffOrEscalate(opts: {
  leadId: string;
  businessId: string;
  confidence: number;
  sentiment: string;
  intent: string;
  messageText: string;
  escalationKeywords: string[];
  sourceChannel: string;
  sourceId?: string;
  lowConfidenceThreshold?: number;
}): Promise<{ skipAiReply: boolean; handoffId?: string; reason?: string }> {
  // 1. Check if handoff already active
  const active = await isHandoffActive(opts.leadId);
  if (active) {
    return { skipAiReply: true, reason: "handoff_already_active" };
  }

  // 2. Check if we should escalate
  const escResult = shouldEscalate({
    confidence: opts.confidence,
    sentiment: opts.sentiment,
    intent: opts.intent,
    escalationKeywords: opts.escalationKeywords,
    messageText: opts.messageText,
    lowConfidenceThreshold: opts.lowConfidenceThreshold,
  });

  if (!escResult.escalate) {
    return { skipAiReply: false };
  }

  // 3. Create the handoff
  const result = await createHandoff({
    businessId: opts.businessId,
    leadId: opts.leadId,
    trigger: escResult.trigger,
    reason: escResult.reason,
    lastCustomerMessage: opts.messageText.slice(0, 500),
    sourceChannel: opts.sourceChannel,
    sourceId: opts.sourceId,
    priority: escResult.priority,
  });

  if (result) {
    return {
      skipAiReply: true,
      handoffId: result.handoffId,
      reason: escResult.reason,
    };
  }

  // Handoff creation failed — don't skip AI (fail-open)
  return { skipAiReply: false };
}
