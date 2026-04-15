// ============================================
// AI Intent + Entity Classification
// Classifies every inbound message for the conversation engine
// ============================================

import { groqJson } from "./groq-client";
import type { AiClassification, Intent, UrgencyLevel, BookingReadiness, Sentiment, ExtractedEntities } from "../types";

interface ClassificationResult {
  intent: Intent;
  urgency: UrgencyLevel;
  service_type: string | null;
  location_mention: string | null;
  booking_readiness: BookingReadiness;
  pricing_sensitivity: boolean;
  sentiment: Sentiment;
  entities: ExtractedEntities;
  confidence: number;
}

const CLASSIFICATION_SYSTEM_PROMPT = `You are a message classifier for an HVAC/air conditioning service business.

Analyze the customer's message and return a JSON object with these fields:

{
  "intent": one of: "pricing_question", "service_area_question", "repair_request", "install_request", "booking_request", "emergency_request", "general_question", "quote_request", "follow_up_reply", "not_interested", "spam", "greeting", "thank_you", "complaint", "unknown",
  "urgency": one of: "low", "normal", "high", "emergency",
  "service_type": the specific service mentioned (e.g. "split system install", "ducted repair", "aircon service") or null,
  "location_mention": any suburb, city, or area mentioned, or null,
  "booking_readiness": one of: "unknown", "browsing", "considering", "ready", "booked",
  "pricing_sensitivity": true if the message is asking about cost/price/fee,
  "sentiment": one of: "positive", "neutral", "negative", "angry",
  "entities": {
    "suburb": extracted suburb/location or undefined,
    "job_type": "install" | "repair" | "service" | "maintenance" | "quote" or undefined,
    "urgency": "today" | "asap" | "this week" | "no rush" or undefined,
    "appliance_type": "split" | "ducted" | "multi-head" | "window" | "portable" or undefined,
    "preferred_timing": any timing preference mentioned or undefined,
    "service_category": specific category or undefined
  },
  "confidence": 0.0 to 1.0 indicating how confident you are in the classification
}

Classification guidelines:
- "booking_request": they want to book, schedule, or come out
- "quote_request": they want a quote or estimate
- "pricing_question": asking about cost/price/fee
- "repair_request": something is broken, not working, needs fixing
- "install_request": want a new system installed
- "emergency_request": urgent/emergency, no cooling/heating in extreme weather, etc.
- "service_area_question": asking if you service their area/suburb
- "follow_up_reply": responding to a previous message from the business
- "greeting": just saying hi/hello
- "thank_you": expressing thanks
- "not_interested": declining, saying no thanks
- "complaint": unhappy about service or experience
- "general_question": anything else about HVAC services

Return ONLY valid JSON, no markdown, no explanation.`;

/**
 * Classify an inbound message using Groq AI.
 * Returns structured classification or a sensible default on failure.
 */
export async function classifyMessage(
  messageText: string,
  conversationContext?: string
): Promise<ClassificationResult> {
  const userPrompt = conversationContext
    ? `Previous conversation context:\n${conversationContext}\n\nNew message to classify: "${messageText}"`
    : `Message to classify: "${messageText}"`;

  const result = await groqJson<ClassificationResult>(
    [
      { role: "system", content: CLASSIFICATION_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    { maxTokens: 400, temperature: 0.1 }
  );

  if (result && result.intent) {
    return {
      intent: result.intent,
      urgency: result.urgency || "normal",
      service_type: result.service_type || null,
      location_mention: result.location_mention || null,
      booking_readiness: result.booking_readiness || "unknown",
      pricing_sensitivity: result.pricing_sensitivity || false,
      sentiment: result.sentiment || "neutral",
      entities: result.entities || {},
      confidence: result.confidence || 0.5,
    };
  }

  // Fallback: basic keyword matching if AI fails
  return keywordClassify(messageText);
}

/**
 * Fallback keyword-based classification when AI is unavailable.
 */
function keywordClassify(text: string): ClassificationResult {
  const lower = text.toLowerCase();

  let intent: Intent = "general_question";
  let urgency: UrgencyLevel = "normal";
  let bookingReadiness: BookingReadiness = "unknown";
  let pricingSensitivity = false;
  const entities: ExtractedEntities = {};

  // Intent detection
  if (/\b(price|cost|how much|fee|rate|charge)\b/.test(lower)) {
    intent = "pricing_question";
    pricingSensitivity = true;
  } else if (/\b(quote|estimate)\b/.test(lower)) {
    intent = "quote_request";
    pricingSensitivity = true;
  } else if (/\b(book|schedule|appointment|come out|come today)\b/.test(lower)) {
    intent = "booking_request";
    bookingReadiness = "ready";
  } else if (/\b(repair|fix|broken|not working|not cooling|not heating|leaking)\b/.test(lower)) {
    intent = "repair_request";
    entities.job_type = "repair";
  } else if (/\b(install|new system|new unit|put in)\b/.test(lower)) {
    intent = "install_request";
    entities.job_type = "install";
  } else if (/\b(emergency|urgent|asap|right now|no cooling|no heating)\b/.test(lower)) {
    intent = "emergency_request";
    urgency = "emergency";
  } else if (/\b(service|cover|area|suburb)\b/.test(lower)) {
    intent = "service_area_question";
  } else if (/\b(hi|hello|hey|g'?day|good morning|good afternoon)\b/.test(lower)) {
    intent = "greeting";
  } else if (/\b(thanks|thank you|cheers|ta)\b/.test(lower)) {
    intent = "thank_you";
  } else if (/\b(no thanks|not interested|don't need|no longer)\b/.test(lower)) {
    intent = "not_interested";
  }

  // Urgency
  if (/\b(today|asap|urgent|emergency|right now|immediately)\b/.test(lower)) {
    urgency = "high";
    entities.urgency = "asap";
  }

  // Appliance type
  if (/\bsplit\b/.test(lower)) entities.appliance_type = "split";
  else if (/\bducted\b/.test(lower)) entities.appliance_type = "ducted";
  else if (/\bmulti[\s-]?head\b/.test(lower)) entities.appliance_type = "multi-head";

  return {
    intent,
    urgency,
    service_type: null,
    location_mention: null,
    booking_readiness: bookingReadiness,
    pricing_sensitivity: pricingSensitivity,
    sentiment: "neutral",
    entities,
    confidence: 0.3,
  };
}

/**
 * Check if a Facebook comment looks like a lead signal.
 */
export function isLeadSignalComment(commentText: string): boolean {
  const lower = commentText.toLowerCase().trim();
  const leadPatterns = [
    /\b(price|pricing|how much|cost)\b/,
    /\b(interested|interest)\b/,
    /\b(pm|dm|message)\b/,
    /\b(quote|estimate)\b/,
    /\b(need|want|looking for)\b/,
    /\b(book|booking)\b/,
    /\b(available|availability)\b/,
    /\bcan you\b/,
    /\bhow do i\b/,
  ];
  return leadPatterns.some((p) => p.test(lower));
}
