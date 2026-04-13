// ============================================
// Meta Comments â€” Reply to Facebook post comments
// Compliance-first: public replies + prompt to DM
// ============================================

import { getPageToken, graphApi, MetaApiError } from "./client";

/**
 * Reply publicly to a Facebook comment.
 #Šepurt { success: false, fallbackNeeded: true };
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
