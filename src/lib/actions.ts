"use server";

import { createServerSupabase } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { LeadStatus, AiTone, ConversionStage } from "./types";
import { setBusinessConfigBatch, clearConfigCache } from "./business/config";
import { getUserBusinessId } from "./business/resolve";

// ============================================
// Server Actions — v2
// ============================================

export async function createLead(formData: FormData) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { error } = await supabase.from("leads").insert({
    user_id: user.id,
    name: formData.get("name") as string,
    email: formData.get("email") as string,
    phone: (formData.get("phone") as string) || null,
    company: (formData.get("company") as string) || null,
    source: (formData.get("source") as string) || "manual",
    notes: (formData.get("notes") as string) || null,
    conversion_stage: "new",
    qualification_data: {},
  });

  if (error) throw new Error(error.message);
  revalidatePath("/leads");
  revalidatePath("/dashboard");
}

export async function updateLeadStatus(leadId: string, status: LeadStatus) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { error } = await supabase
    .from("leads")
    .update({ status })
    .eq("id", leadId)
    .eq("user_id", user.id);

  if (error) throw new Error(error.message);

  if (["responded", "booked", "dead"].includes(status)) {
    await supabase
      .from("follow_ups")
      .update({ status: "cancelled" })
      .eq("lead_id", leadId)
      .eq("status", "pending");
  }

  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/leads");
  revalidatePath("/dashboard");
}

export async function updateConversionStage(leadId: string, stage: ConversionStage) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const update: Record<string, unknown> = { conversion_stage: stage };

  if (stage === "booked") {
    update.status = "booked";
    update.enquiry_form_completed = true;
  } else if (stage === "dead") {
    update.status = "dead";
  }

  await supabase.from("leads").update(update).eq("id", leadId).eq("user_id", user.id);

  if (stage === "booked" || stage === "dead") {
    await supabase
      .from("follow_ups")
      .update({ status: "cancelled" })
      .eq("lead_id", leadId)
      .eq("status", "pending");
  }

  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/leads");
  revalidatePath("/dashboard");
}

export async function markEnquiryCompleted(leadId: string) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  await supabase.from("leads").update({
    enquiry_form_completed: true,
    conversion_stage: "booked",
    status: "booked",
  }).eq("id", leadId).eq("user_id", user.id);

  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/leads");
}

export async function toggleHumanReview(leadId: string, requires: boolean, reason?: string) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  await supabase.from("leads").update({
    requires_human_review: requires,
    escalation_reason: requires ? (reason || "manual_escalation") : null,
  }).eq("id", leadId).eq("user_id", user.id);

  revalidatePath(`/leads/${leadId}`);
}

export async function deleteLead(leadId: string) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { error } = await supabase
    .from("leads")
    .delete()
    .eq("id", leadId)
    .eq("user_id", user.id);

  if (error) throw new Error(error.message);
  revalidatePath("/leads");
  revalidatePath("/dashboard");
}

export async function saveSettings(formData: FormData) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  // Parse arrays from comma-separated strings
  const parseArray = (key: string): string[] => {
    const val = formData.get(key) as string;
    if (!val) return [];
    return val.split(",").map((s) => s.trim()).filter(Boolean);
  };

  const settingsData = {
    user_id: user.id,
    // Follow-up config
    max_follow_ups: parseInt(formData.get("max_follow_ups") as string) || 5,
    follow_up_interval_days: parseInt(formData.get("follow_up_interval_days") as string) || 3,
    stop_on_reply: formData.get("stop_on_reply") === "on",
    auto_follow_up_enabled: formData.get("auto_follow_up_enabled") === "on",
    // AI config
    ai_tone: (formData.get("ai_tone") as AiTone) || "friendly",
    ai_style_instructions: (formData.get("ai_style_instructions") as string) || null,
    first_reply_behaviour: (formData.get("first_reply_behaviour") as string) || "smart_reply",
    // Business info
    business_name: (formData.get("business_name") as string) || null,
    business_description: (formData.get("business_description") as string) || null,
    signature: (formData.get("signature") as string) || null,
    service_type: (formData.get("service_type") as string) || null,
    service_areas: parseArray("service_areas"),
    service_categories: parseArray("service_categories"),
    callout_fee: (formData.get("callout_fee") as string) || null,
    quote_policy: (formData.get("quote_policy") as string) || null,
    emergency_available: formData.get("emergency_available") === "on",
    after_hours_available: formData.get("after_hours_available") === "on",
    operating_hours: (formData.get("operating_hours") as string) || null,
    enquiry_form_url: (formData.get("enquiry_form_url") as string) || null,
    contact_email: (formData.get("contact_email") as string) || null,
    contact_phone: (formData.get("contact_phone") as string) || null,
    // Comment automation (legacy)
    comment_auto_reply: formData.get("comment_auto_reply") === "on",
    dm_automation_enabled: formData.get("dm_automation_enabled") === "on",
    escalation_keywords: parseArray("escalation_keywords"),
    // Comment automation v2
    comment_monitoring_enabled: formData.get("comment_monitoring_enabled") === "on",
    private_reply_enabled: formData.get("private_reply_enabled") === "on",
    public_reply_enabled: formData.get("public_reply_enabled") === "on",
    private_reply_templates: ((formData.get("private_reply_templates") as string) || "").split("\n").map(s => s.trim()).filter(Boolean),
    comment_lead_keywords: parseArray("comment_lead_keywords"),
    comment_confidence_threshold: parseFloat(formData.get("comment_confidence_threshold") as string) || 0.4,
    comment_escalation_threshold: parseFloat(formData.get("comment_escalation_threshold") as string) || 0.8,
    comment_cooldown_minutes: parseInt(formData.get("comment_cooldown_minutes") as string) || 5,
  };

  const { data: existing } = await supabase
    .from("settings")
    .select("id")
    .eq("user_id", user.id)
    .single();

  if (existing) {
    await supabase.from("settings").update(settingsData).eq("user_id", user.id);
  } else {
    await supabase.from("settings").insert(settingsData);
  }

  // Persist handoff + scoring config to business_configs table
  const businessId = await getUserBusinessId(user.id);
  if (businessId) {
    const configUpdates: Record<string, unknown> = {};

    // Handoff config
    const handoffExpireHours = parseInt(formData.get("handoff_auto_expire_hours") as string);
    const handoffLowConf = parseFloat(formData.get("handoff_low_confidence_threshold") as string);
    if (!isNaN(handoffExpireHours) || !isNaN(handoffLowConf)) {
      configUpdates["handoff.config"] = {
        auto_expire_hours: !isNaN(handoffExpireHours) ? handoffExpireHours : 24,
        escalation_keywords: parseArray("escalation_keywords"),
        low_confidence_threshold: !isNaN(handoffLowConf) ? handoffLowConf : 0.3,
      };
    }

    // Scoring weights
    const scoringClassification = parseFloat(formData.get("scoring_classification") as string);
    const scoringEngagement = parseFloat(formData.get("scoring_engagement") as string);
    const scoringUrgency = parseFloat(formData.get("scoring_urgency") as string);
    const scoringRecency = parseFloat(formData.get("scoring_recency") as string);
    const scoringIntent = parseFloat(formData.get("scoring_intent") as string);
    const scoringResponseTime = parseFloat(formData.get("scoring_response_time") as string);
    const scoringSource = parseFloat(formData.get("scoring_source") as string);

    if (!isNaN(scoringClassification)) {
      configUpdates["scoring.weights"] = {
        classification: scoringClassification,
        engagement: !isNaN(scoringEngagement) ? scoringEngagement : 1.0,
        urgency: !isNaN(scoringUrgency) ? scoringUrgency : 1.0,
        recency: !isNaN(scoringRecency) ? scoringRecency : 1.0,
        intent: !isNaN(scoringIntent) ? scoringIntent : 1.0,
        response_time: !isNaN(scoringResponseTime) ? scoringResponseTime : 0.8,
        source: !isNaN(scoringSource) ? scoringSource : 0.5,
      };
    }

    // Estimated lead value (business-level)
    const estLeadValue = parseInt(formData.get("estimated_lead_value") as string);
    if (!isNaN(estLeadValue) && estLeadValue > 0) {
      configUpdates["business.estimated_lead_value"] = estLeadValue;
      // Also update businesses table directly
      await supabase
        .from("businesses")
        .update({ estimated_lead_value: estLeadValue })
        .eq("id", businessId);
    }

    if (Object.keys(configUpdates).length > 0) {
      await setBusinessConfigBatch(businessId, configUpdates);
      clearConfigCache(businessId);
    }
  }

  revalidatePath("/settings");
}

// FAQ management
export async function addFaqEntry(formData: FormData) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  await supabase.from("faq_entries").insert({
    user_id: user.id,
    question: formData.get("question") as string,
    answer: formData.get("answer") as string,
    category: (formData.get("category") as string) || "general",
    keywords: ((formData.get("keywords") as string) || "").split(",").map((s) => s.trim()).filter(Boolean),
  });

  revalidatePath("/settings");
}

export async function updateFaqEntry(faqId: string, formData: FormData) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  await supabase.from("faq_entries").update({
    question: formData.get("question") as string,
    answer: formData.get("answer") as string,
    category: (formData.get("category") as string) || "general",
    keywords: ((formData.get("keywords") as string) || "").split(",").map((s) => s.trim()).filter(Boolean),
  }).eq("id", faqId).eq("user_id", user.id);

  revalidatePath("/settings");
}

export async function deleteFaqEntry(faqId: string) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  await supabase.from("faq_entries").delete().eq("id", faqId).eq("user_id", user.id);
  revalidatePath("/settings");
}

export async function toggleFaqActive(faqId: string, active: boolean) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  await supabase.from("faq_entries").update({ is_active: active }).eq("id", faqId).eq("user_id", user.id);
  revalidatePath("/settings");
}

export async function sendMessage(leadId: string, subject: string, body: string) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  // Load lead to determine channel + get platform IDs
  const { data: lead } = await supabase
    .from("leads")
    .select("id, user_id, platform_user_id, page_id, source, business_id")
    .eq("id", leadId)
    .eq("user_id", user.id)
    .single();

  if (!lead) throw new Error("Lead not found");

  const isMessenger = !!lead.platform_user_id && (lead.source === "messenger" || lead.source === "comment" || lead.source === "facebook");
  const channel = isMessenger ? "messenger" : "email";
  const channelType = isMessenger ? "messenger" : "email";

  let status: "sent" | "failed" | "draft" = "draft";
  let sentAt: string | null = null;
  let platformMessageId: string | null = null;

  // Actually deliver the message
  if (isMessenger && lead.platform_user_id) {
    try {
      // Resolve page token from business_pages table
      const { sendMessage: messengerSend } = await import("@/lib/meta/messenger");

      let pageToken: string | undefined;
      if (lead.page_id) {
        // Try to get token from business_pages table (multi-tenant)
        const { data: pageRow } = await supabase
          .from("business_pages")
          .select("access_token")
          .eq("page_id", lead.page_id)
          .eq("is_active", true)
          .maybeSingle();

        if (pageRow?.access_token) {
          pageToken = pageRow.access_token;
        }
      }

      // Send via Messenger API — pass explicit token if we have one from DB
      const result = await messengerSend(
        lead.platform_user_id,
        body,
        lead.page_id || undefined,
        pageToken || undefined
      ) as { message_id?: string };
      platformMessageId = result?.message_id || null;

      status = "sent";
      sentAt = new Date().toISOString();
    } catch (err) {
      console.error("[sendMessage] Messenger delivery failed:", err);
      status = "failed";
      // Still save the message so user sees what failed
    }
  } else {
    // Email leads — save as draft/manual (no email sending integration yet)
    status = "sent";
    sentAt = new Date().toISOString();
  }

  // Save message record
  const { data: message, error } = await supabase
    .from("messages")
    .insert({
      lead_id: leadId,
      user_id: user.id,
      direction: "outbound",
      channel,
      channel_type: channelType,
      subject: isMessenger ? null : subject,
      body,
      status,
      sent_at: sentAt,
      platform_message_id: platformMessageId,
      ai_generated: false,
      metadata: {},
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  // Update lead status
  await supabase
    .from("leads")
    .update({
      status: "contacted",
      last_contacted_at: sentAt || new Date().toISOString(),
    })
    .eq("id", leadId)
    .eq("user_id", user.id);

  // Log the action
  await supabase.from("automation_logs").insert({
    lead_id: leadId,
    event_type: "manual_message_sent",
    channel,
    action_taken: status === "sent" ? "delivered" : "delivery_failed",
    details: {
      by_user: user.id,
      platform_message_id: platformMessageId,
      messenger: isMessenger,
    },
    success: status === "sent",
    error_message: status === "failed" ? "Messenger API delivery failed" : null,
  });

  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/leads");
  return message;
}

export async function scheduleFollowUps(leadId: string) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { data: settings } = await supabase
    .from("settings")
    .select("*")
    .eq("user_id", user.id)
    .single();

  const maxFollowUps = settings?.max_follow_ups || 5;
  const intervalDays = settings?.follow_up_interval_days || 3;

  const { data: existing } = await supabase
    .from("follow_ups")
    .select("*")
    .eq("lead_id", leadId)
    .order("step_number", { ascending: true });

  const existingCount = existing?.length || 0;
  const remaining = maxFollowUps - existingCount;

  if (remaining <= 0) return;

  const now = new Date();
  const followUps = Array.from({ length: remaining }, (_, i) => ({
    lead_id: leadId,
    user_id: user.id,
    step_number: existingCount + i + 1,
    scheduled_at: new Date(
      now.getTime() + (i + 1) * intervalDays * 24 * 60 * 60 * 1000
    ).toISOString(),
    status: "pending" as const,
  }));

  await supabase.from("follow_ups").insert(followUps);

  await supabase
    .from("leads")
    .update({ status: "following_up" })
    .eq("id", leadId)
    .eq("user_id", user.id);

  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/leads");
  revalidatePath("/dashboard");
}

export async function signOut() {
  const supabase = createServerSupabase();
  await supabase.auth.signOut();
  revalidatePath("/");
}

// ============================================
// markEnquiryFormCompleted
// Toggles the `enquiry_form_completed` flag on a lead. When set to true
// it also cancels pending follow-ups and moves the lead to `booked`.
// The SQL trigger (migration 004) stamps `enquiry_form_completed_at`
// automatically, so we don't touch it here.
// ============================================
export async function markEnquiryFormCompleted(
  leadId: string,
  completed: boolean
) {
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  // Prefer the SQL function which also cancels pending follow-ups
  // atomically. Fall back to a plain update if the function isn't
  // deployed yet (migration 004 pending).
  const { error: rpcError } = await supabase.rpc("mark_form_completed", {
    lead_id_param: leadId,
    completed,
  });

  if (rpcError) {
    const fallback = await supabase
      .from("leads")
      .update({
        enquiry_form_completed: completed,
        status: completed ? "booked" : "following_up",
        conversion_stage: completed ? "booked" : "awaiting_form",
      })
      .eq("id", leadId)
      .eq("user_id", user.id);
    if (fallback.error) throw new Error(fallback.error.message);

    if (completed) {
      await supabase
        .from("follow_ups")
        .update({ status: "cancelled" })
        .eq("lead_id", leadId)
        .eq("status", "pending");
    }
  }

  // Log the manual action
  await supabase.from("automation_logs").insert({
    lead_id: leadId,
    event_type: "manual_form_toggle",
    channel: "web_ui",
    action_taken: completed ? "mark_completed" : "unmark_completed",
    details: { by_user: user.id },
    success: true,
  });

  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/leads");
  revalidatePath("/dashboard");
}
