// ============================================
// Meta Messenger — Send messages, typing indicators
// ============================================

import { getPageToken, graphApi } from "./client";

/**
 * Send a text message via Messenger.
 * @param explicitToken - Pass a page access token directly (multi-tenant DB path).
 *                        If omitted, falls back to env-var lookup via getPageToken.
 */
export async function sendMessage(
  recipientId: string,
  text: string,
  pageId?: string,
  explicitToken?: string
): Promise<unknown> {
  const token = getPageToken(pageId, explicitToken);
  return graphApi("/me/messages", {
    method: "POST",
    body: {
      recipient: { id: recipientId },
      message: { text },
    },
    token,
  });
}

/**
 * Send a message with a button template (e.g., enquiry form link).
 */
export async function sendButtonMessage(
  recipientId: string,
  text: string,
  buttons: Array<{ type: "web_url"; url: string; title: string }>,
  pageId?: string
): Promise<unknown> {
  const token = getPageToken(pageId);
  return graphApi("/me/messages", {
    method: "POST",
    body: {
      recipient: { id: recipientId },
      message: {
        attachment: {
          type: "template",
          payload: {
            template_type: "button",
            text,
            buttons,
          },
        },
      },
    },
    token,
  });
}

/**
 * Send typing indicator.
 */
export async function sendTypingIndicator(
  recipientId: string,
  action: "typing_on" | "typing_off" = "typing_on",
  pageId?: string
): Promise<void> {
  const token = getPageToken(pageId);
  try {
    await graphApi("/me/messages", {
      method: "POST",
      body: {
        recipient: { id: recipientId },
        sender_action: action,
      },
      token,
    });
  } catch {
    // Non-critical — don't throw on typing indicator failure
  }
}
