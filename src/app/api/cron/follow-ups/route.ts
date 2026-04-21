import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { generateMessengerFollowUp } from "@/lib/ai/reply";
import { sendMessage } from "@/lib/meta/messenger";
import { NextResponse } from "next/server";
import type { Lead, Settings, Message, FollowUp } from "@/lib/types";
import {
  scheduleSmartFollowUps,
  isFollowUpEligible,
} from "@/lib/followup/scheduler";
import { expireStaleHandoffs } from "@/lib/conversation/handoff";
import { checkSubscriptionGate } from "@/lib/billing/stripe";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any, any, any>;
function getSupabase(): DB {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// ============================================
// Cron job — Process pending follow-ups + auto-schedule + expire handoffs
// Runs every 5-15 minutes via Vercel Cron or external scheduler
// ============================================

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabase();
  const results = {
    followUpsSent: 0,
    followUpsSkipped: 0,
    autoScheduled: 0,
    handoffsExpired: 0,
    errors: 0,
  };

  // ── Phase 1: Expire stale handoffs ──
  try {
    results.handoffsExpired = await expireStaleHandoffs();
  } catch (err) {
    console.error("[cron/follow-ups] Handoff expiry failed:", err);
  }

  // ── Phase 2: Process due follow-ups ──
  const { data: dueFollowUps } = await supabase
    .from("follow_ups")
    .select("*")
    .eq("status", "pending")
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(50);

  if (dueFollowUps && dueFollowUps.length > 0) {
    for (const followUp of dueFollowUps as FollowUp[]) {
      try {
        const processed = await processFollowUp(supabase, followUp);
        if (processed) {
          results.followUpsSent++;
        } else {
          results.followUpsSkipped++;
        }
      } catch (error) {
        console.error(`[cron/follow-ups] Error processing ${followUp.id}:`, error);
        results.errors++;
      }
    }
  }

  // ── Phase 3: Auto-schedule follow-ups for eligible leads without any ──
  try {
    const autoScheduled = await autoScheduleNewLeads(supabase);
    results.autoScheduled = autoScheduled;
  } catch (err) {
    console.error("[cron/follow-ups] Auto-schedule failed:", err);
  }

  return NextResponse.json(results);
}

// ============================================
// Process a single due follow-up
// ============================================

async function processFollowUp(supabase: DB, followUp: FollowUp): Promise<boolean> {
  // Get lead
  const { data: lead } = await supabase
    .from("leads")
    .select("*")
    .eq("id", followUp.lead_id)
    .single();

  if (!lead) {
    await cancelFollowUp(supabase, followUp.id);
    return false;
  }

  // Stop conditions
  if (
    ["responded", "booked", "dead"].includes(lead.status) ||
    lead.enquiry_form_completed ||
    lead.conversion_stage === "booked" ||
    lead.conversion_stage === "dead" ||
    lead.handoff_active
  ) {
    await cancelFollowUp(supabase, followUp.id);
    return false;
  }

  // Check subscription gate if business_id exists
  if (lead.business_id) {
    const gate = await checkSubscriptionGate(lead.business_id);
    if (!gate.allowed) {
      console.warn(`[cron/follow-ups] Subscription gate blocked for business ${lead.business_id}: ${gate.reason}`);
      return false; // Don't cancel — retry on next run after payment resolves
    }
  }

  // Get user settings
  const { data: settings } = await supabase
    .from("settings")
    .select("*")
    .eq("user_id", followUp.user_id)
    .single();

  const userSettings: Settings = settings || getDefaultSettings(followUp.user_id);

  // Check for recent inbound replies (stop_on_reply)
  if (userSettings.stop_on_reply) {
    const { data: replies } = await supabase
      .from("messages")
      .select("id")
      .eq("lead_id", followUp.lead_id)
      .eq("direction", "inbound")
      .gt("created_at", followUp.created_at)
      .limit(1);

    if (replies && replies.length > 0) {
      await cancelFollowUp(supabase, followUp.id);
      return false;
    }
  }

  // Get conversation history
  const { data: messages } = await supabase
    .from("messages")
    .select("*")
    .eq("lead_id", followUp.lead_id)
    .order("sent_at", { ascending: true })
    .limit(10);

  const recentMessages = (messages || []) as Message[];

  // Determine channel
  const isMessengerLead = lead.platform_user_id && lead.source === "messenger";

  if (isMessengerLead) {
    return await sendMessengerFollowUp(supabase, followUp, lead as Lead, userSettings, recentMessages);
  } else {
    return await sendEmailFollowUp(supabase, followUp, lead as Lead, userSettings);
  }
}

async function sendMessengerFollowUp(
  supabase: DB,
  followUp: FollowUp,
  lead: Lead,
  settings: Settings,
  recentMessages: Message[]
): Promise<boolean> {
  const followUpText = await generateMessengerFollowUp(
    lead,
    settings,
    recentMessages,
    followUp.step_number
  );

  try {
    await sendMessage(lead.platform_user_id!, followUpText, lead.page_id || undefined);
  } catch (sendError) {
    console.error(`[cron/follow-ups] Messenger send failed for ${lead.platform_user_id}:`, sendError);

    // Log the failure
    await supabase.from("automation_logs").insert({
      lead_id: followUp.lead_id,
      event_type: "follow_up_send_failed",
      channel: "messenger",
      action_taken: `follow_up_step_${followUp.step_number}`,
      details: { step: followUp.step_number, error: String(sendError) },
      success: false,
      error_message: String(sendError),
    });

    return false;
  }

  // Save outbound message
  const { data: message } = await supabase
    .from("messages")
    .insert({
      lead_id: followUp.lead_id,
      user_id: followUp.user_id,
      direction: "outbound",
      channel: "messenger",
      channel_type: "messenger",
      body: followUpText,
      ai_generated: true,
      status: "sent",
      sent_at: new Date().toISOString(),
      metadata: { follow_up_step: followUp.step_number },
    })
    .select()
    .single();

  // Mark follow-up as sent
  await supabase
    .from("follow_ups")
    .update({
      status: "sent",
      executed_at: new Date().toISOString(),
      message_id: message?.id,
    })
    .eq("id", followUp.id);

  // Update lead
  await supabase
    .from("leads")
    .update({
      status: "following_up",
      last_contacted_at: new Date().toISOString(),
    })
    .eq("id", followUp.lead_id);

  // Log success
  await supabase.from("automation_logs").insert({
    lead_id: followUp.lead_id,
    event_type: "follow_up_sent",
    channel: "messenger",
    action_taken: `follow_up_step_${followUp.step_number}`,
    details: { step: followUp.step_number },
    success: true,
  });

  return true;
}

async function sendEmailFollowUp(
  supabase: DB,
  followUp: FollowUp,
  lead: Lead,
  settings: Settings
): Promise<boolean> {
  const name = lead.name.split(" ")[0];
  const biz = settings.business_name || "our team";
  const link = settings.enquiry_form_url;

  const body = link
    ? `Hi ${name},\n\nJust checking in — still happy to help with your enquiry. Best way to get things moving is here: ${link}\n\nCheers,\n${biz}`
    : `Hi ${name},\n\nJust following up on my previous message. Would love to help if you're still interested.\n\nBest,\n${biz}`;

  const { data: message } = await supabase
    .from("messages")
    .insert({
      lead_id: followUp.lead_id,
      user_id: followUp.user_id,
      direction: "outbound",
      channel: "email",
      channel_type: "email",
      subject: `Following up — ${biz}`,
      body,
      ai_generated: true,
      status: "sent",
      sent_at: new Date().toISOString(),
    })
    .select()
    .single();

  await supabase
    .from("follow_ups")
    .update({
      status: "sent",
      executed_at: new Date().toISOString(),
      message_id: message?.id,
    })
    .eq("id", followUp.id);

  await supabase
    .from("leads")
    .update({
      status: "following_up",
      last_contacted_at: new Date().toISOString(),
    })
    .eq("id", followUp.lead_id);

  return true;
}

// ============================================
// Auto-schedule: find leads that need follow-ups but don't have any
// ============================================

async function autoScheduleNewLeads(supabase: DB): Promise<number> {
  // Find leads that are contacted or new but have no pending follow-ups
  const { data: leads } = await supabase
    .from("leads")
    .select("id, business_id, status, conversion_stage, enquiry_form_completed, handoff_active, platform_user_id, created_at, lead_score")
    .in("status", ["new", "contacted", "engaged", "qualified"])
    .eq("handoff_active", false)
    .eq("enquiry_form_completed", false)
    .not("platform_user_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(30);

  if (!leads || leads.length === 0) return 0;

  let scheduled = 0;

  for (const lead of leads) {
    // Check if lead already has pending follow-ups
    const { data: existingFU } = await supabase
      .from("follow_ups")
      .select("id")
      .eq("lead_id", lead.id)
      .eq("status", "pending")
      .limit(1);

    if (existingFU && existingFU.length > 0) continue;

    // Check if last contact was recent enough to warrant follow-ups
    if (!lead.business_id) continue;

    try {
      const result = await scheduleSmartFollowUps(lead.id, lead.business_id);
      if (result.scheduled > 0) {
        scheduled += result.scheduled;
        console.log(`[cron/follow-ups] Auto-scheduled ${result.scheduled} follow-ups for lead ${lead.id}`);
      }
    } catch (err) {
      console.error(`[cron/follow-ups] Auto-schedule failed for lead ${lead.id}:`, err);
    }
  }

  return scheduled;
}

// ============================================
// Helpers
// ============================================

async function cancelFollowUp(supabase: DB, followUpId: string) {
  await supabase
    .from("follow_ups")
    .update({ status: "cancelled" })
    .eq("id", followUpId);
}

function getDefaultSettings(userId: string): Settings {
  return {
    id: "",
    user_id: userId,
    max_follow_ups: 5,
    follow_up_interval_days: 3,
    stop_on_reply: true,
    ai_tone: "friendly",
    ai_style_instructions: null,
    first_reply_behaviour: "smart_reply",
    business_name: "HR AIR",
    business_description: null,
    signature: null,
    service_type: "HVAC",
    service_areas: [],
    service_categories: [],
    callout_fee: null,
    quote_policy: null,
    emergency_available: false,
    after_hours_available: false,
    operating_hours: null,
    enquiry_form_url: "https://book.servicem8.com/request_service_online_booking?strVendorUUID=2eec0c0d-dbd4-4b52-aaf6-22f38ff2175b#5990b36a-64bd-4aa9-9e5b-23f620791f6b",
    contact_email: "harrison@hrair.com.au",
    contact_phone: "0431 703 913",
    meta_page_id: null,
    meta_verify_token: null,
    comment_auto_reply: true,
    comment_reply_templates: [],
    dm_automation_enabled: true,
    escalation_keywords: [],
    comment_monitoring_enabled: true,
    private_reply_enabled: true,
    public_reply_enabled: true,
    private_reply_templates: [],
    comment_lead_keywords: [],
    comment_confidence_threshold: 0.4,
    comment_escalation_threshold: 0.8,
    comment_cooldown_minutes: 5,
    created_at: "",
    updated_at: "",
  };
}
