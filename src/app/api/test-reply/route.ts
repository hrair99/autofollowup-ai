// ============================================
// Test Reply Endpoint — Simulate the full AI pipeline without sending to Messenger.
// Protected by authenticated user session. Useful for Harrison to preview bot behaviour.
// ============================================

import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { classifyMessage } from "@/lib/ai/classify";
import { generateConstrainedReply } from "@/lib/ai/reply";
import { resolveNextAction } from "@/lib/conversation/actions";
import { resolveStageTransition, shouldSendEnquiryLink } from "@/lib/conversation/stages";
import { mergeQualificationData } from "@/lib/conversation/qualification";
import type { Lead, Settings, AiClassification, FaqEntry } from "@/lib/types";

interface TestReplyRequest {
  message: string;
  context?: string;
  simulatedStage?: string;
}

export async function POST(request: Request) {
  // Auth: logged-in user only
  const supabaseAuth = createServerSupabase();
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: TestReplyRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.message || typeof body.message !== "string") {
    return NextResponse.json({ error: "message field required" }, { status: 400 });
  }

  const message = body.message.slice(0, 1000);
  const conversationContext = body.context?.slice(0, 2000) || undefined;

  // Service-role client to read settings + FAQs without RLS issues
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Load the user's settings + FAQ entries
  const [settingsRes, faqRes] = await Promise.all([
    admin.from("settings").select("*").eq("user_id", user.id).single(),
    admin
      .from("faq_entries")
      .select("*")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .order("sort_order"),
  ]);

  const settings: Settings = settingsRes.data || defaultSettings(user.id);
  const faqEntries: FaqEntry[] = faqRes.data || [];

  // Build a throwaway "test" lead — never persisted
  const testLead: Lead = {
    id: "test-lead",
    user_id: user.id,
    business_id: null,
    name: "Test Lead",
    email: "test@example.local",
    phone: null,
    company: null,
    source: "messenger",
    status: "new",
    lead_score: null,
    handoff_active: false,
    conversion_stage: (body.simulatedStage as Lead["conversion_stage"]) || "new",
    qualification_data: {},
    platform_user_id: "test-platform-user",
    page_id: null,
    source_post_id: null,
    source_comment_id: null,
    notes: null,
    detected_service_type: null,
    location_text: null,
    urgency_level: "normal",
    booking_readiness: "unknown",
    enquiry_link_sent_at: null,
    enquiry_form_completed: false,
    ai_confidence: null,
    requires_human_review: false,
    escalation_reason: null,
    last_contacted_at: null,
    platform_thread_id: null,
    detected_job_type: null,
    first_comment_id: null,
    comment_count: 0,
    private_reply_count: 0,
    last_comment_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const pipeline = {
    classification: null as unknown,
    next_action: null as unknown,
    new_stage: null as unknown,
    sending_link: false,
    reply: "" as string,
    error: null as string | null,
    timings_ms: { classify: 0, reply: 0, total: 0 },
  };

  const t0 = Date.now();

  try {
    // 1. Classify
    const ct0 = Date.now();
    const classification = await classifyMessage(message, conversationContext);
    pipeline.timings_ms.classify = Date.now() - ct0;
    pipeline.classification = classification;

    // 2. Merge qualification + decide next action
    const updatedQual = mergeQualificationData(
      testLead.qualification_data || {},
      classification.entities,
      classification as AiClassification
    );

    const nextAction = resolveNextAction({
      lead: { ...testLead, qualification_data: updatedQual },
      settings,
      classification: classification as AiClassification,
      messageCount: 1,
    });
    pipeline.next_action = nextAction;

    const sendingLink = shouldSendEnquiryLink(
      { ...testLead, qualification_data: updatedQual },
      classification.intent
    );
    pipeline.sending_link = sendingLink;

    const newStage = resolveStageTransition(
      testLead.conversion_stage,
      classification.intent,
      sendingLink
    );
    pipeline.new_stage = newStage;

    // 3. Generate constrained reply (but don't send)
    const rt0 = Date.now();
    const reply = await generateConstrainedReply({
      lead: { ...testLead, qualification_data: updatedQual, conversion_stage: newStage },
      settings,
      incomingMessage: message,
      classification: classification as AiClassification,
      recentMessages: [],
      nextAction,
      faqEntries,
      shouldIncludeEnquiryLink: sendingLink,
    });
    pipeline.timings_ms.reply = Date.now() - rt0;
    pipeline.reply = reply;
  } catch (e) {
    pipeline.error = String(e);
  }

  pipeline.timings_ms.total = Date.now() - t0;

  return NextResponse.json({
    input: { message, context: conversationContext || null },
    pipeline,
    settings_used: {
      business_name: settings.business_name,
      ai_tone: settings.ai_tone,
      service_type: settings.service_type,
      enquiry_form_url: settings.enquiry_form_url,
      first_reply_behaviour: settings.first_reply_behaviour,
      faq_count: faqEntries.length,
    },
  });
}

function defaultSettings(userId: string): Settings {
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
    business_description: "HVAC / Air Conditioning company based in Australia",
    signature: null,
    service_type: "HVAC",
    service_areas: [],
    service_categories: ["installation", "repairs", "maintenance", "servicing", "split systems", "ducted systems"],
    callout_fee: null,
    quote_policy: null,
    emergency_available: false,
    after_hours_available: false,
    operating_hours: null,
    enquiry_form_url:
      "https://book.servicem8.com/request_service_online_booking?strVendorUUID=2eec0c0d-dbd4-4b52-aaf6-22f38ff2175b#5990b36a-64bd-4aa9-9e5b-23f620791f6b",
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
