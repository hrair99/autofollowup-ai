// ============================================
// Graph API — Comment fetch helpers (fallback enrichment)
//
// These are *read-only* helpers used when an inbound webhook payload is
// missing fields we need for decisioning (e.g. empty message, missing
// from.id, or we want to check can_reply_privately fresh).
// Kept separate from src/lib/meta/comments.ts which handles *writes*.
// ============================================

import { getPageToken } from "./client";

const GRAPH = "https://graph.facebook.com/v25.0";

export interface FetchedComment {
  id: string;
  message?: string;
  created_time?: string;
  from?: { id: string; name?: string };
  parent?: { id: string };
  can_reply_privately?: boolean;
  can_hide?: boolean;
  can_like?: boolean;
  can_comment?: boolean;
}

export interface CommentEligibility {
  ok: boolean;
  canReplyPrivately: boolean;
  reason?: string;
  raw?: FetchedComment;
}

const COMMENT_FIELDS = [
  "id",
  "message",
  "created_time",
  "from",
  "parent",
  "can_reply_privately",
  "can_hide",
  "can_like",
  "can_comment",
].join(",");

/**
 * Fetch a comment by ID. Returns null if the call fails so callers can
 * degrade to whatever data they already have.
 */
export async function getCommentById(
  commentId: string,
  pageId?: string
): Promise<FetchedComment | null> {
  const token = getPageToken(pageId);
  if (!token) {
    console.warn("[commentFetch] No META_PAGE_TOKEN available");
    return null;
  }
  try {
    const res = await fetch(
      `${GRAPH}/${encodeURIComponent(commentId)}?fields=${COMMENT_FIELDS}&access_token=${token}`,
      { method: "GET" }
    );
    if (!res.ok) {
      console.warn(
        `[commentFetch] getCommentById ${commentId} failed: ${res.status}`
      );
      return null;
    }
    return (await res.json()) as FetchedComment;
  } catch (e) {
    console.error("[commentFetch] getCommentById error:", e);
    return null;
  }
}

/**
 * Check whether a comment is currently eligible for a private reply.
 * Prefer Graph's `can_reply_privately` — it reflects the 7-day window
 * and whether the commenter has already been privately replied to.
 */
export async function getCommentEligibility(
  commentId: string,
  pageId?: string
): Promise<CommentEligibility> {
  const c = await getCommentById(commentId, pageId);
  if (!c) {
    return { ok: false, canReplyPrivately: false, reason: "fetch_failed" };
  }
  const canReply = c.can_reply_privately !== false;
  return {
    ok: true,
    canReplyPrivately: canReply,
    reason: canReply ? undefined : "not_eligible_per_graph",
    raw: c,
  };
}
