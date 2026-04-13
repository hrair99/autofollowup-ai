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
 * Returns only events we care about: text messages and lead-signal comments.
 */
export function normalizeWebhookEvents(body: RawWebhookBody): NormalizedWebhookEvent[] {
  const events: NormalizedWebhookEvent[] = [];

  if (body.object !== "page") return events;

  for (const entry of body.entry) {
    const pageId = entry.id;

    // --- Messenger events ---
    if (entry.messaging) {
      for (const event of entry.messaging) {
        // Text messages only (skip attachments, echoes, etc.)
        if (event.message?.text) {
          events.push({
            type: "message",
            pageId,
            senderId: event.sender.id,
            text: event.message.text,
            timestamp: event.timestamp,
            platformMessageId: event.message.mid,
          });
        }

        // Postback events (e.g. Get Started button)
        if (event.postback) {
          events.push({
            type: "message",
            pageId,
            senderId: event.sender.id,
            text: event.postback.title || event.postback.payload || "Get Started",
            timestamp: event.timestamp,
          });
        }
      }
    }

    // --- Feed / comment events ---
    if (entry.changes) {
      for (const change of entry.changes) {
        if (change.field !== "feed") continue;

        const val = change.value;

        // Only handle new comments (not edits/removes)
        if (val.item === "comment" && val.verb === "add" && val.message) {
          // Skip if the comment is from the page itself
          if (val.from.id === pageId) continue;

          events.push({
            type: "comment",
            pageId,
            senderId: val.from.id,
            text: val.message,
            timestamp: val.created_time ? val.created_time * 1000 : Date.now(),
            commentId: val.comment_id,
            postId: val.post_id,
            parentCommentId: val.parent_id !== val.post_id ? val.parent_id : undefined,
            isReply: val.parent_id !== val.post_id,
          });
        }
      }
    }
  }

  return events;
}

/**
 * Check if this is a valid Meta webhook verification request.
 */
export function verifyWebhook(
  mode: string | null,
  token: string | null,
  challenge: string | null,
  verifyToken: string
): { valid: boolean; challenge: string | null } {
  if (mode === "subscribe" && token === verifyToken) {
    return { valid: true, challenge };
  }
  return { valid: false, challenge: null };
}
