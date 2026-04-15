// ============================================
// Comment Handler — Full pipeline for Facebook comment automation
// Classify → Decide → Act → Store
// ============================================

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { classifyComment, quickLeadSignalCheck } from "../ai/commentClassifier";
import type { CommentClassificationResult } from "../ai/commentClassifier";
import { decideCommentAction } from "./commentDecisionEngine";
import type { CommentAction, CommentDecision } from "./commentDecisionEngine";
import { sendPrivateReply, buildPrivateReplyMessage } from "../meta/privateReplies";
import { postPublicReply, likeComment, getTemplateReply, generateAiPublicReply } from "../meta/publicReplies";
import { findOrCreateCommentLead, enrichLeadFromComment, hasUserReceivedPrivateReply } from "../leads/matching";
import type { NormalizedWebhookEvent, Settings } from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any, any, any>;

function getServiceClient(): DB {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// ============================================
// Main Comment Handler
// ============================================

export async function handleComment(event: NormalizedWebhookEvent): Promise<void> {
  const supabase = getServiceClient();
  const { pageId, senderId, text, commentId, postId, parentCommentId, isReply } = event;

  if (!commentId || !text) return;

  console.log(`[CommentHandler] Comment on page ${pageId}, post ${postId}, from ${senderId}: "${text.substring(0, 80)}"`);

  try {
    // --- 0. Check for duplicate processing ---
    const { data: existingComment } = await supabase
      .from("comments")
      .select("id")
      .eq("comment_id", commentId)
      .single();

    if (existingComment) {
      console.log(`[CommentHandler] Comment ${commentId} already processed, skipping`);
      return;
    }

    // --- 1. Load settings ---
    const settings = await loadSettings(supabase);
    if (!settings) {
      console.error("[CommentHandler] No settings found");
      return;
    }

    // Check if comment monitoring is enabled
    if (!settings.comment_monitoring_enabled && settings.comment_monitoring_enabled !== undefined) {
      console.log("[CommentHandler] Comment monitoring disabled");
      return;
    }

    // --- 2. Quick lead signal check (fast filter) ---
    const quickCheck = quickLeadSignalCheck(text, settings.comment_lead_keywords);

    // --- 3. Full classification ---
    const classification = await classifyComment(text, {
      skipAi: !quickCheck && text.length < 5, // Skip AI for very short non-matching comments
    });

    console.log(`[CommentHandler] Classification: ${classification.classification} (${classification.confidence.toFixed(2)}) method=${classification.method}`);

    // --- 4. Check existing lead state ---
    const userReplyHistory = senderId
      ? await hasUserReceivedPrivateReply(senderId, pageId)
      : { sent: false, lastSentAt: null, commentCount: 0 };

    // --- 5. Run decision engine ---
    const decision = decideCommentAction({
      classification,
      hasExistingLead: userReplyHistory.commentCount > 0,
      previousPrivateReplySent: userReplyHistory.sent,
      previousCommentCount: userReplyHistory.commentCount,
      privateReplyEnabled: settings.private_reply_enabled ?? true,
      publicReplyEnabled: settings.public_reply_enabled ?? true,
      confidenceThreshold: settings.comment_confidence_threshold ?? 0.4,
      escalationThreshold: settings.comment_escalation_threshold ?? 0.8,
      commentCooldownMinutes: settings.comment_cooldown_minutes ?? 5,
      lastReplyToUserAt: userReplyHistory.lastSentAt,
      commentAge: 0, // Fresh webhook, age is ~0
      isReply: isReply || false,
      isFromPage: false, // Already filtered in webhook normalizer
    });

    console.log(`[CommentHandler] Decision: ${decision.action} | ${decision.reasoning}`);

    // --- 6. Find/create user ID for DB storage ---
    const userId = await getAssignedUserId(supabase);
    if (!userId) {
      console.error("[CommentHandler] No user to assign to");
      return;
    }

    // --- 7. Store the comment record ---
    const commentRecord = await storeComment(supabase, {
      userId,
      pageId,
      postId: postId || "",
      commentId,
      parentCommentId,
      commenterPlatformId: senderId,
      commenterName: null, // Will be enriched from lead
      body: text,
      classification,
      decision,
      isReply: isReply || false,
      rawPayload: event,
    });

    // --- 8. Lead management ---
    let leadId: string | null = null;

    if (decision.shouldCreateLead && senderId) {
      const leadResult = await findOrCreateCommentLead({
        pageId,
        postId: postId || "",
        commentId,
        commenterPlatformId: senderId,
        source: "facebook_comment",
      });

      if (leadResult) {
        leadId = leadResult.lead.id;

        // Enrich lead with classification data
        await enrichLeadFromComment(leadId, {
          location: classification.location || undefined,
          serviceType: classification.service_type || undefined,
          urgency: classification.urgency || undefined,
          jobType: classification.entities.job_type || undefined,
          confidence: classification.confidence,
          classification: classification.classification,
        });

        // Update comment record with lead_id
        await supabase
          .from("comments")
          .update({ lead_id: leadId, commenter_name: leadResult.lead.name })
          .eq("id", commentRecord.id);

        // Log conversation event
        await supabase.from("conversation_events").insert({
          lead_id: leadId,
          event_type: leadResult.isNew ? "lead_created_from_comment" : "comment_received",
          channel: "facebook_comment",
          source_id: commentId,
          metadata: {
            post_id: postId,
            classification: classification.classification,
            confidence: classification.confidence,
            was_messenger_lead: leadResult.wasMessengerLead,
          },
        });
      }
    } else if (decision.shouldUpdateLead && senderId) {
      // Just find the existing lead and update
      const { data: existingLead } = await supabase
        .from("leads")
        .select("id")
        .eq("platform_user_id", senderId)
        .single();

      if (existingLead) {
        leadId = existingLead.id;
        await supabase
          .from("comments")
          .update({ lead_id: leadId })
          .eq("id", commentRecord.id);
      }
    }

    // --- 9. Execute the decided action ---
    await executeAction(supabase, {
      action: decision.action,
      commentId,
      postId: postId || "",
      pageId,
      senderId,
      text,
      classification,
      settings,
      leadId,
      commentRecordId: commentRecord.id,
    });

    // --- 10. Log automation ---
    await supabase.from("automation_logs").insert({
      lead_id: leadId,
      event_type: "comment_automation",
      channel: "facebook_comment",
      action_taken: decision.action,
      details: {
        comment_id: commentId,
        post_id: postId,
        classification: classification.classification,
        confidence: classification.confidence,
        method: classification.method,
        reasoning: decision.reasoning,
        priority: decision.priority,
      },
      success: true,
    });

    console.log(`[CommentHandler] Complete: action=${decision.action} lead=${leadId || "none"} classification=${classification.classification}`);
  } catch (error) {
    console.error("[CommentHandler] Error:", error);

    // Log error
    await supabase.from("automation_logs").insert({
      lead_id: null,
      event_type: "error",
      channel: "facebook_comment",
      action_taken: "failed",
      details: {
        comment_id: commentId,
        error: String(error),
      },
      success: false,
      error_message: String(error),
    });  // non-critical, ignore errors
  }
}

// ============================================
// Action Executor
// ============================================

async function executeAction(
  supabase: DB,
  ctx: {
    action: CommentAction;
    commentId: string;
    postId: string;
    pageId: string;
    senderId: string;
    text: string;
    classification: CommentClassificationResult;
    settings: Settings;
    leadId: string | null;
    commentRecordId: string;
  }
): Promise<void> {
  const { action, commentId, pageId, text, classification, settings, commentRecordId } = ctx;

  // Always like the comment for engagement
  await likeComment(commentId, pageId);

  switch (action) {
    case "send_private_reply": {
      // Build private reply message
      const privateMessage = buildPrivateReplyMessage({
        businessName: settings.business_name || "our team",
        enquiryFormUrl: settings.enquiry_form_url,
        classification: classification.classification,
        customTemplate: settings.private_reply_templates?.[0] || null,
      });

      // Send private reply
      const result = await sendPrivateReply(commentId, privateMessage, pageId);

      if (result.success) {
        // Update comment record
        await supabase
          .from("comments")
          .update({
            action_taken: "send_private_reply",
            private_reply_sent_at: new Date().toISOString(),
            private_reply_message_id: result.messageId,
          })
          .eq("id", commentRecordId);

        // Update lead private reply count
        if (ctx.leadId) {
          const { error: rpcError } = await supabase.rpc("increment_private_reply_count", { lead_id_param: ctx.leadId });
          if (rpcError) {
            // Fallback: just update directly
            await supabase
              .from("leads")
              .update({ private_reply_count: 1 })
              .eq("id", ctx.leadId!);
          }
        }

        // Also post a brief public reply to show engagement
        if (settings.public_reply_enabled) {
          const publicReply = getTemplateReply(classification.classification, {
            enquiryFormUrl: settings.enquiry_form_url,
            customTemplates: settings.comment_reply_templates,
            businessName: settings.business_name || undefined,
          });

          const publicResult = await postPublicReply(commentId, publicReply, pageId);
          if (publicResult.success) {
            await supabase
              .from("comments")
              .update({
                public_reply_sent_at: new Date().toISOString(),
                public_reply_comment_id: publicResult.commentId,
              })
              .eq("id", commentRecordId);
          }
        }
      } else if (result.fallbackNeeded) {
        // Private reply failed — fall back to public reply
        console.log(`[CommentHandler] Private reply failed, falling back to public reply`);
        await executePublicReply(supabase, ctx, commentRecordId);
      }
      break;
    }

    case "public_reply_only":
    case "public_reply_and_wait": {
      await executePublicReply(supabase, ctx, commentRecordId);
      break;
    }

    case "escalate_to_human": {
      // Update comment record
      await supabase
        .from("comments")
        .update({
          action_taken: "escalate_to_human",
          escalated_at: new Date().toISOString(),
          escalation_reason: `${classification.classification} (confidence: ${classification.confidence.toFixed(2)})`,
        })
        .eq("id", commentRecordId);

      // Mark lead for human review
      if (ctx.leadId) {
        await supabase
          .from("leads")
          .update({
            requires_human_review: true,
            escalation_reason: "comment_escalation",
          })
          .eq("id", ctx.leadId);
      }
      break;
    }

    case "ignore": {
      await supabase
        .from("comments")
        .update({ action_taken: "ignore" })
        .eq("id", commentRecordId);
      break;
    }
  }
}

async function executePublicReply(
  supabase: DB,
  ctx: {
    commentId: string;
    pageId: string;
    text: string;
    classification: CommentClassificationResult;
    settings: Settings;
    commentRecordId: string;
  },
  commentRecordId: string
): Promise<void> {
  const { commentId, pageId, text, classification, settings } = ctx;

  // Try AI-generated reply first, fall back to template
  let replyText = await generateAiPublicReply(text, {
    classification: classification.classification,
    businessName: settings.business_name || "our team",
    enquiryFormUrl: settings.enquiry_form_url,
    tone: settings.ai_tone,
  });

  if (!replyText) {
    replyText = getTemplateReply(classification.classification, {
      enquiryFormUrl: settings.enquiry_form_url,
      customTemplates: settings.comment_reply_templates,
      businessName: settings.business_name || undefined,
    });
  }

  const result = await postPublicReply(commentId, replyText, pageId);

  await supabase
    .from("comments")
    .update({
      action_taken: result.success ? "public_reply_only" : "public_reply_failed",
      public_reply_sent_at: result.success ? new Date().toISOString() : null,
      public_reply_comment_id: result.commentId,
    })
    .eq("id", commentRecordId);
}

// ============================================
// Storage helpers
// ============================================

async function storeComment(
  supabase: DB,
  data: {
    userId: string;
    pageId: string;
    postId: string;
    commentId: string;
    parentCommentId?: string;
    commenterPlatformId: string;
    commenterName: string | null;
    body: string;
    classification: CommentClassificationResult;
    decision: { action: string };
    isReply: boolean;
    rawPayload: unknown;
  }
): Promise<{ id: string }> {
  const { data: record, error } = await supabase
    .from("comments")
    .insert({
      user_id: data.userId,
      page_id: data.pageId,
      post_id: data.postId,
      comment_id: data.commentId,
      parent_comment_id: data.parentCommentId || null,
      commenter_platform_id: data.commenterPlatformId,
      commenter_name: data.commenterName,
      body: data.body,
      classification: data.classification.classification,
      confidence: data.classification.confidence,
      extracted_intent: data.classification.classification,
      extracted_service_type: data.classification.service_type,
      extracted_location: data.classification.location,
      extracted_urgency: data.classification.urgency,
      classification_metadata: {
        method: data.classification.method,
        reasoning: data.classification.reasoning,
        is_lead_signal: data.classification.is_lead_signal,
        entities: data.classification.entities,
      },
      action_taken: data.decision.action,
      is_reply: data.isReply,
      raw_payload: data.rawPayload,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[CommentHandler] Error storing comment:", error);
    return { id: "" };
  }

  return record;
}

async function loadSettings(supabase: DB): Promise<Settings | null> {
  const { data: users } = await supabase.auth.admin.listUsers();
  const userId = users?.users?.[0]?.id;
  if (!userId) return null;

  const { data } = await supabase
    .from("settings")
    .select("*")
    .eq("user_id", userId)
    .single();

  return data as Settings | null;
}

async function getAssignedUserId(supabase: DB): Promise<string | null> {
  const { data: users } = await supabase.auth.admin.listUsers();
  return users?.users?.[0]?.id || null;
}
