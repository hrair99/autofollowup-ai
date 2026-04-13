"use server";

import { createServerSupabase } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { LeadStatus, AiTone, ConversionStage } from "./types";

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
    // Comment automation
    comment_auto_reply: formData.get("comment_auto_reply") === "on",
    dm_automation_enabled: formData.get("dm_automation_enabled") === "on",
    escalation_keywords: parseArray("escalation_keywords"),
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

export async function sendMessage(leadId: string, subject: string, body: string) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { data: message, error } = await supabase
    .from("messages")
    .insert({
      lead_id: leadId,
      user_id: user.id,
      direction: "outbound",
      channel: "email",
      channel_type: "email",
      subject,
      body,
      status: "sent",
      sent_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  await supabase
    .from("leads")
    .update({
      status: "contacted",
      last_contacted_at: new Date().toISOString(),
    })
    .eq("id", leadId)
    .eq("user_id", user.id);

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
