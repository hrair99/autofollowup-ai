// ============================================
// Comment Decision Engine
// Determines what action to take for each classified comment.
//
// Confidence Tiers:
//   > highThreshold (0.85): Full auto — reply + DM
//   > safeThreshold (0.60): Safe auto — reply + DM (conservative templates)
//   < safeThreshold:        No reply — create lead + alert only
// ============================================

import type { CommentClassificationResult } from "../ai/commentClassifier";

// ============================================
// Types
// ============================================

export type CommentAction =
  | "send_private_reply"
  | "public_reply_only"
  | "public_reply_and_wait"
  | "create_lead_only"
  | "ignore"
  | "escalate_to_human";

export type ConfidenceTier = "high" | "safe" | "low";

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
  confidenceThreshold: number;       // Minimum confidence to act (default 0.4, legacy)
  escalationThreshold: number;       // Confidence for complaints that need escalation
  commentCooldownMinutes: number;    // Min time between replies to same user
  // Confidence tier thresholds (new)
  confidenceHighThreshold?: number;  // Default 0.85 — full auto
  confidenceSafeThreshold?: number;  // Default 0.60 — safe auto
  // Timing
  lastReplyToUserAt: string | null;  // ISO timestamp
  commentAge: number;                // Minutes since comment was posted
  // Comment metadata
  isReply: boolean;                  // Is this a reply to another comment?
  isFromPage: boolean;               // Is this from the page itself?
  // Mode
  mode?: "monitor" | "active";       // Business mode
}

export interface CommentDecision {
  action: CommentAction;
  reasoning: string;
  shouldCreateLead: boolean;
  shouldUpdateLead: boolean;
  priority: "high" | "medium" | "low" | "skip";
  confidenceTier: ConfidenceTier;
  needsManualReview?: boolean;
}

// ============================================
// Confidence Tier Helper
// ============================================

function getConfidenceTier(
  confidence: number,
  highThreshold: number,
  safeThreshold: number
): ConfidenceTier {
  if (confidence >= highThreshold) return "high";
  if (confidence >= safeThreshold) return "safe";
  return "low";
}

// ============================================
// Decision Engine
// ============================================

export function decideCommentAction(ctx: CommentDecisionContext): CommentDecision {
  const { classification, isFromPage, isReply } = ctx;
  const highThreshold = ctx.confidenceHighThreshold ?? 0.85;
  const safeThreshold = ctx.confidenceSafeThreshold ?? 0.60;
  const tier = getConfidenceTier(classification.confidence, highThreshold, safeThreshold);

  // --- Monitor mode: never take automated action ---
  if (ctx.mode === "monitor") {
    return {
      action: "create_lead_only",
      reasoning: "Business is in monitor mode — logging only, no automated replies",
      shouldCreateLead: classification.is_lead_signal && !ctx.hasExistingLead,
      shouldUpdateLead: ctx.hasExistingLead,
      priority: "low",
      confidenceTier: tier,
      needsManualReview: true,
    };
  }

  // --- Skip: page's own comments ---
  if (isFromPage) {
    return {
      action: "ignore",
      reasoning: "Comment is from the page itself",
      shouldCreateLead: false,
      shouldUpdateLead: false,
      priority: "skip",
      confidenceTier: tier,
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
      confidenceTier: tier,
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
      confidenceTier: tier,
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
      confidenceTier: tier,
      needsManualReview: true,
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
        confidenceTier: tier,
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
        confidenceTier: tier,
      };
    }
    return {
      action: ctx.publicReplyEnabled ? "public_reply_only" : "create_lead_only",
      reasoning: "Lead signal but comment too old for private reply",
      shouldCreateLead: !ctx.hasExistingLead,
      shouldUpdateLead: ctx.hasExistingLead,
      priority: "low",
      confidenceTier: tier,
    };
  }

  // --- Not a lead signal ---
  if (!classification.is_lead_signal) {
    if (isReply && classification.classification === "unclear") {
      return {
        action: ctx.publicReplyEnabled ? "public_reply_and_wait" : "ignore",
        reasoning: "Reply to page comment — unclear intent, acknowledge publicly",
        shouldCreateLead: false,
        shouldUpdateLead: ctx.hasExistingLead,
        priority: "low",
        confidenceTier: tier,
      };
    }

    return {
      action: "ignore",
      reasoning: "Not classified as a lead signal",
      shouldCreateLead: false,
      shouldUpdateLead: false,
      priority: "skip",
      confidenceTier: tier,
    };
  }

  // ============================================
  // LEAD SIGNAL DETECTED — Apply confidence tiers
  // ============================================

  // Already sent a private reply for a previous comment
  if (ctx.previousPrivateReplySent) {
    if (ctx.publicReplyEnabled && ctx.previousCommentCount <= 3) {
      return {
        action: "public_reply_only",
        reasoning: "Lead signal but private reply already sent — public acknowledgment only",
        shouldCreateLead: false,
        shouldUpdateLead: true,
        priority: "medium",
        confidenceTier: tier,
      };
    }
    return {
      action: "ignore",
      reasoning: "Lead signal but private reply already sent and multiple comments",
      shouldCreateLead: false,
      shouldUpdateLead: true,
      priority: "low",
      confidenceTier: tier,
    };
  }

  // === TIER: HIGH (>= 0.85) — Full auto: reply + DM ===
  if (tier === "high") {
    if (ctx.privateReplyEnabled) {
      return {
        action: "send_private_reply",
        reasoning: `HIGH confidence ${classification.classification} (${classification.confidence.toFixed(2)}) — full auto: reply + DM`,
        shouldCreateLead: !ctx.hasExistingLead,
        shouldUpdateLead: ctx.hasExistingLead,
        priority: "high",
        confidenceTier: "high",
      };
    }
    if (ctx.publicReplyEnabled) {
      return {
        action: "public_reply_only",
        reasoning: `HIGH confidence but private reply disabled — public reply only`,
        shouldCreateLead: !ctx.hasExistingLead,
        shouldUpdateLead: ctx.hasExistingLead,
        priority: "high",
        confidenceTier: "high",
      };
    }
    return {
      action: "create_lead_only",
      reasoning: `HIGH confidence but all replies disabled — creating lead only`,
      shouldCreateLead: !ctx.hasExistingLead,
      shouldUpdateLead: ctx.hasExistingLead,
      priority: "high",
      confidenceTier: "high",
    };
  }

  // === TIER: SAFE (>= 0.60) — Safe auto: reply + DM (with conservative templates) ===
  if (tier === "safe") {
    if (ctx.privateReplyEnabled && !isReply) {
      return {
        action: "send_private_reply",
        reasoning: `SAFE confidence ${classification.classification} (${classification.confidence.toFixed(2)}) — safe auto: reply + DM`,
        shouldCreateLead: !ctx.hasExistingLead,
        shouldUpdateLead: ctx.hasExistingLead,
        priority: "medium",
        confidenceTier: "safe",
      };
    }
    if (ctx.publicReplyEnabled) {
      return {
        action: "public_reply_and_wait",
        reasoning: `SAFE confidence — public reply to engage, waiting for response`,
        shouldCreateLead: !ctx.hasExistingLead,
        shouldUpdateLead: ctx.hasExistingLead,
        priority: "medium",
        confidenceTier: "safe",
      };
    }
    return {
      action: "create_lead_only",
      reasoning: `SAFE confidence but replies disabled — creating lead only`,
      shouldCreateLead: !ctx.hasExistingLead,
      shouldUpdateLead: ctx.hasExistingLead,
      priority: "medium",
      confidenceTier: "safe",
    };
  }

  // === TIER: LOW (< 0.60) — No reply: create lead + alert ===
  return {
    action: "create_lead_only",
    reasoning: `LOW confidence ${classification.classification} (${classification.confidence.toFixed(2)}) — no auto-reply, creating lead + alert for manual review`,
    shouldCreateLead: !ctx.hasExistingLead && classification.is_lead_signal,
    shouldUpdateLead: ctx.hasExistingLead,
    priority: "low",
    confidenceTier: "low",
    needsManualReview: true,
  };
}
