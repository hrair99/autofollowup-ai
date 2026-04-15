// ============================================
// Private Reply Guard — preflight before we DM a commenter
//
// Centralises all "can we DM this person?" logic so the commentHandler
// never silently drops decisions. Every call returns a structured reason
// that's written into automation_logs.decision_trace.
// ============================================

import type { Settings } from "../types";
import type { FetchedComment } from "../meta/commentFetch";
import type { RuleIntentResult } from "./rulesClassifier";

export type GuardAction =
  | "send_private_reply"
  | "public_reply_only"
  | "escalate_to_human"
  | "ignore";

export interface LeadHistory {
  sent: boolean;                 // has this user received a DM before
  lastSentAt: string | null;
  commentCount: number;
  actionsOnThisComment: number;  // dedupe: already acted on this exact comment
}

export interface GuardInput {
  comment: {
    id: string;
    text: string;
    senderId: string | null;
    pageId: string;
    createdAtMs: number;
    canReplyPrivately?: boolean; // from Graph if fetched, undefined if unknown
  };
  settings: Settings;
  leadHistory: LeadHistory;
  rule: RuleIntentResult;
}

export interface GuardResult {
  allowed: boolean;
  action: GuardAction;
  reason: string;
  fallbackAction: GuardAction;
  trace: Record<string, unknown>;
}

const DEFAULT_USER_COOLDOWN_HOURS = 24;
const DEFAULT_MAX_ACTIONS_PER_COMMENT = 1;

/**
 * canSendPrivateReply — single source of truth for DM eligibility.
 *
 * Order of checks:
 *   1. Feature switches (monitoring enabled, private_reply_enabled)
 *   2. Spam / low-signal → ignore
 *   3. Dedupe — already actioned this comment
 *   4. Graph says can_reply_privately === false → public fallback or escalate
 *   5. User cooldown — already DMed recently → ignore (or public-only)
 *   6. Missing sender id → public-only fallback
 *   7. Default: allowed
 */
export function canSendPrivateReply(input: GuardInput): GuardResult {
  const { comment, settings, leadHistory, rule } = input;
  const trace: Record<string, unknown> = {
    comment_id: comment.id,
    rule_intent: rule.intent,
    rule_confidence: rule.confidence,
    rule_is_spam: rule.isSpam,
    has_sender: !!comment.senderId,
    can_reply_privately: comment.canReplyPrivately,
    previous_dm_sent: leadHistory.sent,
    last_sent_at: leadHistory.lastSentAt,
    actions_on_this_comment: leadHistory.actionsOnThisComment,
  };

  // 1. Feature switches
  if (settings.comment_monitoring_enabled === false) {
    return deny("comment_monitoring_disabled", "ignore", trace);
  }
  if (settings.private_reply_enabled === false) {
    // Public-only world
    return {
      allowed: false,
      action: settings.public_reply_enabled === false ? "ignore" : "public_reply_only",
      reason: "private_reply_disabled_in_settings",
      fallbackAction: "public_reply_only",
      trace,
    };
  }

  // 2. Spam / low-signal
  if (rule.isSpam) {
    return deny("classified_as_spam", "ignore", trace);
  }
  if (rule.intent === "low_signal") {
    return deny("low_signal_comment", "ignore", trace);
  }

  // 3. Dedupe — per comment
  const maxPerComment =
    settings.comment_max_actions_per_comment ?? DEFAULT_MAX_ACTIONS_PER_COMMENT;
  if (leadHistory.actionsOnThisComment >= maxPerComment) {
    return deny("already_actioned_comment", "ignore", trace);
  }

  // 4. Graph eligibility
  if (comment.canReplyPrivately === false) {
    return {
      allowed: false,
      action: settings.public_reply_enabled === false ? "escalate_to_human" : "public_reply_only",
      reason: "graph_can_reply_privately_false",
      fallbackAction: "public_reply_only",
      trace,
    };
  }

  // 5. User cooldown
  const cooldownHours =
    settings.comment_user_cooldown_hours ?? DEFAULT_USER_COOLDOWN_HOURS;
  if (leadHistory.sent && leadHistory.lastSentAt) {
    const last = new Date(leadHistory.lastSentAt).getTime();
    const ageHours = (Date.now() - last) / 3_600_000;
    if (ageHours < cooldownHours) {
      (trace as Record<string, unknown>).cooldown_age_hours = ageHours;
      return {
        allowed: false,
        action: "ignore",
        reason: "user_in_cooldown",
        fallbackAction: "public_reply_only",
        trace,
      };
    }
  }

  // 6. No sender — cannot DM
  if (!comment.senderId) {
    return {
      allowed: false,
      action: settings.public_reply_enabled === false ? "ignore" : "public_reply_only",
      reason: "missing_sender_id",
      fallbackAction: "public_reply_only",
      trace,
    };
  }

  // 7. Allowed
  return {
    allowed: true,
    action: "send_private_reply",
    reason: "ok",
    fallbackAction: "public_reply_only",
    trace,
  };
}

function deny(
  reason: string,
  action: GuardAction,
  trace: Record<string, unknown>
): GuardResult {
  return {
    allowed: false,
    action,
    reason,
    fallbackAction: "public_reply_only",
    trace,
  };
}
