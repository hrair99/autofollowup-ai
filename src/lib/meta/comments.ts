// ============================================
// Meta Comments — Reply to Facebook post comments
// Compliance-first: public replies + prompt to DM
// ============================================

import { getPageToken, graphApi, MetaApiError } from "./client";

/**
 * Reply publicly to a Facebook comment.
 */
export async function replyToComment(
  commentId: string,
  message: string,
  pageId?: string
): Promise<unknown> {
  const token = getPageToken(pageId);
  return graphApi(`/${commentId}/comments`, {
    method: "POST",
    body: { message },
    token,
  });
}

/**
 * Like a comment (shows engagement).
 */
export async function likeComment(
  commentId: string,
  pageId?: string
): Promise<void> {
  const token = getPageToken(pageId);
  try {
    await graphApi(`/${commentId}/likes`, {
      method: "POST",
      body: {},
      token,
    });
  } catch {
    // Non-critical
  }
}

/**
 * Send a private reply to a comment author via Messenger.
 * This uses Meta's "Private Replies" API which is available for
 * Page conversations initiated from comments.
 *
 * IMPORTANT: This only works when Meta permissions allow it.
 * Falls back gracefully if not permitted.
 */
export async function sendPrivateReplyToComment(
  commentId: string,
  message: string,
  pageId?: string
): Promise<{ success: boolean; fallbackNeeded: boolean }> {
  const token = getPageToken(pageId);

  try {
    await graphApi("/me/messages", {
      method: "POST",
      body: {
        recipient: { comment_id: commentId },
        message: { text: message },
      },
      token,
    });
    return { success: true, fallbackNeeded: false };
  } catch (error) {
    if (error instanceof MetaApiError) {
      // Error code 10 or similar = not permitted
      console.warn("Private reply not permitted for this comment, using public fallback");
      return { success: false, fallbackNeeded: true };
    }
    throw error;
  }
}

/**
 * Handle a comment with the compliance-safe strategy:
 * 1. Try private reply if DM automation is enabled
 * 2. Fall back to public reply if private reply fails
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
): Promise<{ action: "private_reply" | "public_reply" | "like_only" }> {
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
