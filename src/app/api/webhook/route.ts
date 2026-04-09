import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendMessage, sendTypingIndicator, getUserProfile } from "@/lib/meta";
import { generateFollowUp } from "@/lib/ai";
import type { Lead, Settings } from "@/lib/types";

const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN!;

// Service role client to bypass RLS (webhook has no user session)
function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// ============================================
// GET — Meta webhook verification
// ============================================
export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verified successfully");
    return new NextResponse(challenge);
  }

  return new NextResponse("Verification failed", { status: 403 });
}

// ============================================
// POST — Incoming messages from Messenger
// ============================================
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (body.object !== "page") {
      return NextResponse.json({ status: "ignored" });
    }

    const supabase = getServiceClient();

    for (const entry of body.entry) {
      if (!entry.messaging) continue;

      for (const event of entry.messaging) {
        if (!event.message || !event.message.text) continue;

        const senderId = event.sender.id;
        const messageText = event.message.text;
        const timestamp = event.timestamp;

        console.log(`Incoming message from ${senderId}: ${messageText}`);

        // ----------------------------------------
        // 1. Find or create the lead
        // ----------------------------------------
        let { data: lead } = await supabase
          .from("leads")
          .select("*")
          .eq("email", `messenger_${senderId}@meta.local`)
          .single();

        if (!lead) {
          // Fetch profile from Meta
          const profile = await getUserProfile(senderId);
          const name = profile
            ? `${profile.first_name} ${profile.last_name}`
            : `Messenger User ${senderId.slice(-4)}`;

          // Find a user to assign this lead to (first user in system for MVP)
          const { data: users } = await supabase.auth.admin.listUsers();
          const assignedUserId = users?.users?.[0]?.id;

          if (!assignedUserId) {
            console.error("No users in the system to assign lead to");
            continue;
          }

          const { data: newLead, error } = await supabase
            .from("leads")
            .insert({
              user_id: assignedUserId,
              name,
              email: `messenger_${senderId}@meta.local`,
              source: "messenger",
              status: "new",
              notes: `Facebook Messenger lead. Sender ID: ${senderId}`,
            })
            .select()
            .single();

          if (error) {
            console.error("Error creating lead:", error);
            continue;
          }

          lead = newLead;
        }

        // ----------------------------------------
        // 2. Save the inbound message
        // ----------------------------------------
        await supabase.from("messages").insert({
          lead_id: lead.id,
          user_id: lead.user_id,
          direction: "inbound",
          channel: "manual",
          subject: null,
          body: messageText,
          status: "delivered",
          sent_at: new Date(timestamp).toISOString(),
        });

        // ----------------------------------------
        // 3. Update lead status (they replied!)
        // ----------------------------------------
        if (lead.status === "following_up" || lead.status === "contacted") {
          await supabase
            .from("leads")
            .update({ status: "responded" })
            .eq("id", lead.id);

          // Cancel pending follow-ups
          await supabase
            .from("follow_ups")
            .update({ status: "cancelled" })
            .eq("lead_id", lead.id)
            .eq("status", "pending");
        }

        // ----------------------------------------
        // 4. Auto-reply with AI-generated message
        // ----------------------------------------
        const { data: settings } = await supabase
          .from("settings")
          .select("*")
          .eq("user_id", lead.user_id)
          .single();

        const userSettings: Settings = settings || {
          id: "",
          user_id: lead.user_id,
          max_follow_ups: 5,
          follow_up_interval_days: 3,
          stop_on_reply: true,
          ai_tone: "friendly",
          business_name: null,
          business_description: null,
          signature: null,
          created_at: "",
          updated_at: "",
        };

        // Show typing indicator
        await sendTypingIndicator(senderId);

        // Generate a reply
        const { body: replyBody } = await generateFollowUp(
          lead as Lead,
          userSettings,
          1,
          []
        );

        // Send the reply via Messenger
        await sendMessage(senderId, replyBody);

        // Save the outbound message
        await supabase.from("messages").insert({
          lead_id: lead.id,
          user_id: lead.user_id,
          direction: "outbound",
          channel: "manual",
          subject: null,
          body: replyBody,
          status: "sent",
          sent_at: new Date().toISOString(),
        });

        // Update last contacted
        await supabase
          .from("leads")
          .update({ last_contacted_at: new Date().toISOString() })
          .eq("id", lead.id);
      }
    }

    return NextResponse.json({ status: "ok" });
  } catch (error) {
    console.error("Webhook error:", error);
    return NextResponse.json({ status: "error" }, { status: 500 });
  }
}
