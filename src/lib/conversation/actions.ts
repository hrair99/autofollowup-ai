// ============================================
// Next Best Action Resolver
// Determines what the bot should do given lead state + message classification
// ============================================

import type { Lead, Settings, AiClassification, NextAction, Intent } from "../types";
import { isQualified, shouldSendEnquiryLink } from "./stages";
import { getNextQualificationAction } from "./qualification";

interface ActionContext {
  lead: Lead;
  settings: Settings;
  classification: AiClassification;
  messageCount: number; // Total messages in conversation
}

/**
 * Resolve the next best action for the conversation engine.
 */
export function resolveNextAction(ctx: ActionContext): NextAction {
  const { lead, settings, classification, messageCount } = ctx;
  const { intent, sentiment, confidence } = classification;

  // --- Escalation checks ---
  if (shouldEscalate(intent, sentiment, confidence, settings)) {
    return "escalate_to_human";
  }

  // --- Terminal intents ---
  if (intent === "not_interested" || intent === "spam") {
    return "close_out";
  }

  if (intent === "thank_you") {
    return "close_out";
  }

  // --- New lead, first message ---
  if (lead.conversion_stage === "new" && messageCount <= 1) {
    // If they came in with a specific request, answer it
    if (isActionableIntent(intent)) {
      return "answer_question";
    }
    return "welcome_new";
  }

  // --- Enquiry link timing ---
  if (shouldSendEnquiryLink(lead, intent)) {
    return "send_enquiry_link";
  }

  // --- Already sent link, they're still chatting ---
  if (lead.conversion_stage === "link_sent" || lead.conversion_stage === "awaiting_form") {
    if (isQuestionIntent(intent)) {
      return "answer_question";
    }
    // Gently re-push the link
    return "send_enquiry_link";
  }

  // --- Emergency / urgent ---
  if (intent === "emergency_request" || classification.urgency === "emergency") {
    // Answer urgently and provide booking link immediately
    return "send_enquiry_link";
  }

  // --- Answer questions ---
  if (isQuestionIntent(intent)) {
    return "answer_question";
  }

  // --- Qualification flow ---
  if (!isQualified(lead)) {
    const qualAction = getNextQualificationAction(lead);
    if (qualAction) return qualAction;
  }

  // --- Qualified but haven't sent link yet ---
  if (isQualified(lead) && !lead.enquiry_link_sent_at) {
    return "send_enquiry_link";
  }

  // --- Default: answer and keep conversation going ---
  return "answer_question";
}

function isActionableIntent(intent: Intent): boolean {
  return [
    "pricing_question",
    "service_area_question",
    "repair_request",
    "install_request",
    "booking_request",
    "emergency_request",
    "quote_request",
    "general_question",
  ].includes(intent);
}

function isQuestionIntent(intent: Intent): boolean {
  return [
    "pricing_question",
    "service_area_question",
    "general_question",
    "repair_request",
    "install_request",
  ].includes(intent);
}

function shouldEscalate(
  intent: Intent,
  sentiment: string,
  confidence: number,
  settings: Settings
): boolean {
  // Angry customer
  if (sentiment === "angry") return true;

  // Complaint
  if (intent === "complaint") return true;

  // Low AI confidence
  if (confidence < 0.2) return true;

  // Check escalation keywords
  // (These would be checked against the message text in the engine)

  return false;
}

/**
 * Check if the message text contains any escalation keywords.
 */
export function containsEscalationKeyword(
  text: string,
  keywords: string[]
): boolean {
  if (!keywords.length) return false;
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}
