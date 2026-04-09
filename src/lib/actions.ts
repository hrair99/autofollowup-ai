"use server";

import { createServerSupabase } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { LeadStatus, AiTone } from "./types";

// ============================================
// Server Actions
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

  // Cancel pending follow-ups if lead is done
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

  const settingsData = {
    user_id: user.id,
    max_follow_ups: parseInt(formData.get("max_follow_ups") as string) || 5,
    follow_up_interval_days: parseInt(formData.get("follow_up_interval_days") as string) || 3,
    stop_on_reply: formData.get("stop_on_reply") === "on",
    ai_tone: (formData.get("ai_tone") as AiTone) || "professional",
    business_name: (formData.get("business_name") as string) || null,
    business_description: (formData.get("business_description") as string) || null,
    signature: (formData.get("signature") as string) || null,
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

export async function sendMessage(leadId: string, subject: string, body: string) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  // Create the message
  const { data: message, error } = await supabase
    .from("messages")
    .insert({
      lead_id: leadId,
      user_id: user.id,
      direction: "outbound",
      channel: "email",
      subject,
      body,
      status: "sent",
      sent_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  // Update lead status and last_contacted_at
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

  // Get settings
  const { data: settings } = await supabase
    .from("settings")
    .select("*")
    .eq("user_id", user.id)
    .single();

  const maxFollowUps = settings?.max_follow_ups || 5;
  const intervalDays = settings?.follow_up_interval_days || 3;

  // Get existing follow-ups
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

  // Update lead status
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
