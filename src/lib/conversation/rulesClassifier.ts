// ============================================
// Rules-first classifier — runs BEFORE Groq
//
// Goal: make the common/obvious cases deterministic, cheap, and debuggable.
// Only fall through to AI (Groq) when rule confidence is low.
// ============================================

export type RuleIntent =
  | "emergency_request"
  | "quote_request"
  | "install_request"
  | "service_request"
  | "pricing_question"
  | "location_question"
  | "general_question"
  | "spam"
  | "low_signal";

export type RuleUrgency = "emergency" | "high" | "normal" | "low";

export interface RuleIntentResult {
  intent: RuleIntent;
  urgency: RuleUrgency;
  confidence: number;            // 0..1
  matchedKeywords: string[];
  requiredFields: string[];
  recommendedNextQuestion: string | null;
  isSpam: boolean;
}

// --- Keyword banks (HR AIR = residential/commercial air conditioning) ---

const EMERGENCY_KEYWORDS = [
  "emergency", "urgent", "asap", "today", "right now", "not working",
  "broken", "broke down", "breakdown", "no cooling", "no heating",
  "leaking", "smoking", "sparks", "tripping", "burning smell",
];

const QUOTE_KEYWORDS = [
  "quote", "quotation", "estimate", "how much", "pricing",
  "price", "cost", "ballpark", "rough price",
];

const INSTALL_KEYWORDS = [
  "install", "installation", "new system", "new unit", "new aircon",
  "new air con", "new split", "supply and install", "ducted",
  "replace", "replacement", "upgrade",
];

const SERVICE_KEYWORDS = [
  "service", "maintenance", "clean", "tune up", "tune-up",
  "filter", "annual", "check up", "check-up", "inspect",
];

const PRICING_ONLY_SOFT = [
  "just asking", "just curious", "browsing", "looking around",
];

const LOCATION_KEYWORDS = [
  "do you service", "do you cover", "service area",
  "are you in", "come out to",
];

const SPAM_KEYWORDS = [
  "telegram @", "whatsapp +", "click here", "http://", "https://",
  "bitcoin", "crypto", "investment", "forex", "loan",
  "visit my profile", "check my bio", "dm me for",
];

function countHits(text: string, bank: string[]): string[] {
  const hits: string[] = [];
  const t = text.toLowerCase();
  for (const kw of bank) {
    if (t.includes(kw)) hits.push(kw);
  }
  return hits;
}

function hasAny(text: string, bank: string[]): boolean {
  const t = text.toLowerCase();
  return bank.some((kw) => t.includes(kw));
}

/**
 * Apply rules to a raw comment/message.
 * HR AIR required fields: suburb/postcode, service type, system type, contact preference.
 */
export function classifyByRules(text: string): RuleIntentResult {
  const clean = (text || "").trim();

  // Empty / ultra-short → low signal
  if (clean.length < 3) {
    return {
      intent: "low_signal",
      urgency: "low",
      confidence: 0.9,
      matchedKeywords: [],
      requiredFields: [],
      recommendedNextQuestion: null,
      isSpam: false,
    };
  }

  // Spam first (cheap)
  const spamHits = countHits(clean, SPAM_KEYWORDS);
  if (spamHits.length > 0) {
    return {
      intent: "spam",
      urgency: "low",
      confidence: 0.95,
      matchedKeywords: spamHits,
      requiredFields: [],
      recommendedNextQuestion: null,
      isSpam: true,
    };
  }

  const baseRequired = [
    "suburb_or_postcode",
    "service_type",
    "system_type",
    "contact_preference",
  ];

  // Emergency — highest priority
  const emergencyHits = countHits(clean, EMERGENCY_KEYWORDS);
  if (emergencyHits.length > 0) {
    return {
      intent: "emergency_request",
      urgency: "emergency",
      confidence: 0.9,
      matchedKeywords: emergencyHits,
      requiredFields: baseRequired,
      recommendedNextQuestion:
        "To get you sorted fast — what's your suburb and is the unit completely down or partially working?",
      isSpam: false,
    };
  }

  const installHits = countHits(clean, INSTALL_KEYWORDS);
  const quoteHits = countHits(clean, QUOTE_KEYWORDS);
  const serviceHits = countHits(clean, SERVICE_KEYWORDS);
  const locationHits = countHits(clean, LOCATION_KEYWORDS);

  if (installHits.length > 0) {
    return {
      intent: "install_request",
      urgency: quoteHits.length > 0 ? "normal" : "normal",
      confidence: 0.85,
      matchedKeywords: [...installHits, ...quoteHits],
      requiredFields: baseRequired,
      recommendedNextQuestion:
        "Happy to help. What's the suburb and roughly what size area are we cooling/heating?",
      isSpam: false,
    };
  }

  if (serviceHits.length > 0) {
    return {
      intent: "service_request",
      urgency: "normal",
      confidence: 0.8,
      matchedKeywords: serviceHits,
      requiredFields: baseRequired,
      recommendedNextQuestion:
        "No problem. What's your suburb and what brand/type of system is it?",
      isSpam: false,
    };
  }

  if (quoteHits.length > 0) {
    // Pure price question with no install/service context
    const softBrowse = hasAny(clean, PRICING_ONLY_SOFT);
    return {
      intent: softBrowse ? "pricing_question" : "quote_request",
      urgency: "normal",
      confidence: softBrowse ? 0.6 : 0.75,
      matchedKeywords: quoteHits,
      requiredFields: baseRequired,
      recommendedNextQuestion:
        "Pricing depends on the job. What's the suburb and what are you looking at — a new install, service, or a repair?",
      isSpam: false,
    };
  }

  if (locationHits.length > 0) {
    return {
      intent: "location_question",
      urgency: "normal",
      confidence: 0.75,
      matchedKeywords: locationHits,
      requiredFields: ["suburb_or_postcode"],
      recommendedNextQuestion: "What suburb are you in?",
      isSpam: false,
    };
  }

  // Nothing matched — defer to AI
  return {
    intent: "general_question",
    urgency: "normal",
    confidence: 0.25,
    matchedKeywords: [],
    requiredFields: baseRequired,
    recommendedNextQuestion: null,
    isSpam: false,
  };
}

/**
 * Should we skip the AI call and trust rules?
 * Threshold is intentionally high — we only skip AI when rules are very confident.
 */
export function rulesAreConfident(result: RuleIntentResult): boolean {
  return result.confidence >= 0.7 && result.intent !== "general_question";
}