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
  confidenceThreshold: number;
  escalationThreshold: number;
  commentCooldownMinutes: number;
  // Timing
  lastReplyToUserAt: string | null;
  commentAge: number;
  // Comment metadata
  isReply: boolean;
  isFromPage: boolean;
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

  if (isFromPage) {
    return { action: "ignore", reasoning: "Comment is from the page itself", shouldCreateLead: false, shouldUpdateLead: false, priority: "skip" };
  }

  if (classification.classification === "non_lead" && classification.confidence >= 0.8) {
    return { action: "ignore", reasoning: "High-confidence non-lead classification", shouldCreateLead: false, shouldUpdateLead: false, priority: "skip" };
  }

  if (classification.classification === "spam") {
    return { action: "ignore", reasoning: "Spam detected", shouldCreateLead: false, shouldUpdateLead: false, priority: "skip" };
  }

  if (classification.classification === "complaint") {
    return { action: "escalate_to_human", reasoning: "Complaint detected", shouldCreateLead: false, shouldUpdateLead: ctx.hasExistingLead, priority: "high" };
  }

  if (classification.confidence < ctx.confidenceThreshold) {
    return { action: "ignore", reasoning: `Confidence below threshold`, shouldCreateLead: false, shouldUpdateLead: false, priority: "skip" };
  }

  if (ctx.lastReplyToUserAt) {
    const lastReplyTime = new Date(ctx.lastReplyToUserAt).getTime();
    const cooldownMs = ctx.commentCooldownMinutes * 60 * 1000;
    if (Date.now() - lastReplyTime < cooldownMs) {
      return { action: "ignore", reasoning: "Cooldown active", shouldCreateLead: false, shouldUpdateLead: ctx.hasExistingLead, priority: "skip" };
    }
  }

  if (ctx.commentAge > 7 * 24 * 60) {
    if (!classification.is_lead_signal) {
      return { action: "ignore", reasoning: "Comment too old", shouldCreateLead: false, shouldUpdateLead: false, priority: "skip" };
    }
    return { action: ctx.publicReplyEnabled ? "public_reply_only" : "ignore", reasoning: "Lead signal but too old for private reply", shouldCreateLead: !ctx.hasExistingLead, shouldUpdateLead: ctx.hasExistingLead, priority: "low" };
  }

  if (!classification.is_lead_signal) {
    if (isReply && classification.classification === "unclear") {
      return { action: ctx.publicReplyEnabled ? "public_reply_and_wait" : "ignore", reasoning: "Reply to page comment", shouldCreateLead: false, shouldUpdateLead: ctx.hasExistingLead, priority: "low" };
    }
    return { action: "ignore", reasoning: "Not a lead signal", shouldCreateLead: false, shouldUpdateLead: false, priority: "skip" };
  }

  if (ctx.previousPrivateReplySent) {
    if (ctx.publicReplyEnabled && ctx.previousCommentCount <= 3) {
      return { action: "public_reply_only", reasoning: "Private reply already sent", shouldCreateLead: false, shouldUpdateLead: true, priority: "medium" };
    }
    return { action: "ignore", reasoning: "Private reply already sent", shouldCreateLead: false, shouldUpdateLead: true, priority: "low" };
  }

  if (classification.confidence >= 0.7 && ctx.privateReplyEnabled) {
    return { action: "send_private_reply", reasoning: `High-confidence lead signal`, shouldCreateLead: !ctx.hasExistingLead, shouldUpdateLead: ctx.hasExistingLead, priority: "high" };
  }

  if (classification.confidence >= ctx.confidenceThreshold) {
    if (ctx.privateReplyEnabled && !isReply) {
      return { action: "send_private_reply", reasoning: "Medium-confidence lead signal", shouldCreateLead: !ctx.hasExistingLead, shouldUpdateLead: ctx.hasExistingLead, priority: "medium" };
    }
    if (ctx.publicReplyEnabled) {
      return { action: "public_reply_and_wait", reasoning: "Medium-confidence lead signal", shouldCreateLead: !ctx.hasExistingLead, shouldUpdateLead: ctx.hasExistingLead, priority: "medium" };
    }
  }

  return { action: ctx.publicReplyEnabled ? "public_reply_only" : "ignore", reasoning: "Lead signal detected but conditions not met for private reply", shouldCreateLead: !ctx.hasExistingLead && classification.is_lead_signal, shouldUpdateLead: ctx.hasExistingLead, priority: "low" };
}
