// ============================================
// Private Reply Service — Meta-compliant private messaging from comments
// Sends ONE private Messenger message tied to a comment ID
// ============================================

import { graphApi, getPageToken } from "./client";

export interface PrivateReplyResult {
  success: boolean;
  messageId: string | null;
  error: string | null;
  fallbackNeeded: boolean;
  errorCode: number | null;
}

/**
 * Send a single private reply to a Facebook comment author.
 *
 * Uses the Meta Private Replies API which allows pages to send
 * one private message to someone who commented on their post.
 *
 * Endpoint: POST /me/messages
 * Body: { recipient: { comment_id }, message: { text } }
 *
 * Constraints:
 * - Only ONE private reply per comment
 * - Must be sent within 7 days of the comment
 * - Commenter must not have blocked the page
 * - Not available for all comment types (e.g., some ad comments)
 */
export async function sendPrivateReply(
  commentId: string,
  message: string,
  pageId?: string
): Promise<PrivateReplyResult> {
  try {
    const token = getPageToken(pageId);
    if (!token) {
      console.error("[PrivateReply] No page token available");
      return {
        success: false,
        messageId: null,
        error: "No page access token configured",
        fallbackNeeded: true,
        errorCode: null,
      };
    }

    const result = await graphApi("/me/messages", {
      method: "POST",
      body: {
        recipient: { comment_id: commentId },
        message: { text: message },
      },
      token,
    }) as { message_id?: string };

    console.log(`[PrivateReply] Sent to comment ${commentId}: messageId=${result.message_id}`);

    return {
      success: true,
      messageId: result.message_id || null,
      error: null,
      fallbackNeeded: false,
      errorCode: null,
    };
  } catch (error: unknown) {
    const metaError = error as { status?: number; data?: { error?: { code?: number; message?: string; error_subcode?: number } } };
    const errorCode = metaError?.data?.error?.code || null;
    const errorSubcode = metaError?.data?.error?.error_subcode || null;
    const errorMessage = metaError?.data?.error?.message || String(error);

    console.error(`[PrivateReply] Failed for comment ${commentId}:`, errorMessage);

    // Determine if we should fall back to public reply
    const fallbackNeeded = shouldFallback(errorCode, errorSubcode);

    return {
      success: false,
      messageId: null,
      error: errorMessage,
      fallbackNeeded,
      errorCode,
    };
  }
}

/**
 * Check if a private reply has already been sent for a comment.
 * Prevents duplicate private replies.
 */
export async function hasPrivateReplyBeenSent(
  commentId: string,
  supabase: ReturnType<typeof import("@supabase/supabase-js").createClient>
): Promise<boolean> {
  const { data } = await supabase
    .from("comments")
    .select("private_reply_sent_at")
    .eq("comment_id", commentId)
    .single() as { data: { private_reply_sent_at: string | null } | null };

  return !!(data?.private_reply_sent_at);
}

/**
 * Build a private reply message for a lead signal comment.
 */
export function buildPrivateReplyMessage(options: {�        commenterName?: string;
  businessName: string;
  enquiryFormUrl?: string | null;
  customTemplate?: string | null;
  classification?: string;
}): string {
  const { commenterName, businessName, enquiryFormUrl, customTemplate, classification } = options;
  const name = commenterName?.split(" ")[0] || "there";

  // Use custom template if provided
  if (customTemplate) {
    return customTemplate
      .replace("{name}", name)
      .replace("{business}", businessName)
      .replace("{link}", enquiryFormUrl || "");
  }

  // Default templates based on classification
  if (enquiryFormUrl) {
    switch (classification) {
      case "pricing_request":
      case "quote_request":
        return `Hey ${name}! Thanks for your interest in ${businessName}. Best way to get a quote is to pop your details in here and we'll get back to you ASAP: ${enquiryFormUrl}`;
      case "booking_request":
        return `Hey ${name}! We'd love to help. You can book in through here and we'll get it sorted: ${enquiryFormUrl}`;
      case "support_request":
        return `Hey ${name}, sorry to hear that! Pop your details in here and we'll get someone onto it for you: ${enquiryFormUrl}`;
      default:
        return `Hey ${name}! Thanks for reaching out to ${businessName}. Happy to help — best way to get things moving is here: ${enquiryFormUrl}`;
    }
  }

  return `Hey ${name}! Thanks for reaching out to ${businessName}. Send us a message here and we'll help you out!`;
}

// ============================================
// Internal helpers
// ============================================

/**
 * Determine whether we should fall back to public reply based on error code.
 *
 * Common error codes:
 * - 10: Permission denied (need pages_messaging permission)
 * - 200: Permissions error
 * - 551: Private reply not available for this comment
 * - 2018028: Private replies not supported for this type of content
 * - 1545041: Comment is too old for private reply (>7 days)
 */
function shouldFallback(errorCode: number | null, errorSubcode: number | null): boolean {
  // If no error code, assume fallback needed
  if (!errorCode) return true;

  // These errors mean private reply is not possible ↔ fall back
  const fallbackCodes = [10, 200, 551, 1545041];
  const fallbackSubcodes = [2018028];

  if (fallbackCodes.includes(errorCode)) return true;
  if (errorSubcode && fallbackSubcodes.includes(errorSubcode)) return true;

  // Rate limiting ₔ don't fall back, just wait
  if (errorCode === 4 || errorCode === 17) return true;

  // Unknown error ↔ fall back to be safe
  return true;
}
