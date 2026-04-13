import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { generateMessengerFollowUp } from "@/lib/ai/reply";
import { sendMessage } from "@/lib/meta/messenger";
import { NextResponse } from "next/server";
import type { Lead, Settings, Message, FollowUp } from "@/lib/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any, any, any>;
function getSupabase(): DB {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// ============================================
// Cron job — Process pending follow-ups
// Sends context-aware Messenger follow-ups with enquiry link
// ============================================

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabase();

  // Get all pending follow-ups that are due
  const { data: dueFollowUps } = await supabase
    .from("follow_ups")
    .select("*")
    .eq("status", "pending")
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(50);

  if (!dueFollowUps || dueFollowUps.length === 0) {
    return NextResponse.json({ processed: 0 });
  }

  let processed = 0;
  let skipped = 0;

  for (const followUp of dueFollowUps as FollowUp[]) {
    try {
      // Get lead
      const { data: lead } = await supabase
        .from("leads")
        .select("*")
        .eq("id", followUp.lead_id)
        .single();

      if (!lead) {
        await cancelFollowUp(supabase, followUp.id);
        skipped++;
        continue;
      }

      // Stop conditions: responded, booked, dead, enquiry completed
      if (
        ["responded", "booked", "dead"].includes(lead.status) ||
        lead.enquiry_form_completed ||
        lead.conversion_stage === "booked" ||
        lead.conversion_stage === "dead"
      ) {
        await cancelFollowUp(supabase, followUp.id);
        skipped++;
        continue;
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
          .gt("created_at", followUp.created_at) // Only replies after follow-up was scheduled
          .limit(1);

        if (replies && replies.length > 0) {
          await cancelFollowUp(supabase, followUp.id);
          skipped++;
          continue;
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

      // Determine if this is a Messenger lead
      const isMessengerLead = lead.platform_user_id && lead.source === "messenger";

      if (isMessengerLead) {
        // Generate context-aware Messenger follow-up
        const followUpText = await generateMessengerFollowUp(
          lead as Lead,
          userSettings,
          recentMessages,
          followUp.step_number
        );

        // Send via Messenger
        try {
          await sendMessage(lead.platform_user_id!, followUpText, lead.page_id || undefined);
        } catch (sendError) {
          console.error(`Failed to send Messenger follow-up to ${lead.platform_user_id}:`, sendError);
          // Don't mark as sent if sending failed
          continue;
        }

        // Save the outbound message
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

        // Log
        await supabase.from("automation_logs").insert({
          lead_id: followUp.lead_id,
          event_type: "follow_up_sent",
          channel: "messenger",
          action_taken: `follow_up_step_${followUp.step_number}`,
          details: { step: followUp.step_number },
          success: true,
        });

        processed++;
      } else {
        // Email follow-up (legacy behavior, kept for non-Messenger leads)
        const name = lead.name.split(" ")[0];
        const biz = userSettings.business_name || "our team";
        const link = userSettings.enquiry_form_url;

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
            subject: `Following up —" ${biz}`,
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
        processed++;
      }
    } catch (error) {
      console.error(`Error processing follow-up ${followUp.id}:`, error);
    }
  }

  return NextResponse.json({ processed, skipped, total: dueFollowUps.length });
}

async function cancelFollowUp(
  supabase: DB,
  followUpId: string
) {
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
