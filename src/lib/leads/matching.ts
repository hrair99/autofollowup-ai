// ============================================
// Lead Matching Service
// Finds or creates leads from Facebook comments
// Links commenters to existing Messenger leads
// ============================================

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { getUserProfile } from "../meta/client";
import type { Lead } from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any, any, any>;

function getServiceClient(): DB {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// ============================================
// Types
// ============================================

export interface CommentLeadContext {
  pageId: string;
  postId: string;
  commentId: string;
  commenterPlatformId: string;
  commenterName?: string;
  source: "facebook_comment";
}

export interface LeadMatchResult {
  lead: Lead;
  isNew: boolean;
  wasMessengerLead: boolean;  // Was this person already a Messenger lead?
}

// ============================================
// Main matching function
// ============================================

/**
 * Find or create a lead from a Facebook comment.
 *
 * Matching priority:
 * 1. Match by platform_user_id (exact — same person, same page)
 * 2. Match by legacy email format (messenger_{id}@meta.local)
 * 3. Create new lead
 *
 * If matched to an existing Messenger lead, enriches with comment data.
 */
export async function findOrCreateCommentLead(
  ctx: CommentLeadContext
): Promise<LeadMatchResult | null> {
  const supabase = getServiceClient();
  const { pageId, postId, commentId, commenterPlatformId, commenterName } = ctx;

  // --- 1. Look up by platform_user_id ---
  let { data: existingLead } = await supabase
    .from("leads")
    .select("*")
    .eq("platform_user_id", commenterPlatformId)
    .single();

  if (existingLead) {
    const wasMessenger = existingLead.source === "messenger";

    // Update with comment info if this is a new comment source
    const updates: Record<string, unknown> = {
      last_comment_at: new Date().toISOString(),
      comment_count: (existingLead.comment_count || 0) + 1,
    };

    if (!existingLead.source_comment_id) {
      updates.source_comment_id = commentId;
      updates.source_post_id = postId;
    }
    if (!existingLead.first_comment_id) {
      updates.first_comment_id = commentId;
    }

    await supabase.from("leads").update(updates).eq("id", existingLead.id);

    return {
      lead: { ...existingLead, ...updates } as Lead,
      isNew: false,
      wasMessengerLead: wasMessenger,
    };
  }

  // --- 2. Legacy lookup by email ---
  const { data: legacyLead } = await supabase
    .from("leads")
    .select("*")
    .eq("email", `messenger_${commenterPlatformId}@meta.local`)
    .single();

  if (legacyLead) {
    // Migrate to platform_user_id
    const updates: Record<string, unknown> = {
      platform_user_id: commenterPlatformId,
      page_id: pageId,
      source_comment_id: commentId,
      source_post_id: postId,
      first_comment_id: commentId,
      last_comment_at: new Date().toISOString(),
      comment_count: 1,
    };

    await supabase.from("leads").update(updates).eq("id", legacyLead.id);

    return {
      lead: { ...legacyLead, ...updates } as Lead,
      isNew: false,
      wasMessengerLead: true,
    };
  }

  // --- 3. Create new lead ---
  // Find a user to assign
  const { data: users } = await supabase.auth.admin.listUsers();
  const assignedUserId = users?.users?.[0]?.id;

  if (!assignedUserId) {
    console.error("[LeadMatching] No users in system to assign lead to");
    return null;
  }

  // Try to get profile name from Meta
  let name = commenterName || `User ${commenterPlatformId.slice(-4)}`;
  if (!commenterName) {
    const profile = await getUserProfile(commenterPlatformId, pageId);
    if (profile) {
      name = `${profile.first_name} ${profile.last_name}`;
    }
  }

  const { data: newLead, error } = await supabase
    .from("leads")
    .insert({
      user_id: assignedUserId,
      name,
      email: `messenger_${commenterPlatformId}@meta.local`,
      platform_user_id: commenterPlatformId,
      page_id: pageId,
      source: "facebook_comment",
      source_post_id: postId,
      source_comment_id: commentId,
      first_comment_id: commentId,
      status: "new",
      conversion_stage: "new",
      qualification_data: {},
      comment_count: 1,
      last_comment_at: new Date().toISOString(),
      notes: `Facebook comment lead from post ${postId}.`,
    })
    .select()
    .single();

  if (error) {
    console.error("[LeadMatching] Error creating lead:", error);
    return null;
  }

  return {
    lead: newLead as Lead,
    isNew: true,
    wasMessengerLead: false,
  };
}

// ============================================
// Lead enrichment helpers
// ============================================

/**
 * Enrich a lead with classification data from a comment.
 */
export async function enrichLeadFromComment(
  leadId: string,
  data: {
    location?: string;
    serviceType?: string;
    urgency?: string;
    jobType?: string;
    confidence?: number;
    classification?: string;
  }
): Promise<void> {
  const supabase = getServiceClient();

  const updates: Record<string, unknown> = {};

  if (data.location) {
    updates.location_text = data.location;
    // Also merge into qualification_data
  }
  if (data.serviceType) {
    updates.detected_service_type = data.serviceType;
  }
  if (data.urgency && data.urgency !== "normal") {
    updates.urgency_level = data.urgency;
  }
  if (data.confidence) {
    updates.ai_confidence = data.confidence;
  }
  if (data.classification === "complaint") {
    updates.requires_human_review = true;
    updates.escalation_reason = "complaint_comment";
  }

  // Merge qualification data
  const { data: existingLead } = await supabase
    .from("leads")
    .select("qualification_data")
    .eq("id", leadId)
    .single();

  const qualData = existingLead?.qualification_data || {};
  if (data.location && !qualData.location) qualData.location = data.location;
  if (data.jobType && !qualData.job_type) qualData.job_type = data.jobType;
  if (data.serviceType && !qualData.service_type) qualData.service_type = data.serviceType;
  if (data.urgency && !qualData.urgency) qualData.urgency = data.urgency;
  updates.qualification_data = qualData;

  if (Object.keys(updates).length > 0) {
    await supabase.from("leads").update(updates).eq("id", leadId);
  }
}

/**
 * Check if we've already sent a private reply to this user.
 */
export async function hasUserReceivedPrivateReply(
  commenterPlatformId: string,
  pageId: string
): Promise<{ sent: boolean; lastSentAt: string | null; commentCount: number }> {
  const supabase = getServiceClient();

  const { data } = await supabase
    .from("comments")
    .select("private_reply_sent_at, comment_id")
    .eq("commenter_platform_id", commenterPlatformId)
    .eq("page_id", pageId)
    .not("private_reply_sent_at", "is", null)
    .order("created_at", { ascending: false })
    .limit(1);

  const { count } = await supabase
    .from("comments")
    .select("id", { count: "exact", head: true })
    .eq("commenter_platform_id", commenterPlatformId)
    .eq("page_id", pageId);

  return {
    sent: !!(data && data.length > 0),
    lastSentAt: data?.[0]?.private_reply_sent_at || null,
    commentCount: count || 0,
  };
}
