import { createServerSupabase } from "@/lib/supabase/server";
import { generateInitialOutreach } from "@/lib/ai";
import { groqChat } from "@/lib/ai/groq-client";
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

    const { data: lead } = await supabase
      .from("leads")
      .select("*")
      .eq("id", leadId)
      .eq("user_id", user.id)
      .single();

    if (!lead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    const { data: settings } = await supabase
      .from("settings")
      .select("*")
      .eq("user_id", user.id)
      .single();

    const userSettings = (settings || {}) as Partial<Settings>;

    const { data: messages } = await supabase
      .from("messages")
      .select("*")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: true });

    const typedMessages = (messages || []) as Message[];

    let result;
    if (typedMessages.length === 0) {
      result = await generateInitialOutreach(lead as Lead, {
        business_name: userSettings.business_name || null,
        business_description: userSettings.business_description || null,
        signature: userSettings.signature || null,
      });
    } else {
      // Generate follow-up using Groq
      const name = (lead as Lead).name.split(" ")[0];
      const biz = userSettings.business_name || "our team";

      const reply = await groqChat([
        {
          role: "system",
          content: `You are a helpful business assistant for ${biz}. Write a short follow-up email to ${name}. Be ${userSettings.ai_tone || "professional"} and concise.`,
        },
        {
          role: "user",
          content: `Write follow-up email #${typedMessages.filter((m) => m.direction === "outbound").length + 1} for ${name} from ${(lead as Lead).company || "unknown company"}.`,
        },
      ], { maxTokens: 300 });

      result = {
        subject: `Following up — ${biz}`,
        body: reply || `Hi ${name},\n\nJust following up on my previous message. Would love to chat when you get a chance.\n\n${userSettings.signature || biz}`,
      };
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("AI generate error:", error);
    return NextResponse.json({ error: "Failed to generate" }, { status: 500 });
  }
}
