// ============================================
// Comment Decision Engine
// Determines what action to take for each classified comment
// ============================================

import type { CommentClassificationResult } from "../ai/commentClassifier";

// ============================================
// Types
// ============================================

export type CommentAction =
  | "send_private_reply"
  | "public_reply_only"
  | "public_reply_and_wait"
  | "ignore"
  | "escalate_to_human";

export interface CommentDecisionContext {
  classification: CommentClassificationResult;
  // Lead state
  hasExistingLead: boolean;
  existingLeadStatus?: string;
  previousPrivateReplySent: boolean;
  previousCommentCount: number;
  // Settings
  privateReplyEnabled: boolean;
  publicReplyEnabled: boolean;
  confidenceThreshold: number;       // Minimum confidence to act (default 0.4)
  escalationThreshold: number;       // Confidence for complaints that need escalation
  commentCooldownMinutes: number;    // Min time between replies to same user
  // Timing
  lastReplyToUserAt: string | null;  // ISO timestamp
  commentAge: number;                // Minutes since comment was posted
  // Comment metadata
  isReply: boolean;                  // Is this a reply to another comment?
  isFromPage: boolean;               // Is this from the page itself?
}

export interface CommentDecision {
  action: CommentAction;
  reasoning: string;
  shouldCreateLead: boolean;
  shouldUpdateLead: boolean;
  priority: "high" | "medium" | "low" | "skip";
}

// ============================================
// Decision Engine
// ============================================

export function decideCommentAction(ctx: CommentDecisionContext): CommentDecision {
  const { classification, isFromPage, isReply } = ctx;

  // --- Skip: page's own comments ---
  if (isFromPage) {
    return {
      action: "ignore",
      reasoning: "Comment is from the page itself",
      shouldCreateLead: false,
      shouldUpdateLead: false,
      priority: "skip",
    };
  }

  // --- Skip: non-lead classifications with high confidence ---
  if (classification.classification === "non_lead" && classification.confidence >= 0.8) {
    return {
      action: "ignore",
      reasoning: "High-confidence non-lead classification",
      shouldCreateLead: false,
      shouldUpdateLead: false,
      priority: "skip",
    };
  }

  // --- Skip: spam ---
  if (classification.classification === "spam") {
    return {
      action: "ignore",
      reasoning: "Spam detected",
      shouldCreateLead: false,
      shouldUpdateLead: false,
      priority: "skip",
    };
  }

  // --- Escalate: complaints ---
  if (classification.classification === "complaint") {
    return {
      action: "escalate_to_human",
      reasoning: "Complaint detected — requires human review",
      shouldCreateLead: false,
      shouldUpdateLead: ctx.hasExistingLead,
      priority: "high",
    };
  }

  // --- Skip: below confidence threshold ---
  if (classification.confidence < ctx.confidenceThreshold) {
    return {
      action: "ignore",
      reasoning: `Confidence ${classification.confidence.toFixed(2)} below threshold ${ctx.confidenceThreshold}`,
      shouldCreateLead: false,
      shouldUpdateLead: false,
      priority: "skip",
    };
  }

  // --- Cooldown check: don't spam the same user ---
  if (ctx.lastReplyToUserAt) {
    const lastReplyTime = new Date(ctx.lastReplyToUserAt).getTime();
    const cooldownMs = ctx.commentCooldownMinutes * 60 * 1000;
    if (Date.now() - lastReplyTime < cooldownMs) {
      return {
        action: "ignore",
        reasoning: `Cooldown active — last reply ${Math.round((Date.now() - lastReplyTime) / 60000)}m ago`,
        shouldCreateLead: false,
        shouldUpdateLead: ctx.hasExistingLead,
        priority: "skip",
      };
    }
  }

  // --- Comment is too old for private reply (>7 days) ---
  if (ctx.commentAge > 7 * 24 * 60) {
    if (!classification.is_lead_signal) {
      return {
        action: "ignore",
        reasoning: "Comment too old and not a lead signal",
        shouldCreateLead: false,
        shouldUpdateLead: false,
        priority: "skip",
      };
    }
    // Still a lead signal but too old for private reply
    return {
      action: ctx.publicReplyEnabled ? "public_reply_only" : "ignore",
      reasoning: "Lead signal but comment too old for private reply",
      shouldCreateLead: !ctx.hasExistingLead,
      shouldUpdateLead: ctx.hasExistingLead,
      priority: "low",
    };
  }

  // --- Not a lead signal ---
  if (!classification.is_lead_signal) {
    // Reply to comment threads if it's a direct reply to a page comment
    if (isReply && classification.classification === "unclear") {
      return {
        action: ctx.publicReplyEnabled ? "public_reply_and_wait" : "ignore",
        reasoning: "Reply to page comment — unclear intent, acknowledge publicly",
        shouldCreateLead: false,
        shouldUpdateLead: ctx.hasExistingLead,
        priority: "low",
      };
    }

    return {
      action: "ignore",
      reasoning: "Not classified as a lead signal",
      shouldCreateLead: false,
      shouldUpdateLead: false,
      priority: "skip",
    };
  }

  // ============================================
  // LEAD SIGNAL DETECTED — Decide reply strategy
  // ============================================

  // Already sent a private reply for a previous comment
  if (ctx.previousPrivateReplySent) {
    // Don't send another private reply, but maybe a public acknowledgment
    if (ctx.publicReplyEnabled && ctx.previousCommentCount <= 3) {
      return {
        action: "public_reply_only",
        reasoning: "Lead signal but private reply already sent — public acknowledgment only",
        shouldCreateLead: false,
        shouldUpdateLead: true,
        priority: "medium",
      };
    }
    return {
      action: "ignore",
      reasoning: "Lead signal but private reply already sent and multiple comments",
      shouldCreateLead: false,
      shouldUpdateLead: true,
      priority: "low",
    };
  }

  // High-confidence lead signal — try private reply
  if (classification.confidence >= 0.7 && ctx.privateReplyEnabled) {
    return {
      action: "send_private_reply",
      reasoning: `High-confidence ${classification.classification} (${classification.confidence.toFixed(2)}) — sending private reply`,
      shouldCreateLead: !ctx.hasExistingLead,
      shouldUpdateLead: ctx.hasExistingLead,
      priority: "high",
    };
  }

  // Medium-confidence lead signal — public reply and wait
  if (classification.confidence >= ctx.confidenceThreshold) {
    if (ctx.privateReplyEnabled && !isReply) {
      // Still try private reply for direct comments even at medium confidence
      return {
        action: "send_private_reply",
        reasoning: `Medium-confidence ${classification.classification} (${classification.confidence.toFixed(2)}) — trying private reply`,
        shouldCreateLead: !ctx.hasExistingLead,
        shouldUpdateLead: ctx.hasExistingLead,
        priority: "medium",
      };
    }

    if (ctx.publicReplyEnabled) {
      return {
        action: "public_reply_and_wait",
        reasoning: `Medium-confidence lead signal — public reply to engage`,
        shouldCreateLead: !ctx.hasExistingLead,
        shouldUpdateLead: ctx.hasExistingLead,
        priority: "medium",
      };
    }
  }

  // Fallback
  return {
    action: ctx.publicReplyEnabled ? "public_reply_only" : "ignore",
    reasoning: "Lead signal detected but conditions not met for private reply",
    shouldCreateLead: !ctx.hasExistingLead && classification.is_lead_signal,
    shouldUpdateLead: ctx.hasExistingLead,
    priority: "low",
  };
}
