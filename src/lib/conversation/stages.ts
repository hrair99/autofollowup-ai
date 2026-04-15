// ============================================
// Conversion Stage Definitions + Transitions
// ============================================

import type { ConversionStage, Intent, Lead } from "../types";

/**
 * Stage transition rules. Given a current stage and intent, determine the next stage.
 */
export function resolveStageTransition(
  currentStage: ConversionStage,
  intent: Intent,
  hasEnquiryLinkBeenSent: boolean
): ConversionStage {
  switch (currentStage) {
    case "new":
      // Any real engagement moves to "engaged"
      if (intent === "spam" || intent === "not_interested") return "dead";
      return "engaged";

    case "engaged":
      // Once we know enough, they're qualified
      if (intent === "booking_request" || intent === "quote_request") return "qualified";
      if (intent === "not_interested") return "dead";
      return "engaged"; // Stay engaged until qualified

    case "qualified":
      if (hasEnquiryLinkBeenSent) return "link_sent";
      if (intent === "not_interested") return "dead";
      return "qualified";

    case "link_sent":
      // Waiting for them to complete the form
      if (intent === "follow_up_reply" || intent === "booking_request") return "awaiting_form";
      if (intent === "not_interested") return "dead";
      return "awaiting_form"; // Assume any reply after link = awaiting form

    case "awaiting_form":
      if (intent === "not_interested") return "dead";
      return "awaiting_form"; // Stays until manually marked booked

    case "booked":
      return "booked"; // Terminal

    case "dead":
      // Can be revived if they message again
      if (intent !== "spam") return "engaged";
      return "dead";

    default:
      return currentStage;
  }
}

/**
 * Check if the lead has been qualified (enough info collected).
 */
export function isQualified(lead: Lead): boolean {
  const q = lead.qualification_data || {};
  // Need at least location and job type for basic qualification
  return !!(q.location && q.job_type);
}

/**
 * Check if it's appropriate to send the enquiry link now.
 */
export function shouldSendEnquiryLink(
  lead: Lead,
  intent: Intent
): boolean {
  // Don't re-send if already sent recently (within 24h)
  if (lead.enquiry_link_sent_at) {
    const hoursSinceSent =
      (Date.now() - new Date(lead.enquiry_link_sent_at).getTime()) / (1000 * 60 * 60);
    if (hoursSinceSent < 24) return false;
  }

  // Send when they're ready
  const readyIntents: Intent[] = [
    "booking_request",
    "quote_request",
    "install_request",
  ];

  if (readyIntents.includes(intent)) return true;

  // Send if they're qualified and haven't received it yet
  if (isQualified(lead) && !lead.enquiry_link_sent_at) return true;

  // Send if they explicitly want to book / get a quote
  if (lead.booking_readiness === "ready") return true;

  return false;
}

/**
 * Map conversion stage to lead status for backward compatibility.
 */
export function stageToLeadStatus(stage: ConversionStage): string {
  switch (stage) {
    case "new": return "new";
    case "engaged": return "contacted";
    case "qualified": return "following_up";
    case "link_sent": return "following_up";
    case "awaiting_form": return "responded";
    case "booked": return "booked";
    case "dead": return "dead";
    default: return "new";
  }
}
