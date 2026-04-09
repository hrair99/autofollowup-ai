import { createServerSupabase } from "@/lib/supabase/server";
import { generateFollowUp, generateInitialOutreach } from "@/lib/ai";
import { NextResponse } from "next/server";
import type { Lead, Settings, Message } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const supabase = createServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { leadId } = await request.json();

    // Get lead
    const { data: lead } = await supabase
      .from("leads")
      .select("*")
      .eq("id", leadId)
      .eq("user_id", user.id)
      .single();

    if (!lead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    // Get settings
    const { data: settings } = await supabase
      .from("settings")
      .select("*")
      .eq("user_id", user.id)
      .single();

    const userSettings: Settings = settings || {
      id: "",
      user_id: user.id,
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

    // Get previous messages
    const { data: messages } = await supabase
      .from("messages")
      .select("*")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: true });

    const typedMessages = (messages || []) as Message[];

    let result;
    if (typedMessages.length === 0) {
      result = await generateInitialOutreach(lead as Lead, userSettings);
    } else {
      const stepNumber = typedMessages.filter((m) => m.direction === "outbound").length + 1;
      result = await generateFollowUp(lead as Lead, userSettings, stepNumber, typedMessages);
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("AI generate error:", error);
    return NextResponse.json({ error: "Failed to generate" }, { status: 500 });
  }
}
