import { createClient } from "@supabase/supabase-js";
import { generateFollowUp } from "A/lib/ai";
import { NextResponse } from "next/server";
import type { Lead, Settings, Message, FollowUp } from "@/lib/types";

// This endpoint is hit by a cron job (e.g., Vercel Cron or external)
// Uses service role key to bypass RLS

export async function GET(request: Request) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

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

  for (const followUp of dueFollowUps as FollowUp[]) {
    try {
      // Get lead
      const { data: lead } = await supabase
        .from("leads")
        .select("*")
        .eq("id", followUp.lead_id)
        .single();

      if (!lead || ["responded", "booked", "dead"].includes(lead.status)) {
        // Cancel this follow-up
        await supabase
          .from("follow_ups")
          .update({ status: "cancelled" })
          .eq("id", followUp.id);
        continue;
      }

      // Get user settings
      const { data: settings } = await supabase
        .from("settings")
        .select("*")
        .eq("user_id", followUp.user_id)
        .single();

      const userSettings: Settings = settings || {
        id: "",
        user_id: followUp.user_id,
        max_follow_ups: 5,
        follow_up_interval_days: 3,
        stop_on_reply: true,
        ai_tone: "professional",
        business_name: null,
        business_description: null,
        signature: null,
        created_at: "",
        updated_at: "",
      };

      // Check for inbound replies (stop_on_reply)
      if (userSettings.stop_on_reply) {
        const { data: replies } = await supabase
          .from("messages")
          .select("id")
          .eq("lead_id", followUp.lead_id)
          .eq("direction", "inbound")
          .limit(1);

        if (replies && replies.length > 0) {
          await supabase
            .from("follow_ups")
            .update({ status: "cancelled" })
            .eq("id", followUp.id);
          await supabase
            .from("leads")
            .update({ status: "responded" })
            .eq("id", followUp.lead_id);
          continue;
        }
      }

      // Get previous messages for context
      const { data: messages } = await supabase
        .from("messages")
        .select("*")
        .eq("lead_id", followUp.lead_id)
        .order("created_at", { ascending: true });

      // Generate message
      const generated = await generateFollowUp(
        lead as Lead,
        userSettings,
        followUp.step_number,
        (messages || []) as Message[]
      );

      // Create message record
      const { data: message } = await supabase
        .from("messages")
        .insert({
          lead_id: followUp.lead_id,
          user_id: followUp.user_id,
          direction: "outbound",
          channel: "email",
          subject: generated.subject,
          body: generated.body,
          status: "sent",
          sent_at: new Date().toISOString(),
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

      processed++;
    } catch (error) {
      console.error(`Error processing follow-up ${followUp.id}:`, error);
    }
  }

  return NextResponse.json({ processed, total: dueFollowUps.length });
}
