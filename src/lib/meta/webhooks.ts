// ============================================
// Meta Webhook Event Normalizer
// Handles both Messenger messaging events and feed (comment) events
// ============================================

import type { NormalizedWebhookEvent } from "../types";

interface RawWebhookBody {
  object: string;
  entry: RawEntry[];
}

interface RawEntry {
  id: string; // Page ID
  time: number;
  messaging?: RawMessagingEvent[];
  changes?: RawChangeEvent[];
}

interface RawMessagingEvent {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: {
    mid: string;
    text?: string;
    attachments?: unknown[];
  };
  postback?: {
    title: string;
    payload: string;
  };
}

interface RawChangeEvent {
  field: string;
  value: {
    item: string;        // "comment" | "post" | etc.
    verb: string;        // "add" | "edit" | "remove"
    comment_id?: string;
    post_id?: string;
    parent_id?: string;
    from: { id: string; name: string };
    message?: string;
    created_time?: number;
  };
}

/**
 * Normalize raw Meta webhook body into a flat array of events.
  
ee—U!O'urn to public fallback gracefully if private reply fails
  * 3. Always like the comment for engagement
 */
export async function handleCommentEngagement(
  commentId: string,
  privateMessage: string,
  publicReply: string,
  options: {
    pageId?: string;
    dmEnabled: boolean;
    autoReplyEnabled: boolean;
  }
) {
  const { pageId, dmEnabled, autoReplyEnabled } = options;

  // Always like the comment
  await likeComment(commentId, pageId);

  // Try private reply first if enabled
  if (dmEnabled) {
    const result = await sendPrivateReplyToComment(commentId, privateMessage, pageId);
    if (result.success) {
      return { action: "private_reply" };
    }
  }

  // Public reply fallback
  if (autoReplyEnabled) {
    try {
      await replyToComment(commentId, publicReply, pageId);
      return { action: "public_reply" };
    } catch (error) {
      console.error("Failed to post public reply:", error);
    }
  }

  return { action: "like_only" };
}
