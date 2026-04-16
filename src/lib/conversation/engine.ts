// ============================================
// Conversation Engine — Main Orchestrator
// classify → inspect state → pick action → generate reply
// ============================================

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { classifyMessage } from "../ai/classify";
import { generateConstrainedReply } from "../ai/reply";
import { resolveNextAction, containsEscalationKeyword } from "./actions";
import { resolveStageTransition, shouldSendEnquiryLink, stageToLeadStatus } from "./stages";
import { mergeQualificationData } from "./qualification";
import { sendMessage, sendTypingIndicator } from "../meta/messenger";
import { getUserProfile } from "../meta/client";
import { scheduleNextFollowUp } from "./followUpScheduler";
import {
  type BusinessContext,
  loadBusinessSettings,
  resolveBusinessByPage,
} from "../business/resolve";
import type {
  Lead,
  Settings,
  Message,
  FaqEntry,
  AiClassification,
  NormalizedWebhookEvent,
  ConversationResult,
  QualificationData,
} from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any, any, any>;

function getServiceClient(): DB {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// ============================================
// MESSENGER MESSAGE HANDLER
// ============================================

export async function handleMessengerMessage(
  event: NormalizedWebhookEvent,
  bizCtx?: BusinessContext
): Promise<void> {
  const supabase = getServiceClient();
  const { pageId, senderId, text, timestamp, platformMessageId } = event;

  // Resolve business context if not provided
  if (!bizCtx) {
    bizCtx = (await resolveBusinessByPage(pageId)) ?? undefined;
  }
  const businessId = bizCtx?.businessId ?? null;

  console.log(`[Engine] Message on page ${pageId} from ${senderId} (biz=${businessId ?? "?"}): ${text}`);

  try {
    // 1. Find or create lead
    const lead = await findOrCreateLead(supabase, senderId, pageId, undefined, businessId);
    if (!lead) return;

    // 2. Load settings + FAQ
    const { settings, faqEntries } = businessId
      ? await loadBusinessConfig(supabase, businessId)
      : await loadUserConfig(supabase, lead.user_id);

    // 3. Save inbound message
    const messageRecord = await saveMessage(supabase, {
      lead_id: lead.id,
      user_id: lead.user_id,
      direction: "inbound",
      channel: "messenger",
      channel_type: "messenger",
      body: text,
      platform_message_id: platformMessageId,
      sent_at: new Date(timestamp).toISOString(),
    });

    // 4. Check for first-reply behaviour
    if (settings.first_reply_behaviour === "disabled") {
      await logAutomation(supabase, lead.id, "message_received", "messenger", "no_reply", { reason: "auto_reply_disabled" });
      return;
    }

    // 5. Build conversation context
    const recentMessages = await getRecentMessages(supabase, lead.id);
    const conversationContext = recentMessages
      .slice(-6)
      .map((m) => `${m.direction === "inbound" ? "Customer" : "Bot"}: ${m.body}`)
      .join("\n");

    // 6. Classify the message
    const classification = await classifyMessage(text, conversationContext);

    // Save classification
    await saveClassification(supabase, messageRecord.id, lead.id, classification);

    // 7. Check escalation keywords
    if (containsEscalationKeyword(text, settings.escalation_keywords || [])) {
      classification.sentiment = "angry";
    }

    // 8. Merge qualification data
    const updatedQualData = mergeQualificationData(
      lead.qualification_data || {},
      classification.entities,
      classification as AiClassification
    );

    // 9. Resolve next action
    const nextAction = resolveNextAction({
      lead: { ...lead, qualification_data: updatedQualData },
      settings,
      classification: classification as AiClassification,
      messageCount: recentMessages.length,
    });

    // 10. Determine stage transition
    const sendingLink = shouldSendEnquiryLink(
      { ...lead, qualification_data: updatedQualData },
      classification.intent
    );
    const newStage = resolveStageTransition(
      lead.conversion_stage,
      classification.intent,
      sendingLink || !!lead.enquiry_link_sent_at
    );

    // 11. Generate constrained reply
    await sendTypingIndicator(senderId, "typing_on", pageId);

    const replyText = await generateConstrainedReply({
      lead: { ...lead, qualification_data: updatedQualData, conversion_stage: newStage },
      settings,
      incomingMessage: text,
      classification: classification as AiClassification,
      recentMessages,
      nextAction,
      faqEntries,
      shouldIncludeEnquiryLink: sendingLink,
    });

    // 12. Send reply via Messenger
    await sendMessage(senderId, replyText, pageId);

    // 13. Save outbound message
    await saveMessage(supabase, {
      lead_id: lead.id,
      user_id: lead.user_id,
      direction: "outbound",
      channel: "messenger",
      channel_type: "messenger",
      body: replyText,
      intent: nextAction,
      ai_generated: true,
      sent_at: new Date().toISOString(),
    });

    // 14. Update lead
    const leadUpdate: Record<string, unknown> = {
      qualification_data: updatedQualData,
      conversion_stage: newStage,
      status: stageToLeadStatus(newStage),
      last_contacted_at: new Date().toISOString(),
      ai_confidence: classification.confidence,
    };

    if (classification.location_mention && !lead.location_text) {
      leadUpdate.location_text = classification.location_mention;
    }
    if (classification.service_type && !lead.detected_service_type) {
      leadUpdate.detected_service_type = classification.service_type;
    }
    if (classification.urgency !== "normal") {
      leadUpdate.urgency_level = classification.urgency;
    }
    if (classification.booking_readiness !== "unknown") {
      leadUpdate.booking_readiness = classification.booking_readiness;
    }
    if (sendingLink) {
      leadUpdate.enquiry_link_sent_at = new Date().toISOString();
    }
    if (nextAction === "escalate_to_human") {
      leadUpdate.requires_human_review = true;
      leadUpdate.escalation_reason = classification.sentiment === "angry" ? "angry_customer" : "low_confidence";
    }

    await supabase.from("leads").update(leadUpdate).eq("id", lead.id);

    // 15. Cancel pending follow-ups if they replied
    if (lead.status === "following_up" || lead.status === "contacted") {
      await supabase
        .from("follow_ups")
        .update({ status: "cancelled" })
        .eq("lead_id", lead.id)
        .eq("status", "pending");
    }

    // 16. Log stage transition
    if (newStage !== lead.conversion_stage) {
      await supabase.from("conversation_events").insert({
        lead_id: lead.id,
        event_type: "stage_transition",
        from_stage: lead.conversion_stage,
        to_stage: newStage,
        action: nextAction,
        metadata: { intent: classification.intent, confidence: classification.confidence },
      });
    }

    // 17. Schedule next follow-up (replaces the old "only on button press" flow)
    const scheduled = await scheduleNextFollowUp({
      supabase,
      lead: { ...lead, ...leadUpdate, conversion_stage: newStage } as Lead,
      settings,
      stageAfterTurn: newStage,
      botRepliedThisTurn: true,
    });

    // 18. Log automation
    await logAutomation(supabase, lead.id, "auto_reply", "messenger", nextAction, {
      intent: classification.intent,
      stage: newStage,
      confidence: classification.confidence,
      follow_up: scheduled,
    });

    console.log(
      `[Engine] Replied to ${senderId} | action=${nextAction} stage=${newStage} intent=${classification.intent} follow_up=${scheduled.action}:${scheduled.reason}`
    );
  } catch (error) {
    console.error("[Engine] Error handling message:", error);
    // Don't throw — return 200 to Meta so it doesn't retry
    await logAutomation(supabase, null, "error", "messenger", "failed", {
      senderId,
      error: String(error),
    });
  }
}

// ============================================
// COMMENT HANDLER (Legacy — delegates to commentHandler.ts)
// ============================================

import { handleComment } from "./commentHandler";

/**
 * @deprecated Use handleComment from commentHandler.ts directly.
 * Kept for backward compatibility.
 */
export async function handleCommentEvent(event: NormalizedWebhookEvent): Promise<void> {
  return handleComment(event);
}

// ============================================
// HELPER FUNCTIONS
// ============================================

async function findOrCreateLead(
  supabase: DB,
  platformUserId: string,
  pageId: string,
  extras?: { source?: string; source_post_id?: string; source_comment_id?: string },
  businessId?: string | null
): Promise<Lead | null> {
  // Look up by platform_user_id first (new way)
  // If we have a businessId, scope to that business to prevent cross-tenant matches
  let query = supabase
    .from("leads")
    .select("*")
    .eq("platform_user_id", platformUserId);

  if (businessId) {
    query = query.eq("business_id", businessId);
  }

  let { data: lead } = await query.maybeSingle();

  // Fallback: look up by legacy email format
  if (!lead) {
    let legacyQuery = supabase
      .from("leads")
      .select("*")
      .eq("email", `messenger_${platformUserId}@meta.local`);

    if (businessId) {
      legacyQuery = legacyQuery.eq("business_id", businessId);
    }

    const { data: legacyLead } = await legacyQuery.maybeSingle();

    if (legacyLead) {
      // Migrate legacy lead to use platform_user_id
      await supabase
        .from("leads")
        .update({ platform_user_id: platformUserId, page_id: pageId })
        .eq("id", legacyLead.id);
      lead = { ...legacyLead, platform_user_id: platformUserId, page_id: pageId };
    }
  }

  if (!lead) {
    // Fetch profile from Meta
    const profile = await getUserProfile(platformUserId, pageId);
    const name = profile
      ? `${profile.first_name} ${profile.last_name}`
      : `User ${platformUserId.slice(-4)}`;

    // Find a user to assign this lead to
    // Multi-tenant: use the business owner. Fallback: first user in system.
    let assignedUserId: string | undefined;
    if (businessId) {
      const { data: biz } = await supabase
        .from("businesses")
        .select("owner_id")
        .eq("id", businessId)
        .single();
      assignedUserId = biz?.owner_id;
    }
    if (!assignedUserId) {
      const { data: users } = await supabase.auth.admin.listUsers();
      assignedUserId = users?.users?.[0]?.id;
    }

    if (!assignedUserId) {
      console.error("[Engine] No users in system to assign lead to");
      return null;
    }

    const { data: newLead, error } = await supabase
      .from("leads")
      .insert({
        user_id: assignedUserId,
        business_id: businessId || null,
        name,
        email: `messenger_${platformUserId}@meta.local`,
        platform_user_id: platformUserId,
        page_id: pageId,
        source: extras?.source || "messenger",
        source_post_id: extras?.source_post_id || null,
        source_comment_id: extras?.source_comment_id || null,
        status: "new",
        conversion_stage: "new",
        qualification_data: {},
        notes: `Facebook ${extras?.source || "Messenger"} lead.`,
      })
      .select()
      .single();

    if (error) {
      console.error("[Engine] Error creating lead:", error);
      return null;
    }

    lead = newLead;
  }

  return (lead as unknown) as Lead;
}

async function loadUserConfig(
  supabase: DB,
  userId: string
): Promise<{ settings: Settings; faqEntries: FaqEntry[] }> {
  const [settingsResult, faqResult] = await Promise.all([
    supabase.from("settings").select("*").eq("user_id", userId).single(),
    supabase.from("faq_entries").select("*").eq("user_id", userId).eq("is_active", true).order("sort_order"),
  ]);

  const settings: Settings = settingsResult.data || getDefaultSettings(userId);
  const faqEntries: FaqEntry[] = faqResult.data || [];

  return { settings, faqEntries };
}

/**
 * Load settings + FAQ for a business (multi-tenant path).
 */
async function loadBusinessConfig(
  supabase: DB,
  businessId: string
): Promise<{ settings: Settings; faqEntries: FaqEntry[] }> {
  const [settingsResult, faqResult] = await Promise.all([
    supabase.from("settings").select("*").eq("business_id", businessId).maybeSingle(),
    supabase.from("faq_entries").select("*").eq("business_id", businessId).eq("is_active", true).order("sort_order"),
  ]);

  // Fall back to first user in business for defaults
  let userId = settingsResult.data?.user_id;
  if (!userId) {
    const { data: membership } = await supabase
      .from("user_businesses")
      .select("user_id")
      .eq("business_id", businessId)
      .eq("role", "owner")
      .maybeSingle();
    userId = membership?.user_id || "unknown";
  }

  const settings: Settings = settingsResult.data || getDefaultSettings(userId);
  const faqEntries: FaqEntry[] = faqResult.data || [];

  return { settings, faqEntries };
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
    enquiry_form_url: "https://book.servicem8.com/request_service_online_booking?strVendorUUID=2eec0c0d-dbd4-4b52-aaf6-22f38ff2175b#5990b36a-64bd-4aa9-9e5b-23f620791f6b",
    contact_email: "harrison@hrair.com.au",
    contact_phone: "0431 703 913",
    meta_page_id: null,
    meta_verify_token: null,
    comment_auto_reply: true,
    comment_reply_templates: [],
    dm_automation_enabled: true,
    escalation_keywords: [],
    // Comment automation v2
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

async function saveMessage(
  supabase: DB,
  msg: {
    lead_id: string;
    user_id: string;
    direction: string;
    channel: string;
    channel_type: string;
    body: string;
    platform_message_id?: string;
    intent?: string;
    ai_generated?: boolean;
    sent_at?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from("messages")
    .insert({
      lead_id: msg.lead_id,
      user_id: msg.user_id,
      direction: msg.direction,
      channel: msg.channel,
      channel_type: msg.channel_type,
      subject: null,
      body: msg.body,
      status: msg.direction === "outbound" ? "sent" : "delivered",
      platform_message_id: msg.platform_message_id || null,
      intent: msg.intent || null,
      ai_generated: msg.ai_generated || false,
      sent_at: msg.sent_at || new Date().toISOString(),
      metadata: msg.metadata || {},
    })
    .select("id")
    .single();

  if (error) {
    console.error("[Engine] Error saving message:", error);
    return { id: "" };
  }

  return data;
}

async function saveClassification(
  supabase: DB,
  messageId: string,
  leadId: string,
  classification: Awaited<ReturnType<typeof classifyMessage>>
): Promise<void> {
  if (!messageId) return;

  await supabase.from("ai_classifications").insert({
    message_id: messageId,
    lead_id: leadId,
    intent: classification.intent,
    urgency: classification.urgency,
    service_type: classification.service_type,
    location_mention: classification.location_mention,
    booking_readiness: classification.booking_readiness,
    pricing_sensitivity: classification.pricing_sensitivity,
    sentiment: classification.sentiment,
    entities: classification.entities,
    confidence: classification.confidence,
  });
}

async function getRecentMessages(
  supabase: DB,
  leadId: string
): Promise<Message[]> {
  const { data } = await supabase
    .from("messages")
    .select("*")
    .eq("lead_id", leadId)
    .order("sent_at", { ascending: true })
    .limit(10);

  return (data || []) as Message[];
}

async function logAutomation(
  supabase: DB,
  leadId: string | null,
  eventType: string,
  channel: string,
  action: string,
  details: Record<string, unknown>
): Promise<void> {
  try {
    await supabase.from("automation_logs").insert({
      lead_id: leadId,
      event_type: eventType,
      channel,
      action_taken: action,
      details,
      success: eventType !== "error",
      error_message: eventType === "error" ? String(details.error || "") : null,
    });
  } catch {
    // Non-critical — don't throw on log failure
  }
}
