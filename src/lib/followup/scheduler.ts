// ============================================
// Smart Follow-up Scheduler
// Intelligently schedules follow-ups based on:
// - Lead score (hot/warm/cold)
// - Conversation state (responded/booked/dead)
// - Age of lead (staleness check)
// - Configurable intervals and max attempts
// ============================================

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { Lead, Settings, FollowUp } from "@/lib/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any, any, any>;

// ============================================
// Types
// ============================================

export interface FollowUpTemplate {
  templateType: "gentle_check_in" | "value_reminder" | "final_attempt";
  includeBookingLink: boolean;
  urgency: "low" | "medium" | "high";
}

export interface ScheduleResult {
  scheduled: number;
  nextAt: string | null;
}

// ============================================
// Service Role Supabase Client
// ============================================

function getServiceRoleSupabase(): DB {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// ============================================
// 1. Calculate Follow-up Interval
// Dynamic interval based on lead score with bounds
// ============================================

export function calculateFollowUpInterval(
  lead: Pick<Lead, "lead_score">,
  settings: Pick<Settings, "follow_up_interval_days">
): number {
  const baseInterval = settings.follow_up_interval_days || 3;
  const leadScore = lead.lead_score || 0;

  let multiplier = 1.0;

  if (leadScore >= 65) {
    // Hot leads: 1-2 days (reduce by 50%)
    multiplier = 0.5;
  } else if (leadScore >= 35) {
    // Warm leads: 2-4 days (no adjustment, use base)
    multiplier = 1.0;
  } else {
    // Cold leads: 4-7 days (increase by 50%)
    multiplier = 1.5;
  }

  return Math.round(baseInterval * multiplier);
}

// ============================================
// 2. Check Follow-up Eligibility
// Determine if a lead should receive follow-ups
// ============================================

export function isFollowUpEligible(
  lead: Pick<
    Lead,
    | "status"
    | "conversion_stage"
    | "enquiry_form_completed"
    | "handoff_active"
    | "platform_user_id"
    | "created_at"
  >,
  settings?: Pick<Settings, "auto_follow_up_enabled">
): boolean {
  // Check if follow-ups are globally enabled (default true)
  if (settings?.auto_follow_up_enabled === false) {
    return false;
  }

  // NOT eligible: responded, booked, or dead status
  if (["responded", "booked", "dead"].includes(lead.status)) {
    return false;
  }

  // NOT eligible: enquiry form already completed
  if (lead.enquiry_form_completed) {
    return false;
  }

  // NOT eligible: handoff is active (human takeover)
  if (lead.handoff_active) {
    return false;
  }

  // NOT eligible: conversion stage is booked or dead
  if (["booked", "dead"].includes(lead.conversion_stage)) {
    return false;
  }

  // NOT eligible: no platform_user_id (can't message them)
  if (!lead.platform_user_id) {
    return false;
  }

  // NOT eligible: lead is stale (created more than 30 days ago)
  const createdDate = new Date(lead.created_at);
  const daysSinceCreated = (Date.now() - createdDate.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceCreated > 30) {
    return false;
  }

  // Otherwise, eligible
  return true;
}

// ============================================
// 3. Get Follow-up Template
// Determine message template based on attempt number
// ============================================

export function getFollowUpTemplate(
  lead: Pick<Lead, "lead_score">,
  attempt: number,
  maxAttempts: number
): FollowUpTemplate {
  // Determine urgency based on lead score
  const leadScore = lead.lead_score || 0;
  const baseUrgency: "low" | "medium" | "high" =
    leadScore >= 65 ? "high" : leadScore >= 35 ? "medium" : "low";

  if (attempt === 1) {
    return {
      templateType: "gentle_check_in",
      includeBookingLink: true,
      urgency: baseUrgency,
    };
  } else if (attempt < maxAttempts) {
    return {
      templateType: "value_reminder",
      includeBookingLink: true,
      urgency: baseUrgency,
    };
  } else {
    // Final attempt (attempt == maxAttempts)
    return {
      templateType: "final_attempt",
      includeBookingLink: true,
      urgency: "high", // Always high urgency on final attempt
    };
  }
}

// ============================================
// 4. Main Scheduling Function
// Load lead data, check eligibility, and create follow-ups
// ============================================

export async function scheduleSmartFollowUps(
  leadId: string,
  businessId: string
): Promise<ScheduleResult> {
  const supabase = getServiceRoleSupabase();

  // Load lead
  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .eq("business_id", businessId)
    .single();

  if (leadError || !lead) {
    console.error(`Failed to load lead ${leadId}:`, leadError);
    return { scheduled: 0, nextAt: null };
  }

  // Load settings for the business
  const { data: settings, error: settingsError } = await supabase
    .from("settings")
    .select("*")
    .eq("user_id", lead.user_id)
    .single();

  if (settingsError || !settings) {
    console.warn(
      `Failed to load settings for user ${lead.user_id}:`,
      settingsError
    );
    // Continue with default settings
  }

  const userSettings: Settings = settings || getDefaultSettings(lead.user_id);

  // Check eligibility
  if (!isFollowUpEligible(lead, userSettings)) {
    return { scheduled: 0, nextAt: null };
  }

  // Load existing follow-ups
  const { data: existingFollowUps, error: followUpsError } = await supabase
    .from("follow_ups")
    .select("*")
    .eq("lead_id", leadId)
    .order("step_number", { ascending: true });

  if (followUpsError) {
    console.error(`Failed to load follow-ups for lead ${leadId}:`, followUpsError);
    return { scheduled: 0, nextAt: null };
  }

  const existingCount = existingFollowUps?.length || 0;
  const maxFollowUps = userSettings.max_follow_ups || 5;
  const remainingSlots = maxFollowUps - existingCount;

  if (remainingSlots <= 0) {
    // Already have max follow-ups scheduled
    const nextFollowUp = existingFollowUps?.[existingCount - 1];
    return {
      scheduled: 0,
      nextAt: nextFollowUp?.scheduled_at || null,
    };
  }

  // Calculate interval for this lead
  const intervalDays = calculateFollowUpInterval(lead, userSettings);

  // Create new follow-ups
  const now = new Date();
  const newFollowUps: Array<Omit<FollowUp, "id" | "created_at">> = [];

  for (let i = 0; i < remainingSlots; i++) {
    const stepNumber = existingCount + i + 1;
    const scheduledDate = new Date(
      now.getTime() + stepNumber * intervalDays * 24 * 60 * 60 * 1000
    );

    newFollowUps.push({
      lead_id: leadId,
      user_id: lead.user_id,
      step_number: stepNumber,
      scheduled_at: scheduledDate.toISOString(),
      executed_at: null,
      status: "pending",
      message_id: null,
    });
  }

  // Insert new follow-ups
  const { error: insertError } = await supabase
    .from("follow_ups")
    .insert(newFollowUps);

  if (insertError) {
    console.error(
      `Failed to insert follow-ups for lead ${leadId}:`,
      insertError
    );
    return { scheduled: 0, nextAt: null };
  }

  // Get the next scheduled follow-up timestamp
  const nextFollowUp =
    newFollowUps.length > 0 ? newFollowUps[0] : existingFollowUps?.[0];
  const nextAt = nextFollowUp?.scheduled_at || null;

  return {
    scheduled: newFollowUps.length,
    nextAt,
  };
}

// ============================================
// Helper: Default Settings Fallback
// ============================================

function getDefaultSettings(userId: string): Settings {
  return {
    id: "",
    user_id: userId,
    max_follow_ups: 5,
    follow_up_interval_days: 3,
    stop_on_reply: true,
    auto_follow_up_enabled: true,
    ai_tone: "friendly",
    ai_style_instructions: null,
    first_reply_behaviour: "smart_reply",
    business_name: null,
    business_description: null,
    signature: null,
    service_type: null,
    service_areas: [],
    service_categories: [],
    callout_fee: null,
    quote_policy: null,
    emergency_available: false,
    after_hours_available: false,
    operating_hours: null,
    enquiry_form_url: null,
    contact_email: null,
    contact_phone: null,
    meta_page_id: null,
    meta_verify_token: null,
    comment_auto_reply: false,
    comment_reply_templates: [],
    dm_automation_enabled: true,
    escalation_keywords: [],
    comment_monitoring_enabled: false,
    private_reply_enabled: false,
    public_reply_enabled: false,
    private_reply_templates: [],
    comment_lead_keywords: [],
    comment_confidence_threshold: 0.4,
    comment_escalation_threshold: 0.8,
    comment_cooldown_minutes: 5,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}
