// ============================================
// Comment Classifier — Deterministic rules + AI classification
// Classifies Facebook comments for lead signal detection
// ============================================

import { groqJson } from "./groq-client";

// ============================================
// Types
// ============================================

export type CommentClassification =
  | "lead_interest"
  | "pricing_request"
  | "quote_request"
  | "booking_request"
  | "spam"
  | "complaint"
  | "support_request"
  | "non_lead"
  | "unclear";

export interface CommentClassificationResult {
  classification: CommentClassification;
  confidence: number;
  service_type: string | null;
  location: string | null;
  urgency: string | null;
  is_lead_signal: boolean;
  method: "rules" | "ai" | "rules+ai";
  reasoning: string;
  entities: {
    service_type?: string;
    location?: string;
    urgency?: string;
    job_type?: string;
  };
}

// ============================================
// Deterministic Rules — Fast, high-confidence patterns
// ============================================

interface RuleMatch {
  classification: CommentClassification;
  confidence: number;
  reasoning: string;
}

const STRONG_LEAD_PATTERNS: Array<{
  patterns: RegExp[];
  classification: CommentClassification;
  confidence: number;
  reasoning: string;
}> = [
  // Pricing / Cost
  {
    patterns: [
      /\b(price|pricing|how much|cost|rate|rates|fee|fees|charge)\b/i,
      /^\$?\d+\s*\??$/,  // Just a number with question mark
      /\bwhat('s| is| are) (the |your )?(price|cost|rate|fee)/i,
    ],
    classification: "pricing_request",
    confidence: 0.95,
    reasoning: "Explicit pricing/cost inquiry",
  },
  // Quote
  {
    patterns: [
      /\b(quote|estimate|ballpark)\b/i,
      /\bfree quote\b/i,
      /\bget a quote\b/i,
      /\bquote (me|us|please)\b/i,
    ],
    classification: "quote_request",
    confidence: 0.95,
    reasoning: "Explicit quote request",
  },
  // Booking
  {
    patterns: [
      /\b(book|booking|schedule|appointment)\b/i,
      /\bcome (out|over|to)\b/i,
      /\bcan (you|someone) come\b/i,
      /\bavailab(le|ility)\b/i,
    ],
    classification: "booking_request",
    confidence: 0.90,
    reasoning: "Booking or availability request",
  },
  // Direct interest
  {
    patterns: [
      /\binterested\b/i,
      /\bi('m| am) interested\b/i,
      /\byes please\b/i,
      /\bsign me up\b/i,
      /\bcount me in\b/i,
    ],
    classification: "lead_interest",
    confidence: 0.90,
    reasoning: "Direct expression of interest",
  },
  // DM / Message requests
  {
    patterns: [
      /\b(pm|dm|inbox|message)\s*(me|sent|please|pls)?\b/i,
      /\bsend (me |us )?a? ?(message|dm|pm)\b/i,
      /\bpm('d|ed)?\b/i,
      /\bmessage sent\b/i,
      /\bsent (a )?message\b/i,
      /\binbox(ed)?\b/i,
    ],
    classification: "lead_interest",
    confidence: 0.85,
    reasoning: "Request for DM or notification of message",
  },
  // Service need
  {
    patterns: [
      /\bneed\s+(a |an )?(aircon|air con|air conditioning|hvac|split|ducted|ac)\b/i,
      /\bneed\s+(a |an )?(repair|service|install|maintenance|quote)\b/i,
      /\blooking for\s+(a |an )?(aircon|plumber|electrician|hvac)\b/i,
      /\bwant\s+(a |an )?(new|split|ducted)\b/i,
    ],
    classification: "lead_interest",
    confidence: 0.90,
    reasoning: "Explicit service need",
  },
  // Spam patterns
  {
    patterns: [
      /\b(click here|buy now|free money|crypto|bitcoin|forex)\b/i,
      /\b(earn \$|make money|work from home|mlm)\b/i,
      /https?:\/\/(?!book\.servicem8|facebook\.com)/i,  // External links (not ServiceM8 or Facebook)
    ],
    classification: "spam",
    confidence: 0.90,
    reasoning: "Spam pattern detected",
  },
  // Complaint
  {
    patterns: [
      /\b(terrible|awful|worst|horrible|rip ?off|scam|never again)\b/i,
      /\b(waste of|don't bother|stay away|avoid)\b/i,
    ],
    classification: "complaint",
    confidence: 0.85,
    reasoning: "Complaint or negative sentiment",
  },
];

const WEAK_LEAD_PATTERNS: Array<{
  patterns: RegExp[];
  classification: CommentClassification;
  confidence: number;
  reasoning: string;
}> = [
  // Soft interest signals
  {
    patterns: [
      /\binfo\b/i,
      /\bmore (info|details|information)\b/i,
      /\btell me more\b/i,
    ],
    classification: "lead_interest",
    confidence: 0.70,
    reasoning: "Information request — moderate lead signal",
  },
  // Service area questions
  {
    patterns: [
      /\bdo you (service|cover|come to)\b/i,
      /\bwhat area/i,
      /\b(service|cover)\s+(my |the )?(area|suburb|region)\b/i,
    ],
    classification: "lead_interest",
    confidence: 0.75,
    reasoning: "Service area inquiry",
  },
  // Support / existing customer
  {
    patterns: [
      /\bnot (working|cooling|heating)\b/i,
      /\b(broken|leaking|noisy)\b/i,
      /\bwarranty\b/i,
    ],
    classification: "support_request",
    confidence: 0.75,
    reasoning: "Support or repair need",
  },
];

// Non-lead patterns (high confidence skip)
const NON_LEAD_PATTERNS: RegExp[] = [
  /^(lol|haha|nice|great|awesome|love it|beautiful|wow|omg|😂|👍|❤️|🔥|💯)+$/i,
  /^(tag|tagging|@)\s/i,
  /^@\w+\s*$/,  // Just tagging someone
  /^(shared|sharing)\b/i,
];

// ============================================
// Entity extraction
// ============================================

function extractEntities(text: string): CommentClassificationResult["entities"] {
  const entities: CommentClassificationResult["entities"] = {};
  const lower = text.toLowerCase();

  // Service type
  if (/\bsplit\s*(system)?/i.test(text)) entities.service_type = "split system";
  else if (/\bducted/i.test(text)) entities.service_type = "ducted system";
  else if (/\bmulti[\s-]?head/i.test(text)) entities.service_type = "multi-head";
  else if (/\b(aircon|air con|air conditioning|ac|hvac)\b/i.test(text)) entities.service_type = "air conditioning";

  // Job type
  if (/\b(install|installation|new)\b/i.test(lower)) entities.job_type = "install";
  else if (/\b(repair|fix|broken|not working)\b/i.test(lower)) entities.job_type = "repair";
  else if (/\b(service|maintenance|clean)\b/i.test(lower)) entities.job_type = "service";

  // Urgency
  if (/\b(asap|urgent|emergency|today|right now|immediately)\b/i.test(lower)) {
    entities.urgency = "high";
  } else if (/\b(this week|soon|when available)\b/i.test(lower)) {
    entities.urgency = "normal";
  }

  // Location — look for Australian suburb patterns (word + optional 4-digit postcode)
  const locationMatch = text.match(/\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s+(\d{4})\b/);
  if (locationMatch) {
    entities.location = `${locationMatch[1]} ${locationMatch[2]}`;
  }

  return entities;
}

// ============================================
// Rule-based classification
// ============================================

function classifyByRules(text: string): RuleMatch | null {
  const trimmed = text.trim();

  // Skip very short non-lead comments
  if (trimmed.length <= 2) {
    return { classification: "non_lead", confidence: 0.95, reasoning: "Too short to be a lead signal" };
  }

  // Check non-lead patterns first
  for (const pattern of NON_LEAD_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { classification: "non_lead", confidence: 0.95, reasoning: "Non-lead reaction or tag" };
    }
  }

  // Check strong lead patterns
  for (const rule of STRONG_LEAD_PATTERNS) {
    for (const pattern of rule.patterns) {
      if (pattern.test(trimmed)) {
        return {
          classification: rule.classification,
          confidence: rule.confidence,
          reasoning: rule.reasoning,
        };
      }
    }
  }

  // Check weak lead patterns
  for (const rule of WEAK_LEAD_PATTERNS) {
    for (const pattern of rule.patterns) {
      if (pattern.test(trimmed)) {
        return {
          classification: rule.classification,
          confidence: rule.confidence,
          reasoning: rule.reasoning,
        };
      }
    }
  }

  return null; // No rule matched — fall through to AI
}

// ============================================
// AI classification (for ambiguous comments)
// ============================================

const COMMENT_CLASSIFICATION_PROMPT = `You are a comment classifier for an HVAC/air conditioning service business Facebook page.

Analyze the comment and return a JSON object:

{
  "classification": one of: "lead_interest", "pricing_request", "quote_request", "booking_request", "spam", "complaint", "support_request", "non_lead", "unclear",
  "confidence": 0.0 to 1.0,
  "is_lead_signal": true/false - whether this person might become a customer,
  "service_type": specific service mentioned or null,
  "location": suburb/area mentioned or null,
  "urgency": "low" | "normal" | "high" | "emergency" or null,
  "reasoning": brief explanation of classification
}

Classification guide:
- "lead_interest": shows interest in services, wants info, mentions need
- "pricing_request": asking about cost/price/fees
- "quote_request": asking for a quote or estimate
- "booking_request": wants to book, schedule, or have someone come out
- "spam": promotional, unrelated, or spam content
- "complaint": expressing dissatisfaction
- "support_request": existing customer needing help/repair
- "non_lead": social engagement only (likes, tags, reactions, general chat)
- "unclear": can't determine intent confidently

Lead signals include any comment suggesting the person might want air conditioning services.
Non-leads include: emoji-only reactions, tagging friends, general praise without service interest, unrelated discussion.

Return ONLY valid JSON.`;

interface AiCommentResult {
  classification: CommentClassification;
  confidence: number;
  is_lead_signal: boolean;
  service_type: string | null;
  location: string | null;
  urgency: string | null;
  reasoning: string;
}

async function classifyByAi(text: string, postContext?: string): Promise<AiCommentResult | null> {
  const userPrompt = postContext
    ? `Post context: "${postContext}"\n\nComment to classify: "${text}"`
    : `Comment to classify: "${text}"`;

  const result = await groqJson<AiCommentResult>(
    [
      { role: "system", content: COMMENT_CLASSIFICATION_PROMPT },
      { role: "user", content: userPrompt },
    ],
    { maxTokens: 200, temperature: 0.1 }
  );

  return result;
}

// ============================================
// Main classifier — Rules first, AI fallback
// ============================================

export async function classifyComment(
  commentText: string,
  options?: {
    postContext?: string;
    skipAi?: boolean;
  }
): Promise<CommentClassificationResult> {
  const entities = extractEntities(commentText);

  // Step 1: Try deterministic rules
  const ruleResult = classifyByRules(commentText);

  if (ruleResult && ruleResult.confidence >= 0.85) {
    // High-confidence rule match — use it directly
    return {
      classification: ruleResult.classification,
      confidence: ruleResult.confidence,
      service_type: entities.service_type || null,
      location: entities.location || null,
      urgency: entities.urgency || null,
      is_lead_signal: isLeadClassification(ruleResult.classification),
      method: "rules",
      reasoning: ruleResult.reasoning,
      entities,
    };
  }

  // Step 2: If rules gave a weak match or nothing, try AI
  if (!options?.skipAi) {
    const aiResult = await classifyByAi(commentText, options?.postContext);

    if (aiResult && aiResult.confidence > 0) {
      // If we had a weak rule match, use the higher-confidence one
      if (ruleResult && ruleResult.confidence > aiResult.confidence) {
        return {
          classification: ruleResult.classification,
          confidence: ruleResult.confidence,
          service_type: entities.service_type || aiResult.service_type,
          location: entities.location || aiResult.location,
          urgency: entities.urgency || aiResult.urgency,
          is_lead_signal: isLeadClassification(ruleResult.classification),
          method: "rules+ai",
          reasoning: ruleResult.reasoning,
          entities,
        };
      }

      return {
        classification: aiResult.classification,
        confidence: aiResult.confidence,
        service_type: entities.service_type || aiResult.service_type,
        location: entities.location || aiResult.location,
        urgency: entities.urgency || aiResult.urgency,
        is_lead_signal: aiResult.is_lead_signal || isLeadClassification(aiResult.classification),
        method: ruleResult ? "rules+ai" : "ai",
        reasoning: aiResult.reasoning,
        entities,
      };
    }
  }

  // Step 3: Fall back to rule result if AI failed
  if (ruleResult) {
    return {
      classification: ruleResult.classification,
      confidence: ruleResult.confidence,
      service_type: entities.service_type || null,
      location: entities.location || null,
      urgency: entities.urgency || null,
      is_lead_signal: isLeadClassification(ruleResult.classification),
      method: "rules",
      reasoning: ruleResult.reasoning,
      entities,
    };
  }

  // Step 4: No match at all
  return {
    classification: "unclear",
    confidence: 0.2,
    service_type: entities.service_type || null,
    location: entities.location || null,
    urgency: entities.urgency || null,
    is_lead_signal: false,
    method: "rules",
    reasoning: "No matching classification pattern found",
    entities,
  };
}

// ============================================
// Helpers
// ============================================

function isLeadClassification(classification: CommentClassification): boolean {
  return [
    "lead_interest",
    "pricing_request",
    "quote_request",
    "booking_request",
    "support_request",
  ].includes(classification);
}

/**
 * Quick check if a comment text matches any lead keywords.
 * Used for fast filtering before full classification.
 */
export function quickLeadSignalCheck(text: string, customKeywords?: string[]): boolean {
  const lower = text.toLowerCase().trim();

  // Built-in lead signal words
  const builtInPatterns = [
    /\b(price|pricing|how much|cost|quote|estimate)\b/,
    /\b(interested|interest|need|want|looking for)\b/,
    /\b(pm|dm|message|inbox)\b/,
    /\b(book|booking|available|availability)\b/,
    /\b(can you|how do i|do you)\b/,
    /\b(repair|install|service|maintenance)\b/,
    /\b(aircon|air con|split|ducted|hvac)\b/,
  ];

  if (builtInPatterns.some((p) => p.test(lower))) return true;

  // Custom keywords from settings
  if (customKeywords?.length) {
    return customKeywords.some((kw) => lower.includes(kw.toLowerCase()));
  }

  return false;
}
